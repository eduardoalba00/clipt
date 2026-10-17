//! Recording. ScreenCaptureKit captures the screen (the system picker for a
//! display or window, our own overlay for a dragged selection) and an
//! `AVAssetWriter` writes it as a take. The mic and camera come from an
//! `AVCaptureSession`. Every stream is timed on the host clock and the files
//! start at the first screen frame, so they line up.

use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message,
};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSBezierPath, NSColor, NSCursor, NSEvent, NSFont, NSScreen,
    NSStringDrawing, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVAuthorizationStatus,
    AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureConnection,
    AVCaptureDevice, AVCaptureDeviceInput, AVCaptureOutput, AVCaptureSession,
    AVCaptureVideoDataOutput, AVCaptureVideoDataOutputSampleBufferDelegate, AVMediaType,
};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_media::{CMClock, CMSampleBuffer, CMTime};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize, NSString,
};
use objc2_screen_capture_kit::{
    SCContentFilter, SCContentSharingPicker, SCContentSharingPickerMode,
    SCContentSharingPickerObserver, SCDisplay, SCFrameStatus, SCRunningApplication,
    SCShareableContent, SCShareableContentStyle, SCStream, SCStreamConfiguration, SCStreamDelegate,
    SCStreamOutput, SCStreamOutputType, SCWindow,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::objc::{any, dict, int, k, ns, num};
use crate::take::Take;

pub const STOP_SHORTCUT: &str = "CmdOrCtrl+Shift+2";

/// The longest side of a recording. Plenty for a 1080p export, even cropped.
const MAX_SIDE: f64 = 3840.0;
const FPS: i32 = 60;
/// kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
const YUV420V: u32 = u32::from_be_bytes(*b"420v");
const SOUND: u32 = u32::from_be_bytes(*b"soun");

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Screen,
    Selection,
    Window,
}

#[derive(Serialize, Clone)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum Event {
    Started,
    Finished { take: Box<crate::take::Info> },
    Cancelled,
    Failed { message: String },
}

/// Moves framework objects between threads; every use is serialized.
struct Send<T>(T);
// SAFETY: Callers serialize access (a mutex, or handing over once).
unsafe impl<T> std::marker::Send for Send<T> {}
// SAFETY: See above.
unsafe impl<T> Sync for Send<T> {}

fn emit(app: &AppHandle, event: Event) {
    let _ = app.emit("recording", event);
}

// ---------------------------------------------------------------------------
// Writing

struct Track {
    writer: Retained<AVAssetWriter>,
    video: Retained<AVAssetWriterInput>,
    audio: Option<Retained<AVAssetWriterInput>>,
    started: bool,
}

impl Track {
    fn new(
        path: &std::path::Path,
        codec: &NSString,
        width: f64,
        height: f64,
        bitrate: i64,
        audio: bool,
    ) -> Result<Track> {
        let _ = std::fs::remove_file(path);
        // SAFETY: Plain AVFoundation setup.
        unsafe {
            let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
                &crate::objc::file_url(path),
                k!(objc2_av_foundation::AVFileTypeQuickTimeMovie),
            )
            .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
            let compression = dict(&[
                (
                    k!(objc2_av_foundation::AVVideoAverageBitRateKey),
                    any(&*int(bitrate)),
                ),
                (
                    k!(objc2_av_foundation::AVVideoExpectedSourceFrameRateKey),
                    any(&*int(FPS as i64)),
                ),
                (
                    k!(objc2_av_foundation::AVVideoMaxKeyFrameIntervalKey),
                    any(&*int(FPS as i64 * 2)),
                ),
                (
                    k!(objc2_av_foundation::AVVideoAllowFrameReorderingKey),
                    any(&*NSNumber::new_bool(false)),
                ),
            ]);
            let settings = dict(&[
                (k!(objc2_av_foundation::AVVideoCodecKey), any(codec)),
                (
                    k!(objc2_av_foundation::AVVideoWidthKey),
                    any(&*int(width as i64)),
                ),
                (
                    k!(objc2_av_foundation::AVVideoHeightKey),
                    any(&*int(height as i64)),
                ),
                (
                    k!(objc2_av_foundation::AVVideoCompressionPropertiesKey),
                    any(&*compression),
                ),
            ]);
            let video = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                k!(objc2_av_foundation::AVMediaTypeVideo),
                Some(&settings),
            );
            video.setExpectsMediaDataInRealTime(true);
            if !writer.canAddInput(&video) {
                bail!("Couldn't set up the video encoder");
            }
            writer.addInput(&video);
            let audio = if audio {
                let settings = dict(&[
                    (
                        &*ns("AVFormatIDKey"),
                        any(&*int(u32::from_be_bytes(*b"aac ") as i64)),
                    ),
                    (&*ns("AVSampleRateKey"), any(&*num(48_000.0))),
                    (&*ns("AVNumberOfChannelsKey"), any(&*int(1))),
                    (&*ns("AVEncoderBitRateKey"), any(&*int(128_000))),
                ]);
                let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                    k!(objc2_av_foundation::AVMediaTypeAudio),
                    Some(&settings),
                );
                input.setExpectsMediaDataInRealTime(true);
                writer.canAddInput(&input).then(|| {
                    writer.addInput(&input);
                    input
                })
            } else {
                None
            };
            if !writer.startWriting() {
                bail!(
                    "Couldn't start writing: {}",
                    crate::objc::error_text(writer.error())
                );
            }
            Ok(Track {
                writer,
                video,
                audio,
                started: false,
            })
        }
    }

    fn append_video(&mut self, sample: &CMSampleBuffer, t0: CMTime) {
        // SAFETY: Called under the track's mutex.
        unsafe {
            if !self.started {
                self.writer.startSessionAtSourceTime(t0);
                self.started = true;
            }
            if self.video.isReadyForMoreMediaData() {
                self.video.appendSampleBuffer(sample);
            }
        }
    }

    fn append_audio(&mut self, sample: &CMSampleBuffer) {
        // SAFETY: Called under the track's mutex, after the session started.
        unsafe {
            if let Some(audio) = &self.audio {
                if self.started && audio.isReadyForMoreMediaData() {
                    audio.appendSampleBuffer(sample);
                }
            }
        }
    }

    /// Finishes the file. Returns whether anything was written.
    fn finish(self, end: CMTime) -> bool {
        // SAFETY: No more appends happen once the streams have stopped.
        unsafe {
            if !self.started {
                self.writer.cancelWriting();
                return false;
            }
            self.video.markAsFinished();
            if let Some(audio) = &self.audio {
                audio.markAsFinished();
            }
            self.writer.endSessionAtSourceTime(end);
            let writer = self.writer.clone();
            crate::objc::wait(Duration::from_secs(30), |tx| {
                let block = block2::RcBlock::new(move || {
                    let _ = tx.send(());
                });
                writer.finishWritingWithCompletionHandler(&block);
            });
            self.writer.status() == AVAssetWriterStatus::Completed
        }
    }
}

struct Shared {
    app: AppHandle,
    screen: Mutex<Option<Send<Track>>>,
    camera: Mutex<Option<Send<Track>>>,
    /// Host time of the first screen frame; every file starts here.
    t0: Mutex<Option<CMTime>>,
    frames: AtomicU64,
    stopping: AtomicBool,
    /// The capture session's clock, to bring mic and camera times to host time.
    capture_clock: Mutex<Option<Send<Retained<CMClock>>>>,
}

fn host_now() -> CMTime {
    // SAFETY: Reading the host clock.
    unsafe { CMClock::host_time_clock().time() }
}

fn frame_complete(sample: &CMSampleBuffer) -> bool {
    // SAFETY: SCK attaches an array of dictionaries to each sample.
    unsafe {
        let Some(attachments) = sample.sample_attachments_array(false) else {
            return false;
        };
        let array = &*(objc2_core_foundation::CFRetained::as_ptr(&attachments).as_ptr()
            as *const NSArray<NSDictionary<NSString, AnyObject>>);
        let Some(info) = array.firstObject() else {
            return false;
        };
        let key: &NSString = objc2_screen_capture_kit::SCStreamFrameInfoStatus;
        let Some(status) = info.objectForKey(key) else {
            return false;
        };
        let Some(status) = status.downcast_ref::<NSNumber>() else {
            return false;
        };
        status.integerValue() == SCFrameStatus::Complete.0
    }
}

impl Shared {
    fn on_screen(&self, sample: &CMSampleBuffer) {
        if self.stopping.load(Ordering::SeqCst) || !frame_complete(sample) {
            return;
        }
        // SAFETY: A valid sample from SCK.
        let pts = unsafe { sample.presentation_time_stamp() };
        let t0 = *self
            .t0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert(pts);
        if let Some(track) = self
            .screen
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            track.0.append_video(sample, t0);
        }
        self.frames.fetch_add(1, Ordering::SeqCst);
    }

    /// A mic or camera sample, moved onto the host clock. Dropped before the
    /// first screen frame.
    fn on_capture(&self, sample: &CMSampleBuffer) {
        if self.stopping.load(Ordering::SeqCst) {
            return;
        }
        let Some(t0) = *self.t0.lock().unwrap_or_else(|e| e.into_inner()) else {
            return;
        };
        let clock = self.capture_clock.lock().unwrap_or_else(|e| e.into_inner());
        let retimed = clock.as_ref().and_then(|c| retime(sample, &c.0));
        drop(clock);
        let sample: &CMSampleBuffer = retimed.as_deref().unwrap_or(sample);
        // SAFETY: A valid sample from AVCaptureSession.
        unsafe {
            if sample.presentation_time_stamp().compare(t0) < 0 {
                return;
            }
            let sound = sample
                .format_description()
                .is_some_and(|f| f.media_type() == SOUND);
            if sound {
                if let Some(track) = self
                    .screen
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_mut()
                {
                    track.0.append_audio(sample);
                }
            } else if let Some(cam) = self
                .camera
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_mut()
            {
                cam.0.append_video(sample, t0);
            }
        }
    }
}

/// A copy of `sample` stamped in host time, if `clock` isn't the host clock.
fn retime(
    sample: &CMSampleBuffer,
    clock: &CMClock,
) -> Option<objc2_core_foundation::CFRetained<CMSampleBuffer>> {
    // SAFETY: CoreMedia calls on a valid sample buffer.
    unsafe {
        let host = CMClock::host_time_clock();
        let pts = sample.presentation_time_stamp();
        let mapped = objc2_core_media::CMSyncConvertTime(pts, clock, &host);
        if mapped.compare(pts) == 0 {
            return None;
        }
        let count = sample.num_samples().max(1);
        let duration = sample.duration();
        let each = if count > 1 {
            CMTime::new(duration.value / count as i64, duration.timescale)
        } else {
            duration
        };
        let timing = objc2_core_media::CMSampleTimingInfo {
            duration: each,
            presentationTimeStamp: mapped,
            decodeTimeStamp: objc2_core_media::kCMTimeInvalid,
        };
        let mut out: *mut CMSampleBuffer = std::ptr::null_mut();
        let status = CMSampleBuffer::create_copy_with_new_timing(
            None,
            sample,
            1,
            &timing,
            std::ptr::NonNull::from(&mut out),
        );
        if status != 0 || out.is_null() {
            return None;
        }
        Some(objc2_core_foundation::CFRetained::from_raw(
            std::ptr::NonNull::new_unchecked(out),
        ))
    }
}

// ---------------------------------------------------------------------------
// Delegates

pub struct OutputIvars {
    shared: Arc<Shared>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[name = "CliptStreamOutput"]
    #[ivars = OutputIvars]
    struct StreamOutput;

    unsafe impl NSObjectProtocol for StreamOutput {}

    unsafe impl SCStreamOutput for StreamOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind == SCStreamOutputType::Screen {
                self.ivars().shared.on_screen(sample);
            }
        }
    }

    unsafe impl SCStreamDelegate for StreamOutput {
        #[unsafe(method(stream:didStopWithError:))]
        fn did_stop(&self, _stream: &SCStream, _error: &NSError) {
            // The display went away, or sharing was stopped from the system.
            let app = self.ivars().shared.app.clone();
            std::thread::spawn(move || stop(&app));
        }
    }

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for StreamOutput {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn capture_output(
            &self,
            _output: &AVCaptureOutput,
            sample: &CMSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            self.ivars().shared.on_capture(sample);
        }
    }

    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for StreamOutput {}
);

impl StreamOutput {
    fn create(shared: Arc<Shared>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars { shared });
        // SAFETY: NSObject's init.
        unsafe { msg_send![super(this), init] }
    }
}

enum Picked {
    Filter(Send<Retained<SCContentFilter>>),
    Cancelled,
    Failed(String),
}

pub struct PickerIvars {
    reply: Mutex<Option<Sender<Picked>>>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[name = "CliptPickerObserver"]
    #[ivars = PickerIvars]
    struct PickerObserver;

    unsafe impl NSObjectProtocol for PickerObserver {}

    unsafe impl SCContentSharingPickerObserver for PickerObserver {
        #[unsafe(method(contentSharingPicker:didCancelForStream:))]
        fn did_cancel(&self, _picker: &SCContentSharingPicker, _stream: Option<&SCStream>) {
            self.reply(Picked::Cancelled);
        }

        #[unsafe(method(contentSharingPicker:didUpdateWithFilter:forStream:))]
        fn did_pick(
            &self,
            _picker: &SCContentSharingPicker,
            filter: &SCContentFilter,
            _stream: Option<&SCStream>,
        ) {
            self.reply(Picked::Filter(Send(filter.retain())));
        }

        #[unsafe(method(contentSharingPickerStartDidFailWithError:))]
        fn did_fail(&self, error: &NSError) {
            self.reply(Picked::Failed(error.localizedDescription().to_string()));
        }
    }
);

impl PickerObserver {
    fn create(reply: Sender<Picked>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(PickerIvars {
            reply: Mutex::new(Some(reply)),
        });
        // SAFETY: NSObject's init.
        unsafe { msg_send![super(this), init] }
    }

    fn reply(&self, picked: Picked) {
        if let Some(tx) = self
            .ivars()
            .reply
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = tx.send(picked);
        }
    }
}

// ---------------------------------------------------------------------------
// Choosing what to record

fn on_main<R: std::marker::Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(MainThreadMarker) -> R + std::marker::Send + 'static,
) -> Result<R> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = tx.send(f(mtm));
        }
    })?;
    rx.recv().map_err(|_| anyhow!("The main thread went away"))
}

/// Shows the system picker and waits for a display or window.
fn pick(app: &AppHandle, kind: Kind) -> Result<Option<Retained<SCContentFilter>>> {
    let (tx, rx) = mpsc::channel();
    let observer = on_main(app, move |_| {
        // SAFETY: Main-thread ScreenCaptureKit calls.
        unsafe {
            let picker = SCContentSharingPicker::sharedPicker();
            let config = picker.defaultConfiguration();
            let mode = if kind == Kind::Window {
                SCContentSharingPickerMode::SingleWindow
            } else {
                SCContentSharingPickerMode::SingleDisplay
            };
            config.setAllowedPickerModes(mode);
            config.setAllowsChangingSelectedContent(false);
            if let Some(id) = objc2_foundation::NSBundle::mainBundle().bundleIdentifier() {
                config.setExcludedBundleIDs(&NSArray::from_retained_slice(&[id]));
            }
            picker.setDefaultConfiguration(&config);
            picker.setMaximumStreamCount(Some(&NSNumber::new_isize(1)));
            let observer = PickerObserver::create(tx);
            picker.addObserver(ProtocolObject::from_ref(&*observer));
            picker.setActive(true);
            let style = if kind == Kind::Window {
                SCShareableContentStyle::Window
            } else {
                SCShareableContentStyle::Display
            };
            picker.presentPickerUsingContentStyle(style);
            Send(observer)
        }
    })?;
    let picked = rx
        .recv_timeout(Duration::from_secs(15 * 60))
        .unwrap_or(Picked::Cancelled);
    let _ = on_main(app, move |_| {
        // SAFETY: Main-thread ScreenCaptureKit calls.
        unsafe {
            let picker = SCContentSharingPicker::sharedPicker();
            picker.removeObserver(ProtocolObject::from_ref(&*observer.0));
        }
    });
    match picked {
        Picked::Filter(f) => Ok(Some(f.0)),
        Picked::Cancelled => {
            deactivate_picker(app);
            Ok(None)
        }
        Picked::Failed(e) => {
            deactivate_picker(app);
            Err(anyhow!(e))
        }
    }
}

fn deactivate_picker(app: &AppHandle) {
    let _ = on_main(app, |_| {
        // SAFETY: Main-thread ScreenCaptureKit call.
        unsafe { SCContentSharingPicker::sharedPicker().setActive(false) };
    });
}

/// A dragged area: the display it's on and the rect in display points
/// (origin top-left), plus the display's pixel scale.
#[derive(Clone, Copy, Debug)]
struct Area {
    display: u32,
    rect: CGRect,
}

pub struct SelectIvars {
    start: Cell<Option<NSPoint>>,
    current: Cell<Option<NSRect>>,
    display: u32,
    scale: f64,
}

define_class!(
    // SAFETY: NSWindow has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSWindow))]
    #[thread_kind = MainThreadOnly]
    #[name = "CliptSelectWindow"]
    struct SelectWindow;

    impl SelectWindow {
        /// Borderless windows can't take key events unless they say so.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool {
            true
        }
    }
);

define_class!(
    // SAFETY: NSView has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "CliptSelectView"]
    #[ivars = SelectIvars]
    struct SelectView;

    impl SelectView {
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(resetCursorRects))]
        fn reset_cursor_rects(&self) {
            self.addCursorRect_cursor(self.bounds(), &NSCursor::crosshairCursor());
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            let p = self.convertPoint_fromView(event.locationInWindow(), None);
            self.ivars().start.set(Some(p));
            self.ivars().current.set(None);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            let Some(a) = self.ivars().start.get() else { return };
            let b = self.convertPoint_fromView(event.locationInWindow(), None);
            let bounds = self.bounds();
            let bx = b.x.clamp(0.0, bounds.size.width);
            let by = b.y.clamp(0.0, bounds.size.height);
            let rect = NSRect::new(
                NSPoint::new(a.x.min(bx).round(), a.y.min(by).round()),
                NSSize::new((a.x - bx).abs().round(), (a.y - by).abs().round()),
            );
            self.ivars().current.set(Some(rect));
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, _event: &NSEvent) {
            let rect = self.ivars().current.get();
            self.ivars().start.set(None);
            match rect {
                Some(r) if r.size.width >= 32.0 && r.size.height >= 32.0 => {
                    let height = self.bounds().size.height;
                    finish_selection(Some(Area {
                        display: self.ivars().display,
                        rect: CGRect::new(
                            CGPoint::new(r.origin.x, height - r.origin.y - r.size.height),
                            CGSize::new(r.size.width, r.size.height),
                        ),
                    }));
                }
                _ => {
                    self.ivars().current.set(None);
                    self.setNeedsDisplay(true);
                }
            }
        }

        #[unsafe(method(keyDown:))]
        fn key_down(&self, event: &NSEvent) {
            // Escape cancels.
            if event.keyCode() == 53 {
                finish_selection(None);
            }
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            self.draw();
        }
    }
);

impl SelectView {
    fn draw(&self) {
        let b = self.bounds();
        let dim = NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.38);
        let text_attrs = |size: f64| {
            let font = NSFont::systemFontOfSize(size);
            let white = NSColor::whiteColor();
            // SAFETY: Static AppKit keys.
            let (font_key, color_key) = unsafe {
                (
                    objc2_app_kit::NSFontAttributeName,
                    objc2_app_kit::NSForegroundColorAttributeName,
                )
            };
            dict(&[(font_key, any(&*font)), (color_key, any(&*white))])
        };
        match self.ivars().current.get() {
            None => {
                dim.setFill();
                NSBezierPath::fillRect(b);
                let hint = ns("Drag to select an area. Press Esc to cancel.");
                let attrs = text_attrs(15.0);
                // SAFETY: Drawing inside drawRect:.
                unsafe {
                    let size = hint.sizeWithAttributes(Some(&attrs));
                    hint.drawAtPoint_withAttributes(
                        NSPoint::new(
                            (b.size.width - size.width) / 2.0,
                            (b.size.height - size.height) / 2.0,
                        ),
                        Some(&attrs),
                    );
                }
            }
            Some(r) => {
                dim.setFill();
                // Four bands around the selection keep it clear.
                let (x0, y0, x1, y1) = (
                    r.origin.x,
                    r.origin.y,
                    r.origin.x + r.size.width,
                    r.origin.y + r.size.height,
                );
                for band in [
                    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(b.size.width, y0)),
                    NSRect::new(
                        NSPoint::new(0.0, y1),
                        NSSize::new(b.size.width, b.size.height - y1),
                    ),
                    NSRect::new(NSPoint::new(0.0, y0), NSSize::new(x0, y1 - y0)),
                    NSRect::new(
                        NSPoint::new(x1, y0),
                        NSSize::new(b.size.width - x1, y1 - y0),
                    ),
                ] {
                    NSBezierPath::fillRect(band);
                }
                NSColor::whiteColor().setStroke();
                let outline = NSBezierPath::bezierPathWithRect(NSRect::new(
                    NSPoint::new(x0 - 0.5, y0 - 0.5),
                    NSSize::new(r.size.width + 1.0, r.size.height + 1.0),
                ));
                outline.setLineWidth(1.0);
                outline.stroke();
                let s = self.ivars().scale;
                let label = ns(&format!(
                    "{} × {}",
                    (r.size.width * s).round() as i64,
                    (r.size.height * s).round() as i64
                ));
                let attrs = text_attrs(12.0);
                // SAFETY: Drawing inside drawRect:.
                unsafe {
                    let size = label.sizeWithAttributes(Some(&attrs));
                    let y = if y0 > size.height + 10.0 {
                        y0 - size.height - 6.0
                    } else {
                        y1 + 6.0
                    };
                    label.drawAtPoint_withAttributes(NSPoint::new(x0, y), Some(&attrs));
                }
            }
        }
    }
}

/// The overlay windows, and where to send the result.
type Selecting = (Vec<Retained<SelectWindow>>, Sender<Option<Area>>);

thread_local! {
    static SELECTING: RefCell<Option<Selecting>> = const { RefCell::new(None) };
}

fn finish_selection(area: Option<Area>) {
    if let Some((windows, tx)) = SELECTING.with_borrow_mut(|s| s.take()) {
        for w in windows {
            w.orderOut(None);
        }
        let _ = tx.send(area);
    }
}

fn display_id(screen: &NSScreen) -> u32 {
    let key = ns("NSScreenNumber");
    screen
        .deviceDescription()
        .objectForKey(&key)
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .map(|n| n.unsignedIntValue())
        .unwrap_or(0)
}

/// Covers every screen with a dimmed overlay and waits for a dragged area.
fn select_area(app: &AppHandle) -> Result<Option<Area>> {
    let (tx, rx) = mpsc::channel();
    on_main(app, move |mtm| {
        let mut windows = Vec::new();
        for screen in NSScreen::screens(mtm).iter() {
            let frame = screen.frame();
            // SAFETY: Plain AppKit window setup on the main thread.
            let window: Retained<SelectWindow> = unsafe {
                msg_send![
                    SelectWindow::alloc(mtm),
                    initWithContentRect: frame,
                    styleMask: NSWindowStyleMask::Borderless,
                    backing: NSBackingStoreType::Buffered,
                    defer: false,
                ]
            };
            // SAFETY: We keep the window alive ourselves.
            unsafe { window.setReleasedWhenClosed(false) };
            window.setOpaque(false);
            window.setBackgroundColor(Some(&NSColor::clearColor()));
            // Above everything, including the menu bar and the Dock.
            window.setLevel(1000);
            window.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
            let view = SelectView::alloc(mtm).set_ivars(SelectIvars {
                start: Cell::new(None),
                current: Cell::new(None),
                display: display_id(&screen),
                scale: screen.backingScaleFactor(),
            });
            let bounds = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
            // SAFETY: NSView's designated initializer.
            let view: Retained<SelectView> =
                unsafe { msg_send![super(view), initWithFrame: bounds] };
            window.setContentView(Some(&view));
            window.makeKeyAndOrderFront(None);
            window.makeFirstResponder(Some(&view));
            windows.push(window);
        }
        NSApplication::sharedApplication(mtm).activate();
        SELECTING.with_borrow_mut(|s| *s = Some((windows, tx)));
    })?;
    Ok(rx.recv_timeout(Duration::from_secs(15 * 60)).ok().flatten())
}

fn shareable_content() -> Result<Retained<SCShareableContent>> {
    let got = crate::objc::wait(Duration::from_secs(10), |tx| {
        let block = block2::RcBlock::new(
            move |content: *mut SCShareableContent, error: *mut NSError| {
                // SAFETY: SCK hands us a valid content object or an error.
                let result = unsafe {
                    match content.as_ref() {
                        Some(c) => Ok(Send(c.retain())),
                        None => Err(error
                            .as_ref()
                            .map(|e| e.localizedDescription().to_string())
                            .unwrap_or_default()),
                    }
                };
                let _ = tx.send(result);
            },
        );
        // SAFETY: The handler is called once.
        unsafe {
            SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
                false, true, &block,
            )
        };
    });
    match got {
        Some(Ok(c)) => Ok(c.0),
        Some(Err(_)) | None => Err(anyhow!(
            "Clipt can't see the screen. Allow it in System Settings, Privacy & Security, Screen & System Audio Recording, then reopen Clipt."
        )),
    }
}

/// A filter for part of a display, leaving out Clipt's own windows.
fn area_filter(area: Area) -> Result<Retained<SCContentFilter>> {
    if !objc2_core_graphics::CGPreflightScreenCaptureAccess() {
        objc2_core_graphics::CGRequestScreenCaptureAccess();
        bail!("Allow Clipt in System Settings, Privacy & Security, Screen & System Audio Recording, then reopen Clipt.");
    }
    let content = shareable_content()?;
    // SAFETY: Plain ScreenCaptureKit calls.
    unsafe {
        let display: Retained<SCDisplay> = content
            .displays()
            .iter()
            .find(|d| d.displayID() == area.display)
            .ok_or_else(|| anyhow!("That display is no longer available"))?;
        let ours = objc2_foundation::NSBundle::mainBundle().bundleIdentifier();
        let apps: Vec<Retained<SCRunningApplication>> = content
            .applications()
            .iter()
            .filter(|a| {
                ours.as_deref()
                    .is_some_and(|id| *a.bundleIdentifier() == *id)
            })
            .collect();
        let apps: Vec<&SCRunningApplication> = apps.iter().map(|a| &**a).collect();
        let none: Retained<NSArray<SCWindow>> = NSArray::new();
        Ok(
            SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(
                SCContentFilter::alloc(),
                &display,
                &NSArray::from_slice(&apps),
                &none,
            ),
        )
    }
}

// ---------------------------------------------------------------------------
// Mic and camera

fn ask_access(kind: &AVMediaType, what: &str) -> Result<()> {
    // SAFETY: Plain AVFoundation calls.
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(kind) };
    if status == AVAuthorizationStatus::Authorized {
        return Ok(());
    }
    if status == AVAuthorizationStatus::NotDetermined {
        let granted = crate::objc::wait(Duration::from_secs(120), |tx| {
            let block = block2::RcBlock::new(move |ok: Bool| {
                let _ = tx.send(ok.as_bool());
            });
            // SAFETY: The handler is called once.
            unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(kind, &block) };
        });
        if granted == Some(true) {
            return Ok(());
        }
    }
    bail!("Clipt can't use the {what}. Allow it in System Settings, Privacy & Security.")
}

struct Capture {
    session: Retained<AVCaptureSession>,
    camera_size: Option<(f64, f64)>,
}

fn capture_session(mic: bool, camera: bool, delegate: &StreamOutput) -> Result<Capture> {
    let audio_kind = k!(objc2_av_foundation::AVMediaTypeAudio);
    let video_kind = k!(objc2_av_foundation::AVMediaTypeVideo);
    // SAFETY: Plain AVFoundation setup.
    unsafe {
        let session = AVCaptureSession::new();
        session.beginConfiguration();
        let mut camera_size = None;
        if camera {
            let device = AVCaptureDevice::defaultDeviceWithMediaType(video_kind)
                .ok_or_else(|| anyhow!("No camera found"))?;
            let input = AVCaptureDeviceInput::deviceInputWithDevice_error(&device)
                .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
            if session.canSetSessionPreset(objc2_av_foundation::AVCaptureSessionPreset1280x720) {
                session.setSessionPreset(objc2_av_foundation::AVCaptureSessionPreset1280x720);
                camera_size = Some((1280.0, 720.0));
            } else {
                session.setSessionPreset(objc2_av_foundation::AVCaptureSessionPreset640x480);
                camera_size = Some((640.0, 480.0));
            }
            if session.canAddInput(&input) {
                session.addInput(&input);
            }
            let output = AVCaptureVideoDataOutput::new();
            output.setAlwaysDiscardsLateVideoFrames(true);
            let queue = dispatch2::DispatchQueue::new("clipt.camera", None);
            output.setSampleBufferDelegate_queue(
                Some(ProtocolObject::from_ref(delegate)),
                Some(&queue),
            );
            if session.canAddOutput(&output) {
                session.addOutput(&output);
            }
        }
        if mic {
            let device = AVCaptureDevice::defaultDeviceWithMediaType(audio_kind)
                .ok_or_else(|| anyhow!("No microphone found"))?;
            let input = AVCaptureDeviceInput::deviceInputWithDevice_error(&device)
                .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
            if session.canAddInput(&input) {
                session.addInput(&input);
            }
            let output = AVCaptureAudioDataOutput::new();
            let queue = dispatch2::DispatchQueue::new("clipt.mic", None);
            output.setSampleBufferDelegate_queue(
                Some(ProtocolObject::from_ref(delegate)),
                Some(&queue),
            );
            if session.canAddOutput(&output) {
                session.addOutput(&output);
            }
        }
        session.commitConfiguration();
        Ok(Capture {
            session,
            camera_size,
        })
    }
}

// ---------------------------------------------------------------------------
// The session

struct Session {
    take: Take,
    shared: Arc<Shared>,
    stream: Send<Retained<SCStream>>,
    _output: Send<Retained<StreamOutput>>,
    capture: Option<Send<Retained<AVCaptureSession>>>,
    used_picker: bool,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static BUSY: AtomicBool = AtomicBool::new(false);

fn even(v: f64) -> f64 {
    let v = v.round().max(2.0);
    v + (v as i64 % 2) as f64
}

/// Picks the content, then records until `stop`. Runs off the main thread.
pub fn start(app: AppHandle, data_dir: std::path::PathBuf, kind: Kind, mic: bool, camera: bool) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = begin(&app, &data_dir, kind, mic, camera);
    match result {
        Ok(true) => emit(&app, Event::Started),
        Ok(false) => {
            BUSY.store(false, Ordering::SeqCst);
            emit(&app, Event::Cancelled);
        }
        Err(e) => {
            BUSY.store(false, Ordering::SeqCst);
            emit(
                &app,
                Event::Failed {
                    message: e.to_string(),
                },
            );
        }
    }
}

fn begin(
    app: &AppHandle,
    data_dir: &std::path::Path,
    kind: Kind,
    mic: bool,
    camera: bool,
) -> Result<bool> {
    if mic {
        ask_access(k!(objc2_av_foundation::AVMediaTypeAudio), "microphone")?;
    }
    if camera {
        ask_access(k!(objc2_av_foundation::AVMediaTypeVideo), "camera")?;
    }

    // Get Clipt out of the way while choosing and recording.
    let hide = app.clone();
    let _ = on_main(app, move |_| {
        if let Some(w) = hide.get_webview_window("main") {
            let _ = w.hide();
        }
    });

    let (filter, source) = match kind {
        Kind::Selection => match select_area(app)? {
            Some(area) => (area_filter(area)?, Some(area.rect)),
            None => {
                crate::show_main(app);
                return Ok(false);
            }
        },
        Kind::Screen | Kind::Window => match pick(app, kind)? {
            Some(filter) => (filter, None),
            None => {
                crate::show_main(app);
                return Ok(false);
            }
        },
    };
    let used_picker = source.is_none();

    match record(app, data_dir, filter, source, mic, camera, used_picker) {
        Ok(()) => Ok(true),
        Err(e) => {
            if used_picker {
                deactivate_picker(app);
            }
            crate::show_main(app);
            Err(e)
        }
    }
}

fn record(
    app: &AppHandle,
    data_dir: &std::path::Path,
    filter: Retained<SCContentFilter>,
    source: Option<CGRect>,
    mic: bool,
    camera: bool,
    used_picker: bool,
) -> Result<()> {
    // SAFETY: Plain ScreenCaptureKit / AVFoundation setup.
    unsafe {
        let scale = filter.pointPixelScale() as f64;
        let points = source.unwrap_or_else(|| filter.contentRect());
        let mut w = points.size.width * scale;
        let mut h = points.size.height * scale;
        let shrink = (MAX_SIDE / w.max(h)).min(1.0);
        w = even(w * shrink);
        h = even(h * shrink);

        let config = SCStreamConfiguration::new();
        config.setWidth(w as usize);
        config.setHeight(h as usize);
        if let Some(rect) = source {
            config.setSourceRect(rect);
        }
        config.setMinimumFrameInterval(CMTime::new(1, FPS));
        config.setPixelFormat(YUV420V);
        config.setColorMatrix(objc2_core_graphics::kCGDisplayStreamYCbCrMatrix_ITU_R_709_2);
        config.setShowsCursor(true);
        config.setQueueDepth(8);
        config.setCapturesAudio(false);

        let take = Take::for_recording(data_dir, camera)?;
        let bitrate = (w * h * FPS as f64 * 0.1) as i64;
        let screen = Track::new(
            &take.screen_path(),
            k!(objc2_av_foundation::AVVideoCodecTypeHEVC),
            w,
            h,
            bitrate,
            mic,
        )?;

        let shared = Arc::new(Shared {
            app: app.clone(),
            screen: Mutex::new(Some(Send(screen))),
            camera: Mutex::new(None),
            t0: Mutex::new(None),
            frames: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
            capture_clock: Mutex::new(None),
        });
        let output = StreamOutput::create(shared.clone());

        let capture = if mic || camera {
            let c = capture_session(mic, camera, &output)?;
            if let Some((cw, ch)) = c.camera_size {
                let path = take
                    .dir
                    .join(take.meta.camera.as_deref().unwrap_or("camera.mov"));
                let track = Track::new(
                    &path,
                    k!(objc2_av_foundation::AVVideoCodecTypeH264),
                    cw,
                    ch,
                    6_000_000,
                    false,
                )?;
                *shared.camera.lock().unwrap_or_else(|e| e.into_inner()) = Some(Send(track));
            }
            if let Some(clock) = c.session.synchronizationClock() {
                *shared
                    .capture_clock
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(Send(clock));
            }
            Some(c.session)
        } else {
            None
        };

        let stream = SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &config,
            Some(ProtocolObject::from_ref(&*output)),
        );
        let queue = dispatch2::DispatchQueue::new("clipt.screen", None);
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*output),
                SCStreamOutputType::Screen,
                Some(&queue),
            )
            .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;

        if let Some(session) = &capture {
            session.startRunning();
        }
        let started = crate::objc::wait(Duration::from_secs(10), |tx| {
            let block = block2::RcBlock::new(move |error: *mut NSError| {
                let message = error.as_ref().map(|e| e.localizedDescription().to_string());
                let _ = tx.send(message);
            });
            stream.startCaptureWithCompletionHandler(Some(&block));
        });
        match started {
            Some(None) => {}
            Some(Some(message)) => {
                if let Some(session) = &capture {
                    session.stopRunning();
                }
                take.discard();
                bail!("Couldn't start recording: {message}");
            }
            None => {
                take.discard();
                bail!("Couldn't start recording");
            }
        }

        *SESSION.lock().unwrap_or_else(|e| e.into_inner()) = Some(Session {
            take,
            shared,
            stream: Send(stream),
            _output: Send(output),
            capture: capture.map(Send),
            used_picker,
        });
    }

    crate::tray::set_recording(app, true);
    let stop_app = app.clone();
    let _ = app
        .global_shortcut()
        .on_shortcut(STOP_SHORTCUT, move |_, _, event| {
            if event.state == ShortcutState::Pressed {
                let app = stop_app.clone();
                std::thread::spawn(move || stop(&app));
            }
        });
    Ok(())
}

pub fn is_recording() -> bool {
    BUSY.load(Ordering::SeqCst)
}

/// Stops recording, finishes the files and opens the take in the editor.
pub fn stop(app: &AppHandle) {
    let Some(session) = SESSION.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return;
    };
    session.shared.stopping.store(true, Ordering::SeqCst);
    let _ = app.global_shortcut().unregister(STOP_SHORTCUT);
    crate::tray::set_recording(app, false);

    // SAFETY: Stopping the streams we started.
    unsafe {
        let stream = session.stream.0.clone();
        crate::objc::wait(Duration::from_secs(5), |tx| {
            let block = block2::RcBlock::new(move |_error: *mut NSError| {
                let _ = tx.send(());
            });
            stream.stopCaptureWithCompletionHandler(Some(&block));
        });
        if let Some(capture) = &session.capture {
            capture.0.stopRunning();
        }
    }
    if session.used_picker {
        deactivate_picker(app);
    }

    let end = host_now();
    let screen = session
        .shared
        .screen
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .map(|t| t.0);
    let camera = session
        .shared
        .camera
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .map(|t| t.0);
    let wrote = screen.map(|t| t.finish(end)).unwrap_or(false);
    let camera_ok = camera.map(|t| t.finish(end)).unwrap_or(false);
    let mut take = session.take;
    if !camera_ok {
        take.meta.camera = None;
        let _ = take.save();
    }

    BUSY.store(false, Ordering::SeqCst);
    if !wrote || session.shared.frames.load(Ordering::SeqCst) == 0 {
        take.discard();
        emit(
            app,
            Event::Failed {
                message: "Nothing was recorded".into(),
            },
        );
    } else {
        // Open the take first, so the window comes back on the editor.
        match crate::adopt_recording(app, take) {
            Ok(info) => emit(
                app,
                Event::Finished {
                    take: Box::new(info),
                },
            ),
            Err(e) => emit(app, Event::Failed { message: e }),
        }
    }
    crate::show_main(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_even() {
        assert_eq!(even(1511.0), 1512.0);
        assert_eq!(even(1512.4), 1512.0);
        assert_eq!(even(0.0), 2.0);
    }

    #[test]
    fn kinds_parse() {
        let k: Kind = serde_json::from_str("\"selection\"").unwrap();
        assert_eq!(k, Kind::Selection);
    }

    /// A frame stamped at `pts` seconds, the way SCK and the camera hand them over.
    fn frame(
        pts: f64,
        w: usize,
        h: usize,
        shade: u8,
    ) -> objc2_core_foundation::CFRetained<CMSampleBuffer> {
        use objc2_core_video::{
            CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddress,
            CVPixelBufferGetDataSize, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
            CVPixelBufferUnlockBaseAddress,
        };
        use std::ptr::{null, null_mut, NonNull};
        // SAFETY: Building a sample buffer from a fresh BGRA pixel buffer.
        unsafe {
            let mut buffer: *mut CVPixelBuffer = null_mut();
            CVPixelBufferCreate(
                None,
                w,
                h,
                crate::render::BGRA,
                None,
                NonNull::from(&mut buffer),
            );
            let buffer = objc2_core_foundation::CFRetained::from_raw(NonNull::new(buffer).unwrap());
            CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags(0));
            let base = CVPixelBufferGetBaseAddress(&buffer) as *mut u8;
            std::ptr::write_bytes(base, shade, CVPixelBufferGetDataSize(&buffer));
            CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags(0));
            let mut format: *const objc2_core_media::CMVideoFormatDescription = null();
            objc2_core_media::CMVideoFormatDescriptionCreateForImageBuffer(
                None,
                &buffer,
                NonNull::from(&mut format),
            );
            let format = objc2_core_foundation::CFRetained::from_raw(
                NonNull::new(format as *mut _).unwrap(),
            );
            let mut timing = objc2_core_media::CMSampleTimingInfo {
                duration: CMTime::new(1, FPS),
                presentationTimeStamp: crate::objc::time(pts),
                decodeTimeStamp: objc2_core_media::kCMTimeInvalid,
            };
            let mut out: *mut CMSampleBuffer = null_mut();
            CMSampleBuffer::create_ready_with_image_buffer(
                None,
                &buffer,
                &format,
                NonNull::from(&mut timing),
                NonNull::from(&mut out),
            );
            objc2_core_foundation::CFRetained::from_raw(NonNull::new(out).unwrap())
        }
    }

    /// Writes a take the way a recording does (host-time stamps, HEVC screen,
    /// a camera that starts late) and checks it opens as one lined-up take.
    #[test]
    fn recorded_take_lines_up() {
        let dir = std::env::temp_dir().join(format!("clipt-rec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let screen_path = dir.join("screen.mov");
        let camera_path = dir.join("camera.mov");
        let hevc = k!(objc2_av_foundation::AVVideoCodecTypeHEVC);
        let h264 = k!(objc2_av_foundation::AVVideoCodecTypeH264);
        let mut screen = Track::new(&screen_path, hevc, 640.0, 400.0, 8_000_000, false).unwrap();
        let mut camera = Track::new(&camera_path, h264, 320.0, 240.0, 2_000_000, false).unwrap();

        // Host time is large and arbitrary; the take starts at the first frame.
        let t0 = 5000.0;
        for n in 0..90 {
            let t = t0 + n as f64 / 60.0;
            screen.append_video(&frame(t, 640, 400, (n * 2) as u8), crate::objc::time(t0));
            // The camera's first frame arrives 0.25 s after the screen's.
            if t >= t0 + 0.25 {
                camera.append_video(&frame(t, 320, 240, 128), crate::objc::time(t0));
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let end = crate::objc::time(t0 + 1.5);
        assert!(screen.finish(end));
        assert!(camera.finish(end));

        let media = crate::media::open(&screen_path, Some(&camera_path)).unwrap();
        assert!(
            (media.seconds() - 1.5).abs() < 0.05,
            "duration {}",
            media.seconds()
        );
        assert_eq!((media.source.width, media.source.height), (640.0, 400.0));
        assert!(media.source.has_camera);
        let tracks =
            crate::media::tracks(&media.asset, k!(objc2_av_foundation::AVMediaTypeVideo)).unwrap();
        let cam = tracks
            .iter()
            .find(|t| Some(unsafe { t.trackID() }) == media.tracks.camera.map(|c| c.0))
            .expect("camera track");
        // The camera's first real frame lands 0.25 s in, after an empty edit.
        // SAFETY: Loaded track.
        let start = unsafe {
            cam.segments()
                .iter()
                .find(|s| !s.isEmpty())
                .map(|s| crate::objc::seconds(s.timeMapping().target.start))
        };
        assert!(
            start.is_some_and(|s| (s - 0.25).abs() < 0.03),
            "camera starts at {start:?}"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

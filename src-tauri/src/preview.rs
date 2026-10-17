//! The live preview: an `AVPlayer` playing the take through the same video
//! composition export uses, shown in an `AVPlayerLayer` that sits under the
//! (transparent) webview. The page leaves a hole where the preview goes and
//! tells us its insets; AppKit keeps the layer in place during live resize.
//!
//! Everything here runs on the main thread.

use std::cell::{Cell, RefCell};
use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode, NSWorkspace};
use objc2_av_foundation::{
    AVPlayer, AVPlayerActionAtItemEnd, AVPlayerItem, AVPlayerLayer, AVPlayerTimeControlStatus,
};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_media::{kCMTimeZero, CMTime};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::{CAMediaTimingFunction, CATransaction};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::media::Media;
use crate::objc::{k, seconds, time};
use crate::render;
use crate::scene::Scene;

#[derive(Serialize, Clone, Copy)]
pub struct Playback {
    pub time: f64,
    pub playing: bool,
}

pub struct HostIvars {
    video: Retained<AVPlayerLayer>,
    aspect: Cell<f64>,
}

define_class!(
    // SAFETY: NSView has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "CliptPreviewHost"]
    #[ivars = HostIvars]
    pub struct PreviewHost;

    impl PreviewHost {
        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            // SAFETY: Forwarding to NSView.
            let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
            self.place_video(false);
        }

        /// Clicks belong to the page above.
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }
    }
);

/// The canvas, fitted inside the preview area. The page does the same math
/// (`src/lib/geometry.ts`) to place the crop overlay.
pub fn contain(area: (f64, f64), aspect: f64) -> CGRect {
    let (w, h) = area;
    let (cw, ch) = if w / h > aspect {
        (h * aspect, h)
    } else {
        (w, w / aspect)
    };
    CGRect::new(
        CGPoint::new(((w - cw) / 2.0).round(), ((h - ch) / 2.0).round()),
        CGSize::new(cw.round(), ch.round()),
    )
}

fn reduce_motion() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

impl PreviewHost {
    fn create(mtm: MainThreadMarker, video: Retained<AVPlayerLayer>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(HostIvars {
            video,
            aspect: Cell::new(16.0 / 9.0),
        });
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(10.0, 10.0));
        // SAFETY: NSView's designated initializer.
        let this: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        this.setWantsLayer(true);
        if let Some(layer) = this.layer() {
            layer.addSublayer(&this.ivars().video);
        }
        this
    }

    fn set_aspect(&self, aspect: f64) {
        let changed = (self.ivars().aspect.get() - aspect).abs() > 1e-4;
        self.ivars().aspect.set(aspect);
        self.place_video(changed && !reduce_motion());
    }

    /// Size the video layer to the canvas. When the shape changes, it settles
    /// into the new shape instead of jumping; the content fills it as it goes.
    fn place_video(&self, animate: bool) {
        let b = self.bounds();
        let r = contain((b.size.width, b.size.height), self.ivars().aspect.get());
        CATransaction::begin();
        if animate {
            CATransaction::setAnimationDuration(0.36);
            let curve = CAMediaTimingFunction::functionWithControlPoints(0.22, 1.0, 0.36, 1.0);
            CATransaction::setAnimationTimingFunction(Some(&curve));
        } else {
            CATransaction::setDisableActions(true);
        }
        self.ivars().video.setFrame(r);
        CATransaction::commit();
    }
}

pub struct Preview {
    /// The take being shown.
    id: String,
    media: Media,
    item: Retained<AVPlayerItem>,
    player: Retained<AVPlayer>,
    host: Retained<PreviewHost>,
    observer: Retained<AnyObject>,
    trim: (f64, f64),
    fps: u32,
}

thread_local! {
    static PREVIEW: RefCell<Option<Preview>> = const { RefCell::new(None) };
    /// A seek in flight, and the latest target asked for meanwhile.
    static SEEK: Cell<(bool, Option<f64>)> = const { Cell::new((false, None)) };
}

/// The player item the preview plays: the take, through the scene's composition.
pub fn player_item(
    media: &Media,
    scene: Arc<Scene>,
    mtm: MainThreadMarker,
) -> Retained<AVPlayerItem> {
    // SAFETY: A valid asset and composition.
    unsafe {
        let item = AVPlayerItem::playerItemWithAsset(&media.asset, mtm);
        item.setVideoComposition(Some(&render::video_composition(
            scene,
            media.tracks,
            media.duration,
        )));
        item
    }
}

fn emit(app: &AppHandle, player: &AVPlayer) {
    // SAFETY: Reading player state on the main thread.
    let (t, playing) = unsafe {
        (
            seconds(player.currentTime()),
            player.timeControlStatus() != AVPlayerTimeControlStatus::Paused,
        )
    };
    let _ = app.emit("playback", Playback { time: t, playing });
}

/// Starts previewing `media` in `window` with `scene`.
pub fn open(window: &WebviewWindow, id: String, media: Media, scene: Scene, trim: (f64, f64)) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    close();
    let Some(native) = crate::macos::ns_window(window) else {
        return;
    };
    let Some(content) = native.contentView() else {
        return;
    };
    let fps = scene.fps;
    let aspect = scene.width as f64 / scene.height as f64;
    let item = player_item(&media, Arc::new(scene), mtm);
    // SAFETY: Plain AVFoundation / AppKit setup on the main thread.
    unsafe {
        let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
        player.setActionAtItemEnd(AVPlayerActionAtItemEnd::Pause);
        let layer = AVPlayerLayer::playerLayerWithPlayer(Some(&player));
        layer.setVideoGravity(k!(objc2_av_foundation::AVLayerVideoGravityResizeAspectFill));
        layer.setMasksToBounds(true);

        let host = PreviewHost::create(mtm, layer);
        host.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        host.setHidden(true);
        let below = crate::macos::glass_backing(&content);
        content.addSubview_positioned_relativeTo(
            &host,
            NSWindowOrderingMode::Above,
            below.as_deref(),
        );
        host.ivars().aspect.set(aspect);

        let app = window.app_handle().clone();
        let watched = player.clone();
        let block = block2::RcBlock::new(move |_t: CMTime| emit(&app, &watched));
        let observer = player.addPeriodicTimeObserverForInterval_queue_usingBlock(
            CMTime::new(1, 30),
            None,
            &block,
        );
        item.setForwardPlaybackEndTime(time(trim.1));
        PREVIEW.with_borrow_mut(|p| {
            *p = Some(Preview {
                id,
                media,
                item,
                player,
                host,
                observer,
                trim,
                fps,
            })
        });
    }
    seek(trim.0);
}

pub fn close() {
    PREVIEW.with_borrow_mut(|p| {
        if let Some(p) = p.take() {
            // SAFETY: Tearing down on the main thread.
            unsafe {
                p.player.pause();
                p.player.removeTimeObserver(&p.observer);
                p.player.replaceCurrentItemWithPlayerItem(None);
            }
            p.host.removeFromSuperview();
        }
    });
}

fn with<R>(f: impl FnOnce(&mut Preview) -> R) -> Option<R> {
    PREVIEW.with_borrow_mut(|p| p.as_mut().map(f))
}

/// Swaps in a new scene. The current frame redraws right away.
pub fn set_scene(scene: Scene, trim: (f64, f64)) {
    let aspect = scene.width as f64 / scene.height as f64;
    let fps = scene.fps;
    let paused = with(|p| {
        let composition =
            render::video_composition(Arc::new(scene), p.media.tracks, p.media.duration);
        p.trim = trim;
        p.fps = fps;
        // SAFETY: Main-thread AVFoundation calls.
        unsafe {
            p.item.setVideoComposition(Some(&composition));
            p.item.setForwardPlaybackEndTime(time(trim.1));
            p.host.set_aspect(aspect);
            p.player.timeControlStatus() == AVPlayerTimeControlStatus::Paused
        }
    });
    if paused == Some(true) {
        // Re-render the paused frame with the new composition.
        let now = with(|p| unsafe { seconds(p.player.currentTime()) }).unwrap_or(trim.0);
        seek(now.clamp(trim.0, trim.1));
    }
}

/// Seeks exactly, coalescing a burst of scrubs into the latest one.
pub fn seek(to: f64) {
    let (busy, _) = SEEK.get();
    if busy {
        SEEK.set((true, Some(to)));
        return;
    }
    SEEK.set((true, None));
    let started = with(|p| {
        let done = block2::RcBlock::new(|_finished: Bool| {
            dispatch2::DispatchQueue::main().exec_async(|| {
                let (_, next) = SEEK.get();
                SEEK.set((false, None));
                if let Some(next) = next {
                    seek(next);
                }
            });
        });
        // SAFETY: Main-thread AVFoundation call.
        unsafe {
            p.player
                .seekToTime_toleranceBefore_toleranceAfter_completionHandler(
                    time(to),
                    kCMTimeZero,
                    kCMTimeZero,
                    &done,
                )
        };
    });
    if started.is_none() {
        SEEK.set((false, None));
    }
}

pub fn play() {
    let restart = with(|p| {
        // SAFETY: Main-thread AVFoundation calls.
        let now = unsafe { seconds(p.player.currentTime()) };
        let frame = 1.0 / p.fps.max(1) as f64;
        (now < p.trim.0 || now >= p.trim.1 - frame).then_some(p.trim.0)
    })
    .flatten();
    with(|p| {
        // SAFETY: Main-thread AVFoundation calls.
        unsafe {
            if let Some(start) = restart {
                p.player.seekToTime_toleranceBefore_toleranceAfter(
                    time(start),
                    kCMTimeZero,
                    kCMTimeZero,
                );
            }
            p.player.play();
        }
    });
}

pub fn pause() {
    // SAFETY: Main-thread AVFoundation call.
    with(|p| unsafe { p.player.pause() });
}

pub fn toggle() {
    // SAFETY: Main-thread AVFoundation call.
    let playing =
        with(|p| unsafe { p.player.timeControlStatus() != AVPlayerTimeControlStatus::Paused });
    match playing {
        Some(true) => pause(),
        Some(false) => play(),
        None => {}
    }
}

/// Places the preview area: CSS pixels from each window edge.
pub fn set_insets(window: &WebviewWindow, top: f64, right: f64, bottom: f64, left: f64) {
    let Some(native) = crate::macos::ns_window(window) else {
        return;
    };
    let Some(content) = native.contentView() else {
        return;
    };
    with(|p| {
        let b = content.bounds();
        let w = (b.size.width - left - right).max(1.0);
        let h = (b.size.height - top - bottom).max(1.0);
        let y = if content.isFlipped() {
            top
        } else {
            b.size.height - top - h
        };
        p.host
            .setFrame(NSRect::new(NSPoint::new(left, y), NSSize::new(w, h)));
        p.host.setHidden(false);
    });
}

pub fn set_visible(visible: bool) {
    with(|p| p.host.setHidden(!visible));
}

/// The id of the take on screen, if any.
pub fn showing() -> Option<String> {
    PREVIEW.with_borrow(|p| p.as_ref().map(|p| p.id.clone()))
}

//! Shared helpers for the integration tests: a clip generated in code, and
//! ways to read frames and facts back out of a file with AVFoundation.
#![allow(dead_code)]

use std::ffi::c_void;
use std::path::Path;
use std::ptr::{null, null_mut, NonNull};
use std::time::Duration;

use clipt_lib::objc::{any, dict, file_url, int, k, ns, seconds};
use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderTrackOutput, AVAssetWriter, AVAssetWriterInput,
    AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus,
};
use objc2_core_foundation::CFDictionary;
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString};

pub const BGRA: u32 = u32::from_be_bytes(*b"BGRA");

/// A BGRA image read back from a file or the compositor.
pub struct Frame {
    pub width: usize,
    pub height: usize,
    pub bgra: Vec<u8>,
}

impl Frame {
    /// Writes a BMP (top-down) for eyeballing a frame: `CLIPT_DUMP=dir`.
    pub fn dump(&self, name: &str) {
        let Ok(dir) = std::env::var("CLIPT_DUMP") else {
            return;
        };
        let mut out = Vec::with_capacity(54 + self.bgra.len());
        let size = 54 + self.bgra.len() as u32;
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&54u32.to_le_bytes());
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&(self.width as i32).to_le_bytes());
        out.extend_from_slice(&(-(self.height as i32)).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&[0; 24]);
        out.extend_from_slice(&self.bgra);
        std::fs::write(std::path::Path::new(&dir).join(format!("{name}.bmp")), out).unwrap();
    }

    pub fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        let i = (y * self.width + x) * 4;
        [self.bgra[i + 2], self.bgra[i + 1], self.bgra[i]]
    }

    /// Mean absolute difference per channel (0..255) and the share of
    /// channels that differ by more than `tolerance`.
    pub fn diff(&self, other: &Frame, tolerance: u8) -> (f64, f64) {
        assert_eq!((self.width, self.height), (other.width, other.height));
        let mut sum = 0u64;
        let mut over = 0u64;
        let mut count = 0u64;
        for (i, (a, b)) in self.bgra.iter().zip(&other.bgra).enumerate() {
            if i % 4 == 3 {
                continue;
            }
            let d = a.abs_diff(*b);
            sum += d as u64;
            if d > tolerance {
                over += 1;
            }
            count += 1;
        }
        (sum as f64 / count as f64, over as f64 / count as f64)
    }
}

pub fn read_buffer(buffer: &CVPixelBuffer) -> Frame {
    // SAFETY: A BGRA pixel buffer, locked while we copy it.
    unsafe {
        CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly);
        let width = CVPixelBufferGetWidth(buffer);
        let height = CVPixelBufferGetHeight(buffer);
        let row = CVPixelBufferGetBytesPerRow(buffer);
        let base = CVPixelBufferGetBaseAddress(buffer) as *const u8;
        let mut bgra = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let line = std::slice::from_raw_parts(base.add(y * row), width * 4);
            bgra.extend_from_slice(line);
        }
        CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly);
        Frame {
            width,
            height,
            bgra,
        }
    }
}

fn bgra_settings() -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    dict(&[(&*ns("PixelFormatType"), any(&*NSNumber::new_u32(BGRA)))])
}

/// The colour the test pattern has at (x, y) in frame `n`: a diagonal
/// gradient, a moving white square and a checker band of fine detail.
fn pattern(x: usize, y: usize, n: usize, w: usize, h: usize) -> [u8; 3] {
    let sq = 120;
    let sx = (n * 9) % (w - sq);
    if x >= sx && x < sx + sq && y >= 200 && y < 200 + sq {
        return [255, 255, 255];
    }
    if y < 60 {
        return if ((x / 8) + (y / 8)) % 2 == 0 {
            [20, 20, 20]
        } else {
            [235, 235, 235]
        };
    }
    [
        (x * 255 / w) as u8,
        (y * 255 / h) as u8,
        ((n * 4) % 256) as u8,
    ]
}

extern "C" {
    fn CMBlockBufferCreateWithMemoryBlock(
        allocator: *const c_void,
        memory: *mut c_void,
        block_length: usize,
        block_allocator: *const c_void,
        custom: *const c_void,
        offset: usize,
        data_length: usize,
        flags: u32,
        out: *mut *mut c_void,
    ) -> i32;
    fn CMBlockBufferReplaceDataBytes(
        source: *const c_void,
        destination: *mut c_void,
        offset: usize,
        length: usize,
    ) -> i32;
    fn CMAudioFormatDescriptionCreate(
        allocator: *const c_void,
        asbd: *const Asbd,
        layout_size: usize,
        layout: *const c_void,
        cookie_size: usize,
        cookie: *const c_void,
        extensions: *const c_void,
        out: *mut *mut c_void,
    ) -> i32;
    fn CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: *const c_void,
        data: *mut c_void,
        format: *mut c_void,
        samples: isize,
        pts: CMTime,
        packets: *const c_void,
        out: *mut *mut c_void,
    ) -> i32;
    fn CFRelease(object: *const c_void);
}

/// AudioStreamBasicDescription.
#[repr(C)]
struct Asbd {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

/// A 440 Hz tone, mono 16-bit at 48 kHz, starting at `start` samples.
unsafe fn tone(start: usize, count: usize) -> *mut c_void {
    let samples: Vec<i16> = (start..start + count)
        .map(|i| ((i as f64 * 440.0 * std::f64::consts::TAU / 48_000.0).sin() * 8000.0) as i16)
        .collect();
    let bytes = count * 2;
    let mut block = null_mut();
    CMBlockBufferCreateWithMemoryBlock(
        null(),
        null_mut(),
        bytes,
        null(),
        null(),
        0,
        bytes,
        1,
        &mut block,
    );
    CMBlockBufferReplaceDataBytes(samples.as_ptr().cast(), block, 0, bytes);
    let asbd = Asbd {
        sample_rate: 48_000.0,
        format_id: u32::from_be_bytes(*b"lpcm"),
        // Signed integer, packed.
        format_flags: 0x4 | 0x8,
        bytes_per_packet: 2,
        frames_per_packet: 1,
        bytes_per_frame: 2,
        channels_per_frame: 1,
        bits_per_channel: 16,
        reserved: 0,
    };
    let mut format = null_mut();
    CMAudioFormatDescriptionCreate(null(), &asbd, 0, null(), 0, null(), null(), &mut format);
    let mut sample = null_mut();
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        null(),
        block,
        format,
        count as isize,
        CMTime::new(start as i64, 48_000),
        null(),
        &mut sample,
    );
    CFRelease(block);
    CFRelease(format);
    sample
}

/// A pixel painter: (x, y, frame, width, height) -> RGB.
pub type Paint = fn(usize, usize, usize, usize, usize) -> [u8; 3];

/// Writes a `seconds` long H.264 .mov at `fps` of the test pattern,
/// optionally with a tone.
pub fn make_clip(path: &Path, width: usize, height: usize, fps: usize, secs: f64, audio: bool) {
    make_painted(path, width, height, fps, secs, audio, pattern);
}

/// A dark app window: sidebar, toolbar, cards and a moving pointer. Used for
/// the README demo.
pub fn app_ui(x: usize, y: usize, n: usize, w: usize, h: usize) -> [u8; 3] {
    let (fx, fy) = (x as f64 / w as f64, y as f64 / h as f64);
    // Pointer: a small white triangle drifting across the cards.
    let t = n as f64 / 60.0;
    let px = 0.42 + 0.3 * (t * 0.9).sin().abs();
    let py = 0.35 + 0.25 * (t * 0.6).cos().abs();
    let (dx, dy) = ((fx - px) * w as f64, (fy - py) * h as f64);
    if dx >= 0.0 && dy >= 0.0 && dx <= 18.0 && dy <= 26.0 && dx <= dy * 0.7 {
        return [250, 250, 250];
    }
    if fx < 0.2 {
        // Sidebar with list rows; the selected row is highlighted.
        let row = (fy * 18.0) as usize;
        let inside =
            (fy * 18.0).fract() > 0.25 && (fy * 18.0).fract() < 0.75 && fx > 0.02 && fx < 0.18;
        if row == 4 && inside {
            return [52, 62, 94];
        }
        if (2..12).contains(&row) && inside && fx < 0.04 + 0.1 * ((row * 7 % 5) as f64 / 5.0 + 0.4)
        {
            return [70, 72, 80];
        }
        return [30, 31, 35];
    }
    if fy < 0.08 {
        if fx > 0.82 && fx < 0.96 && fy > 0.02 && fy < 0.06 {
            return [88, 120, 255];
        }
        return [36, 37, 42];
    }
    // Cards in a 3x2 grid; one card fills as time passes.
    let gx = (fx - 0.24) / 0.25;
    let gy = (fy - 0.13) / 0.42;
    if gx >= 0.0 && gy >= 0.0 && gx < 3.0 && gy < 2.0 && gx.fract() < 0.9 && gy.fract() < 0.88 {
        let (cx, cy) = (gx.fract() / 0.9, gy.fract() / 0.88);
        let card = gx as usize + 3 * gy as usize;
        if cy < 0.55 {
            let hue = [
                [255, 138, 101],
                [99, 179, 237],
                [154, 230, 180],
                [246, 173, 85],
                [183, 148, 244],
                [237, 100, 166],
            ][card];
            let fill = if card == 1 {
                ((t * 0.5).sin() * 0.5 + 0.5) * 0.9 + 0.1
            } else {
                1.0
            };
            return if cx < fill { hue } else { [44, 46, 52] };
        }
        if cy > 0.68 && cy < 0.76 && cx > 0.06 && cx < 0.7 {
            return [120, 122, 130];
        }
        if cy > 0.82 && cy < 0.88 && cx > 0.06 && cx < 0.45 {
            return [80, 82, 90];
        }
        return [40, 41, 46];
    }
    [24, 25, 28]
}

/// Like `make_clip`, with any painter.
pub fn make_painted(
    path: &Path,
    width: usize,
    height: usize,
    fps: usize,
    secs: f64,
    audio: bool,
    paint: Paint,
) {
    let _ = std::fs::remove_file(path);
    // SAFETY: Straightforward AVFoundation writing from one thread.
    unsafe {
        let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
            &file_url(path),
            k!(objc2_av_foundation::AVFileTypeQuickTimeMovie),
        )
        .expect("writer");
        let settings = dict(&[
            (
                k!(objc2_av_foundation::AVVideoCodecKey),
                any(k!(objc2_av_foundation::AVVideoCodecTypeH264)),
            ),
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
                any(&*dict(&[(
                    k!(objc2_av_foundation::AVVideoAverageBitRateKey),
                    any(&*int(40_000_000)),
                )])),
            ),
        ]);
        let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            k!(objc2_av_foundation::AVMediaTypeVideo),
            Some(&settings),
        );
        input.setExpectsMediaDataInRealTime(false);
        let adaptor = AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(
            &input,
            Some(&bgra_settings()),
        );
        writer.addInput(&input);

        let audio_in = audio.then(|| {
            let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                k!(objc2_av_foundation::AVMediaTypeAudio),
                Some(&dict(&[
                    (
                        &*ns("AVFormatIDKey"),
                        any(&*int(u32::from_be_bytes(*b"aac ") as i64)),
                    ),
                    (&*ns("AVSampleRateKey"), any(&*NSNumber::new_f64(48_000.0))),
                    (&*ns("AVNumberOfChannelsKey"), any(&*int(1))),
                    (&*ns("AVEncoderBitRateKey"), any(&*int(96_000))),
                ])),
            );
            input.setExpectsMediaDataInRealTime(false);
            writer.addInput(&input);
            input
        });

        assert!(writer.startWriting());
        writer.startSessionAtSourceTime(CMTime::new(0, fps as i32));

        let frames = (secs * fps as f64).round() as usize;
        let attrs = dict(&[(
            &*ns("IOSurfaceProperties"),
            any(&*NSDictionary::<NSString, objc2::runtime::AnyObject>::new()),
        )]);
        let total_samples = if audio_in.is_some() {
            (secs * 48_000.0) as usize
        } else {
            0
        };
        let mut written_samples = 0;
        let mut n = 0;
        // Feed whichever input is ready; the writer interleaves for us.
        while n < frames || written_samples < total_samples {
            let mut moved = false;
            if n < frames && input.isReadyForMoreMediaData() {
                let mut out: *mut CVPixelBuffer = null_mut();
                CVPixelBufferCreate(
                    None,
                    width,
                    height,
                    BGRA,
                    Some(&*(Retained::as_ptr(&attrs) as *const CFDictionary)),
                    NonNull::from(&mut out),
                );
                let buffer = &*out;
                CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(0));
                let row = CVPixelBufferGetBytesPerRow(buffer);
                let base = CVPixelBufferGetBaseAddress(buffer) as *mut u8;
                for y in 0..height {
                    let line = std::slice::from_raw_parts_mut(base.add(y * row), width * 4);
                    for x in 0..width {
                        let [r, g, b] = paint(x, y, n, width, height);
                        line[x * 4..x * 4 + 4].copy_from_slice(&[b, g, r, 255]);
                    }
                }
                CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(0));
                assert!(adaptor.appendPixelBuffer_withPresentationTime(
                    buffer,
                    CMTime::new(n as i64, fps as i32)
                ));
                CFRelease(out as *const c_void);
                n += 1;
                if n == frames {
                    input.markAsFinished();
                }
                moved = true;
            }
            if let Some(audio_in) = &audio_in {
                if written_samples < total_samples && audio_in.isReadyForMoreMediaData() {
                    let count = (total_samples - written_samples).min(4800);
                    let sample = tone(written_samples, count);
                    assert!(audio_in.appendSampleBuffer(&*(sample as *const CMSampleBuffer)));
                    CFRelease(sample);
                    written_samples += count;
                    if written_samples == total_samples {
                        audio_in.markAsFinished();
                    }
                    moved = true;
                }
            }
            if !moved {
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        writer.endSessionAtSourceTime(CMTime::new(frames as i64, fps as i32));
        let (tx, rx) = std::sync::mpsc::channel();
        let block = block2::RcBlock::new(move || {
            let _ = tx.send(());
        });
        writer.finishWritingWithCompletionHandler(&block);
        rx.recv_timeout(Duration::from_secs(30)).expect("finish");
        assert_eq!(writer.status(), AVAssetWriterStatus::Completed);
    }
}

pub struct Facts {
    pub duration: f64,
    pub width: f64,
    pub height: f64,
    pub fps: f64,
    pub video_codec: String,
    pub audio_codec: Option<String>,
}

fn fourcc(v: u32) -> String {
    String::from_utf8_lossy(&v.to_be_bytes()).into_owned()
}

fn codec(track: &objc2_av_foundation::AVAssetTrack) -> String {
    // SAFETY: A loaded track's format descriptions are CMFormatDescriptions.
    unsafe {
        let formats = track.formatDescriptions();
        let first = formats.objectAtIndex(0);
        let desc = &*(Retained::as_ptr(&first) as *const objc2_core_media::CMFormatDescription);
        fourcc(desc.media_sub_type())
    }
}

/// Reads duration, size, frame rate and codecs back with AVFoundation.
pub fn facts(path: &Path) -> Facts {
    let asset = clipt_lib::media::open_asset(path);
    let video = clipt_lib::media::tracks(&asset, k!(objc2_av_foundation::AVMediaTypeVideo))
        .unwrap()
        .remove(0);
    let audio = clipt_lib::media::tracks(&asset, k!(objc2_av_foundation::AVMediaTypeAudio))
        .unwrap()
        .into_iter()
        .next();
    // SAFETY: Loaded tracks.
    unsafe {
        let size = video.naturalSize();
        Facts {
            duration: seconds(video.timeRange().duration),
            width: size.width,
            height: size.height,
            fps: video.nominalFrameRate() as f64,
            video_codec: codec(&video),
            audio_codec: audio.as_deref().map(codec),
        }
    }
}

/// Decodes the frame of a file nearest `at` seconds.
pub fn file_frame(path: &Path, at: f64) -> Frame {
    let asset = clipt_lib::media::open_asset(path);
    let video = clipt_lib::media::tracks(&asset, k!(objc2_av_foundation::AVMediaTypeVideo))
        .unwrap()
        .remove(0);
    // SAFETY: Straightforward AVFoundation reading.
    unsafe {
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).unwrap();
        let out = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(
            &video,
            Some(&bgra_settings()),
        );
        reader.addOutput(&out);
        assert!(reader.startReading());
        nearest(&out, at)
    }
}

/// Reads samples from `out` and returns the one whose time is nearest `at`.
pub fn nearest(out: &objc2_av_foundation::AVAssetReaderOutput, at: f64) -> Frame {
    let mut best: Option<(f64, Frame)> = None;
    // SAFETY: Reading decoded BGRA samples.
    unsafe {
        while let Some(sample) = out.copyNextSampleBuffer() {
            let t = seconds(sample.presentation_time_stamp());
            let Some(image) = sample.image_buffer() else {
                continue;
            };
            let d = (t - at).abs();
            if best.as_ref().is_none_or(|(bd, _)| d < *bd) {
                best = Some((d, read_buffer(&image)));
            }
            if t > at + 0.5 {
                break;
            }
        }
    }
    best.expect("a frame").1
}

//! Opens a take's files as one `AVMutableComposition`: the screen track, an
//! optional camera track and an optional audio track, all starting at zero.

use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use objc2::rc::Retained;
use objc2_av_foundation::{AVAsset, AVAssetTrack, AVMediaType, AVMutableComposition, AVURLAsset};
use objc2_core_media::{kCMTimeZero, CMTime, CMTimeRange};
use objc2_foundation::NSArray;

use crate::objc::{any, dict, file_url, k, seconds, yes};
use crate::render::{Affine, Tracks};
use crate::scene::Source;

pub struct Media {
    pub asset: Retained<AVMutableComposition>,
    pub tracks: Tracks,
    pub duration: CMTime,
    pub source: Source,
    pub fps: f64,
    pub has_audio: bool,
}

impl Media {
    pub fn seconds(&self) -> f64 {
        seconds(self.duration)
    }
}

pub fn open_asset(path: &Path) -> Retained<AVURLAsset> {
    let options = dict(&[(
        // SAFETY: Static constant.
        unsafe { objc2_av_foundation::AVURLAssetPreferPreciseDurationAndTimingKey },
        any(&*yes()),
    )]);
    // SAFETY: A file URL and valid options.
    unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(path), Some(&options)) }
}

pub fn tracks(asset: &AVAsset, kind: &AVMediaType) -> Result<Vec<Retained<AVAssetTrack>>> {
    let result = crate::objc::wait(Duration::from_secs(20), |tx| {
        let block = block2::RcBlock::new(
            move |found: *mut NSArray<AVAssetTrack>, error: *mut objc2_foundation::NSError| {
                // SAFETY: AVFoundation hands us valid (or null) pointers.
                let outcome = unsafe {
                    match found.as_ref() {
                        Some(found) => Ok(found.to_vec()),
                        None => Err(error
                            .as_ref()
                            .map(|e| e.localizedDescription().to_string())
                            .unwrap_or_else(|| "Couldn't read the video".into())),
                    }
                };
                let _ = tx.send(SendTracks(outcome));
            },
        );
        // SAFETY: The block is called once from an AVFoundation queue.
        unsafe { asset.loadTracksWithMediaType_completionHandler(kind, &block) };
    });
    match result {
        Some(SendTracks(Ok(found))) => Ok(found),
        Some(SendTracks(Err(e))) => Err(anyhow!(e)),
        None => bail!("Timed out reading the video"),
    }
}

struct SendTracks(Result<Vec<Retained<AVAssetTrack>>, String>);
// SAFETY: AVAssetTrack is immutable once loaded and safe to pass between threads.
unsafe impl Send for SendTracks {}

fn transform(track: &AVAssetTrack) -> Affine {
    // SAFETY: Loaded track.
    let t = unsafe { track.preferredTransform() };
    [t.a, t.b, t.c, t.d, t.tx, t.ty]
}

/// The track's size after its rotation.
fn display_size(track: &AVAssetTrack) -> (f64, f64) {
    // SAFETY: Loaded track.
    let size = unsafe { track.naturalSize() };
    let t = transform(track);
    let w = (size.width * t[0] + size.height * t[2]).abs();
    let h = (size.width * t[1] + size.height * t[3]).abs();
    (w.round(), h.round())
}

/// Copies each stretch of `from`'s media inside `limit` into `into`, at its own
/// time less `shift`. Inserting the whole range at once would close up empty
/// edits, so a mic or camera that started late would drift early.
///
/// # Safety
///
/// Both tracks must be loaded.
unsafe fn copy_track(
    into: &objc2_av_foundation::AVMutableCompositionTrack,
    from: &AVAssetTrack,
    limit: CMTimeRange,
    shift: CMTime,
) -> bool {
    let mut copied = false;
    // SAFETY: Guaranteed by the caller.
    unsafe {
        for segment in from.segments().iter() {
            if segment.isEmpty() {
                continue;
            }
            let piece = segment.timeMapping().target.intersection(limit);
            if seconds(piece.duration) <= 0.0 {
                continue;
            }
            let at = piece.start.subtract(shift);
            copied |= into
                .insertTimeRange_ofTrack_atTime_error(piece, from, at)
                .is_ok();
        }
    }
    copied
}

pub fn open(screen: &Path, camera: Option<&Path>) -> Result<Media> {
    let video_kind = k!(objc2_av_foundation::AVMediaTypeVideo);
    let audio_kind = k!(objc2_av_foundation::AVMediaTypeAudio);

    let screen_asset = open_asset(screen);
    let video = tracks(&screen_asset, video_kind)?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("This file has no video"))?;
    let audio = tracks(&screen_asset, audio_kind)?.into_iter().next();

    // SAFETY: Plain AVFoundation calls on loaded tracks.
    unsafe {
        let range = video.timeRange();
        if seconds(range.duration) <= 0.0 {
            bail!("This video is empty");
        }
        let composition = AVMutableComposition::composition();
        let comp_video = composition
            .addMutableTrackWithMediaType_preferredTrackID(video_kind, 0)
            .ok_or_else(|| anyhow!("Couldn't prepare the video"))?;
        comp_video
            .insertTimeRange_ofTrack_atTime_error(range, &video, kCMTimeZero)
            .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
        comp_video.setPreferredTransform(video.preferredTransform());

        // Audio and camera keep their place relative to the screen's start.
        let limit = CMTimeRange::new(range.start, range.duration);
        let mut has_audio = false;
        if let Some(audio) = &audio {
            if let Some(comp_audio) =
                composition.addMutableTrackWithMediaType_preferredTrackID(audio_kind, 0)
            {
                has_audio = copy_track(&comp_audio, audio, limit, range.start);
            }
        }

        let mut camera_track = None;
        if let Some(camera) = camera {
            let cam_asset = open_asset(camera);
            if let Some(cam) = tracks(&cam_asset, video_kind)?.into_iter().next() {
                if let Some(comp_cam) =
                    composition.addMutableTrackWithMediaType_preferredTrackID(video_kind, 0)
                {
                    // The camera file starts with the screen; only its own
                    // timeline matters.
                    let cam_limit = CMTimeRange::new(kCMTimeZero, range.duration);
                    if copy_track(&comp_cam, &cam, cam_limit, kCMTimeZero) {
                        camera_track = Some((comp_cam.trackID(), transform(&cam)));
                    }
                }
            }
        }

        let (width, height) = display_size(&video);
        let fps = video.nominalFrameRate() as f64;
        Ok(Media {
            tracks: Tracks {
                screen: comp_video.trackID(),
                screen_transform: transform(&video),
                camera: camera_track,
            },
            duration: range.duration,
            source: Source {
                width,
                height,
                has_camera: camera_track.is_some(),
            },
            fps: if fps > 0.0 { fps } else { 30.0 },
            has_audio,
            asset: composition,
        })
    }
}

/// Writes `count` evenly spaced JPEG thumbnails of the screen track, `height`
/// pixels tall, for the timeline filmstrip. Returns their paths in order.
pub fn thumbnails(
    path: &Path,
    dir: &Path,
    count: usize,
    height: f64,
) -> Result<Vec<std::path::PathBuf>> {
    use objc2::{AllocAnyThread, Message};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_av_foundation::AVAssetImageGenerator;
    use objc2_core_foundation::CGSize;
    use objc2_core_graphics::CGImage;

    std::fs::create_dir_all(dir)?;
    let asset = open_asset(path);
    let video = tracks(&asset, k!(objc2_av_foundation::AVMediaTypeVideo))?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("This file has no video"))?;
    // SAFETY: Loaded track.
    let length = seconds(unsafe { video.timeRange() }.duration);
    // SAFETY: Plain AVFoundation setup.
    let generator = unsafe {
        let g = AVAssetImageGenerator::assetImageGeneratorWithAsset(&asset);
        g.setAppliesPreferredTrackTransform(true);
        g.setMaximumSize(CGSize::new(0.0, height));
        g.setRequestedTimeToleranceBefore(crate::objc::time(0.1));
        g.setRequestedTimeToleranceAfter(crate::objc::time(0.1));
        g
    };
    let properties = dict(&[(
        // SAFETY: Static constant.
        unsafe { objc2_app_kit::NSImageCompressionFactor },
        any(&*crate::objc::num(0.72)),
    )]);

    struct SendImage(Option<objc2::rc::Retained<CGImage>>);
    // SAFETY: CGImage is immutable and thread safe.
    unsafe impl Send for SendImage {}

    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let at = length * (i as f64 + 0.5) / count as f64;
        let image = crate::objc::wait(Duration::from_secs(10), |tx| {
            let block = block2::RcBlock::new(
                move |image: *mut CGImage, _t: CMTime, _e: *mut objc2_foundation::NSError| {
                    // SAFETY: AVFoundation retains the image for the block's duration.
                    let image = unsafe { image.as_ref() }.map(|i| i.retain());
                    let _ = tx.send(SendImage(image));
                },
            );
            // SAFETY: The handler is called once.
            unsafe {
                generator.generateCGImageAsynchronouslyForTime_completionHandler(
                    crate::objc::time(at),
                    &block,
                )
            };
        });
        let Some(SendImage(Some(image))) = image else {
            continue;
        };
        let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
        // SAFETY: Valid properties dictionary.
        let Some(data) = (unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties)
        }) else {
            continue;
        };
        let file = dir.join(format!("{i:02}.jpg"));
        std::fs::write(&file, data.to_vec())?;
        out.push(file);
    }
    Ok(out)
}

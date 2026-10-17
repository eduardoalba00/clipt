//! Renders a take through its `Scene` into an MP4 tuned for X: H.264 (hardware
//! encoder), AAC, at most 1080p, 30 or 60 fps.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use objc2::rc::{autoreleasepool, Retained};
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderOutput, AVAssetReaderStatus, AVAssetReaderTrackOutput,
    AVAssetReaderVideoCompositionOutput, AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus,
};
use objc2_core_media::CMTimeRange;
use objc2_foundation::{NSArray, NSDate, NSDateFormatter, NSDictionary, NSString};

use crate::media::{self, Media};
use crate::objc::{any, dict, file_url, int, k, ns, num, seconds, time, yes};
use crate::render::{self, BGRA};
use crate::scene::Scene;

/// X's longest video is 2:20.
pub const X_MAX_SECONDS: f64 = 140.0;

const AUDIO_RATE: f64 = 48_000.0;
const LPCM: u32 = u32::from_be_bytes(*b"lpcm");
const AAC: u32 = u32::from_be_bytes(*b"aac ");

pub struct Job {
    pub screen: PathBuf,
    pub camera: Option<PathBuf>,
    pub scene: Scene,
    pub trim: (f64, f64),
    pub out: PathBuf,
}

/// About 10 Mbps for 1080p30 and 16 Mbps for 1080p60, scaled by pixel count.
pub fn bitrate(width: u32, height: u32, fps: u32) -> i64 {
    let base = if fps > 30 { 16_000_000.0 } else { 10_000_000.0 };
    let pixels = (width * height) as f64 / (1920.0 * 1080.0);
    (base * pixels).max(4_000_000.0) as i64
}

fn video_settings(
    width: u32,
    height: u32,
    fps: u32,
) -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    let compression = dict(&[
        (
            k!(objc2_av_foundation::AVVideoAverageBitRateKey),
            any(&*int(bitrate(width, height, fps))),
        ),
        (
            k!(objc2_av_foundation::AVVideoProfileLevelKey),
            any(k!(
                objc2_av_foundation::AVVideoProfileLevelH264HighAutoLevel
            )),
        ),
        (
            k!(objc2_av_foundation::AVVideoExpectedSourceFrameRateKey),
            any(&*int(fps as i64)),
        ),
        (
            k!(objc2_av_foundation::AVVideoMaxKeyFrameIntervalKey),
            any(&*int(fps as i64 * 2)),
        ),
    ]);
    let color = dict(&[
        (
            k!(objc2_av_foundation::AVVideoColorPrimariesKey),
            any(k!(objc2_av_foundation::AVVideoColorPrimaries_ITU_R_709_2)),
        ),
        (
            k!(objc2_av_foundation::AVVideoTransferFunctionKey),
            any(k!(objc2_av_foundation::AVVideoTransferFunction_ITU_R_709_2)),
        ),
        (
            k!(objc2_av_foundation::AVVideoYCbCrMatrixKey),
            any(k!(objc2_av_foundation::AVVideoYCbCrMatrix_ITU_R_709_2)),
        ),
    ]);
    // Prefer the hardware encoder (VideoToolbox) without failing where it's busy.
    let encoder = dict(&[(&*ns("EnableHardwareAcceleratedVideoEncoder"), any(&*yes()))]);
    dict(&[
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
            any(&*compression),
        ),
        (
            k!(objc2_av_foundation::AVVideoColorPropertiesKey),
            any(&*color),
        ),
        (
            k!(objc2_av_foundation::AVVideoEncoderSpecificationKey),
            any(&*encoder),
        ),
    ])
}

fn pcm_settings() -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    dict(&[
        (&*ns("AVFormatIDKey"), any(&*int(LPCM as i64))),
        (&*ns("AVSampleRateKey"), any(&*num(AUDIO_RATE))),
        (&*ns("AVNumberOfChannelsKey"), any(&*int(2))),
        (&*ns("AVLinearPCMBitDepthKey"), any(&*int(16))),
        (
            &*ns("AVLinearPCMIsFloatKey"),
            any(&*objc2_foundation::NSNumber::new_bool(false)),
        ),
        (
            &*ns("AVLinearPCMIsBigEndianKey"),
            any(&*objc2_foundation::NSNumber::new_bool(false)),
        ),
        (
            &*ns("AVLinearPCMIsNonInterleaved"),
            any(&*objc2_foundation::NSNumber::new_bool(false)),
        ),
    ])
}

pub fn aac_settings() -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    dict(&[
        (&*ns("AVFormatIDKey"), any(&*int(AAC as i64))),
        (&*ns("AVSampleRateKey"), any(&*num(AUDIO_RATE))),
        (&*ns("AVNumberOfChannelsKey"), any(&*int(2))),
        (&*ns("AVEncoderBitRateKey"), any(&*int(128_000))),
    ])
}

fn bgra_settings() -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    dict(&[(
        &*ns("PixelFormatType"),
        any(&*objc2_foundation::NSNumber::new_u32(BGRA)),
    )])
}

/// The composited frames of `media` for `scene`, read straight from the
/// compositor (no encoding). Shared by export and the parity test.
pub fn frame_reader(
    media: &Media,
    scene: Scene,
    range: CMTimeRange,
) -> Result<(
    Retained<AVAssetReader>,
    Retained<AVAssetReaderVideoCompositionOutput>,
)> {
    let video_kind = k!(objc2_av_foundation::AVMediaTypeVideo);
    let tracks = media::tracks(&media.asset, video_kind)?;
    let tracks: Vec<&objc2_av_foundation::AVAssetTrack> = tracks.iter().map(|t| &**t).collect();
    // SAFETY: Plain AVFoundation setup.
    unsafe {
        let reader = AVAssetReader::assetReaderWithAsset_error(&media.asset)
            .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
        reader.setTimeRange(range);
        let output = AVAssetReaderVideoCompositionOutput::assetReaderVideoCompositionOutputWithVideoTracks_videoSettings(
            &NSArray::from_slice(&tracks),
            Some(&bgra_settings()),
        );
        output.setVideoComposition(Some(&render::video_composition(
            Arc::new(scene),
            media.tracks,
            media.duration,
        )));
        output.setAlwaysCopiesSampleData(false);
        if !reader.canAddOutput(&output) {
            bail!("Couldn't read the video");
        }
        reader.addOutput(&output);
        Ok((reader, output))
    }
}

/// Exports `job`, calling `progress` with 0..1 as it goes.
pub fn run(job: &Job, progress: &dyn Fn(f64)) -> Result<()> {
    let media = media::open(&job.screen, job.camera.as_deref())?;
    let total = media.seconds();
    let start = job.trim.0.clamp(0.0, total);
    let end = job.trim.1.clamp(start, total);
    if end - start < 0.05 {
        bail!("The trimmed clip is empty");
    }
    // SAFETY: Pure CoreMedia arithmetic.
    let range = unsafe {
        CMTimeRange::new(time(start), time(end - start))
            .intersection(CMTimeRange::new(time(0.0), media.duration))
    };
    let (width, height, fps) = (job.scene.width, job.scene.height, job.scene.fps);

    let (reader, video_out) = frame_reader(&media, job.scene.clone(), range)?;
    let audio_kind = k!(objc2_av_foundation::AVMediaTypeAudio);
    let video_kind = k!(objc2_av_foundation::AVMediaTypeVideo);

    let _ = std::fs::remove_file(&job.out);
    // SAFETY: Plain AVFoundation setup and a single-threaded pump loop.
    unsafe {
        let audio_out: Option<Retained<AVAssetReaderTrackOutput>> =
            if media.has_audio {
                media::tracks(&media.asset, audio_kind)?.first().and_then(|track| {
                let out = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(
                    track,
                    Some(&pcm_settings()),
                );
                reader.canAddOutput(&out).then(|| {
                    reader.addOutput(&out);
                    out
                })
            })
            } else {
                None
            };

        let writer = AVAssetWriter::assetWriterWithURL_fileType_error(
            &file_url(&job.out),
            k!(objc2_av_foundation::AVFileTypeMPEG4),
        )
        .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
        writer.setShouldOptimizeForNetworkUse(true);

        let video_in = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            video_kind,
            Some(&video_settings(width, height, fps)),
        );
        video_in.setExpectsMediaDataInRealTime(false);
        if !writer.canAddInput(&video_in) {
            bail!("Couldn't set up the H.264 encoder");
        }
        writer.addInput(&video_in);

        let audio_in = audio_out.as_ref().map(|_| {
            let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
                audio_kind,
                Some(&aac_settings()),
            );
            input.setExpectsMediaDataInRealTime(false);
            writer.addInput(&input);
            input
        });

        if !reader.startReading() {
            bail!(
                "Couldn't read the video: {}",
                crate::objc::error_text(reader.error())
            );
        }
        if !writer.startWriting() {
            bail!(
                "Couldn't write the file: {}",
                crate::objc::error_text(writer.error())
            );
        }
        writer.startSessionAtSourceTime(range.start);

        let video_src: &AVAssetReaderOutput = &video_out;
        let audio_src: Option<&AVAssetReaderOutput> = audio_out.as_deref().map(|o| &**o);
        let mut video_done = false;
        let mut audio_done = audio_in.is_none();
        let length = seconds(range.duration).max(1e-6);
        let mut last_report = -1.0;

        while !(video_done && audio_done) {
            let mut moved = false;
            autoreleasepool(|_| {
                if !video_done && video_in.isReadyForMoreMediaData() {
                    match video_src.copyNextSampleBuffer() {
                        Some(sample) => {
                            let t =
                                seconds(sample.presentation_time_stamp()) - seconds(range.start);
                            if !video_in.appendSampleBuffer(&sample) {
                                video_done = true;
                            }
                            let p = (t / length).clamp(0.0, 1.0);
                            if p - last_report >= 0.01 {
                                last_report = p;
                                progress(p);
                            }
                        }
                        None => {
                            video_in.markAsFinished();
                            video_done = true;
                        }
                    }
                    moved = true;
                }
                if let (false, Some(input), Some(src)) = (audio_done, &audio_in, audio_src) {
                    if input.isReadyForMoreMediaData() {
                        match src.copyNextSampleBuffer() {
                            Some(sample) => {
                                if !input.appendSampleBuffer(&sample) {
                                    audio_done = true;
                                }
                            }
                            None => {
                                input.markAsFinished();
                                audio_done = true;
                            }
                        }
                        moved = true;
                    }
                }
            });
            if writer.status() == AVAssetWriterStatus::Failed
                || reader.status() == AVAssetReaderStatus::Failed
            {
                break;
            }
            if !moved {
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        if reader.status() == AVAssetReaderStatus::Failed {
            writer.cancelWriting();
            bail!(
                "Couldn't read the video: {}",
                crate::objc::error_text(reader.error())
            );
        }
        if writer.status() == AVAssetWriterStatus::Failed {
            bail!(
                "Couldn't write the file: {}",
                crate::objc::error_text(writer.error())
            );
        }
        writer.endSessionAtSourceTime(range.start.add(range.duration));
        let finished = crate::objc::wait(Duration::from_secs(60), |tx| {
            let block = block2::RcBlock::new(move || {
                let _ = tx.send(());
            });
            writer.finishWritingWithCompletionHandler(&block);
        });
        if finished.is_none() || writer.status() != AVAssetWriterStatus::Completed {
            bail!(
                "Couldn't finish the file: {}",
                crate::objc::error_text(writer.error())
            );
        }
    }
    progress(1.0);
    Ok(())
}

/// "Clipt 2026-10-17 at 14.32.05.mp4", made unique in `dir`.
pub fn file_name(dir: &Path) -> PathBuf {
    let formatter = NSDateFormatter::new();
    formatter.setDateFormat(Some(&ns("yyyy-MM-dd 'at' HH.mm.ss")));
    let stamp = formatter.stringFromDate(&NSDate::now()).to_string();
    let base = format!("Clipt {stamp}");
    unique(dir, &base)
}

fn unique(dir: &Path, base: &str) -> PathBuf {
    let mut path = dir.join(format!("{base}.mp4"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} {n}.mp4"));
        n += 1;
    }
    path
}

/// Moves a finished export into place without ever replacing a file.
pub fn place(temp: &Path, dir: &Path) -> Result<PathBuf> {
    loop {
        let target = file_name(dir);
        // `hard_link` fails if the target exists, so a race can't overwrite.
        match std::fs::hard_link(temp, &target) {
            Ok(()) => {
                let _ = std::fs::remove_file(temp);
                return Ok(target);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitrate_scales() {
        assert_eq!(bitrate(1920, 1080, 30), 10_000_000);
        assert_eq!(bitrate(1920, 1080, 60), 16_000_000);
        assert!(bitrate(1080, 1080, 30) < 10_000_000);
        assert_eq!(bitrate(320, 240, 30), 4_000_000);
    }

    #[test]
    fn names_never_collide() {
        let dir = std::env::temp_dir().join(format!("clipt-name-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = unique(&dir, "Clipt x");
        std::fs::write(&a, b"1").unwrap();
        let b = unique(&dir, "Clipt x");
        assert_ne!(a, b);
        assert!(b.to_string_lossy().ends_with("Clipt x 2.mp4"));
        let temp = dir.join("temp.mp4");
        std::fs::write(&temp, b"2").unwrap();
        let placed = place(&temp, &dir).unwrap();
        assert!(!temp.exists());
        assert_eq!(std::fs::read(&placed).unwrap(), b"2");
        assert_eq!(std::fs::read(&a).unwrap(), b"1");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

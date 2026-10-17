//! Preview must match export. Plays a generated take through the preview's
//! own `AVPlayerItem` (as the app does, on the main thread) and compares that
//! frame with the same frame from the export path, before and after encoding.
//!
//! Runs without the test harness so it owns the main thread.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use clipt_lib::export::{self, Job};
use clipt_lib::objc::{any, dict, ns, time};
use clipt_lib::scene::{
    Aspect, Background, BrowserFrame, CameraBubble, Corner, Output, Recipe, Scene, Style, Trim,
};
use common::Frame;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_av_foundation::{AVPlayer, AVPlayerItemStatus, AVPlayerItemVideoOutput};
use objc2_core_foundation::CFRunLoop;
use objc2_core_media::{kCMTimeZero, CMTimeRange};
use objc2_foundation::NSNumber;

fn pump(seconds: f64) {
    // SAFETY: Static constant.
    let mode = unsafe { objc2_core_foundation::kCFRunLoopDefaultMode };
    CFRunLoop::run_in_mode(mode, seconds, false);
}

fn recipe() -> Recipe {
    Recipe {
        trim: Trim {
            start: 0.0,
            end: 2.0,
        },
        crop: Some(clipt_lib::scene::NormRect {
            x: 0.1,
            y: 0.05,
            w: 0.8,
            h: 0.9,
        }),
        style: Style {
            background: Background::Preset { id: "dusk".into() },
            padding: 0.6,
            radius: 0.8,
            shadow: true,
        },
        frame: BrowserFrame {
            enabled: true,
            url: "myapp.com".into(),
            dark: true,
        },
        camera: CameraBubble {
            visible: true,
            corner: Corner::BottomRight,
            size: 0.5,
        },
        output: Output {
            aspect: Aspect::Wide,
            fps: 30,
        },
    }
}

/// The frame at `at` as the preview's player shows it.
fn preview_frame(
    media: &clipt_lib::media::Media,
    scene: &Scene,
    at: f64,
    mtm: MainThreadMarker,
) -> Frame {
    let item = clipt_lib::preview::player_item(media, Arc::new(scene.clone()), mtm);
    let settings = dict(&[(
        &*ns("PixelFormatType"),
        any(&*NSNumber::new_u32(common::BGRA)),
    )]);
    // SAFETY: Straightforward AVFoundation use on the main thread.
    unsafe {
        let output = AVPlayerItemVideoOutput::initWithPixelBufferAttributes(
            AVPlayerItemVideoOutput::alloc(),
            Some(&settings),
        );
        item.addOutput(&output);
        let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
        let deadline = Instant::now() + Duration::from_secs(20);
        while item.status() != AVPlayerItemStatus::ReadyToPlay {
            assert!(
                item.status() != AVPlayerItemStatus::Failed,
                "player item failed"
            );
            assert!(Instant::now() < deadline, "player never got ready");
            pump(0.02);
        }
        let done = std::rc::Rc::new(std::cell::Cell::new(false));
        let flag = done.clone();
        let block = block2::RcBlock::new(move |_finished: objc2::runtime::Bool| flag.set(true));
        player.seekToTime_toleranceBefore_toleranceAfter_completionHandler(
            time(at),
            kCMTimeZero,
            kCMTimeZero,
            &block,
        );
        let deadline = Instant::now() + Duration::from_secs(20);
        while !done.get() {
            assert!(Instant::now() < deadline, "seek never finished");
            pump(0.02);
        }
        // Only accept the frame whose own timestamp is `at`: the output can
        // still hold the frame from before the seek.
        loop {
            let mut shown = time(-1.0);
            if let Some(buffer) =
                output.copyPixelBufferForItemTime_itemTimeForDisplay(time(at), &mut shown)
            {
                if (clipt_lib::objc::seconds(shown) - at).abs() < 0.5 / 30.0 {
                    return common::read_buffer(&buffer);
                }
            }
            assert!(Instant::now() < deadline, "no preview frame at {at}");
            pump(0.02);
        }
    }
}

/// The same frame straight out of the export path's compositor, unencoded.
fn composited_frame(media: &clipt_lib::media::Media, scene: &Scene, at: f64) -> Frame {
    // SAFETY: Pure CoreMedia arithmetic.
    let range = unsafe { CMTimeRange::new(time(at), time(0.5)) };
    let (reader, output) = export::frame_reader(media, scene.clone(), range).unwrap();
    // SAFETY: Reading on this thread.
    assert!(unsafe { reader.startReading() });
    common::nearest(&output, at)
}

fn main() {
    let mtm = MainThreadMarker::new().expect("runs on the main thread");
    let dir = std::env::temp_dir().join(format!("clipt-parity-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let screen = dir.join("screen.mov");
    let camera = dir.join("camera.mov");
    common::make_clip(&screen, 1280, 800, 30, 2.0, true);
    common::make_clip(&camera, 640, 480, 30, 2.0, false);

    let media = clipt_lib::media::open(&screen, Some(&camera)).unwrap();
    assert!(media.source.has_camera);
    let r = recipe();
    let scene = Scene::build(&r, &media.source);
    assert!(scene.frame.is_some() && scene.camera.is_some());
    let at = 1.0;

    let preview = preview_frame(&media, &scene, at, mtm);
    assert_eq!((preview.width, preview.height), (1920, 1080));
    preview.dump("preview");

    // 1. Same compositor, same source frame: identical pixels.
    let composited = composited_frame(&media, &scene, at);
    let (mean, share) = preview.diff(&composited, 0);
    println!(
        "preview vs export compositor: mean {mean:.4}, differing {:.4}%",
        share * 100.0
    );
    assert!(
        mean < 0.01,
        "preview and export render differently (mean {mean})"
    );

    // 2. The encoded file: same picture within H.264's loss.
    let out = dir.join("out.mp4");
    let job = Job {
        screen: screen.clone(),
        camera: Some(camera.clone()),
        scene: scene.clone(),
        trim: (0.0, 2.0),
        out: out.clone(),
    };
    export::run(&job, &|_| {}).unwrap();
    let encoded = common::file_frame(&out, at);
    encoded.dump("exported");
    let (mean, share) = preview.diff(&encoded, 24);
    println!(
        "preview vs exported MP4: mean {mean:.3}, over 24: {:.3}%",
        share * 100.0
    );
    assert!(
        mean < 3.0,
        "exported frame drifted from the preview (mean {mean})"
    );
    assert!(
        share < 0.02,
        "exported frame drifted from the preview ({share})"
    );

    // 3. A different scene must not pass, so the check has teeth.
    let mut other = r.clone();
    other.style.padding = 0.1;
    let other = Scene::build(&other, &media.source);
    let wrong = composited_frame(&media, &other, at);
    let (mean, _) = preview.diff(&wrong, 24);
    assert!(
        mean > 5.0,
        "the comparison can't tell scenes apart (mean {mean})"
    );

    std::fs::remove_dir_all(&dir).unwrap();
    println!("parity: ok");
}

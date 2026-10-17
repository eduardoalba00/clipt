//! Generates a clip in code, exports it with known settings and checks the
//! file with AVFoundation: duration, resolution, frame rate and codecs.

mod common;

use std::path::PathBuf;

use clipt_lib::export::{self, Job};
use clipt_lib::scene::{
    Aspect, Background, BrowserFrame, CameraBubble, Corner, Output, Recipe, Scene, Style, Trim,
};

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("clipt-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn recipe(aspect: Aspect, fps: u32, trim: (f64, f64)) -> Recipe {
    Recipe {
        trim: Trim {
            start: trim.0,
            end: trim.1,
        },
        crop: None,
        style: Style {
            background: Background::Preset { id: "dawn".into() },
            padding: 0.5,
            radius: 0.5,
            shadow: true,
        },
        frame: BrowserFrame {
            enabled: false,
            url: "myapp.com".into(),
            dark: false,
        },
        camera: CameraBubble {
            visible: false,
            corner: Corner::BottomRight,
            size: 0.5,
        },
        output: Output { aspect, fps },
    }
}

fn export(clip: &std::path::Path, out: &std::path::Path, r: &Recipe) -> Scene {
    let media = clipt_lib::media::open(clip, None).unwrap();
    let scene = Scene::build(r, &media.source);
    let job = Job {
        screen: clip.to_path_buf(),
        camera: None,
        scene: scene.clone(),
        trim: (r.trim.start, r.trim.end),
        out: out.to_path_buf(),
    };
    let last = std::cell::Cell::new(0.0);
    export::run(&job, &|p| {
        assert!(p >= last.get(), "progress only moves forward");
        last.set(p);
    })
    .unwrap();
    assert_eq!(last.get(), 1.0);
    scene
}

#[test]
fn exports_1080p30_h264_aac() {
    let d = dir("wide");
    let clip = d.join("clip.mov");
    common::make_clip(&clip, 1280, 800, 30, 3.0, true);
    let source = common::facts(&clip);
    assert_eq!((source.width, source.height), (1280.0, 800.0));

    let out = d.join("out.mp4");
    let r = recipe(Aspect::Wide, 30, (0.5, 2.5));
    let scene = export(&clip, &out, &r);

    let f = common::facts(&out);
    assert_eq!((f.width, f.height), (1920.0, 1080.0));
    assert!((f.duration - 2.0).abs() < 0.05, "duration {}", f.duration);
    assert!((f.fps - 30.0).abs() < 0.5, "fps {}", f.fps);
    assert_eq!(f.video_codec, "avc1");
    assert_eq!(f.audio_codec.as_deref(), Some("aac "));

    // The corner is the Dawn gradient's first colour, #F9C6E0, and the middle
    // of the card is video, not background.
    let frame = common::file_frame(&out, 1.0);
    let [r0, g0, b0] = frame.pixel(4, 4);
    assert!(
        r0.abs_diff(0xF9) < 12 && g0.abs_diff(0xC6) < 12 && b0.abs_diff(0xE0) < 12,
        "{r0} {g0} {b0}"
    );
    let cx = (scene.video.x + scene.video.w / 2.0) as usize;
    let cy = (scene.video.y + scene.video.h * 0.75) as usize;
    let mid = frame.pixel(cx, cy);
    assert!(mid != frame.pixel(4, 4));
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn exports_square_60fps_without_audio() {
    let d = dir("square");
    let clip = d.join("clip.mov");
    common::make_clip(&clip, 1280, 800, 60, 1.5, false);
    let out = d.join("out.mp4");
    let r = recipe(Aspect::Square, 60, (0.0, 1.5));
    export(&clip, &out, &r);

    let f = common::facts(&out);
    assert_eq!((f.width, f.height), (1080.0, 1080.0));
    assert!((f.duration - 1.5).abs() < 0.05, "duration {}", f.duration);
    assert!((f.fps - 60.0).abs() < 0.5, "fps {}", f.fps);
    assert_eq!(f.video_codec, "avc1");
    assert_eq!(f.audio_codec, None);
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn portrait_and_auto_sizes() {
    let d = dir("sizes");
    let clip = d.join("clip.mov");
    common::make_clip(&clip, 1280, 800, 30, 0.5, false);
    for (aspect, size) in [
        (Aspect::Portrait, (1080.0, 1350.0)),
        (Aspect::Auto, (1920.0, 1080.0)),
    ] {
        let out = d.join("out.mp4");
        let mut r = recipe(aspect, 30, (0.0, 0.5));
        r.style.padding = 0.0;
        let scene = export(&clip, &out, &r);
        let f = common::facts(&out);
        assert_eq!(
            (f.width, f.height),
            (scene.width as f64, scene.height as f64)
        );
        if aspect == Aspect::Portrait {
            assert_eq!((f.width, f.height), size);
        } else {
            // 1280x800 is 16:10, so Auto at no padding is 1728x1080.
            assert_eq!((f.width, f.height), (1728.0, 1080.0));
        }
    }
    std::fs::remove_dir_all(&d).unwrap();
}

/// Writes a sample take for trying Clipt by hand:
/// `CLIPT_SAMPLE=~/Desktop/sample.mov cargo test --test export sample -- --ignored`
#[test]
#[ignore]
fn sample() {
    let path = std::env::var("CLIPT_SAMPLE").expect("set CLIPT_SAMPLE");
    common::make_clip(std::path::Path::new(&path), 1440, 900, 60, 6.0, true);
}

/// Renders the README demo frames with Clipt's own compositor:
/// `CLIPT_DUMP=/tmp/demo cargo test --release --test export demo -- --ignored`
#[test]
#[ignore]
fn demo() {
    let out = std::env::var("CLIPT_DUMP").expect("set CLIPT_DUMP");
    let clip = std::path::Path::new(&out).join("app.mov");
    common::make_painted(&clip, 1600, 1000, 60, 8.0, false, common::app_ui);
    let media = clipt_lib::media::open(&clip, None).unwrap();

    let mut r = recipe(Aspect::Auto, 30, (0.0, 8.0));
    r.style.padding = 0.0;
    r.style.radius = 0.0;
    r.style.shadow = false;
    let mut steps: Vec<(Recipe, bool)> = vec![(r.clone(), true)];
    r.style.padding = 0.45;
    steps.push((r.clone(), false));
    r.style.radius = 0.6;
    r.style.shadow = true;
    steps.push((r.clone(), false));
    r.frame.enabled = true;
    steps.push((r.clone(), false));
    r.style.background = Background::Preset { id: "dusk".into() };
    r.frame.dark = true;
    steps.push((r.clone(), false));
    r.output.aspect = Aspect::Wide;
    steps.push((r.clone(), false));
    r.output.aspect = Aspect::Square;
    r.style.background = Background::Preset {
        id: "seaGlass".into(),
    };
    r.frame.dark = false;
    steps.push((r.clone(), false));

    let mut frame_no = 0;
    for (i, (recipe, plain)) in steps.iter().enumerate() {
        let scene = if *plain {
            Scene::plain(&media.source, 30)
        } else {
            Scene::build(recipe, &media.source)
        };
        let start = i as f64 * 1.1;
        // SAFETY: Pure CoreMedia arithmetic.
        let range = unsafe {
            objc2_core_media::CMTimeRange::new(
                clipt_lib::objc::time(start),
                clipt_lib::objc::time(1.1),
            )
        };
        let (reader, output) = clipt_lib::export::frame_reader(&media, scene, range).unwrap();
        // SAFETY: Reading on this thread.
        unsafe {
            assert!(reader.startReading());
            let mut n = 0;
            while let Some(sample) = output.copyNextSampleBuffer() {
                if n % 3 == 0 {
                    if let Some(image) = sample.image_buffer() {
                        common::read_buffer(&image).dump(&format!("demo-{frame_no:03}"));
                        frame_no += 1;
                    }
                }
                n += 1;
            }
        }
    }
}

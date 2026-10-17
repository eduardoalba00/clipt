//! The edit recipe and the layout it produces.
//!
//! `Recipe` is what the user chose (owned by the UI's undo history). `Scene`
//! is the single source of truth for what a frame looks like: canvas size,
//! where the video sits, crop, corners, shadow, browser frame and camera
//! bubble, all in output pixels. Preview and export both render a `Scene`.

use serde::{Deserialize, Serialize};

/// Output frames are capped at 1080p for X.
pub const MAX_LONG: f64 = 1920.0;
pub const MAX_SHORT: f64 = 1080.0;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub trim: Trim,
    pub crop: Option<NormRect>,
    pub style: Style,
    pub frame: BrowserFrame,
    pub camera: CameraBubble,
    pub output: Output,
}

/// Seconds into the take.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Trim {
    pub start: f64,
    pub end: f64,
}

/// A rectangle in 0..1 units of the source frame, origin top-left.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub background: Background,
    /// Slider value, 0..1.
    pub padding: f64,
    /// Slider value, 0..1.
    pub radius: f64,
    pub shadow: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Background {
    Preset { id: String },
    Solid { color: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrame {
    pub enabled: bool,
    pub url: String,
    pub dark: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraBubble {
    pub visible: bool,
    pub corner: Corner,
    /// Slider value, 0..1.
    pub size: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Aspect {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "16:9")]
    Wide,
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "4:5")]
    Portrait,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Output {
    pub aspect: Aspect,
    pub fps: u32,
}

/// Straight sRGB, 0..1.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Rgb {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

impl Rgb {
    pub const fn hex(v: u32) -> Self {
        Rgb {
            r: ((v >> 16) & 0xff) as f64 / 255.0,
            g: ((v >> 8) & 0xff) as f64 / 255.0,
            b: (v & 0xff) as f64 / 255.0,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        let s = s.strip_prefix('#')?;
        if s.len() != 6 {
            return None;
        }
        u32::from_str_radix(s, 16).ok().map(Rgb::hex)
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Fill {
    Solid { color: Rgb },
    Gradient { from: Rgb, to: Rgb },
}

pub struct Preset {
    pub id: &'static str,
    pub fill: Fill,
}

const fn gradient(id: &'static str, from: u32, to: u32) -> Preset {
    Preset {
        id,
        fill: Fill::Gradient {
            from: Rgb::hex(from),
            to: Rgb::hex(to),
        },
    }
}

const fn solid(id: &'static str, color: u32) -> Preset {
    Preset {
        id,
        fill: Fill::Solid {
            color: Rgb::hex(color),
        },
    }
}

/// Keep in sync with `src/lib/presets.ts` (names and swatches for the UI).
pub const PRESETS: [Preset; 8] = [
    gradient("dawn", 0xF9C6E0, 0xA9C2F0),
    gradient("seaGlass", 0xA8E6E2, 0xF6D6E4),
    gradient("apricot", 0xF7D58B, 0xF4A28C),
    gradient("sage", 0xDCE8D2, 0x9DB89A),
    gradient("dusk", 0x232A47, 0x5E4A8C),
    gradient("graphite", 0x3A3A3D, 0x161618),
    solid("paper", 0xF3F0EA),
    solid("ink", 0x111113),
];

impl Background {
    pub fn fill(&self) -> Fill {
        match self {
            Background::Preset { id } => PRESETS
                .iter()
                .find(|p| p.id == id)
                .map(|p| p.fill)
                .unwrap_or(PRESETS[0].fill),
            Background::Solid { color } => Fill::Solid {
                color: Rgb::parse(color).unwrap_or(Rgb::hex(0x111113)),
            },
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Rect { x, y, w, h }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Minimal browser chrome drawn above the video.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameLayout {
    pub bar: Rect,
    pub dots: [Point; 3],
    pub dot_radius: f64,
    pub pill: Rect,
    pub text: String,
    pub font_size: f64,
    pub dark: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraLayout {
    pub center: Point,
    pub radius: f64,
    pub ring: f64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shadow {
    pub offset_y: f64,
    pub blur: f64,
    pub opacity: f64,
}

/// What the source looks like before any edits, after its rotation is applied.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Source {
    pub width: f64,
    pub height: f64,
    pub has_camera: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub fill: Fill,
    /// Bar plus video, the rounded card. Output pixels, origin top-left.
    pub card: Rect,
    pub video: Rect,
    /// The part of the (oriented) source shown in `video`, source pixels, top-left.
    pub source_crop: Rect,
    pub radius: f64,
    pub shadow: Option<Shadow>,
    pub frame: Option<FrameLayout>,
    pub camera: Option<CameraLayout>,
    /// Plain source frames with nothing on top: used while editing the crop.
    pub plain: bool,
    pub fps: u32,
}

fn even(v: f64) -> u32 {
    let v = v.round().max(2.0) as u32;
    v + (v & 1)
}

/// The largest size with this aspect that fits within 1920x1080 (or 1080x1920).
fn fit_max(aspect: f64) -> (u32, u32) {
    let (bw, bh) = if aspect >= 1.0 {
        (MAX_LONG, MAX_SHORT)
    } else {
        (MAX_SHORT, MAX_LONG)
    };
    let (w, h) = if bw / bh > aspect {
        (bh * aspect, bh)
    } else {
        (bw, bw / aspect)
    };
    (even(w), even(h))
}

/// Fit `aspect` inside `area`, centred.
fn contain(area: Rect, aspect: f64) -> Rect {
    let (w, h) = if area.w / area.h > aspect {
        (area.h * aspect, area.h)
    } else {
        (area.w, area.w / aspect)
    };
    Rect::new(
        area.x + (area.w - w) / 2.0,
        area.y + (area.h - h) / 2.0,
        w,
        h,
    )
}

/// Browser bar height as a fraction of the video width.
const BAR: f64 = 0.042;

pub fn crop_rect(recipe: &Recipe, src: &Source) -> Rect {
    let c = recipe.crop.unwrap_or(NormRect {
        x: 0.0,
        y: 0.0,
        w: 1.0,
        h: 1.0,
    });
    let x = c.x.clamp(0.0, 1.0);
    let y = c.y.clamp(0.0, 1.0);
    let w = c.w.clamp(0.01, 1.0 - x);
    let h = c.h.clamp(0.01, 1.0 - y);
    Rect::new(x * src.width, y * src.height, w * src.width, h * src.height)
}

impl Scene {
    pub fn build(recipe: &Recipe, src: &Source) -> Scene {
        let crop = crop_rect(recipe, src);
        let video_aspect = crop.w / crop.h;
        let framed = recipe.frame.enabled;
        // Card = video plus a bar whose height scales with the video width.
        let card_aspect = if framed {
            1.0 / (1.0 / video_aspect + BAR)
        } else {
            video_aspect
        };
        let pad = recipe.style.padding.clamp(0.0, 1.0) * 0.16;

        // Auto sizes the canvas around the card: card height 1, width `card_aspect`,
        // padding relative to the card's short side.
        let auto_pad = pad * card_aspect.min(1.0);
        let (width, height) = match recipe.output.aspect {
            Aspect::Auto => fit_max((card_aspect + 2.0 * auto_pad) / (1.0 + 2.0 * auto_pad)),
            Aspect::Wide => (1920, 1080),
            Aspect::Square => (1080, 1080),
            Aspect::Portrait => (1080, 1350),
        };
        let (w, h) = (width as f64, height as f64);
        let short = w.min(h);

        let card = match recipe.output.aspect {
            Aspect::Auto => {
                let scale = (w / (card_aspect + 2.0 * auto_pad)).min(h / (1.0 + 2.0 * auto_pad));
                let (cw, ch) = (card_aspect * scale, scale);
                Rect::new((w - cw) / 2.0, (h - ch) / 2.0, cw, ch)
            }
            _ => {
                let p = pad * short;
                contain(Rect::new(p, p, w - 2.0 * p, h - 2.0 * p), card_aspect)
            }
        };

        let bar_h = if framed { card.w * BAR } else { 0.0 };
        let video = Rect::new(card.x, card.y + bar_h, card.w, card.h - bar_h);

        let radius =
            (recipe.style.radius.clamp(0.0, 1.0) * 0.045 * short).min(card.w.min(card.h) / 2.0);
        let shadow = recipe.style.shadow.then_some(Shadow {
            offset_y: 0.012 * short,
            blur: 0.022 * short,
            opacity: 0.32,
        });

        let frame = framed.then(|| {
            let cy = card.y + bar_h / 2.0;
            let dot_radius = bar_h * 0.15;
            let first = card.x + bar_h * 0.55;
            let gap = bar_h * 0.46;
            let pill_h = bar_h * 0.6;
            let pill_w = (card.w * 0.42).max(pill_h * 4.0).min(card.w - bar_h * 5.0);
            FrameLayout {
                bar: Rect::new(card.x, card.y, card.w, bar_h),
                dots: [0.0, 1.0, 2.0].map(|i| Point {
                    x: first + gap * i,
                    y: cy,
                }),
                dot_radius,
                pill: Rect::new(
                    card.x + (card.w - pill_w) / 2.0,
                    cy - pill_h / 2.0,
                    pill_w,
                    pill_h,
                ),
                text: recipe.frame.url.trim().to_string(),
                font_size: bar_h * 0.34,
                dark: recipe.frame.dark,
            }
        });

        let camera = (src.has_camera && recipe.camera.visible).then(|| {
            let radius = (0.07 + recipe.camera.size.clamp(0.0, 1.0) * 0.08) * short;
            let margin = 0.035 * short + radius;
            let (x, y) = match recipe.camera.corner {
                Corner::TopLeft => (margin, margin),
                Corner::TopRight => (w - margin, margin),
                Corner::BottomLeft => (margin, h - margin),
                Corner::BottomRight => (w - margin, h - margin),
            };
            CameraLayout {
                center: Point { x, y },
                radius,
                ring: (0.006 * short).max(2.0),
            }
        });

        Scene {
            width,
            height,
            fill: recipe.style.background.fill(),
            card,
            video,
            source_crop: crop,
            radius,
            shadow,
            frame,
            camera,
            plain: false,
            fps: recipe.output.fps,
        }
    }

    /// The whole source frame and nothing else, for drawing the crop on top.
    pub fn plain(src: &Source, fps: u32) -> Scene {
        let (width, height) = fit_max(src.width / src.height);
        let full = Rect::new(0.0, 0.0, width as f64, height as f64);
        Scene {
            width,
            height,
            fill: Fill::Solid { color: Rgb::hex(0) },
            card: full,
            video: full,
            source_crop: Rect::new(0.0, 0.0, src.width, src.height),
            radius: 0.0,
            shadow: None,
            frame: None,
            camera: None,
            plain: true,
            fps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe() -> Recipe {
        Recipe {
            trim: Trim {
                start: 0.0,
                end: 10.0,
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
                visible: true,
                corner: Corner::BottomRight,
                size: 0.5,
            },
            output: Output {
                aspect: Aspect::Auto,
                fps: 60,
            },
        }
    }

    const RETINA: Source = Source {
        width: 3024.0,
        height: 1964.0,
        has_camera: false,
    };

    fn inside(inner: Rect, w: u32, h: u32) -> bool {
        inner.x >= -1e-6
            && inner.y >= -1e-6
            && inner.x + inner.w <= w as f64 + 1e-6
            && inner.y + inner.h <= h as f64 + 1e-6
    }

    #[test]
    fn fixed_aspects_have_x_sizes() {
        let mut r = recipe();
        for (aspect, size) in [
            (Aspect::Wide, (1920, 1080)),
            (Aspect::Square, (1080, 1080)),
            (Aspect::Portrait, (1080, 1350)),
        ] {
            r.output.aspect = aspect;
            let s = Scene::build(&r, &RETINA);
            assert_eq!((s.width, s.height), size);
            assert!(inside(s.card, s.width, s.height));
        }
    }

    #[test]
    fn auto_fits_1080p_and_is_even() {
        let mut r = recipe();
        for pad in [0.0, 0.3, 1.0] {
            r.style.padding = pad;
            for src in [
                RETINA,
                Source {
                    width: 1080.0,
                    height: 1920.0,
                    has_camera: false,
                },
                Source {
                    width: 801.0,
                    height: 333.0,
                    has_camera: false,
                },
            ] {
                let s = Scene::build(&r, &src);
                assert!(s.width % 2 == 0 && s.height % 2 == 0);
                assert!(s.width.max(s.height) <= 1920 && s.width.min(s.height) <= 1080);
                assert!(inside(s.card, s.width, s.height));
                // The video keeps the source aspect.
                let a = s.video.w / s.video.h;
                assert!((a - src.width / src.height).abs() < 0.01, "{a}");
            }
        }
    }

    #[test]
    fn auto_without_padding_fills_canvas() {
        let mut r = recipe();
        r.style.padding = 0.0;
        let s = Scene::build(&r, &RETINA);
        assert!((s.card.w - s.width as f64).abs() < 2.0);
        assert!((s.card.h - s.height as f64).abs() < 2.0);
    }

    #[test]
    fn padding_insets_card() {
        let mut r = recipe();
        r.output.aspect = Aspect::Wide;
        r.style.padding = 1.0;
        let s = Scene::build(&r, &RETINA);
        assert!(s.card.y >= 0.16 * 1080.0 - 1.0);
    }

    #[test]
    fn crop_changes_video_aspect() {
        let mut r = recipe();
        r.crop = Some(NormRect {
            x: 0.25,
            y: 0.0,
            w: 0.5,
            h: 1.0,
        });
        let s = Scene::build(&r, &RETINA);
        assert_eq!(s.source_crop, Rect::new(756.0, 0.0, 1512.0, 1964.0));
        assert!((s.video.w / s.video.h - 1512.0 / 1964.0).abs() < 0.01);
    }

    #[test]
    fn frame_bar_sits_above_video() {
        let mut r = recipe();
        r.frame.enabled = true;
        r.output.aspect = Aspect::Square;
        let s = Scene::build(&r, &RETINA);
        let f = s.frame.expect("frame");
        assert!((f.bar.y + f.bar.h - s.video.y).abs() < 1e-6);
        assert!((s.video.w / s.video.h - 3024.0 / 1964.0).abs() < 0.01);
        assert!(f.pill.x > f.dots[2].x);
    }

    #[test]
    fn camera_only_when_recorded() {
        let r = recipe();
        assert!(Scene::build(&r, &RETINA).camera.is_none());
        let with_cam = Source {
            has_camera: true,
            ..RETINA
        };
        let cam = Scene::build(&r, &with_cam).camera.expect("camera");
        assert!(cam.center.x > 1000.0);
    }

    #[test]
    fn recipe_json_round_trips() {
        let json = serde_json::to_string(&recipe()).unwrap();
        assert!(json.contains("\"aspect\":\"auto\""));
        let back: Recipe = serde_json::from_str(&json).unwrap();
        assert_eq!(back, recipe());
    }
}

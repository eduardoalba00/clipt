//! Draws a `Scene` with Core Image, and plugs that into AVFoundation as a
//! custom video compositor.
//!
//! Preview (an `AVPlayer`) and export (an `AVAssetReader`) both use the
//! `AVVideoComposition` built by [`video_composition`], so every frame on
//! screen and in the file goes through the same [`compose`] call.

use std::sync::{Arc, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, ClassType, DefinedClass, Message};
use objc2_av_foundation::{
    AVAsynchronousVideoCompositionRequest, AVMutableVideoComposition, AVVideoCompositing,
    AVVideoCompositionInstructionProtocol, AVVideoCompositionRenderContext,
};
use objc2_core_foundation::{CFRetained, CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGColorSpace;
use objc2_core_image::{CIColor, CIContext, CIFilter, CIImage, CIVector};
use objc2_core_media::{CMPersistentTrackID, CMTimeRange};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSArray, NSCopying, NSDictionary, NSNumber, NSString, NSValue, NSZone};

use crate::objc::{any, array, dict, int, k, ns, num, yes};
use crate::scene::{Fill, Rect, Rgb, Scene};

/// kCVPixelFormatType_32BGRA
pub const BGRA: u32 = u32::from_be_bytes(*b"BGRA");

/// An affine transform, `[a, b, c, d, tx, ty]`, as stored in a track's
/// `preferredTransform` (y axis pointing down).
pub type Affine = [f64; 6];

pub const IDENTITY: Affine = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// The tracks a frame is built from.
#[derive(Clone, Copy, Debug)]
pub struct Tracks {
    pub screen: CMPersistentTrackID,
    pub screen_transform: Affine,
    pub camera: Option<(CMPersistentTrackID, Affine)>,
}

// ---------------------------------------------------------------------------
// Core Image drawing

fn cg(t: Affine) -> CGAffineTransform {
    CGAffineTransform {
        a: t[0],
        b: t[1],
        c: t[2],
        d: t[3],
        tx: t[4],
        ty: t[5],
    }
}

/// `first`, then `second`.
fn concat(first: Affine, second: Affine) -> Affine {
    let [a1, b1, c1, d1, x1, y1] = first;
    let [a2, b2, c2, d2, x2, y2] = second;
    [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        x1 * a2 + y1 * c2 + x2,
        x1 * b2 + y1 * d2 + y2,
    ]
}

fn translate(x: f64, y: f64) -> Affine {
    [1.0, 0.0, 0.0, 1.0, x, y]
}

fn scale(x: f64, y: f64) -> Affine {
    [x, 0.0, 0.0, y, 0.0, 0.0]
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
    CGRect::new(CGPoint::new(x, y), CGSize::new(w, h))
}

/// Scene rects are top-left; Core Image is bottom-left.
fn flip(r: Rect, height: f64) -> CGRect {
    rect(r.x, height - r.y - r.h, r.w, r.h)
}

fn color(c: Rgb, alpha: f64) -> Retained<CIColor> {
    let space = crate::objc::srgb();
    // SAFETY: Valid components and color space.
    unsafe { CIColor::colorWithRed_green_blue_alpha_colorSpace(c.r, c.g, c.b, alpha, &space) }
        .expect("sRGB CIColor")
}

fn solid(c: Rgb, alpha: f64, area: CGRect) -> Retained<CIImage> {
    // SAFETY: Plain Core Image calls.
    unsafe { CIImage::imageWithColor(&color(c, alpha)).imageByCroppingToRect(area) }
}

fn generate(name: &str, params: &[(&NSString, &AnyObject)]) -> Retained<CIImage> {
    let params = dict(params);
    // SAFETY: Built-in generator with valid parameters.
    unsafe {
        CIFilter::filterWithName_withInputParameters(&ns(name), Some(&params))
            .and_then(|f| f.outputImage())
            .unwrap_or_else(|| CIImage::emptyImage())
    }
}

fn apply(image: &CIImage, name: &str, params: &[(&NSString, &AnyObject)]) -> Retained<CIImage> {
    // SAFETY: Built-in filter with valid parameters.
    unsafe { image.imageByApplyingFilter_withInputParameters(&ns(name), &dict(params)) }
}

fn over(top: &CIImage, bottom: &CIImage) -> Retained<CIImage> {
    // SAFETY: Plain Core Image call.
    unsafe { top.imageByCompositingOverImage(bottom) }
}

/// `image` where `mask` is opaque.
fn masked(image: &CIImage, mask: &CIImage) -> Retained<CIImage> {
    apply(
        image,
        "CISourceInCompositing",
        &[(&ns("inputBackgroundImage"), any(mask))],
    )
}

fn rounded(area: CGRect, radius: f64, c: Rgb, alpha: f64) -> Retained<CIImage> {
    // SAFETY: Plain Core Image calls.
    let extent = unsafe { CIVector::vectorWithCGRect(area) };
    generate(
        "CIRoundedRectangleGenerator",
        &[
            (&ns("inputExtent"), any(&*extent)),
            (&ns("inputRadius"), any(&*num(radius))),
            (&ns("inputColor"), any(&*color(c, alpha))),
        ],
    )
}

/// An anti-aliased disc.
fn disc(cx: f64, cy: f64, radius: f64, c: Rgb, alpha: f64) -> Retained<CIImage> {
    // SAFETY: Plain Core Image calls.
    let center = unsafe { CIVector::vectorWithX_Y(cx, cy) };
    let image = generate(
        "CIRadialGradient",
        &[
            (&ns("inputCenter"), any(&*center)),
            (&ns("inputRadius0"), any(&*num((radius - 0.75).max(0.0)))),
            (&ns("inputRadius1"), any(&*num(radius + 0.75))),
            (&ns("inputColor0"), any(&*color(c, alpha))),
            (&ns("inputColor1"), any(&*color(c, 0.0))),
        ],
    );
    // SAFETY: Plain Core Image call.
    unsafe {
        image.imageByCroppingToRect(rect(
            cx - radius - 2.0,
            cy - radius - 2.0,
            2.0 * radius + 4.0,
            2.0 * radius + 4.0,
        ))
    }
}

fn background(fill: Fill, canvas: CGRect) -> Retained<CIImage> {
    match fill {
        Fill::Solid { color } => solid(color, 1.0, canvas),
        Fill::Gradient { from, to } => {
            // Top-left to bottom-right.
            // SAFETY: Plain Core Image calls.
            let (p0, p1) = unsafe {
                (
                    CIVector::vectorWithX_Y(0.0, canvas.size.height),
                    CIVector::vectorWithX_Y(canvas.size.width, 0.0),
                )
            };
            let gradient = generate(
                "CISmoothLinearGradient",
                &[
                    (&ns("inputPoint0"), any(&*p0)),
                    (&ns("inputPoint1"), any(&*p1)),
                    (&ns("inputColor0"), any(&*color(from, 1.0))),
                    (&ns("inputColor1"), any(&*color(to, 1.0))),
                ],
            );
            // A fixed, faint noise keeps the encoder from banding the gradient.
            let noise = generate("CIRandomGenerator", &[]);
            let a = 1.5 / 255.0;
            // SAFETY: Plain Core Image calls.
            let (r, g, b, z, bias) = unsafe {
                (
                    CIVector::vectorWithX_Y_Z_W(a, 0.0, 0.0, 0.0),
                    CIVector::vectorWithX_Y_Z_W(0.0, a, 0.0, 0.0),
                    CIVector::vectorWithX_Y_Z_W(0.0, 0.0, a, 0.0),
                    CIVector::vectorWithX_Y_Z_W(0.0, 0.0, 0.0, 0.0),
                    CIVector::vectorWithX_Y_Z_W(-a / 2.0, -a / 2.0, -a / 2.0, 0.0),
                )
            };
            let noise = apply(
                &noise,
                "CIColorMatrix",
                &[
                    (&ns("inputRVector"), any(&*r)),
                    (&ns("inputGVector"), any(&*g)),
                    (&ns("inputBVector"), any(&*b)),
                    (&ns("inputAVector"), any(&*z)),
                    (&ns("inputBiasVector"), any(&*bias)),
                ],
            );
            let dithered = apply(
                &noise,
                "CIAdditionCompositing",
                &[(&ns("inputBackgroundImage"), any(&*gradient))],
            );
            // SAFETY: Plain Core Image call.
            unsafe { dithered.imageByCroppingToRect(canvas) }
        }
    }
}

/// Applies a track's preferred transform and moves the result to the origin.
fn orient(image: &CIImage, t: Affine) -> Retained<CIImage> {
    if t == IDENTITY {
        return image.retain();
    }
    // The transform is defined with y pointing down; Core Image points up.
    let flip = scale(1.0, -1.0);
    let m = concat(concat(flip, t), flip);
    // SAFETY: Plain Core Image calls.
    unsafe {
        let turned = image.imageByApplyingTransform(cg(m));
        let e = turned.extent();
        turned.imageByApplyingTransform(cg(translate(-e.origin.x, -e.origin.y)))
    }
}

/// Crops `src` (top-left `crop`, source pixels) and fits it into `dest`.
fn place(src: &CIImage, crop: Rect, dest: CGRect) -> Retained<CIImage> {
    // SAFETY: Plain Core Image calls.
    unsafe {
        let h = src.extent().size.height;
        let c = flip(crop, h);
        let sx = dest.size.width / c.size.width;
        let sy = dest.size.height / c.size.height;
        let m = concat(
            concat(translate(-c.origin.x, -c.origin.y), scale(sx, sy)),
            translate(dest.origin.x, dest.origin.y),
        );
        src.imageByCroppingToRect(c)
            .imageByClampingToExtent()
            .imageByApplyingTransform_highQualityDownsample(cg(m), true)
            .imageByCroppingToRect(dest)
    }
}

/// Text for the browser frame's URL pill.
fn text(s: &str, size: f64, c: Rgb) -> Retained<CIImage> {
    let image = generate(
        "CITextImageGenerator",
        &[
            (&ns("inputText"), any(&*ns(s))),
            (&ns("inputFontName"), any(&*ns("HelveticaNeue-Medium"))),
            (&ns("inputFontSize"), any(&*num(size))),
            (&ns("inputScaleFactor"), any(&*num(1.0))),
            (&ns("inputPadding"), any(&*num(0.0))),
        ],
    );
    // SAFETY: Plain Core Image calls.
    let extent = unsafe { image.extent() };
    masked(&solid(c, 1.0, extent), &image)
}

/// Every frame of preview and export is drawn here.
pub fn compose(scene: &Scene, screen: &CIImage, camera: Option<&CIImage>) -> Retained<CIImage> {
    let (w, h) = (scene.width as f64, scene.height as f64);
    let canvas = rect(0.0, 0.0, w, h);
    let video = flip(scene.video, h);
    let content = place(screen, scene.source_crop, video);

    if scene.plain {
        return over(&content, &solid(Rgb::hex(0), 1.0, canvas));
    }

    let card = flip(scene.card, h);
    let mut card_image = content;
    if let Some(frame) = &scene.frame {
        let (bar_color, pill_color, text_color) = if frame.dark {
            (Rgb::hex(0x2B2B2F), Rgb::hex(0x1C1C1F), Rgb::hex(0xA1A1A8))
        } else {
            (Rgb::hex(0xEDEDF0), Rgb::hex(0xFFFFFF), Rgb::hex(0x6B6B73))
        };
        let bar = flip(frame.bar, h);
        let mut chrome = solid(bar_color, 1.0, bar);
        for (i, dot) in frame.dots.iter().enumerate() {
            let c = [0xFF5F57, 0xFEBC2E, 0x28C840][i];
            chrome = over(
                &disc(dot.x, h - dot.y, frame.dot_radius, Rgb::hex(c), 1.0),
                &chrome,
            );
        }
        let pill = flip(frame.pill, h);
        chrome = over(
            &rounded(pill, pill.size.height / 2.0, pill_color, 1.0),
            &chrome,
        );
        if !frame.text.is_empty() {
            let label = text(&frame.text, frame.font_size, text_color);
            // SAFETY: Plain Core Image calls.
            unsafe {
                let e = label.extent();
                let room = pill.size.width - pill.size.height;
                let label = label.imageByCroppingToRect(rect(
                    e.origin.x,
                    e.origin.y,
                    e.size.width.min(room),
                    e.size.height,
                ));
                let e = label.extent();
                let x = pill.origin.x + (pill.size.width - e.size.width) / 2.0;
                let y = pill.origin.y + (pill.size.height - e.size.height) / 2.0;
                let label = label.imageByApplyingTransform(cg(translate(
                    (x - e.origin.x).round(),
                    (y - e.origin.y).round(),
                )));
                chrome = over(&label, &chrome);
            }
        }
        card_image = over(&card_image, &chrome);
    }

    let shape = rounded(card, scene.radius, Rgb::hex(0xFFFFFF), 1.0);
    let card_image = masked(&card_image, &shape);

    let mut out = background(scene.fill, canvas);
    if let Some(shadow) = scene.shadow {
        let shade = rounded(card, scene.radius, Rgb::hex(0), shadow.opacity);
        // SAFETY: Plain Core Image calls.
        let shade = unsafe {
            shade
                .imageByApplyingTransform(cg(translate(0.0, -shadow.offset_y)))
                .imageByApplyingGaussianBlurWithSigma(shadow.blur)
        };
        out = over(&shade, &out);
    }
    out = over(&card_image, &out);

    if let (Some(bubble), Some(cam)) = (&scene.camera, camera) {
        // SAFETY: Plain Core Image calls.
        let e = unsafe { cam.extent() };
        let side = e.size.width.min(e.size.height);
        let square = Rect::new(
            (e.size.width - side) / 2.0,
            (e.size.height - side) / 2.0,
            side,
            side,
        );
        let (cx, cy, r) = (bubble.center.x, h - bubble.center.y, bubble.radius);
        let face = place(cam, square, rect(cx - r, cy - r, 2.0 * r, 2.0 * r));
        let face = masked(&face, &disc(cx, cy, r, Rgb::hex(0xFFFFFF), 1.0));
        let ring = disc(cx, cy, r + bubble.ring, Rgb::hex(0xFFFFFF), 0.9);
        // SAFETY: Plain Core Image calls.
        let glow = unsafe {
            disc(cx, cy - bubble.ring, r + bubble.ring, Rgb::hex(0), 0.28)
                .imageByApplyingGaussianBlurWithSigma(bubble.ring * 3.0)
        };
        out = over(&face, &over(&ring, &over(&glow, &out)));
    }

    // SAFETY: Plain Core Image call.
    unsafe { out.imageByCroppingToRect(canvas) }
}

// ---------------------------------------------------------------------------
// Rendering

struct Renderer {
    context: Retained<CIContext>,
    output: CFRetained<CGColorSpace>,
}

// SAFETY: CIContext is documented as thread safe; color spaces are immutable.
unsafe impl Send for Renderer {}
// SAFETY: See above.
unsafe impl Sync for Renderer {}

fn renderer() -> &'static Renderer {
    static RENDERER: OnceLock<Renderer> = OnceLock::new();
    RENDERER.get_or_init(|| {
        let working = crate::objc::srgb();
        // Blend in sRGB like the rest of the UI (CSS does the same), so
        // gradients and shadows look the way the presets were picked.
        let options = dict(&[
            (
                unsafe { objc2_core_image::kCIContextWorkingColorSpace },
                any(&*working),
            ),
            (
                unsafe { objc2_core_image::kCIContextCacheIntermediates },
                any(&*NSNumber::new_bool(false)),
            ),
        ]);
        // SAFETY: Valid options.
        let context = unsafe { CIContext::contextWithOptions(Some(&options)) };
        Renderer {
            context,
            output: crate::objc::rec709(),
        }
    })
}

/// Draws `image` into `buffer`, tagged and encoded as Rec. 709.
pub fn render_into(image: &CIImage, buffer: &CVPixelBuffer, width: f64, height: f64) {
    let r = renderer();
    // SAFETY: The buffer is a writable pixel buffer of at least this size.
    unsafe {
        r.context.render_toCVPixelBuffer_bounds_colorSpace(
            image,
            buffer,
            rect(0.0, 0.0, width, height),
            Some(&r.output),
        )
    };
}

fn frame_image(
    request: &AVAsynchronousVideoCompositionRequest,
    track: CMPersistentTrackID,
    t: Affine,
) -> Option<Retained<CIImage>> {
    // SAFETY: The track ID was listed in the instruction's required tracks.
    let buffer = unsafe { request.sourceFrameByTrackID(track) }?;
    // SAFETY: A valid decoded frame.
    let image = unsafe { CIImage::imageWithCVPixelBuffer(&buffer) };
    Some(orient(&image, t))
}

// ---------------------------------------------------------------------------
// AVFoundation plumbing

pub struct InstructionIvars {
    scene: Arc<Scene>,
    tracks: Tracks,
    range: CMTimeRange,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[name = "CliptInstruction"]
    #[ivars = InstructionIvars]
    pub struct Instruction;

    unsafe impl NSObjectProtocol for Instruction {}

    unsafe impl NSCopying for Instruction {
        #[unsafe(method_id(copyWithZone:))]
        fn copy_with_zone(&self, _zone: *mut NSZone) -> Retained<Self> {
            // Immutable, so a copy can be the same object.
            self.retain()
        }
    }

    unsafe impl AVVideoCompositionInstructionProtocol for Instruction {
        #[unsafe(method(timeRange))]
        fn time_range(&self) -> CMTimeRange {
            self.ivars().range
        }

        #[unsafe(method(enablePostProcessing))]
        fn enable_post_processing(&self) -> bool {
            false
        }

        #[unsafe(method(containsTweening))]
        fn contains_tweening(&self) -> bool {
            // Every frame changes with time (the video plays).
            true
        }

        #[unsafe(method_id(requiredSourceTrackIDs))]
        fn required_source_track_ids(&self) -> Option<Retained<NSArray<NSValue>>> {
            let t = self.ivars().tracks;
            let screen = int(t.screen as i64);
            let camera = t.camera.map(|(id, _)| int(id as i64));
            let mut ids: Vec<&NSValue> = vec![&screen];
            if let Some(c) = &camera {
                ids.push(c);
            }
            Some(array(&ids))
        }

        #[unsafe(method(passthroughTrackID))]
        fn passthrough_track_id(&self) -> CMPersistentTrackID {
            0
        }
    }
);

// SAFETY: The ivars are immutable and thread safe.
unsafe impl Send for Instruction {}
// SAFETY: See above.
unsafe impl Sync for Instruction {}

impl Instruction {
    fn create(scene: Arc<Scene>, tracks: Tracks, range: CMTimeRange) -> Retained<Self> {
        let this = Self::alloc().set_ivars(InstructionIvars {
            scene,
            tracks,
            range,
        });
        // SAFETY: NSObject's init.
        unsafe { msg_send![super(this), init] }
    }
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[name = "CliptCompositor"]
    pub struct Compositor;

    unsafe impl NSObjectProtocol for Compositor {}

    unsafe impl AVVideoCompositing for Compositor {
        #[unsafe(method_id(sourcePixelBufferAttributes))]
        fn source_pixel_buffer_attributes(
            &self,
        ) -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
            Some(pixel_buffer_attributes())
        }

        #[unsafe(method_id(requiredPixelBufferAttributesForRenderContext))]
        fn required_pixel_buffer_attributes(&self) -> Retained<NSDictionary<NSString, AnyObject>> {
            pixel_buffer_attributes()
        }

        #[unsafe(method(renderContextChanged:))]
        fn render_context_changed(&self, _context: &AVVideoCompositionRenderContext) {}

        #[unsafe(method(startVideoCompositionRequest:))]
        fn start_request(&self, request: &AVAsynchronousVideoCompositionRequest) {
            render_request(request);
        }

        #[unsafe(method(cancelAllPendingVideoCompositionRequests))]
        fn cancel_all(&self) {}
    }
);

// SAFETY: The compositor has no state.
unsafe impl Send for Compositor {}
// SAFETY: See above.
unsafe impl Sync for Compositor {}

fn pixel_buffer_attributes() -> Retained<NSDictionary<NSString, AnyObject>> {
    let formats = array(&[&*NSNumber::new_u32(BGRA)]);
    let surface: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::new();
    dict(&[
        (&ns("PixelFormatType"), any(&*formats)),
        (&ns("IOSurfaceProperties"), any(&*surface)),
        (&ns("MetalCompatibility"), any(&*yes())),
    ])
}

fn render_request(request: &AVAsynchronousVideoCompositionRequest) {
    // SAFETY: Plain AVFoundation calls on the request we were handed.
    unsafe {
        let instruction = request.videoCompositionInstruction();
        let object: &AnyObject = any(&*instruction);
        let Some(instruction) = object.downcast_ref::<Instruction>() else {
            request.finishCancelledRequest();
            return;
        };
        let ivars = instruction.ivars();
        let tracks = ivars.tracks;
        let Some(screen) = frame_image(request, tracks.screen, tracks.screen_transform) else {
            // No source frame yet (e.g. a gap): leave the background.
            request.finishCancelledRequest();
            return;
        };
        let camera = tracks
            .camera
            .and_then(|(id, t)| frame_image(request, id, t));
        let image = compose(&ivars.scene, &screen, camera.as_deref());
        let Some(buffer) = request.renderContext().newPixelBuffer() else {
            request.finishCancelledRequest();
            return;
        };
        render_into(
            &image,
            &buffer,
            ivars.scene.width as f64,
            ivars.scene.height as f64,
        );
        request.finishWithComposedVideoFrame(&buffer);
    }
}

/// The one recipe for turning a take into frames, used by preview and export.
pub fn video_composition(
    scene: Arc<Scene>,
    tracks: Tracks,
    duration: objc2_core_media::CMTime,
) -> Retained<AVMutableVideoComposition> {
    // SAFETY: Plain AVFoundation setup.
    unsafe {
        let composition = AVMutableVideoComposition::videoComposition();
        let class: &AnyClass = Compositor::class();
        composition.setCustomVideoCompositorClass(Some(class));
        composition.setRenderSize(CGSize::new(scene.width as f64, scene.height as f64));
        composition.setFrameDuration(objc2_core_media::CMTime::new(1, scene.fps.max(1) as i32));
        composition.setColorPrimaries(Some(k!(
            objc2_av_foundation::AVVideoColorPrimaries_ITU_R_709_2
        )));
        composition.setColorTransferFunction(Some(k!(
            objc2_av_foundation::AVVideoTransferFunction_ITU_R_709_2
        )));
        composition.setColorYCbCrMatrix(Some(k!(
            objc2_av_foundation::AVVideoYCbCrMatrix_ITU_R_709_2
        )));
        let range = CMTimeRange::new(objc2_core_media::kCMTimeZero, duration);
        let instruction = Instruction::create(scene, tracks, range);
        let instruction =
            ProtocolObject::<dyn AVVideoCompositionInstructionProtocol>::from_retained(instruction);
        composition.setInstructions(&NSArray::from_retained_slice(&[instruction]));
        composition
    }
}

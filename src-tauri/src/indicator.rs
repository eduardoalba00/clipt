//! While recording, dims everything except what's being recorded and draws a
//! hairline around it. The overlay ignores the mouse, is left out of screen
//! capture, and only ever covers things that aren't in the recording.
//!
//! Main thread only.

use std::cell::{Cell, RefCell};

use objc2::rc::Retained;
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSBezierPath, NSColor, NSScreen, NSView, NSWindow,
    NSWindowCollectionBehavior, NSWindowSharingType, NSWindowStyleMask,
};
use objc2_core_foundation::{CFDictionary, CGRect};
use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, NSString, NSTimer};

/// What is being recorded.
#[derive(Clone, Copy, Debug)]
pub enum Target {
    /// Part of a display: its id and the rect in display points, top-left.
    Area { display: u32, rect: CGRect },
    /// A window, followed as it moves.
    Window(u32),
    /// A whole display: the others are dimmed.
    Display(u32),
}

/// Just below the menu bar, so the menu bar (and Clipt's stop icon) stay lit.
const LEVEL: isize = 23;
const DIM: f64 = 0.38;

pub struct IndicatorIvars {
    hole: Cell<Option<NSRect>>,
    border: Cell<bool>,
}

define_class!(
    // SAFETY: NSView has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "CliptIndicatorView"]
    #[ivars = IndicatorIvars]
    struct IndicatorView;

    impl IndicatorView {
        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            self.draw();
        }
    }
);

impl IndicatorView {
    fn draw(&self) {
        let b = self.bounds();
        NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, DIM).setFill();
        let Some(r) = self.ivars().hole.get() else {
            NSBezierPath::fillRect(b);
            return;
        };
        let (bw, bh) = (b.size.width, b.size.height);
        let x0 = r.origin.x.clamp(0.0, bw);
        let y0 = r.origin.y.clamp(0.0, bh);
        let x1 = (r.origin.x + r.size.width).clamp(0.0, bw);
        let y1 = (r.origin.y + r.size.height).clamp(0.0, bh);
        for band in [
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(bw, y0)),
            NSRect::new(NSPoint::new(0.0, y1), NSSize::new(bw, bh - y1)),
            NSRect::new(NSPoint::new(0.0, y0), NSSize::new(x0, y1 - y0)),
            NSRect::new(NSPoint::new(x1, y0), NSSize::new(bw - x1, y1 - y0)),
        ] {
            if band.size.width > 0.0 && band.size.height > 0.0 {
                NSBezierPath::fillRect(band);
            }
        }
        if self.ivars().border.get() {
            // Just outside the recorded area, so it never ends up in the video.
            NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.85).setStroke();
            let line = NSBezierPath::bezierPathWithRect(NSRect::new(
                NSPoint::new(r.origin.x - 1.0, r.origin.y - 1.0),
                NSSize::new(r.size.width + 2.0, r.size.height + 2.0),
            ));
            line.setLineWidth(1.0);
            line.stroke();
        }
    }
}

struct Indicator {
    target: Target,
    windows: Vec<(Retained<NSWindow>, Retained<IndicatorView>, NSRect)>,
    timer: Option<Retained<NSTimer>>,
    last: Option<NSRect>,
}

thread_local! {
    static INDICATOR: RefCell<Option<Indicator>> = const { RefCell::new(None) };
}

pub fn display_id(screen: &NSScreen) -> u32 {
    screen
        .deviceDescription()
        .objectForKey(&NSString::from_str("NSScreenNumber"))
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .map(|n| n.unsignedIntValue())
        .unwrap_or(0)
}

/// Height of the menu-bar screen: Core Graphics' y axis flips around it.
fn flip_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm)
        .firstObject()
        .map(|s| s.frame().size.height)
        .unwrap_or(0.0)
}

/// A window's frame in Cocoa screen coordinates, if it's still on screen.
fn window_frame(id: u32, mtm: MainThreadMarker) -> Option<NSRect> {
    // kCGWindowListOptionIncludingWindow
    let option = objc2_core_graphics::CGWindowListOption(1 << 3);
    let list = objc2_core_graphics::CGWindowListCopyWindowInfo(option, id)?;
    // SAFETY: The list is an array of dictionaries, toll-free bridged.
    unsafe {
        let array = &*(objc2_core_foundation::CFRetained::as_ptr(&list).as_ptr()
            as *const objc2_foundation::NSArray<
                objc2_foundation::NSDictionary<NSString, objc2::runtime::AnyObject>,
            >);
        let info = array.firstObject()?;
        let bounds = info.objectForKey(crate::objc::cf(objc2_core_graphics::kCGWindowBounds))?;
        let mut rect = CGRect::default();
        let dict = &*(Retained::as_ptr(&bounds) as *const CFDictionary);
        if !objc2_core_graphics::CGRectMakeWithDictionaryRepresentation(Some(dict), &mut rect) {
            return None;
        }
        let y = flip_height(mtm) - rect.origin.y - rect.size.height;
        Some(NSRect::new(NSPoint::new(rect.origin.x, y), rect.size))
    }
}

/// A display-local rect (points, origin top-left) in Cocoa screen
/// coordinates (origin bottom-left of the main display), given the display's
/// Cocoa frame.
fn area_to_global(screen: NSRect, rect: CGRect) -> NSRect {
    NSRect::new(
        NSPoint::new(
            screen.origin.x + rect.origin.x,
            screen.origin.y + screen.size.height - rect.origin.y - rect.size.height,
        ),
        rect.size,
    )
}

/// `global` relative to a screen with Cocoa frame `screen`, if they overlap.
fn to_local(global: NSRect, screen: NSRect) -> Option<NSRect> {
    let overlaps = global.origin.x < screen.origin.x + screen.size.width
        && global.origin.x + global.size.width > screen.origin.x
        && global.origin.y < screen.origin.y + screen.size.height
        && global.origin.y + global.size.height > screen.origin.y;
    overlaps.then(|| {
        NSRect::new(
            NSPoint::new(
                global.origin.x - screen.origin.x,
                global.origin.y - screen.origin.y,
            ),
            global.size,
        )
    })
}

/// The recorded area in Cocoa screen coordinates, and whether to outline it.
fn hole(target: Target, mtm: MainThreadMarker) -> (Option<NSRect>, bool) {
    let screen_of = |id: u32| {
        NSScreen::screens(mtm)
            .iter()
            .find(|s| display_id(s) == id)
            .map(|s| s.frame())
    };
    match target {
        Target::Area { display, rect } => {
            (screen_of(display).map(|f| area_to_global(f, rect)), true)
        }
        Target::Window(id) => (window_frame(id, mtm), true),
        Target::Display(id) => (screen_of(id), false),
    }
}

fn place(indicator: &mut Indicator, mtm: MainThreadMarker) {
    let (global, border) = hole(indicator.target, mtm);
    if global == indicator.last && indicator.last.is_some() {
        return;
    }
    indicator.last = global;
    for (window, view, frame) in &indicator.windows {
        let local = global.and_then(|g| to_local(g, *frame));
        // A whole recorded display gets no overlay at all.
        let covers_screen = !border
            && local.is_some_and(|l| {
                l.origin.x <= 0.5
                    && l.origin.y <= 0.5
                    && l.size.width >= frame.size.width - 0.5
                    && l.size.height >= frame.size.height - 0.5
            });
        window.setIsVisible(!covers_screen);
        view.ivars().hole.set(local);
        view.ivars().border.set(border);
        view.setNeedsDisplay(true);
    }
}

pub fn show(target: Target) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    hide();
    let mut windows = Vec::new();
    for screen in NSScreen::screens(mtm).iter() {
        let frame = screen.frame();
        // SAFETY: Plain AppKit window setup on the main thread.
        let window: Retained<NSWindow> = unsafe {
            msg_send![
                NSWindow::alloc(mtm),
                initWithContentRect: frame,
                styleMask: NSWindowStyleMask::Borderless,
                backing: NSBackingStoreType::Buffered,
                defer: false,
            ]
        };
        // SAFETY: We keep the window alive ourselves.
        unsafe { window.setReleasedWhenClosed(false) };
        window.setOpaque(false);
        window.setHasShadow(false);
        window.setBackgroundColor(Some(&NSColor::clearColor()));
        window.setIgnoresMouseEvents(true);
        window.setLevel(LEVEL);
        window.setSharingType(NSWindowSharingType::None);
        window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        let view = IndicatorView::alloc(mtm).set_ivars(IndicatorIvars {
            hole: Cell::new(None),
            border: Cell::new(true),
        });
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
        // SAFETY: NSView's designated initializer.
        let view: Retained<IndicatorView> =
            unsafe { msg_send![super(view), initWithFrame: bounds] };
        window.setContentView(Some(&view));
        window.orderFrontRegardless();
        windows.push((window, view, frame));
    }
    let mut indicator = Indicator {
        target,
        windows,
        timer: None,
        last: None,
    };
    place(&mut indicator, mtm);
    if let Target::Window(_) = target {
        // Follow the window if it moves or resizes.
        let block = block2::RcBlock::new(|_timer: std::ptr::NonNull<NSTimer>| {
            if let Some(mtm) = MainThreadMarker::new() {
                INDICATOR.with_borrow_mut(|i| {
                    if let Some(i) = i.as_mut() {
                        place(i, mtm);
                    }
                });
            }
        });
        // SAFETY: The timer runs on the main run loop and is invalidated in `hide`.
        indicator.timer = Some(unsafe {
            NSTimer::scheduledTimerWithTimeInterval_repeats_block(1.0 / 30.0, true, &block)
        });
    }
    INDICATOR.with_borrow_mut(|i| *i = Some(indicator));
}

pub fn hide() {
    INDICATOR.with_borrow_mut(|i| {
        if let Some(i) = i.take() {
            if let Some(timer) = i.timer {
                timer.invalidate();
            }
            for (window, _, _) in i.windows {
                window.orderOut(None);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }

    #[test]
    fn area_flips_to_cocoa() {
        // A 1512x982 main display; 100pt from its top-left, 400x300.
        let main = rect(0.0, 0.0, 1512.0, 982.0);
        let g = area_to_global(main, rect(100.0, 100.0, 400.0, 300.0));
        assert_eq!(g, rect(100.0, 582.0, 400.0, 300.0));
        assert_eq!(to_local(g, main), Some(g));
    }

    #[test]
    fn second_display_offsets() {
        // A display to the right of the main one, its bottom 200pt higher.
        let side = rect(1512.0, 200.0, 1920.0, 1080.0);
        let g = area_to_global(side, rect(0.0, 0.0, 100.0, 100.0));
        assert_eq!(g, rect(1512.0, 1180.0, 100.0, 100.0));
        assert_eq!(to_local(g, side), Some(rect(0.0, 980.0, 100.0, 100.0)));
        // Nothing of it shows on the main display, which is dimmed whole.
        assert_eq!(to_local(g, rect(0.0, 0.0, 1512.0, 982.0)), None);
    }
}

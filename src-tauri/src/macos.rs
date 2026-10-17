//! macOS window chrome: traffic lights, native glass, window sizes, Finder.
//!
//! The glass follows MonoCode (MIT): a transparent NSWindow whose background
//! colour is the tint, `CGSSetWindowBackgroundBlurRadius` (private
//! WindowServer API) to blur the desktop behind it, and a nearly transparent
//! NSVisualEffectView below the WKWebView to keep the backdrop stable. Light
//! mode uses an opaque window instead.

use std::ffi::{c_char, c_int, c_void};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSPasteboard, NSTitlebarSeparatorStyle,
    NSURLNSPasteboardSupport, NSUserInterfaceItemIdentification, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow, NSWindowButton, NSWindowOrderingMode, NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};
use tauri::{WebviewWindow, WindowEvent};

use crate::objc::file_url;

/// Must match the HTML title bar (`h-10`).
const TITLE_BAR_HEIGHT: f64 = 40.0;
const BUTTON_SIZE: f64 = 14.0;
const LEFT_MARGIN: f64 = 14.0;
const BUTTON_SPACING: f64 = 6.0;
const TOP_INSET: f64 = (TITLE_BAR_HEIGHT - BUTTON_SIZE) / 2.0;

/// Clipt shows more of the desktop than MonoCode (0.85).
pub const GLASS_TINT: f64 = 0.70;
pub const GLASS_BLUR: c_int = 24;
/// `--background-lightness` 9% and 97% from the theme tokens.
const DARK_BASE: f64 = 23.0 / 255.0;
const LIGHT_BASE: f64 = 247.0 / 255.0;

const GLASS_BACKING_ID: &str = "clipt.glass-backing";
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

static PINNED: AtomicBool = AtomicBool::new(false);

type CgsConnection = usize;
type SetBlurFn = unsafe extern "C" fn(CgsConnection, c_int, c_int) -> c_int;
type ConnectionFn = unsafe extern "C" fn() -> CgsConnection;

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

pub fn ns_window(window: &WebviewWindow) -> Option<Retained<NSWindow>> {
    let ptr = window.ns_window().ok()?;
    if ptr.is_null() {
        return None;
    }
    // SAFETY: Tauri hands out its live NSWindow.
    unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
}

pub fn install(window: &WebviewWindow) {
    let Some(native) = ns_window(window) else {
        return;
    };
    native.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
    pin_buttons(&native);
    stretch_titlebar(&native);
    let events = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Resized(_) | WindowEvent::Focused(true) = event {
            if let Some(native) = ns_window(&events) {
                pin_buttons(&native);
                stretch_titlebar(&native);
            }
        }
    });
}

/// The AppKit backdrop under the webview, if glass has been set up.
pub fn glass_backing(content: &NSView) -> Option<Retained<NSView>> {
    let id = NSString::from_str(GLASS_BACKING_ID);
    content
        .subviews()
        .iter()
        .find(|v| v.identifier().as_deref() == Some(&*id))
}

fn ensure_backing(native: &NSWindow, mtm: MainThreadMarker) -> Option<Retained<NSView>> {
    let content = native.contentView()?;
    if let Some(existing) = glass_backing(&content) {
        return Some(existing);
    }
    let backing =
        NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), content.bounds());
    backing.setIdentifier(Some(&NSString::from_str(GLASS_BACKING_ID)));
    backing.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
    backing.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    backing.setState(NSVisualEffectState::Active);
    backing.setAlphaValue(0.01);
    backing.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    // Wry owns the content view and the WKWebView; add a sibling at the bottom.
    content.addSubview_positioned_relativeTo(&backing, NSWindowOrderingMode::Below, None);
    Some(Retained::into_super(backing))
}

/// Dark: frosted glass tinted at 70%. Light: an opaque window.
pub fn set_appearance(window: &WebviewWindow, dark: bool) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(native) = ns_window(window) else {
        return;
    };
    let backing = ensure_backing(&native, mtm);
    if dark {
        if let Some(b) = &backing {
            b.setHidden(false);
        }
        native.setOpaque(false);
        native.setBackgroundColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(
            DARK_BASE, DARK_BASE, DARK_BASE, GLASS_TINT,
        )));
        apply_blur(&native, GLASS_BLUR);
    } else {
        if let Some(b) = &backing {
            b.setHidden(true);
        }
        apply_blur(&native, 0);
        native.setOpaque(true);
        native.setBackgroundColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(
            LIGHT_BASE, LIGHT_BASE, LIGHT_BASE, 1.0,
        )));
    }
    native.setHasShadow(true);
    native.invalidateShadow();
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Launcher,
    Editor,
}

/// Resizes the window for the launcher or the editor, keeping it centred
/// where it was and on screen.
pub fn set_mode(window: &WebviewWindow, mode: Mode, animate: bool) {
    let Some(native) = ns_window(window) else {
        return;
    };
    let (w, h, min) = match mode {
        Mode::Launcher => (340.0, 404.0, NSSize::new(340.0, 404.0)),
        Mode::Editor => (1200.0, 780.0, NSSize::new(880.0, 580.0)),
    };
    let mut mask = native.styleMask();
    if mode == Mode::Editor {
        mask |= NSWindowStyleMask::Resizable;
    } else {
        mask &= !NSWindowStyleMask::Resizable;
    }
    native.setStyleMask(mask);
    native.setContentMinSize(min);
    if let Some(zoom) = native.standardWindowButton(NSWindowButton::ZoomButton) {
        zoom.setEnabled(mode == Mode::Editor);
    }

    let current = native.frame();
    let (cx, cy) = (
        current.origin.x + current.size.width / 2.0,
        current.origin.y + current.size.height / 2.0,
    );
    let mut frame = NSRect::new(NSPoint::new(cx - w / 2.0, cy - h / 2.0), NSSize::new(w, h));
    if let Some(screen) = native.screen() {
        let v = screen.visibleFrame();
        frame.size.width = frame.size.width.min(v.size.width);
        frame.size.height = frame.size.height.min(v.size.height);
        frame.origin.x = frame
            .origin
            .x
            .clamp(v.origin.x, v.origin.x + v.size.width - frame.size.width);
        frame.origin.y = frame
            .origin
            .y
            .clamp(v.origin.y, v.origin.y + v.size.height - frame.size.height);
    }
    let animate = animate && !reduce_motion() && native.isVisible();
    native.setFrame_display_animate(frame, true, animate);
    stretch_titlebar(&native);
}

pub fn reduce_motion() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

pub fn reveal_in_finder(path: &Path) {
    let url = file_url(path);
    NSWorkspace::sharedWorkspace()
        .activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&[url]));
}

pub fn open_folder(path: &Path) {
    NSWorkspace::sharedWorkspace().openURL(&file_url(path));
}

/// Puts the file itself on the clipboard, so pasting into X attaches it.
pub fn copy_file(path: &Path) {
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    file_url(path).writeToPasteboard(&board);
}

fn apply_blur(window: &NSWindow, radius: c_int) {
    let (Some(set_blur), Some(connection)) = (set_blur_fn(), cgs_connection()) else {
        return;
    };
    let number = window.windowNumber();
    if number <= 0 {
        return;
    }
    // SAFETY: A valid connection and window number.
    unsafe {
        set_blur(connection, number as c_int, radius);
    }
}

fn buttons() -> [NSWindowButton; 3] {
    [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
}

/// Pins the traffic lights once with Auto Layout, centred in our title bar.
fn pin_buttons(window: &NSWindow) {
    if PINNED.load(Ordering::Relaxed) {
        return;
    }
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    // SAFETY: Reading the view hierarchy on the main thread.
    let Some(titlebar) = (unsafe { close.superview() }) else {
        return;
    };
    titlebar.setClipsToBounds(false);
    // SAFETY: As above.
    if let Some(container) = unsafe { titlebar.superview() } {
        container.setClipsToBounds(false);
    }
    for (i, kind) in buttons().iter().enumerate() {
        let Some(button) = window.standardWindowButton(*kind) else {
            continue;
        };
        button.setTranslatesAutoresizingMaskIntoConstraints(false);
        let x = LEFT_MARGIN + i as f64 * (BUTTON_SIZE + BUTTON_SPACING);
        button
            .widthAnchor()
            .constraintEqualToConstant(BUTTON_SIZE)
            .setActive(true);
        button
            .heightAnchor()
            .constraintEqualToConstant(BUTTON_SIZE)
            .setActive(true);
        button
            .leadingAnchor()
            .constraintEqualToAnchor_constant(&titlebar.leadingAnchor(), x)
            .setActive(true);
        button
            .topAnchor()
            .constraintEqualToAnchor_constant(&titlebar.topAnchor(), TOP_INSET)
            .setActive(true);
    }
    PINNED.store(true, Ordering::Relaxed);
}

fn stretch_titlebar(window: &NSWindow) {
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    // SAFETY: Reading the view hierarchy on the main thread.
    let Some(titlebar) = (unsafe { close.superview() }) else {
        return;
    };
    // SAFETY: As above.
    let Some(container) = (unsafe { titlebar.superview() }) else {
        return;
    };
    // SAFETY: As above.
    let parent_height = unsafe { container.superview() }
        .map(|parent| parent.frame().size.height)
        .unwrap_or_else(|| window.frame().size.height);
    let mut frame = container.frame();
    frame.size.height = TITLE_BAR_HEIGHT;
    frame.origin.y = parent_height - TITLE_BAR_HEIGHT;
    container.setFrame(frame);
    let mut inner = titlebar.frame();
    inner.origin.y = 0.0;
    inner.size.height = TITLE_BAR_HEIGHT;
    inner.size.width = frame.size.width;
    titlebar.setFrame(inner);
}

fn set_blur_fn() -> Option<SetBlurFn> {
    static FN: OnceLock<Option<SetBlurFn>> = OnceLock::new();
    *FN.get_or_init(|| dlsym_fn(b"CGSSetWindowBackgroundBlurRadius\0"))
}

fn cgs_connection() -> Option<CgsConnection> {
    static FN: OnceLock<Option<ConnectionFn>> = OnceLock::new();
    let function = (*FN.get_or_init(|| {
        dlsym_fn(b"CGSDefaultConnectionForThread\0").or_else(|| dlsym_fn(b"CGSMainConnectionID\0"))
    }))?;
    // SAFETY: A WindowServer accessor with no arguments.
    let connection = unsafe { function() };
    (connection != 0).then_some(connection)
}

fn dlsym_fn<T>(symbol: &[u8]) -> Option<T> {
    // SAFETY: Looking up a C function by its NUL-terminated name.
    unsafe {
        let ptr = dlsym(RTLD_DEFAULT, symbol.as_ptr().cast());
        if ptr.is_null() {
            None
        } else {
            Some(std::mem::transmute_copy(&ptr))
        }
    }
}

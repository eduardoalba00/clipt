//! Small helpers for talking to Apple frameworks through objc2.

use std::sync::mpsc;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::Message;
use objc2_core_foundation::{CFRetained, CFString};
use objc2_core_graphics::CGColorSpace;
use objc2_core_media::CMTime;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};

/// Unwraps an optional framework constant (`AVVideoCodecKey` and friends).
#[macro_export]
macro_rules! k {
    ($name:path) => {{
        let ptr = &raw const $name;
        let name = stringify!($name);
        #[allow(unused_unsafe)]
        // SAFETY: `ptr` points at an immutable framework constant.
        let value = unsafe { $crate::objc::constant(ptr, name) };
        value
    }};
}
pub use crate::k;

/// Reads a framework constant through a pointer to it, for `k!`.
///
/// # Safety
///
/// `ptr` must point at an immutable static.
pub unsafe fn constant<T: ?Sized + 'static>(
    ptr: *const Option<&'static T>,
    name: &str,
) -> &'static T {
    // SAFETY: Guaranteed by the caller.
    let value = unsafe { *ptr };
    value.unwrap_or_else(|| panic!("{name} is missing"))
}

/// Any Objective-C object, or toll-free bridged CF object, as `id`.
pub fn any<T: ?Sized>(object: &T) -> &AnyObject {
    // SAFETY: Callers only pass Objective-C and CoreFoundation objects, which
    // share the object layout.
    unsafe { &*(object as *const T as *const AnyObject) }
}

pub fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

/// A bridged `CFString` constant as the `NSString` it is.
pub fn cf(s: &CFString) -> &NSString {
    // SAFETY: CFString is toll-free bridged with NSString.
    unsafe { &*(s as *const CFString as *const NSString) }
}

pub fn num(v: f64) -> Retained<NSNumber> {
    NSNumber::new_f64(v)
}

pub fn int(v: i64) -> Retained<NSNumber> {
    NSNumber::new_i64(v)
}

pub fn yes() -> Retained<NSNumber> {
    NSNumber::new_bool(true)
}

pub fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|p| p.1).collect();
    NSDictionary::from_slices(&keys, &values)
}

pub fn array<T: Message>(items: &[&T]) -> Retained<NSArray<T>> {
    NSArray::from_slice(items)
}

pub fn file_url(path: &std::path::Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&ns(&path.to_string_lossy()))
}

pub fn srgb() -> CFRetained<CGColorSpace> {
    // SAFETY: Static constant.
    CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }))
        .expect("sRGB color space")
}

pub fn rec709() -> CFRetained<CGColorSpace> {
    // SAFETY: Static constant.
    CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceITUR_709 }))
        .expect("Rec. 709 color space")
}

/// Fine enough for frame times at 60 fps and audio sample times.
pub const TIMESCALE: i32 = 60_000;

pub fn time(seconds: f64) -> CMTime {
    // SAFETY: Pure function.
    unsafe { CMTime::with_seconds(seconds, TIMESCALE) }
}

pub fn seconds(t: CMTime) -> f64 {
    // SAFETY: Pure function.
    unsafe { t.seconds() }
}

/// Runs an API that reports through a completion block and waits for it.
/// Never call this on a queue the callback needs.
pub fn wait<T: Send + 'static>(
    timeout: Duration,
    start: impl FnOnce(mpsc::Sender<T>),
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    start(tx);
    rx.recv_timeout(timeout).ok()
}

pub fn error_text(error: Option<Retained<objc2_foundation::NSError>>) -> String {
    match error {
        Some(e) => e.localizedDescription().to_string(),
        None => "Unknown error".into(),
    }
}

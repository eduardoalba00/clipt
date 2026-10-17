//! The menu bar icon. Idle, it opens a small menu; while recording, a click
//! stops the recording.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const SIZE: u32 = 36;

/// Signed distance to a rounded rectangle centred at the origin.
fn rounded_box(x: f32, y: f32, half_w: f32, half_h: f32, r: f32) -> f32 {
    let qx = x.abs() - half_w + r;
    let qy = y.abs() - half_h + r;
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    outside + qx.max(qy).min(0.0) - r
}

/// Draws a template glyph: black where `shape` is inside (negative).
fn glyph(shape: impl Fn(f32, f32) -> f32) -> Image<'static> {
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let c = SIZE as f32 / 2.0;
    for py in 0..SIZE {
        for px in 0..SIZE {
            let d = shape(px as f32 + 0.5 - c, py as f32 + 0.5 - c);
            let a = (0.5 - d).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[0, 0, 0, (a * 255.0) as u8]);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

/// A screen outline with a record dot inside.
fn idle_icon() -> Image<'static> {
    glyph(|x, y| {
        let frame = rounded_box(x, y, 15.0, 11.5, 4.0);
        let ring = frame.abs() - 1.5;
        let dot = (x * x + y * y).sqrt() - 4.5;
        ring.min(dot)
    })
}

/// A filled disc with a stop square cut out of it.
fn recording_icon() -> Image<'static> {
    glyph(|x, y| {
        let disc = (x * x + y * y).sqrt() - 15.0;
        let stop = rounded_box(x, y, 5.0, 5.0, 1.5);
        disc.max(-stop)
    })
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "tray-new", "New recording", true, None::<&str>)?,
            &MenuItem::with_id(app, "tray-stop", "Stop recording", false, None::<&str>)?,
            &MenuItem::with_id(app, "tray-show", "Show Clipt", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray-quit", "Quit Clipt", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("clipt")
        .icon(idle_icon())
        .icon_as_template(true)
        .tooltip("Clipt")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-new" => {
                crate::show_main(app);
                let _ = app.emit("menu", "new");
            }
            "tray-stop" => {
                let _ = app.emit("menu", "stop");
            }
            "tray-show" => crate::show_main(app),
            "tray-quit" => crate::request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if RECORDING.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = app.emit("menu", "stop");
                }
            }
        })
        .build(app)?;
    let _ = app.manage(TrayMenu(menu));
    Ok(())
}

struct TrayMenu(Menu<tauri::Wry>);

static RECORDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn tray(app: &AppHandle) -> Option<TrayIcon> {
    app.tray_by_id("clipt")
}

/// While recording, the icon becomes a stop button.
pub fn set_recording(app: &AppHandle, recording: bool) {
    RECORDING.store(recording, std::sync::atomic::Ordering::SeqCst);
    if let Some(tray) = tray(app) {
        let _ = tray.set_icon(Some(if recording {
            recording_icon()
        } else {
            idle_icon()
        }));
        let _ = tray.set_icon_as_template(true);
        let _ = tray.set_show_menu_on_left_click(!recording);
        let _ = tray.set_tooltip(Some(if recording { "Stop recording" } else { "Clipt" }));
    }
    if let Some(menu) = app.try_state::<TrayMenu>() {
        if let Some(item) = menu
            .0
            .get("tray-stop")
            .and_then(|i| i.as_menuitem().cloned())
        {
            let _ = item.set_enabled(recording);
        }
        if let Some(item) = menu
            .0
            .get("tray-new")
            .and_then(|i| i.as_menuitem().cloned())
        {
            let _ = item.set_enabled(!recording);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icons_have_ink_and_clear_corners() {
        let alpha = |icon: &Image, x: u32, y: u32| icon.rgba()[((y * SIZE + x) * 4 + 3) as usize];
        let idle = idle_icon();
        assert_eq!(alpha(&idle, 0, 0), 0);
        assert_eq!(alpha(&idle, SIZE / 2, SIZE / 2), 255, "the record dot");
        let rec = recording_icon();
        assert_eq!(alpha(&rec, 0, 0), 0);
        assert_eq!(
            alpha(&rec, SIZE / 2, SIZE / 2),
            0,
            "the stop square is cut out"
        );
        assert_eq!(alpha(&rec, SIZE / 2, 6), 255, "the disc");
    }
}

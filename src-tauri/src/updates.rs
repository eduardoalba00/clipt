//! Updates: a quiet check soon after launch and every few hours after, and
//! one on demand from the menu. Releases are signed, and the updater refuses
//! anything whose signature doesn't match the key in `tauri.conf.json`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const FIRST_CHECK: Duration = Duration::from_secs(10);
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

static CHECKING: AtomicBool = AtomicBool::new(false);

/// The version the user said "Later" to. Quiet checks don't ask about it
/// again this session; the menu item still does.
static DECLINED: Mutex<Option<String>> = Mutex::new(None);

/// Starts the quiet checks. Development builds never look for updates.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            check(&app, false);
            std::thread::sleep(INTERVAL);
        }
    });
}

/// "Check for Updates…": always answers, even when there is nothing new.
pub fn check_now(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || check(&app, true));
}

fn check(app: &AppHandle, asked: bool) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    run(app, asked);
    CHECKING.store(false, Ordering::SeqCst);
}

fn run(app: &AppHandle, asked: bool) {
    let found = tauri::async_runtime::block_on(async { app.updater()?.check().await });
    let update = match found {
        Ok(Some(update)) => update,
        Ok(None) => {
            if asked {
                let version = &app.package_info().version;
                tell(
                    app,
                    "You're up to date",
                    &format!("Clipt {version} is the latest version."),
                );
            }
            return;
        }
        Err(e) => {
            if asked {
                tell(app, "Couldn't check for updates", &e.to_string());
            }
            return;
        }
    };
    let declined = DECLINED.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if !asked && declined.as_deref() == Some(update.version.as_str()) {
        return;
    }
    // A quiet check never interrupts a recording or an export; the next one asks.
    if let Some(busy) = crate::busy(app) {
        if asked {
            tell(
                app,
                "Update available",
                &format!("Clipt {} is available. {busy}", update.version),
            );
        }
        return;
    }
    let install = app
        .dialog()
        .message(format!(
            "Clipt {} is available. You have {}.\n\nClipt restarts to finish installing. Unexported recordings are kept.",
            update.version, update.current_version
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and Restart".into(),
            "Later".into(),
        ))
        .blocking_show();
    if !install {
        *DECLINED.lock().unwrap_or_else(|e| e.into_inner()) = Some(update.version);
        return;
    }
    // A recording may have started while the dialog was up.
    if let Some(busy) = crate::busy(app) {
        tell(app, "Update postponed", busy);
        return;
    }
    match tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {})) {
        Ok(()) => crate::relaunch(app.clone()),
        Err(e) => tell(app, "The update didn't install", &e.to_string()),
    }
}

fn tell(app: &AppHandle, title: &str, text: &str) {
    app.dialog()
        .message(text)
        .title(title)
        .kind(MessageDialogKind::Info)
        .blocking_show();
}

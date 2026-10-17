//! Clipt: a small, fast, frictionless screen recorder for macOS.
//!
//! The page draws controls and keeps the edit history. Everything that
//! touches media lives here: takes, the preview player, compositing, export
//! and recording.

pub mod export;
mod indicator;
pub mod macos;
pub mod media;
pub mod objc;
pub mod preview;
mod record;
pub mod render;
pub mod scene;
pub mod take;
mod tray;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent};

use crate::scene::{Recipe, Scene, Source};
use crate::take::Take;

/// The take open in the editor.
struct Current {
    take: Take,
    source: Source,
    duration: f64,
}

#[derive(Default)]
struct AppState {
    current: Mutex<Option<Current>>,
    exporting: AtomicBool,
}

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn data_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_data_dir().map_err(err)
}

/// Where exports go: `~/Movies/Clipt`.
fn exports_dir(app: &AppHandle) -> Res<PathBuf> {
    let dir = app.path().video_dir().map_err(err)?.join("Clipt");
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// Runs `f` on the main thread, inline when already there, and waits for it.
/// AppKit and the preview player only live there.
fn on_main<R: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> R + Send + 'static) -> Res<R> {
    if objc2::MainThreadMarker::new().is_some() {
        return Ok(f());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(err)?;
    rx.recv().map_err(err)
}

fn lock(state: &AppState) -> std::sync::MutexGuard<'_, Option<Current>> {
    state.current.lock().unwrap_or_else(|e| e.into_inner())
}

/// Opens a take's media to learn its facts. Safe off the main thread.
fn probe(take: &Take) -> Res<(take::Info, Source)> {
    let media = media::open(&take.screen_path(), take.camera_path().as_deref()).map_err(err)?;
    let info = take::Info {
        id: take.meta.id.clone(),
        name: take.meta.name.clone(),
        duration: media.seconds(),
        width: media.source.width,
        height: media.source.height,
        fps: media.fps,
        has_audio: media.has_audio,
        has_camera: media.source.has_camera,
        exported: take.meta.exported,
        recipe: take.meta.recipe.clone(),
    };
    Ok((info, media.source))
}

#[derive(Serialize, Clone)]
struct Thumbnails {
    id: String,
    paths: Vec<String>,
}

fn make_thumbnails(app: &AppHandle, take: &Take) {
    let app = app.clone();
    let (id, screen, dir) = (take.meta.id.clone(), take.screen_path(), take.thumbs_dir());
    std::thread::spawn(move || {
        if let Ok(paths) = media::thumbnails(&screen, &dir, 24, 96.0) {
            let paths = paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let _ = app.emit("thumbnails", Thumbnails { id, paths });
        }
    });
}

/// Makes `take` the open take and tells the page about it.
fn adopt(app: &AppHandle, state: &AppState, take: Take) -> Res<take::Info> {
    let (info, source) = probe(&take)?;
    make_thumbnails(app, &take);
    *lock(state) = Some(Current {
        take,
        source,
        duration: info.duration,
    });
    Ok(info)
}

/// Opens a finished recording in the editor.
pub(crate) fn adopt_recording(app: &AppHandle, take: Take) -> Res<take::Info> {
    let state = app.state::<AppState>();
    adopt(app, &state, take)
}

#[tauri::command]
async fn start_recording(app: AppHandle, kind: record::Kind, mic: bool, camera: bool) -> Res<()> {
    if record::is_recording() {
        return Err("Already recording".into());
    }
    if lock(&app.state::<AppState>()).is_some() {
        return Err("Close the open take first".into());
    }
    let dir = data_dir(&app)?;
    std::thread::spawn(move || record::start(app, dir, kind, mic, camera));
    Ok(())
}

#[tauri::command]
async fn permissions() -> record::Permissions {
    record::permissions()
}

/// Shows the system prompt. Off the main thread: it waits for the answer.
#[tauri::command]
async fn request_permission(what: record::Permission) -> record::Permissions {
    record::request(what)
}

#[tauri::command]
fn open_privacy(what: record::Permission) {
    macos::open_privacy(match what {
        record::Permission::Screen => "Privacy_ScreenCapture",
        record::Permission::Mic => "Privacy_Microphone",
        record::Permission::Camera => "Privacy_Camera",
    });
}

/// macOS applies a new Screen Recording grant only to a fresh process.
#[tauri::command]
fn relaunch(app: AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.restart();
}

#[tauri::command]
fn stop_recording(app: AppHandle) {
    std::thread::spawn(move || record::stop(&app));
}

#[tauri::command]
async fn import_video(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<take::Info> {
    let take = Take::import(&data_dir(&app)?, std::path::Path::new(&path)).map_err(err)?;
    match adopt(&app, &state, take.clone()) {
        Ok(info) => Ok(info),
        Err(e) => {
            take.discard();
            Err(e)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Leftover {
    id: String,
    name: String,
    created: u64,
}

/// A take that was never exported, left by a quit or a crash.
#[tauri::command]
async fn leftover_take(app: AppHandle, state: State<'_, AppState>) -> Res<Option<Leftover>> {
    let open = lock(&state).as_ref().map(|c| c.take.meta.id.clone());
    Ok(take::leftover(&data_dir(&app)?)
        .filter(|t| Some(&t.meta.id) != open.as_ref())
        .map(|t| Leftover {
            id: t.meta.id,
            name: t.meta.name,
            created: t.meta.created,
        }))
}

#[tauri::command]
async fn resume_take(app: AppHandle, state: State<'_, AppState>, id: String) -> Res<take::Info> {
    let dir = take::root(&data_dir(&app)?).join(&id);
    let take = Take::open(&dir).map_err(err)?;
    adopt(&app, &state, take)
}

/// Image types Clipt takes as a background.
const PICTURES: [&str; 7] = ["png", "jpg", "jpeg", "heic", "webp", "tiff", "gif"];

/// Copies a picture into Clipt's backgrounds folder and returns its new path,
/// so a take never depends on where the original lives.
#[tauri::command]
async fn add_background(app: AppHandle, path: String) -> Res<String> {
    let source = std::path::Path::new(&path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| PICTURES.contains(&e.as_str()))
        .ok_or("Clipt takes PNG, JPEG, HEIC, WebP, TIFF or GIF images")?;
    let dir = data_dir(&app)?.join("backgrounds");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("{stamp}.{ext}"));
    std::fs::copy(source, &target).map_err(err)?;
    let stored = target.to_string_lossy().into_owned();
    if render::picture(&stored).is_none() {
        let _ = std::fs::remove_file(&target);
        return Err("Clipt couldn't read that image".into());
    }
    Ok(stored)
}

/// Deletes a leftover take the user chose not to continue.
#[tauri::command]
async fn discard_leftover(app: AppHandle, state: State<'_, AppState>, id: String) -> Res<()> {
    let open = lock(&state).as_ref().map(|c| c.take.meta.id.clone());
    if open.as_deref() == Some(id.as_str()) {
        return Err("That take is open".into());
    }
    let dir = take::root(&data_dir(&app)?).join(&id);
    Take::open(&dir).map_err(err)?.discard();
    Ok(())
}

/// Rebuilds the scene from the recipe and shows it. `cropping` shows the
/// whole source frame so the crop can be edited on top of it.
#[tauri::command]
fn set_recipe(
    window: WebviewWindow,
    state: State<'_, AppState>,
    recipe: Recipe,
    cropping: bool,
    persist: bool,
) -> Res<Scene> {
    let (id, screen, camera, source, duration) = {
        let current = lock(&state);
        let c = current.as_ref().ok_or("No take is open")?;
        (
            c.take.meta.id.clone(),
            c.take.screen_path(),
            c.take.camera_path(),
            c.source,
            c.duration,
        )
    };
    let scene = if cropping {
        Scene::plain(&source, recipe.output.fps)
    } else {
        Scene::build(&recipe, &source)
    };
    let trim = if cropping {
        (0.0, duration)
    } else {
        (recipe.trim.start, recipe.trim.end)
    };
    let shown = scene.clone();
    let app = window.app_handle().clone();
    on_main(&app, move || -> Res<()> {
        if preview::showing().as_deref() == Some(id.as_str()) {
            preview::set_scene(shown, trim);
            return Ok(());
        }
        let media = media::open(&screen, camera.as_deref()).map_err(err)?;
        preview::open(&window, id, media, shown, trim);
        Ok(())
    })??;
    if persist {
        if let Some(current) = lock(&state).as_mut() {
            current.take.meta.recipe = Some(recipe);
            current.take.save().map_err(err)?;
        }
    }
    Ok(scene)
}

#[tauri::command]
fn preview_insets(window: WebviewWindow, top: f64, right: f64, bottom: f64, left: f64) {
    let app = window.app_handle().clone();
    let _ = on_main(&app, move || {
        preview::set_insets(&window, top, right, bottom, left)
    });
}

#[tauri::command]
fn preview_visible(app: AppHandle, visible: bool) {
    let _ = on_main(&app, move || preview::set_visible(visible));
}

#[tauri::command]
fn toggle_play(app: AppHandle) {
    let _ = on_main(&app, preview::toggle);
}

#[tauri::command]
fn pause(app: AppHandle) {
    let _ = on_main(&app, preview::pause);
}

#[tauri::command]
fn seek(app: AppHandle, time: f64) {
    let _ = on_main(&app, move || preview::seek(time));
}

/// Closes the open take and deletes it from the working folder.
#[tauri::command]
fn discard_take(app: AppHandle, state: State<'_, AppState>) {
    let _ = on_main(&app, preview::close);
    if let Some(current) = lock(&state).take() {
        current.take.discard();
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Exported {
    id: String,
    path: String,
    name: String,
}

#[tauri::command]
async fn export_take(app: AppHandle, state: State<'_, AppState>, recipe: Recipe) -> Res<()> {
    if state.exporting.swap(true, Ordering::SeqCst) {
        return Err("An export is already running".into());
    }
    let job = {
        let current = lock(&state);
        let Some(current) = current.as_ref() else {
            state.exporting.store(false, Ordering::SeqCst);
            return Err("No take is open".into());
        };
        let dir = match exports_dir(&app) {
            Ok(d) => d,
            Err(e) => {
                state.exporting.store(false, Ordering::SeqCst);
                return Err(e);
            }
        };
        let id = current.take.meta.id.clone();
        (
            id.clone(),
            dir.clone(),
            export::Job {
                screen: current.take.screen_path(),
                camera: current.take.camera_path(),
                scene: Scene::build(&recipe, &current.source),
                trim: (recipe.trim.start, recipe.trim.end),
                out: dir.join(format!(".clipt-export-{id}.mp4")),
            },
        )
    };
    std::thread::spawn(move || {
        let (id, dir, job) = job;
        let progress_app = app.clone();
        let result = export::run(&job, &|p| {
            let _ = progress_app.emit("export-progress", p);
        })
        .and_then(|_| export::place(&job.out, &dir));
        let state = app.state::<AppState>();
        state.exporting.store(false, Ordering::SeqCst);
        match result {
            Ok(path) => {
                if let Some(current) = lock(&state).as_mut() {
                    if current.take.meta.id == id {
                        current.take.meta.exported = true;
                        let _ = current.take.save();
                    }
                }
                let shown = path.clone();
                let _ = app.run_on_main_thread(move || {
                    macos::reveal_in_finder(&shown);
                    macos::copy_file(&shown);
                });
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let _ = app.emit(
                    "export-done",
                    Exported {
                        id,
                        path: path.to_string_lossy().into_owned(),
                        name,
                    },
                );
            }
            Err(e) => {
                let _ = std::fs::remove_file(&job.out);
                let _ = app.emit("export-failed", e.to_string());
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn open_recordings(app: AppHandle) -> Res<()> {
    macos::open_folder(&exports_dir(&app)?);
    Ok(())
}

#[tauri::command]
fn set_appearance(window: WebviewWindow, dark: bool) {
    let app = window.app_handle().clone();
    let _ = on_main(&app, move || macos::set_appearance(&window, dark));
}

#[tauri::command]
fn set_mode(window: WebviewWindow, mode: macos::Mode) {
    let app = window.app_handle().clone();
    let _ = on_main(&app, move || {
        if mode == macos::Mode::Launcher {
            preview::set_visible(false);
        }
        macos::set_mode(&window, mode, true);
    });
}

/// The page shows itself once it has painted, so launch never flashes.
#[tauri::command]
fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn quit(app: AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    let _ = on_main(&app, preview::close);
    app.exit(0);
}

static QUITTING: AtomicBool = AtomicBool::new(false);

/// Quitting never loses work: an unexported take stays in the working folder
/// and the launcher offers to continue it next time.
fn request_quit(app: &AppHandle) {
    quit(app.clone());
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let app_menu = Submenu::with_items(
        app,
        "Clipt",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Clipt"), None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &MenuItem::with_id(app, "quit", "Quit Clipt", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New recording", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "export", "Export", true, Some("CmdOrCtrl+E"))?,
            &MenuItem::with_id(
                app,
                "recordings",
                "Open recordings",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    // Undo and redo are the editor's, not the text field's.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .menu(menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => request_quit(app),
            "recordings" => {
                let _ = open_recordings(app.clone());
            }
            id => {
                let _ = app.emit("menu", id.to_string());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                macos::install(&window);
                macos::set_mode(&window, macos::Mode::Launcher, false);
                let _ = window.center();
            }
            tray::install(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The red button hides the window; Clipt stays in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    preview::pause();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            permissions,
            request_permission,
            open_privacy,
            relaunch,
            import_video,
            leftover_take,
            resume_take,
            discard_leftover,
            add_background,
            set_recipe,
            preview_insets,
            preview_visible,
            toggle_play,
            pause,
            seek,
            discard_take,
            export_take,
            open_recordings,
            set_appearance,
            set_mode,
            ready,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clipt")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => {
                QUITTING.store(true, Ordering::SeqCst);
            }
            RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}

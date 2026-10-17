//! Takes: raw recordings (or imported files) kept in Clipt's own working
//! folder, `~/Library/Application Support/com.clipt.desktop/takes/<id>/`.
//! Edits are a recipe stored next to the take; an MP4 only exists once the
//! take is exported.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

use crate::scene::Recipe;

const META: &str = "take.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub name: String,
    pub screen: String,
    pub camera: Option<String>,
    pub created: u64,
    pub exported: bool,
    pub recipe: Option<Recipe>,
}

/// What the editor needs to know about the open take.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub name: String,
    pub duration: f64,
    pub width: f64,
    pub height: f64,
    pub fps: f64,
    pub has_audio: bool,
    pub has_camera: bool,
    pub exported: bool,
    pub recipe: Option<Recipe>,
}

#[derive(Clone, Debug)]
pub struct Take {
    pub dir: PathBuf,
    pub meta: Meta,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn root(data_dir: &Path) -> PathBuf {
    data_dir.join("takes")
}

impl Take {
    fn new(data_dir: &Path, name: String, screen: String) -> Result<Take> {
        let created = now_ms();
        let mut id = created.to_string();
        let mut dir = root(data_dir).join(&id);
        let mut n = 1;
        while dir.exists() {
            id = format!("{created}-{n}");
            dir = root(data_dir).join(&id);
            n += 1;
        }
        std::fs::create_dir_all(&dir).context("Couldn't create the take folder")?;
        Ok(Take {
            dir,
            meta: Meta {
                id,
                name,
                screen,
                camera: None,
                created,
                exported: false,
                recipe: None,
            },
        })
    }

    /// Copies a video in. On APFS this is a clone, so it's instant.
    pub fn import(data_dir: &Path, source: &Path) -> Result<Take> {
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| ["mov", "mp4", "m4v"].contains(&e.as_str()))
            .ok_or_else(|| anyhow!("Clipt opens .mov and .mp4 files"))?;
        let name = source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Video".into());
        let take = Take::new(data_dir, name, format!("source.{ext}"))?;
        if let Err(e) = std::fs::copy(source, take.screen_path()) {
            let _ = std::fs::remove_dir_all(&take.dir);
            return Err(anyhow!("Couldn't copy the video: {e}"));
        }
        take.save()?;
        Ok(take)
    }

    /// An empty take that a recording will fill.
    pub fn for_recording(data_dir: &Path, camera: bool) -> Result<Take> {
        let mut take = Take::new(data_dir, "Recording".into(), "screen.mov".into())?;
        if camera {
            take.meta.camera = Some("camera.mov".into());
        }
        take.save()?;
        Ok(take)
    }

    pub fn open(dir: &Path) -> Result<Take> {
        let text = std::fs::read_to_string(dir.join(META))?;
        Ok(Take {
            dir: dir.to_path_buf(),
            meta: serde_json::from_str(&text)?,
        })
    }

    pub fn screen_path(&self) -> PathBuf {
        self.dir.join(&self.meta.screen)
    }

    pub fn camera_path(&self) -> Option<PathBuf> {
        self.meta
            .camera
            .as_ref()
            .map(|c| self.dir.join(c))
            .filter(|p| p.exists())
    }

    pub fn thumbs_dir(&self) -> PathBuf {
        self.dir.join("thumbs")
    }

    pub fn save(&self) -> Result<()> {
        let tmp = self.dir.join(format!("{META}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.meta)?)?;
        std::fs::rename(tmp, self.dir.join(META))?;
        Ok(())
    }

    pub fn discard(self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The newest take that was never exported (left by a quit or crash), after
/// removing every other leftover that is safe to remove.
pub fn leftover(data_dir: &Path) -> Option<Take> {
    let entries = std::fs::read_dir(root(data_dir)).ok()?;
    let mut keep: Vec<Take> = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        match Take::open(&dir) {
            Ok(take) if take.meta.exported => take.discard(),
            Ok(take) if take.screen_path().exists() => keep.push(take),
            // Unreadable, or a recording that never wrote a frame.
            _ => {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    }
    keep.sort_by_key(|t| std::cmp::Reverse(t.meta.created));
    keep.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("clipt-take-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn import_copies_and_round_trips() {
        let data = temp("import");
        let src = data.join("Demo.MOV");
        std::fs::write(&src, b"movie").unwrap();
        let take = Take::import(&data, &src).unwrap();
        assert_eq!(take.meta.name, "Demo");
        assert_eq!(std::fs::read(take.screen_path()).unwrap(), b"movie");
        assert!(src.exists(), "the original stays put");
        let again = Take::open(&take.dir).unwrap();
        assert_eq!(again.meta.id, take.meta.id);
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn import_rejects_other_files() {
        let data = temp("reject");
        let src = data.join("notes.txt");
        std::fs::write(&src, b"x").unwrap();
        assert!(Take::import(&data, &src).is_err());
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn leftover_keeps_newest_unexported() {
        let data = temp("leftover");
        let src = data.join("a.mp4");
        std::fs::write(&src, b"x").unwrap();
        let old = Take::import(&data, &src).unwrap();
        let mut done = Take::import(&data, &src).unwrap();
        done.meta.exported = true;
        done.save().unwrap();
        let empty = Take::for_recording(&data, false).unwrap();
        let newest = Take::import(&data, &src).unwrap();
        let found = leftover(&data).unwrap();
        assert_eq!(found.meta.id, newest.meta.id);
        assert!(
            old.dir.exists(),
            "unexported takes are never deleted silently"
        );
        assert!(!done.dir.exists());
        assert!(!empty.dir.exists());
        std::fs::remove_dir_all(&data).unwrap();
    }
}

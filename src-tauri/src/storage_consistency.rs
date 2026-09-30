//! Storage consistency checker — the permanent net under "a project's files
//! and its dashboard entry must never silently diverge".
//!
//! A project's data lives in five places that are written by different code
//! paths: the dashboard list (per-origin webview `localStorage`, so the
//! frontend passes its ids in), the primary store record
//! (`projects/<id>/project.json`), the native asset bytes (`assets/<id>/`), the
//! durable mirror (`project-mirror/projects/<id>.json`), and the media
//! vault's per-hash project references. When one of them outlives the others
//! the operator used to learn about it only by stumbling over the disk usage.
//! This module compares them and returns typed findings — ids, paths, sizes,
//! mtimes — for the storage settings surface. It is READ-ONLY: it never
//! moves, rewrites or deletes anything (`storage_quarantine.rs` is the only
//! mover, and only on an explicit operator ruling).
//!
//! What is deliberately NOT a finding: a deleted project's retained backups
//! (`project-store-backups/<id>/`, `project-mirror/backups/<id>/`). Those are
//! kept on purpose for a recovery window and swept by age
//! (`project_mirror::sweep_stale_project_backups`).

use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::storage_root::{assets_dir, media_vault_dir, project_mirror_dir, projects_dir};

/// What is wrong with one project id.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    /// A store record exists but the dashboard does not list it. The operator
    /// cannot open it, yet it occupies disk and looks like a live project.
    RecordNotOnDashboard,
    /// The dashboard lists an id with no store record: opening it fails.
    DashboardWithoutRecord,
    /// No store record and not on the dashboard, but bytes/refs remain:
    /// native asset files, a mirror copy, or media-vault references.
    DataWithoutRecord,
    /// `projects/<id>/` exists with no `project.json` in it.
    EmptyStoreDir,
    /// `media-vault/registry.json` exists but does not parse. The loader heals
    /// this at launch and on the next import; a scan that still sees it means
    /// nothing has touched the vault since it broke.
    VaultRegistryUnparseable,
    /// A registry entry whose blob file is missing — the invariant "an entry
    /// implies its blob" is broken; the asset would 404 on read.
    VaultEntryWithoutBlob,
    /// A registry entry whose recorded size differs from its blob's size.
    VaultBlobSizeMismatch,
}

/// One path (or logical location) that belongs to a finding.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FindingPath {
    /// `storeRecord` | `assets` | `mirrorRecord` | `storeDir` | `vaultRefs` |
    /// `vaultRegistry` | `vaultBlob`
    pub role: &'static str,
    /// Empty for `vaultRefs` (a registry entry set, not a path).
    pub path: String,
    pub bytes: u64,
    pub files: u64,
    /// Newest mtime under the path, ms since epoch (0 = unknown).
    pub modified_ms: u64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyFinding {
    pub id: String,
    pub kind: FindingKind,
    /// From the store or mirror record, when one parses.
    pub name: Option<String>,
    pub segment_count: Option<u64>,
    /// The id is on the operator's delete list (tombstone) — the data is
    /// residue of a deletion, not a project that lost its dashboard row.
    pub tombstoned: bool,
    pub paths: Vec<FindingPath>,
}

impl ConsistencyFinding {
    pub fn total_bytes(&self) -> u64 {
        self.paths.iter().map(|p| p.bytes).sum()
    }
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyReport {
    pub findings: Vec<ConsistencyFinding>,
    pub total_bytes: u64,
    /// Ids the scan looked at, so "0 findings" can be told from "scan saw nothing".
    pub ids_examined: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Size/count/newest-mtime of a file or a directory tree. A missing path is `None`.
fn measure(role: &'static str, path: &Path) -> Option<FindingPath> {
    let meta = fs::symlink_metadata(path).ok()?;
    let (mut bytes, mut files, mut modified) = (0u64, 0u64, mtime_ms(&meta));
    if meta.is_file() {
        bytes = meta.len();
        files = 1;
    } else if meta.is_dir() {
        let mut stack = vec![path.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = fs::read_dir(&dir) else { continue };
            for entry in rd.filter_map(|e| e.ok()) {
                let Ok(m) = entry.metadata() else { continue };
                if m.is_dir() {
                    stack.push(entry.path());
                } else {
                    bytes += m.len();
                    files += 1;
                    modified = modified.max(mtime_ms(&m));
                }
            }
        }
    }
    Some(FindingPath {
        role,
        path: path.display().to_string(),
        bytes,
        files,
        modified_ms: modified,
    })
}

fn looks_like_project_id(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn subdirs(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| looks_like_project_id(n))
                .collect()
        })
        .unwrap_or_default()
}

/// `name` / segment count out of a store or mirror record, if it parses.
fn record_summary(path: &Path) -> (Option<String>, Option<u64>) {
    let Ok(text) = fs::read_to_string(path) else { return (None, None) };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return (None, None) };
    let project = v.get("project").unwrap_or(&v);
    let name = project.get("name").and_then(|n| n.as_str()).map(str::to_string);
    let segs = project.get("segments").and_then(|s| s.as_array()).map(|a| a.len() as u64);
    (name, segs)
}

/// Compares the dashboard ids the frontend supplies against everything on
/// disk under `root`. Pure over the filesystem — no app handle — so it is
/// exercised in tests against real temp directories.
pub fn scan_consistency(
    root: &Path,
    dashboard_ids: &[String],
    deleted_ids: &[String],
) -> Result<ConsistencyReport, String> {
    let dashboard: HashSet<&str> = dashboard_ids.iter().map(String::as_str).collect();
    let deleted: HashSet<&str> = deleted_ids.iter().map(String::as_str).collect();

    let store_dir = projects_dir(root);
    let assets = assets_dir(root);
    let mirror = project_mirror_dir(root);
    // The scan never repairs: a damaged registry becomes a finding, not an error.
    let mut vault_findings: Vec<ConsistencyFinding> = Vec::new();
    let vault_entries = match crate::media_vault::entries_no_heal(root) {
        Ok(entries) => entries,
        Err(cause) => {
            let registry = crate::media_vault::registry_file(root);
            vault_findings.push(ConsistencyFinding {
                id: "media-vault/registry.json".to_string(),
                kind: FindingKind::VaultRegistryUnparseable,
                name: Some(cause),
                segment_count: None,
                tombstoned: false,
                paths: measure("vaultRegistry", &registry).into_iter().collect(),
            });
            Vec::new()
        }
    };
    let vault = crate::media_vault::reference_totals(&vault_entries);
    for entry in &vault_entries {
        let blob = crate::media_vault::blob_len(root, &entry.content_hash);
        let kind = match blob {
            None => Some(FindingKind::VaultEntryWithoutBlob),
            Some(len) if len != entry.size_bytes => Some(FindingKind::VaultBlobSizeMismatch),
            Some(_) => None,
        };
        if let Some(kind) = kind {
            vault_findings.push(ConsistencyFinding {
                id: entry.content_hash.clone(),
                kind,
                name: Some(entry.display_name.clone()),
                segment_count: None,
                tombstoned: false,
                paths: vec![FindingPath {
                    role: "vaultBlob",
                    path: media_vault_dir(root).join(format!("{}.bin", entry.content_hash)).display().to_string(),
                    bytes: blob.unwrap_or(0),
                    files: u64::from(blob.is_some()),
                    modified_ms: 0,
                }],
            });
        }
    }
    vault_findings.sort_by(|a, b| a.id.cmp(&b.id));

    let store_ids: BTreeSet<String> = subdirs(&store_dir).into_iter().collect();
    let asset_ids: BTreeSet<String> = subdirs(&assets).into_iter().collect();
    let mirror_ids: BTreeSet<String> = fs::read_dir(mirror.join("projects"))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let n = e.file_name().into_string().ok()?;
                    let id = n.strip_suffix(".json")?.to_string();
                    looks_like_project_id(&id).then_some(id)
                })
                .collect()
        })
        .unwrap_or_default();

    let mut all: BTreeSet<String> = BTreeSet::new();
    all.extend(store_ids.iter().cloned());
    all.extend(asset_ids.iter().cloned());
    all.extend(mirror_ids.iter().cloned());
    all.extend(vault.keys().filter(|k| looks_like_project_id(k)).cloned());
    all.extend(dashboard.iter().filter(|k| looks_like_project_id(k)).map(|s| s.to_string()));

    let mut findings = Vec::new();
    for id in &all {
        let record_path = store_dir.join(id).join("project.json");
        let has_record = record_path.is_file();
        let on_dashboard = dashboard.contains(id.as_str());
        let tombstoned = deleted.contains(id.as_str());

        let mut paths: Vec<FindingPath> = Vec::new();
        let kind = if has_record && !on_dashboard {
            paths.extend(measure("storeRecord", &record_path));
            Some(FindingKind::RecordNotOnDashboard)
        } else if !has_record && on_dashboard {
            Some(FindingKind::DashboardWithoutRecord)
        } else if !has_record && !on_dashboard {
            let dir = store_dir.join(id);
            let residue_assets = measure("assets", &assets.join(id));
            let residue_mirror = measure("mirrorRecord", &mirror.join("projects").join(format!("{id}.json")));
            let refs = vault.get(id.as_str());
            if dir.is_dir() && residue_assets.is_none() && residue_mirror.is_none() && refs.is_none() {
                paths.extend(measure("storeDir", &dir));
                Some(FindingKind::EmptyStoreDir)
            } else if residue_assets.is_some() || residue_mirror.is_some() || refs.is_some() {
                if dir.is_dir() {
                    paths.extend(measure("storeDir", &dir));
                }
                paths.extend(residue_assets);
                paths.extend(residue_mirror);
                if let Some(r) = refs {
                    paths.push(FindingPath {
                        role: "vaultRefs",
                        path: String::new(),
                        bytes: r.bytes,
                        files: r.entries,
                        modified_ms: 0,
                    });
                }
                Some(FindingKind::DataWithoutRecord)
            } else {
                None
            }
        } else {
            None
        };
        let Some(kind) = kind else { continue };

        if kind == FindingKind::RecordNotOnDashboard {
            // The same project's other bytes are part of what the operator
            // would be deciding about.
            paths.extend(measure("assets", &assets.join(id)));
            paths.extend(measure("mirrorRecord", &mirror.join("projects").join(format!("{id}.json"))));
        }
        let (name, segment_count) = if has_record {
            record_summary(&record_path)
        } else {
            record_summary(&mirror.join("projects").join(format!("{id}.json")))
        };
        findings.push(ConsistencyFinding {
            id: id.clone(),
            kind,
            name,
            segment_count,
            tombstoned,
            paths,
        });
    }

    findings.extend(vault_findings);
    let total_bytes = findings.iter().map(|f| f.total_bytes()).sum();
    Ok(ConsistencyReport { findings, total_bytes, ids_examined: all.len() as u64 })
}

#[tauri::command]
pub async fn storage_consistency_scan(
    app: tauri::AppHandle,
    dashboard_ids: Vec<String>,
    deleted_ids: Vec<String>,
) -> Result<ConsistencyReport, String> {
    let root = crate::storage_root::resolve_storage_root(&app)?;
    // Walks asset trees (thousands of files): off the async executor thread.
    tauri::async_runtime::spawn_blocking(move || scan_consistency(&root, &dashboard_ids, &deleted_ids))
        .await
        .map_err(|e| format!("consistency scan task failed: {e}"))?
}

/// Convenience for tests and the quarantine module: the finding for one id.
#[allow(dead_code)]
pub fn finding_for<'a>(report: &'a ConsistencyReport, id: &str) -> Option<&'a ConsistencyFinding> {
    report.findings.iter().find(|f| f.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "kinetix-consistency-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn record(root: &Path, id: &str, name: &str, segs: usize) {
        let body = format!(
            "{{\"version\":6,\"savedAt\":1,\"project\":{{\"id\":\"{id}\",\"name\":\"{name}\",\"segments\":[{}]}}}}",
            (0..segs).map(|_| "{}").collect::<Vec<_>>().join(",")
        );
        put(&projects_dir(root).join(id).join("project.json"), body.as_bytes());
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_consistent_root_has_no_findings() {
        let d = tmp("ok");
        record(&d, "aaaa1111", "One", 3);
        put(&assets_dir(&d).join("aaaa1111").join("x.bin"), b"abc");
        let r = scan_consistency(&d, &ids(&["aaaa1111"]), &[]).unwrap();
        assert!(r.findings.is_empty(), "{:?}", r.findings);
        assert_eq!(r.ids_examined, 1);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_store_record_missing_from_the_dashboard_is_reported_with_its_bytes() {
        let d = tmp("hidden");
        record(&d, "bbbb2222", "Hidden", 2);
        put(&assets_dir(&d).join("bbbb2222").join("v.bin"), &[0u8; 1000]);
        put(&assets_dir(&d).join("bbbb2222").join("v.meta.json"), b"{}");
        let r = scan_consistency(&d, &[], &[]).unwrap();
        let f = finding_for(&r, "bbbb2222").expect("finding");
        assert_eq!(f.kind, FindingKind::RecordNotOnDashboard);
        assert_eq!(f.name.as_deref(), Some("Hidden"));
        assert_eq!(f.segment_count, Some(2));
        let assets = f.paths.iter().find(|p| p.role == "assets").unwrap();
        assert_eq!((assets.bytes, assets.files), (1002, 2));
        assert!(f.paths.iter().any(|p| p.role == "storeRecord" && p.bytes > 0 && p.modified_ms > 0));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_dashboard_entry_without_a_record_is_reported() {
        let d = tmp("dangling");
        fs::create_dir_all(projects_dir(&d)).unwrap();
        let r = scan_consistency(&d, &ids(&["cccc3333"]), &[]).unwrap();
        assert_eq!(finding_for(&r, "cccc3333").unwrap().kind, FindingKind::DashboardWithoutRecord);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn assets_mirror_and_vault_refs_without_a_record_are_data_without_record() {
        let d = tmp("residue");
        put(&assets_dir(&d).join("dddd4444").join("a.bin"), &[1u8; 50]);
        put(
            &project_mirror_dir(&d).join("projects").join("dddd4444.json"),
            b"{\"project\":{\"name\":\"Ghost\",\"segments\":[{},{}]}}",
        );
        put(
            &d.join("media-vault").join("registry.json"),
            b"{\"entries\":{\"h1\":{\"contentHash\":\"h1\",\"displayName\":\"a\",\"mimeType\":\"x\",\"sizeBytes\":700,\"addedAtMs\":1,\"referencedByProjectIds\":[\"dddd4444\"]}}}",
        );
        let r = scan_consistency(&d, &[], &ids(&["dddd4444"])).unwrap();
        let f = finding_for(&r, "dddd4444").unwrap();
        assert_eq!(f.kind, FindingKind::DataWithoutRecord);
        assert!(f.tombstoned);
        assert_eq!(f.name.as_deref(), Some("Ghost"));
        let roles: Vec<_> = f.paths.iter().map(|p| p.role).collect();
        assert!(roles.contains(&"assets") && roles.contains(&"mirrorRecord") && roles.contains(&"vaultRefs"));
        assert_eq!(f.paths.iter().find(|p| p.role == "vaultRefs").unwrap().bytes, 700);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn retained_backups_alone_are_by_design_not_a_finding() {
        let d = tmp("backups");
        put(&d.join("project-store-backups").join("eeee5555").join("1.json"), b"{}");
        put(&project_mirror_dir(&d).join("backups").join("eeee5555").join("1.json"), b"{}");
        let r = scan_consistency(&d, &[], &ids(&["eeee5555"])).unwrap();
        assert!(r.findings.is_empty(), "{:?}", r.findings);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_empty_store_dir_is_reported_and_the_scan_moves_nothing() {
        let d = tmp("emptydir");
        fs::create_dir_all(projects_dir(&d).join("ffff6666")).unwrap();
        record(&d, "abab7777", "Real", 1);
        let before: Vec<_> = walk(&d);
        let r = scan_consistency(&d, &ids(&["abab7777"]), &[]).unwrap();
        assert_eq!(finding_for(&r, "ffff6666").unwrap().kind, FindingKind::EmptyStoreDir);
        assert_eq!(walk(&d), before, "the scanner is read-only");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn hostile_directory_names_are_ignored() {
        let d = tmp("hostile");
        put(&assets_dir(&d).join("bad name").join("a.bin"), b"x");
        let r = scan_consistency(&d, &[], &[]).unwrap();
        assert!(r.findings.is_empty());
        fs::remove_dir_all(&d).ok();
    }

    // ---- media-vault checks ------------------------------------------------

    fn vault_entry(root: &Path, content: &[u8], project: &str) -> crate::media_vault::MediaVaultEntry {
        crate::media_vault::media_vault_import_bytes(root, project, content, "clip.mp4", "video/mp4").unwrap()
    }

    #[test]
    fn a_healthy_vault_has_no_findings() {
        let d = tmp("vault-ok");
        record(&d, "aaaa1111", "One", 1);
        vault_entry(&d, b"healthy bytes", "aaaa1111");
        let r = scan_consistency(&d, &ids(&["aaaa1111"]), &[]).unwrap();
        assert!(r.findings.is_empty(), "{:?}", r.findings);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_unparseable_registry_is_a_finding_not_a_scan_failure_and_is_not_repaired() {
        let d = tmp("vault-torn");
        record(&d, "aaaa1111", "One", 1);
        vault_entry(&d, b"bytes", "aaaa1111");
        let reg = crate::media_vault::registry_file(&d);
        let mut torn = fs::read(&reg).unwrap();
        torn.extend_from_slice(b"\n  trailing\n");
        fs::write(&reg, &torn).unwrap();
        let before = walk(&d);

        let r = scan_consistency(&d, &ids(&["aaaa1111"]), &[]).unwrap();
        let f = r.findings.iter().find(|f| f.kind == FindingKind::VaultRegistryUnparseable).expect("finding");
        assert!(f.name.as_deref().unwrap().contains("trailing characters"));
        assert_eq!(f.paths[0].role, "vaultRegistry");
        assert_eq!(walk(&d), before, "the scanner is read-only — nothing healed, nothing quarantined");
        assert_eq!(fs::read(&reg).unwrap(), torn);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_registry_entry_whose_blob_is_gone_is_reported() {
        let d = tmp("vault-dangling");
        record(&d, "aaaa1111", "One", 1);
        let e = vault_entry(&d, b"will vanish", "aaaa1111");
        fs::remove_file(media_vault_dir(&d).join(format!("{}.bin", e.content_hash))).unwrap();
        let r = scan_consistency(&d, &ids(&["aaaa1111"]), &[]).unwrap();
        let f = finding_for(&r, &e.content_hash).expect("finding");
        assert_eq!(f.kind, FindingKind::VaultEntryWithoutBlob);
        assert_eq!(f.name.as_deref(), Some("clip.mp4"));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_blob_whose_size_disagrees_with_its_entry_is_reported() {
        let d = tmp("vault-size");
        record(&d, "aaaa1111", "One", 1);
        let e = vault_entry(&d, b"twelve bytes", "aaaa1111");
        fs::write(media_vault_dir(&d).join(format!("{}.bin", e.content_hash)), b"short").unwrap();
        let r = scan_consistency(&d, &ids(&["aaaa1111"]), &[]).unwrap();
        assert_eq!(finding_for(&r, &e.content_hash).unwrap().kind, FindingKind::VaultBlobSizeMismatch);
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_orphan_blob_from_a_phase_one_crash_is_by_design_not_a_finding() {
        let d = tmp("vault-orphan-blob");
        fs::create_dir_all(media_vault_dir(&d)).unwrap();
        fs::write(media_vault_dir(&d).join(format!("{}.bin", "a".repeat(64))), b"unreferenced").unwrap();
        let r = scan_consistency(&d, &[], &[]).unwrap();
        assert!(r.findings.is_empty(), "{:?}", r.findings);
        fs::remove_dir_all(&d).ok();
    }

    /// Operator tool, not a gate: `KINETIX_SCAN_ROOT=<root> KINETIX_SCAN_DASHBOARD=id,id
    /// KINETIX_SCAN_DELETED=id,id cargo test --lib scan_real_root -- --ignored --nocapture`
    /// prints the report for a real storage root. Read-only, like the scanner.
    #[test]
    #[ignore]
    fn scan_real_root() {
        let root = PathBuf::from(std::env::var("KINETIX_SCAN_ROOT").expect("KINETIX_SCAN_ROOT"));
        let list = |k: &str| -> Vec<String> {
            std::env::var(k).unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from).collect()
        };
        let r = scan_consistency(&root, &list("KINETIX_SCAN_DASHBOARD"), &list("KINETIX_SCAN_DELETED")).unwrap();
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
    }

    fn walk(root: &Path) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in fs::read_dir(&d).unwrap().filter_map(|e| e.ok()) {
                let p = e.path();
                out.push(format!("{}:{}", p.display(), e.metadata().unwrap().len()));
                if p.is_dir() {
                    stack.push(p);
                }
            }
        }
        out.sort();
        out
    }
}

//! Sidecar lookup that canonicalizes `current_exe()` *before* any symlink
//! check. tauri-plugin-shell's `StartingBinary` rejects the raw
//! `current_exe()` path when any ancestor is a symlink. On macOS `/var` →
//! `/private/var` is a system symlink, so a perfectly normal cargo-target
//! (or `/var/folders/…` cache) fails with:
//! `StartingBinary found current_exe() that contains a symlink on a
//! non-allowed platform: /var`.
//!
//! Security intent kept: canonicalization must succeed, and the sidecar
//! must resolve inside the current exe's own parent directory (the install
//! dir — any drive, any path) or a known cargo/dev root. A sibling
//! `ffmpeg-*` that canonicalizes to somewhere else (e.g. `/etc`, `%TEMP%`)
//! is still refused. Hardcoded `/Applications` / `C:\Program Files` lists
//! are not used: they reject a legitimate custom Windows install.

use std::path::{Path, PathBuf};
use tauri_plugin_shell::process::Command;
use tauri_plugin_shell::ShellExt;

/// Same walk `tauri-utils` `StartingBinary::has_symlink` does on macOS:
/// any ancestor that *is* a symlink (not merely *contains* one after
/// canonicalize). `/var` matches; `/private/var` after canonicalize does not.
pub(crate) fn symlink_ancestor(path: &Path) -> Option<&Path> {
    path.ancestors().find(|ancestor| {
        matches!(
            ancestor
                .symlink_metadata()
                .as_ref()
                .map(std::fs::Metadata::file_type)
                .as_ref()
                .map(std::fs::FileType::is_symlink),
            Ok(true)
        )
    })
}

pub(crate) fn tauri_starting_binary_guard(exe: &Path) -> Result<(), String> {
    if let Some(link) = symlink_ancestor(exe) {
        return Err(format!(
            "StartingBinary found current_exe() that contains a symlink on a non-allowed platform: {}",
            link.display()
        ));
    }
    Ok(())
}

pub(crate) fn host_triple() -> &'static str {
    if let Some(t) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        return t;
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
    )))]
    {
        "unknown-unknown-unknown"
    }
}

fn sidecar_file_name(name: &str, triple: &str) -> String {
    #[cfg(windows)]
    {
        format!("{name}-{triple}.exe")
    }
    #[cfg(not(windows))]
    {
        let _ = triple;
        format!("{name}-{triple}")
    }
}

/// Cargo/dev roots only. Production installs are allowed via the exe's own
/// parent, not a hardcoded Program Files / Applications list.
pub(crate) fn default_dev_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(manifest) = std::fs::canonicalize(env!("CARGO_MANIFEST_DIR")) {
        if let Some(repo) = manifest.parent() {
            roots.push(repo.to_path_buf());
        }
        roots.push(manifest.clone());
        roots.push(manifest.join("binaries"));
    }
    roots
}

pub(crate) fn normalize_injected_path(raw: &str, windows: bool) -> String {
    if !windows {
        return raw.replace('\\', "/");
    }
    let mut t = raw.replace('/', "\\");
    let prefix_unc = "\\\\?\\UNC\\";
    let prefix_dev = "\\\\?\\";
    if t.len() >= prefix_unc.len() && t[..prefix_unc.len()].eq_ignore_ascii_case(prefix_unc) {
        t = format!("\\\\{}", &t[prefix_unc.len()..]);
    } else if t.len() >= prefix_dev.len() && t[..prefix_dev.len()].eq_ignore_ascii_case(prefix_dev) {
        t = t[prefix_dev.len()..].to_string();
    }
    t.to_ascii_lowercase()
}

pub(crate) fn injected_parent(path: &str, windows: bool) -> Option<String> {
    let n = normalize_injected_path(path, windows);
    if windows {
        let trimmed = n.trim_end_matches('\\');
        let (parent, _) = trimmed.rsplit_once('\\')?;
        if parent.ends_with(':') {
            Some(format!("{parent}\\"))
        } else {
            Some(parent.to_string())
        }
    } else {
        let trimmed = n.trim_end_matches('/');
        let (parent, _) = trimmed.rsplit_once('/')?;
        Some(if parent.is_empty() { "/".to_string() } else { parent.to_string() })
    }
}

pub(crate) fn injected_is_under(path: &str, root: &str, windows: bool) -> bool {
    let p = normalize_injected_path(path, windows);
    let r = normalize_injected_path(root, windows);
    if windows {
        let r = r.trim_end_matches('\\');
        let p = p.trim_end_matches('\\');
        p == r || p.starts_with(&format!("{r}\\"))
    } else {
        let r = r.trim_end_matches('/');
        let p = p.trim_end_matches('/');
        p == r || p.starts_with(&format!("{r}/"))
    }
}

/// Sidecar is allowed iff it sits under the exe's own parent or a listed
/// extra/dev root. Path strings are fixtures — no filesystem.
pub(crate) fn injected_guard_allows(
    exe: &str,
    sidecar: &str,
    extra_roots: &[&str],
    windows: bool,
) -> bool {
    let Some(install_dir) = injected_parent(exe, windows) else {
        return false;
    };
    let mut roots: Vec<String> = vec![install_dir];
    roots.extend(extra_roots.iter().map(|r| r.to_string()));
    roots
        .iter()
        .any(|root| injected_is_under(sidecar, root, windows))
}

pub(crate) fn path_under_allowed_roots(canonical: &Path, roots: &[PathBuf]) -> bool {
    #[cfg(windows)]
    {
        let c = canonical.to_string_lossy();
        roots
            .iter()
            .any(|root| injected_is_under(&c, &root.to_string_lossy(), true))
    }
    #[cfg(not(windows))]
    {
        roots.iter().any(|root| canonical.starts_with(root))
    }
}

/// Canonicalize the running exe. Install location is not filtered here —
/// the sidecar check uses the exe's parent as the install root.
pub(crate) fn canonicalize_exe(exe: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(exe).map_err(|e| {
        format!(
            "sidecar: canonicalize current_exe {} failed: {e}",
            exe.display()
        )
    })
}

fn allowed_roots_for_canonical_exe(canonical_exe: &Path, extra_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(parent) = canonical_exe.parent() {
        roots.push(parent.to_path_buf());
    }
    roots.extend(extra_roots.iter().cloned());
    roots
}

fn exe_search_dirs(canonical_exe: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = canonical_exe.parent() {
        dirs.push(dir.to_path_buf());
        if dir.ends_with("deps") {
            if let Some(parent) = dir.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
    }
    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries"),
    );
    dirs
}

fn sidecar_candidates(canonical_exe: &Path, name: &str, triple: &str) -> Vec<PathBuf> {
    let file = sidecar_file_name(name, triple);
    let mut out = Vec::new();
    for dir in exe_search_dirs(canonical_exe) {
        out.push(dir.join(&file));
        out.push(dir.join(name));
        #[cfg(windows)]
        out.push(dir.join(format!("{name}.exe")));
    }
    out
}

/// Resolve `name` (e.g. `ffmpeg`, `whisper`) next to a (possibly symlinked)
/// exe path. Canonicalizes the exe *before* any symlink-component check.
pub(crate) fn resolve_sidecar_from(
    exe: &Path,
    name: &str,
    extra_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let canonical_exe = canonicalize_exe(exe)?;
    let allowed_roots = allowed_roots_for_canonical_exe(&canonical_exe, extra_roots);
    let triple = host_triple();
    let mut last_err = format!("sidecar '{name}' not found next to {}", canonical_exe.display());
    for candidate in sidecar_candidates(&canonical_exe, name, triple) {
        if !candidate.exists() {
            continue;
        }
        match std::fs::canonicalize(&candidate) {
            Ok(resolved) => {
                if !path_under_allowed_roots(&resolved, &allowed_roots) {
                    last_err = format!(
                        "sidecar: {} resolves to {} outside allowed install/dev roots",
                        candidate.display(),
                        resolved.display()
                    );
                    continue;
                }
                return Ok(resolved);
            }
            Err(e) => {
                last_err = format!(
                    "sidecar: canonicalize {} failed: {e}",
                    candidate.display()
                );
            }
        }
    }
    Err(last_err)
}

pub(crate) fn resolve_sidecar(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("sidecar: current_exe: {e}"))?;
    resolve_sidecar_from(&exe, name, &default_dev_roots())
}

/// Plugin `Command` via `.command(path)` — never `.sidecar()`, which goes
/// through `tauri_utils::platform::current_exe` / StartingBinary.
pub(crate) fn sidecar_command(app: &tauri::AppHandle, name: &str) -> Result<Command, String> {
    let path = resolve_sidecar(name)?;
    Ok(app.shell().command(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kinetix-sidecar-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    fn var_style_exe_fixture(sidecar_name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        use std::os::unix::fs::symlink;
        let root = unique_dir();
        let real_dir = root
            .join("private")
            .join("var")
            .join("folders")
            .join("xx")
            .join("debug");
        fs::create_dir_all(&real_dir).unwrap();
        let exe = real_dir.join("app");
        fs::write(&exe, b"fake-exe").unwrap();
        let triple = host_triple();
        let sidecar = real_dir.join(sidecar_file_name(sidecar_name, triple));
        fs::write(&sidecar, b"fake-sidecar").unwrap();
        let var_link = root.join("var");
        symlink(root.join("private").join("var"), &var_link).unwrap();
        let linked_exe = var_link.join("folders").join("xx").join("debug").join("app");
        assert!(linked_exe.exists());
        (root, linked_exe, exe, sidecar)
    }

    #[cfg(unix)]
    #[test]
    fn tauri_guard_rejects_var_symlink_exe_path_before_canonicalize() {
        let (root, linked_exe, _, _) = var_style_exe_fixture("ffmpeg");
        let err = tauri_starting_binary_guard(&linked_exe).expect_err("raw /var path must trip the guard");
        assert!(
            err.contains("non-allowed platform"),
            "expected StartingBinary wording, got {err}"
        );
        assert!(
            err.contains("var"),
            "operator screenshot named /var; got {err}"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn canonicalize_before_check_accepts_var_style_symlinked_exe_dir() {
        let (root, linked_exe, real_exe, sidecar) = var_style_exe_fixture("ffmpeg");
        tauri_starting_binary_guard(&linked_exe).expect_err("red: uncanonicalized path is rejected");
        let allowed = [std::fs::canonicalize(&root).unwrap()];
        let resolved = resolve_sidecar_from(&linked_exe, "ffmpeg", &allowed)
            .unwrap_or_else(|e| panic!("canonicalized lookup must succeed: {e}"));
        assert_eq!(resolved, std::fs::canonicalize(&sidecar).unwrap());
        assert_eq!(
            canonicalize_exe(&linked_exe).unwrap(),
            std::fs::canonicalize(&real_exe).unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn whisper_sidecar_same_guard_class() {
        let (root, linked_exe, _, sidecar) = var_style_exe_fixture("whisper");
        let allowed = [std::fs::canonicalize(&root).unwrap()];
        let resolved = resolve_sidecar_from(&linked_exe, "whisper", &allowed).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&sidecar).unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_when_canonicalize_fails() {
        let missing = unique_dir().join("no-such-exe");
        let err = canonicalize_exe(&missing).unwrap_err();
        assert!(err.contains("canonicalize"), "{err}");
        let _ = fs::remove_dir_all(missing.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_sidecar_whose_canonical_path_leaves_allowed_roots() {
        use std::os::unix::fs::symlink;
        let root = unique_dir();
        let exe_dir = root.join("appdir");
        fs::create_dir_all(&exe_dir).unwrap();
        let exe = exe_dir.join("app");
        fs::write(&exe, b"exe").unwrap();
        let outside = unique_dir();
        let evil = outside.join("not-ffmpeg");
        fs::write(&evil, b"nope").unwrap();
        let candidate = exe_dir.join(sidecar_file_name("ffmpeg", host_triple()));
        symlink(&evil, &candidate).unwrap();
        let allowed = [std::fs::canonicalize(&root).unwrap()];
        let err = resolve_sidecar_from(&exe, "ffmpeg", &allowed).unwrap_err();
        assert!(
            err.contains("outside allowed"),
            "must refuse a sidecar that canonicalizes out of the install root: {err}"
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn f1_custom_windows_install_next_to_ffmpeg_must_be_allowed() {
        let exe = r"\\?\D:\DATA\Kinetix Installed\app.exe";
        let sidecar = r"\\?\D:\DATA\Kinetix Installed\ffmpeg-x86_64-pc-windows-msvc.exe";
        assert!(
            injected_guard_allows(exe, sidecar, &[], true),
            "installer puts ffmpeg beside app.exe on any drive"
        );
    }

    #[test]
    fn f1_windows_device_prefix_mixed_slashes_drive_case_and_unc_normalize() {
        let cases: &[(&str, &str)] = &[
            (
                r"\\?\D:\DATA\Kinetix Installed\app.exe",
                r"\\?\D:\DATA\Kinetix Installed\ffmpeg.exe",
            ),
            (
                r"D:/DATA/Kinetix Installed/app.exe",
                r"D:\DATA\Kinetix Installed\ffmpeg.exe",
            ),
            (
                r"d:\DATA\Kinetix Installed\app.exe",
                r"D:\DATA\Kinetix Installed\ffmpeg.exe",
            ),
            (
                r"\\?\UNC\fileserver\share\Kinetix\app.exe",
                r"\\fileserver\share\Kinetix\ffmpeg.exe",
            ),
        ];
        for (exe, sidecar) in cases {
            assert!(
                injected_guard_allows(exe, sidecar, &[], true),
                "normalize must accept {exe} + sibling"
            );
        }
    }

    #[test]
    fn f1_macos_applications_sibling_is_accepted() {
        let exe = "/Applications/Kinetix Pro Studio.app/Contents/MacOS/app";
        let sidecar =
            "/Applications/Kinetix Pro Studio.app/Contents/MacOS/ffmpeg-aarch64-apple-darwin";
        assert!(injected_guard_allows(exe, sidecar, &[], false));
    }

    #[test]
    fn f1_sidecar_planted_outside_install_dir_is_refused() {
        let exe = r"\\?\D:\DATA\Kinetix Installed\app.exe";
        let planted = r"C:\Windows\Temp\ffmpeg.exe";
        assert!(!injected_guard_allows(exe, planted, &[], true));
    }

    #[test]
    fn f1_dev_root_extra_still_allows_a_cargo_binaries_sidecar() {
        assert!(injected_guard_allows(
            r"C:\src\target\debug\app.exe",
            r"C:\src\src-tauri\binaries\ffmpeg.exe",
            &[r"C:\src\src-tauri\binaries"],
            true,
        ));
    }

    #[test]
    fn production_sidecar_lookups_share_sidecar_command() {
        let files = [
            ("ffmpeg.rs", include_str!("ffmpeg.rs")),
            ("whisper.rs", include_str!("whisper.rs")),
            ("media_vault.rs", include_str!("media_vault.rs")),
            ("cloud_gateway.rs", include_str!("cloud_gateway.rs")),
        ];
        for (name, src) in files {
            let prod = src
                .lines()
                .filter(|line| {
                    let t = line.trim_start();
                    !t.starts_with("//") && !t.starts_with("///") && !t.starts_with("//!")
                })
                .collect::<Vec<_>>()
                .join("\n");
            assert!(
                !prod.contains(".sidecar("),
                "{name} must not call plugin .sidecar()"
            );
            assert!(
                prod.contains("crate::sidecar::sidecar_command"),
                "{name} must look up ffmpeg/whisper through sidecar_command"
            );
        }
    }
}

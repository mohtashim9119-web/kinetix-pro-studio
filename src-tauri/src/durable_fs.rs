//! WS3 Round 20 — the one place a file is fsynced BY PATH, and the one place
//! a bounded retry wraps `sync_all` on any handle.
//!
//! Why this module exists. The first Windows field run failed at the mux
//! stage with `write_file(voiceover_audio): sync_all: Access is denied. (os
//! error 5)` after 40,374 frames of successful appends. The cause was not
//! Defender, not Controlled Folder Access, not a stale handle — it was the
//! open: `ffmpeg.rs`'s `sync_session_file` did `fs::File::open(path)` (Win32
//! `GENERIC_READ` only) and then `sync_all`. `fsync(2)` on an `O_RDONLY` fd
//! succeeds on macOS and Linux; `FlushFileBuffers` on a handle without
//! write access returns `ERROR_ACCESS_DENIED`. The same read-only-open-then-
//! sync pattern also lived in `models.rs`'s import path, so model import
//! would have failed identically. Both now come through `open_for_fsync`.
//!
//! Two distinct failure classes, two policies:
//!
//! * **Handle access** (the bug): fixed at the open — `open_for_fsync` asks
//!   for write access (`OpenOptions::write(true)`, no `create`, no
//!   `truncate`), which is the only way `FlushFileBuffers` can legally
//!   succeed. The `#[cfg(windows)]` tests in `ffmpeg.rs` pin that a
//!   read-only handle cannot flush, an append handle can, and this helper's
//!   result is `Confirmed`.
//! * **External holds** (Defender scan-on-close, Controlled Folder Access, a
//!   sharing violation from another opener): NOT fixable at the open. The
//!   policy is a bounded retry (`FSYNC_RETRY_BACKOFF_MS`, ≤ 775 ms of sleep
//!   in total — Rung 0: every wait has a number) and then a typed
//!   [`SyncOutcome::Unconfirmed`] carrying the OS error code and the path.
//!   The bytes were already written by the time any of these helpers runs;
//!   an unconfirmed fsync means "on disk in the OS's view, durability
//!   against power loss not proven" — the caller decides whether that is
//!   fatal. For a finished export it is not: `Unconfirmed` degrades to
//!   "saved but not confirmed durable", never to "export lost". Errors
//!   outside the retryable set (`NotFound`, I/O errors, disk full) surface
//!   immediately as `Err` — retrying those would only hide them.
//!
//! What is deliberately NOT here: the durability decision itself. Each call
//! site says whether `Unconfirmed` is tolerable; this module only makes the
//! two outcomes distinguishable and bounded.

use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

/// Sleep before retry attempt N (after the first, unslept attempt). Six
/// attempts, 775 ms of sleep in total — well inside every ffmpeg liveness
/// bound and short enough that a genuinely held file surfaces quickly.
pub const FSYNC_RETRY_BACKOFF_MS: [u64; 5] = [25, 50, 100, 200, 400];

/// Result of a bounded fsync that did not return a hard error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncOutcome {
    /// `sync_all` returned `Ok` — the bytes are durable as far as the OS and
    /// the device report.
    Confirmed,
    /// Every attempt failed with a retryable, externally-caused error. The
    /// bytes are written (the file is complete in the page cache); their
    /// durability against a crash or power loss is not proven. `cause`
    /// names the label, the path, the OS error code, and the attempt count.
    Unconfirmed { cause: String },
}

impl SyncOutcome {
    pub fn is_confirmed(&self) -> bool {
        matches!(self, SyncOutcome::Confirmed)
    }

    /// The warning string for an `Unconfirmed` outcome, `None` when confirmed.
    pub fn warning(&self) -> Option<&str> {
        match self {
            SyncOutcome::Confirmed => None,
            SyncOutcome::Unconfirmed { cause } => Some(cause),
        }
    }
}

/// Opens `path` with the access `sync_all` needs on every platform: write,
/// no create, no truncate, no append. The file must already exist — this is
/// for syncing bytes that were written through another handle (`fs::write`,
/// `set_len`, a `.part` promoted by rename), never for producing them.
pub fn open_for_fsync(path: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new().write(true).open(path)
}

/// Whether an fsync (or the open before it) failed for a reason that a
/// short wait can plausibly clear: another process holding the file (AV
/// scan-on-close, an indexer), a transient sharing/lock violation, or an
/// interrupted syscall. `ERROR_ACCESS_DENIED` is in the set because
/// Controlled Folder Access and some AV filters report a temporary hold with
/// exactly that code — after the handle-access fix, our own opens never
/// produce it, so a persistent one is external by construction.
pub fn is_retryable_sync_error(err: &io::Error) -> bool {
    if err.kind() == io::ErrorKind::Interrupted {
        return true;
    }
    #[cfg(windows)]
    {
        const ERROR_ACCESS_DENIED: i32 = 5;
        const ERROR_SHARING_VIOLATION: i32 = 32;
        const ERROR_LOCK_VIOLATION: i32 = 33;
        if matches!(
            err.raw_os_error(),
            Some(ERROR_ACCESS_DENIED) | Some(ERROR_SHARING_VIOLATION) | Some(ERROR_LOCK_VIOLATION)
        ) {
            return true;
        }
    }
    #[cfg(unix)]
    {
        // EAGAIN / EBUSY — rare for fsync, but the same "try again shortly"
        // meaning. `ErrorKind::WouldBlock` covers EAGAIN.
        if err.kind() == io::ErrorKind::WouldBlock {
            return true;
        }
        if err.raw_os_error() == Some(libc::EBUSY) {
            return true;
        }
    }
    false
}

fn describe(label: &str, path: &Path, step: &str, err: &io::Error, attempts: usize, elapsed: Duration) -> String {
    // `io::Error`'s Display already carries "(os error N)"; keep the raw code
    // explicit as well so a field report can be grepped for it.
    let code = err
        .raw_os_error()
        .map(|c| c.to_string())
        .unwrap_or_else(|| format!("{:?}", err.kind()));
    format!(
        "{label}: {step} on {}: {err} [os_error={code}, attempts={attempts}, elapsed_ms={}]",
        path.display(),
        elapsed.as_millis()
    )
}

/// Runs `attempt` up to `1 + FSYNC_RETRY_BACKOFF_MS.len()` times. A hard
/// (non-retryable) error returns `Err` at once with the OS code and path in
/// the string; exhausting the retries on a retryable error returns
/// `Ok(Unconfirmed)`. `step` names the io call for the message.
fn bounded<F>(label: &str, path: &Path, mut attempt: F) -> Result<SyncOutcome, String>
where
    F: FnMut() -> Result<(), (&'static str, io::Error)>,
{
    let started = Instant::now();
    let mut attempts = 0usize;
    let last: (&'static str, io::Error);
    loop {
        attempts += 1;
        match attempt() {
            Ok(()) => return Ok(SyncOutcome::Confirmed),
            Err((step, err)) => {
                if !is_retryable_sync_error(&err) {
                    return Err(describe(label, path, step, &err, attempts, started.elapsed()));
                }
                let Some(&sleep_ms) = FSYNC_RETRY_BACKOFF_MS.get(attempts - 1) else {
                    last = (step, err);
                    break;
                };
                thread::sleep(Duration::from_millis(sleep_ms));
            }
        }
    }
    let (step, err) = last;
    Ok(SyncOutcome::Unconfirmed {
        cause: describe(label, path, step, &err, attempts, started.elapsed()),
    })
}

/// fsync `path` by name with the bounded retry policy. Each attempt re-opens
/// (write access, see `open_for_fsync`) so a hold released between attempts
/// is actually observed — a retry on a handle that already failed
/// `FlushFileBuffers` would not re-check anything.
pub fn fsync_path_bounded(path: &Path, label: &str) -> Result<SyncOutcome, String> {
    bounded(label, path, || {
        let file = open_for_fsync(path).map_err(|e| ("open for sync", e))?;
        file.sync_all().map_err(|e| ("sync_all", e))
    })
}

/// fsync an already-open handle with the same bounded retry policy. For
/// handles this crate created with `File::create` / `OpenOptions::write` —
/// the access is already right, so only the external-hold class can fail
/// here. `path` is for the message only.
pub fn fsync_file_bounded(file: &fs::File, path: &Path, label: &str) -> Result<SyncOutcome, String> {
    bounded(label, path, || file.sync_all().map_err(|e| ("sync_all", e)))
}

/// One-shot, no retry, `io::Result` — for callers outside the export
/// session (model import) that want the fixed open and nothing else.
pub fn fsync_path(path: &Path) -> io::Result<()> {
    open_for_fsync(path)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use uuid::Uuid;

    fn scratch_file(contents: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kinetix-durable-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f.bin");
        fs::write(&p, contents).unwrap();
        p
    }

    #[test]
    fn open_for_fsync_never_truncates_or_creates() {
        let p = scratch_file(b"0123456789");
        let f = open_for_fsync(&p).unwrap();
        f.sync_all().unwrap();
        drop(f);
        assert_eq!(fs::read(&p).unwrap(), b"0123456789");
        let missing = p.with_file_name("absent.bin");
        let err = open_for_fsync(&missing).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(!missing.exists(), "fsync open must not create the file");
    }

    #[test]
    fn fsync_path_bounded_confirms_an_existing_file_on_every_platform() {
        let p = scratch_file(b"voiceover");
        let outcome = fsync_path_bounded(&p, "write_file(voiceover_audio)").unwrap();
        assert_eq!(outcome, SyncOutcome::Confirmed);
        assert!(outcome.warning().is_none());
    }

    #[test]
    fn a_missing_file_is_a_hard_error_not_a_retry() {
        let p = scratch_file(b"x").with_file_name("nope");
        let started = Instant::now();
        let err = fsync_path_bounded(&p, "probe").unwrap_err();
        assert!(started.elapsed() < Duration::from_millis(FSYNC_RETRY_BACKOFF_MS[0]),
            "NotFound must not enter the backoff schedule");
        assert!(err.contains("probe: open for sync on"), "{err}");
        assert!(err.contains("nope"), "path must be in the cause: {err}");
        assert!(err.contains("attempts=1"), "{err}");
        assert!(err.contains("os_error="), "{err}");
    }

    #[test]
    fn retryable_errors_exhaust_the_schedule_then_degrade_to_unconfirmed() {
        let calls = AtomicUsize::new(0);
        let p = Path::new("C:/Users/op/Videos/out.mp4");
        let started = Instant::now();
        let outcome = bounded("copy_session_file dest", p, || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(("sync_all", io::Error::from(io::ErrorKind::Interrupted)))
        })
        .unwrap();
        let elapsed = started.elapsed();
        let total_sleep: u64 = FSYNC_RETRY_BACKOFF_MS.iter().sum();
        assert_eq!(calls.load(Ordering::SeqCst), 1 + FSYNC_RETRY_BACKOFF_MS.len());
        assert!(elapsed >= Duration::from_millis(total_sleep), "{elapsed:?}");
        // Bounded: the whole schedule plus generous scheduler slack.
        assert!(elapsed < Duration::from_millis(total_sleep + 1_000), "{elapsed:?}");
        assert!(!outcome.is_confirmed());
        let SyncOutcome::Unconfirmed { cause } = outcome else {
            panic!("expected Unconfirmed, got {outcome:?}");
        };
        assert!(cause.contains("copy_session_file dest: sync_all on C:/Users/op/Videos/out.mp4"), "{cause}");
        assert!(cause.contains(&format!("attempts={}", 1 + FSYNC_RETRY_BACKOFF_MS.len())), "{cause}");
    }

    #[test]
    fn a_hold_released_mid_schedule_confirms() {
        let calls = AtomicUsize::new(0);
        let outcome = bounded("probe", Path::new("held"), || {
            if calls.fetch_add(1, Ordering::SeqCst) < 2 {
                Err(("sync_all", io::Error::from(io::ErrorKind::Interrupted)))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(outcome, SyncOutcome::Confirmed);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn retryable_set_is_the_external_hold_class_only() {
        assert!(is_retryable_sync_error(&io::Error::from(io::ErrorKind::Interrupted)));
        assert!(!is_retryable_sync_error(&io::Error::from(io::ErrorKind::NotFound)));
        assert!(!is_retryable_sync_error(&io::Error::from(io::ErrorKind::StorageFull)));
        #[cfg(windows)]
        {
            for code in [5, 32, 33] {
                assert!(is_retryable_sync_error(&io::Error::from_raw_os_error(code)), "{code}");
            }
            // ERROR_DISK_FULL — never retried, always surfaced.
            assert!(!is_retryable_sync_error(&io::Error::from_raw_os_error(112)));
        }
        #[cfg(unix)]
        {
            assert!(is_retryable_sync_error(&io::Error::from_raw_os_error(libc::EBUSY)));
            assert!(!is_retryable_sync_error(&io::Error::from_raw_os_error(libc::EIO)));
            assert!(!is_retryable_sync_error(&io::Error::from_raw_os_error(libc::ENOSPC)));
        }
    }

    #[test]
    fn fsync_file_bounded_confirms_a_write_handle() {
        let p = scratch_file(b"");
        let mut f = fs::File::create(&p).unwrap();
        use std::io::Write;
        f.write_all(b"part").unwrap();
        assert_eq!(fsync_file_bounded(&f, &p, "copy_session_file part").unwrap(), SyncOutcome::Confirmed);
    }
}

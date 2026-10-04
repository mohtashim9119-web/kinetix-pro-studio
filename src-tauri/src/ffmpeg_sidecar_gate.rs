//! Exclusive occupancy of the bundled ffmpeg sidecar: an export session and
//! dashboard thumbnail extraction never spawn it at the same time.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Occupancy {
    export_sessions: u32,
    thumbs: u32,
}

static GATE: Mutex<Occupancy> = Mutex::new(Occupancy { export_sessions: 0, thumbs: 0 });
static CV: Condvar = Condvar::new();

pub fn begin_export_session() {
    let mut g = GATE.lock().unwrap();
    while g.thumbs > 0 {
        g = CV.wait(g).unwrap();
    }
    g.export_sessions += 1;
}

pub fn end_export_session() {
    let mut g = GATE.lock().unwrap();
    g.export_sessions = g.export_sessions.saturating_sub(1);
    CV.notify_all();
}

/// How long a dashboard thumbnail waits for a running export before it is
/// refused. A thumbnail is a convenience: it must never starve behind a request
/// that died without ending its session (a reloaded webview mid-export).
pub const THUMBNAIL_WAIT: Duration = Duration::from_secs(30);

/// Holds the sidecar for one thumbnail extraction. Dropping it — normally, on a
/// cancelled future or on a panic — always releases, so the count cannot leak.
pub struct ThumbnailGuard(());

impl Drop for ThumbnailGuard {
    fn drop(&mut self) {
        let mut g = GATE.lock().unwrap_or_else(|e| e.into_inner());
        g.thumbs = g.thumbs.saturating_sub(1);
        CV.notify_all();
    }
}

/// Waits (bounded) for any export session to end, then takes the sidecar.
/// Blocking: call from a blocking context, not straight from an async task.
pub fn begin_thumbnail_within(wait: Duration) -> Result<ThumbnailGuard, String> {
    let deadline = Instant::now() + wait;
    let mut g = GATE.lock().unwrap_or_else(|e| e.into_inner());
    while g.export_sessions > 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(format!(
                "thumbnail refused: ffmpeg is busy with an export session (waited {} s)",
                wait.as_secs()
            ));
        }
        g = CV.wait_timeout(g, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    g.thumbs += 1;
    Ok(ThumbnailGuard(()))
}

#[cfg(test)]
pub fn reset_for_tests() {
    let mut g = GATE.lock().unwrap();
    g.export_sessions = 0;
    g.thumbs = 0;
    CV.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;

    // The gate is process-global; these tests must not interleave.
    static SERIAL: Mutex<()> = Mutex::new(());

    #[test]
    fn leaked_export_session_refuses_a_thumbnail_instead_of_starving_it() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session(); // a dead request: no end_export_session ever comes
        let t0 = Instant::now();
        let err = begin_thumbnail_within(Duration::from_millis(120)).err().expect("must refuse, not wait forever");
        assert!(err.contains("busy"), "honest reason: {err}");
        assert!(t0.elapsed() >= Duration::from_millis(100) && t0.elapsed() < Duration::from_secs(2));
        reset_for_tests();
    }

    #[test]
    fn thumbnail_guard_releases_on_drop_even_when_the_work_is_abandoned() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        {
            let _g = begin_thumbnail_within(Duration::from_millis(50)).unwrap();
            // dropped without an explicit end (a cancelled/panicked extraction)
        }
        let t0 = Instant::now();
        begin_export_session(); // would block forever if the thumb count leaked
        assert!(t0.elapsed() < Duration::from_millis(500));
        end_export_session();
        reset_for_tests();
    }

    #[test]
    fn export_and_thumbnail_never_hold_ffmpeg_together() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session();
        let started = AtomicBool::new(false);
        thread::scope(|s| {
            s.spawn(|| {
                let _g = begin_thumbnail_within(Duration::from_secs(5)).unwrap();
                started.store(true, Ordering::SeqCst);
            });
            thread::sleep(Duration::from_millis(80));
            assert!(!started.load(Ordering::SeqCst), "thumbnail must wait while an export session holds ffmpeg");
            end_export_session();
        });
        assert!(started.load(Ordering::SeqCst));

        reset_for_tests();
        let thumb = begin_thumbnail_within(Duration::from_secs(5)).unwrap();
        let t0 = Instant::now();
        let started2 = AtomicBool::new(false);
        thread::scope(|s| {
            s.spawn(|| {
                begin_export_session();
                started2.store(true, Ordering::SeqCst);
                end_export_session();
            });
            thread::sleep(Duration::from_millis(80));
            assert!(!started2.load(Ordering::SeqCst), "export must wait while a thumbnail holds ffmpeg");
            drop(thumb);
        });
        assert!(started2.load(Ordering::SeqCst));
        assert!(t0.elapsed() >= Duration::from_millis(80));
        reset_for_tests();
    }
}

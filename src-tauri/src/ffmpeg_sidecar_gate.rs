//! Exclusive occupancy of the bundled ffmpeg sidecar: an export session and
//! dashboard thumbnail extraction never spawn it at the same time.
//!
//! PAIRING CONTRACT. `ffmpeg_create_session` begins a session; retaining it
//! for resume and destroying it end it. `ffmpeg_reenter_session` does NOT
//! begin: a re-entered handle is either a discovery/collector/purge handle
//! that only inspects or deletes, or a resumed run, whose sidecar occupancy is
//! already held by the fresh session every run creates first. Occupancy is
//! therefore the SET of session ids this process began and has not ended, not
//! a bare counter: an end for an id that never began (a re-entered session's
//! destroy) or that already ended (retain, then destroy) changes nothing, so
//! no destroy can open the gate under a live export.

use std::collections::BTreeSet;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

struct Occupancy {
    export_sessions: BTreeSet<String>,
    thumbs: u32,
}

static GATE: Mutex<Occupancy> = Mutex::new(Occupancy { export_sessions: BTreeSet::new(), thumbs: 0 });
static CV: Condvar = Condvar::new();

/// Idempotent per session: a repeat begin for the same id counts once.
pub fn begin_export_session(session_id: &str) {
    let mut g = GATE.lock().unwrap();
    while g.thumbs > 0 {
        g = CV.wait(g).unwrap();
    }
    g.export_sessions.insert(session_id.to_string());
}

/// Ends `session_id` only if this process began it and has not ended it.
pub fn end_export_session(session_id: &str) {
    let mut g = GATE.lock().unwrap();
    if g.export_sessions.remove(session_id) {
        CV.notify_all();
    }
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
    while !g.export_sessions.is_empty() {
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
fn live_export_sessions() -> usize {
    GATE.lock().unwrap().export_sessions.len()
}

#[cfg(test)]
pub fn reset_for_tests() {
    let mut g = GATE.lock().unwrap();
    g.export_sessions.clear();
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
    fn create_then_destroy_balances() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("a");
        assert_eq!(live_export_sessions(), 1);
        end_export_session("a");
        assert_eq!(live_export_sessions(), 0);
        reset_for_tests();
    }

    #[test]
    fn destroy_of_a_session_this_process_never_began_does_not_decrement() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("fresh");
        // reenter never begins; its destroy (a discovery release, the TTL
        // collector, a purge, start-clean) must not end the live export.
        end_export_session("reentered");
        assert_eq!(live_export_sessions(), 1);
        assert!(begin_thumbnail_within(Duration::from_millis(30)).is_err(), "the live export still holds ffmpeg");
        reset_for_tests();
    }

    #[test]
    fn reenter_then_destroy_leaves_the_count_unchanged() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        end_export_session("reentered-only");
        assert_eq!(live_export_sessions(), 0);
        begin_export_session("fresh");
        end_export_session("reentered-only");
        assert_eq!(live_export_sessions(), 1);
        reset_for_tests();
    }

    #[test]
    fn unbalanced_destroys_never_drop_below_the_live_exports() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("a");
        begin_export_session("b");
        // retain then destroy of the same session, and stray destroys.
        end_export_session("a");
        end_export_session("a");
        end_export_session("stray");
        end_export_session("stray");
        assert_eq!(live_export_sessions(), 1, "b is still exporting");
        end_export_session("b");
        assert_eq!(live_export_sessions(), 0);
        reset_for_tests();
    }

    #[test]
    fn a_repeat_begin_for_the_same_session_counts_once() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("a");
        begin_export_session("a");
        end_export_session("a");
        assert_eq!(live_export_sessions(), 0);
        reset_for_tests();
    }

    #[test]
    fn leaked_export_session_refuses_a_thumbnail_instead_of_starving_it() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("dead"); // a dead request: no end_export_session ever comes
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
        begin_export_session("s"); // would block forever if the thumb count leaked
        assert!(t0.elapsed() < Duration::from_millis(500));
        end_export_session("s");
        reset_for_tests();
    }

    #[test]
    fn export_and_thumbnail_never_hold_ffmpeg_together() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        begin_export_session("s");
        let started = AtomicBool::new(false);
        thread::scope(|s| {
            s.spawn(|| {
                let _g = begin_thumbnail_within(Duration::from_secs(5)).unwrap();
                started.store(true, Ordering::SeqCst);
            });
            thread::sleep(Duration::from_millis(80));
            assert!(!started.load(Ordering::SeqCst), "thumbnail must wait while an export session holds ffmpeg");
            end_export_session("s");
        });
        assert!(started.load(Ordering::SeqCst));

        reset_for_tests();
        let thumb = begin_thumbnail_within(Duration::from_secs(5)).unwrap();
        let t0 = Instant::now();
        let started2 = AtomicBool::new(false);
        thread::scope(|s| {
            s.spawn(|| {
                begin_export_session("s2");
                started2.store(true, Ordering::SeqCst);
                end_export_session("s2");
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

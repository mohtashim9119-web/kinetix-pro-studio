//! Exclusive occupancy of the bundled ffmpeg sidecar: an export session and
//! dashboard thumbnail extraction never spawn it at the same time.

use std::sync::{Condvar, Mutex};

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

pub fn begin_thumbnail() {
    let mut g = GATE.lock().unwrap();
    while g.export_sessions > 0 {
        g = CV.wait(g).unwrap();
    }
    g.thumbs += 1;
}

pub fn end_thumbnail() {
    let mut g = GATE.lock().unwrap();
    g.thumbs = g.thumbs.saturating_sub(1);
    CV.notify_all();
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
    use std::time::{Duration, Instant};

    #[test]
    fn export_and_thumbnail_never_hold_ffmpeg_together() {
        reset_for_tests();
        begin_export_session();
        let started = AtomicBool::new(false);
        thread::scope(|s| {
            s.spawn(|| {
                begin_thumbnail();
                started.store(true, Ordering::SeqCst);
                end_thumbnail();
            });
            thread::sleep(Duration::from_millis(80));
            assert!(!started.load(Ordering::SeqCst), "thumbnail must wait while an export session holds ffmpeg");
            end_export_session();
        });
        assert!(started.load(Ordering::SeqCst));

        reset_for_tests();
        begin_thumbnail();
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
            end_thumbnail();
        });
        assert!(started2.load(Ordering::SeqCst));
        assert!(t0.elapsed() >= Duration::from_millis(80));
        reset_for_tests();
    }
}

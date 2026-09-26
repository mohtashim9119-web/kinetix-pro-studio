// ---------------------------------------------------------------------------
// G6 Step 1 — real-file throughput measurement for `sha256::hash_file`, the
// primitive the Media Vault's content-hash registry (Step 2) will run over
// every imported asset. Answers one question before that registry is built:
// is streaming a hand-rolled, hardware-unaccelerated SHA-256 over real media
// fast enough to run synchronously at import time, or does it need to move
// off the import path.
//
// Self-gated, mirroring `fa_durable_wav_live.rs`'s convention: a plain
// `cargo test` sweep compiles this binary and exits immediately without
// touching the filesystem. Needs no Tauri runtime at all (`sha256::hash_file`
// is plain `std::fs`), so unlike `fa_durable_wav_live`/`fa_timing_live` this
// is a `harness = false` binary only to get a bare `main()` timing print, not
// for any real-Wry-runtime requirement. Run it with:
//
//   MEDIA_HASH_THROUGHPUT_FILE=/path/to/a/real/media/file \
//   cargo test --release --test media_hash_throughput_live
//
// `--release` matters: this hand-rolled hasher has no SIMD/hardware-SHA
// acceleration, and a debug build's throughput number would understate what
// production (built `--release`, same as `tauri:build`) actually delivers.
// ---------------------------------------------------------------------------

use app_lib::sha256::hash_file;
use std::time::Instant;

fn main() {
    let Ok(path) = std::env::var("MEDIA_HASH_THROUGHPUT_FILE") else {
        eprintln!(
            "SKIP media_hash_throughput_live: set MEDIA_HASH_THROUGHPUT_FILE=/path/to/a/real/media/file to run"
        );
        return;
    };
    let path = std::path::PathBuf::from(path);
    let size_bytes = std::fs::metadata(&path)
        .unwrap_or_else(|e| panic!("stat {}: {e}", path.display()))
        .len();

    let started = Instant::now();
    let digest = hash_file(&path).unwrap_or_else(|e| panic!("hash_file {}: {e}", path.display()));
    let elapsed = started.elapsed();

    let mb = size_bytes as f64 / (1024.0 * 1024.0);
    let secs = elapsed.as_secs_f64();
    let mb_per_sec = if secs > 0.0 { mb / secs } else { f64::INFINITY };

    println!(
        "media_hash_throughput_live: {} — {:.1} MiB in {:.3}s = {:.1} MiB/s (sha256 {digest})",
        path.display(),
        mb,
        secs,
        mb_per_sec,
    );
}

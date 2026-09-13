# WS3 export baseline reconciliation (Cursor modal rebase vs integration)

> `.cursor/` note only — not part of `docs/`. Prevents the next cloud run from misreading a
> stale delta against CC's last reported gate.

## Vitest total arithmetic

| Anchor | Vitest total (pass / fail / skip = total) | Notes |
|---|---|---|
| CC integration baseline (pre-modal rebase) | **3729** total | CC's last reported figure before modal work landed |
| Cursor modal rebase (misread) | **+49 lane delta** | Rebase arithmetic treated growth as +49 vs 3729 → implied **3778** |
| `ws3-export-integration` @ **`b80ba40`** (2026-09-13) | **3663 / 0 / 78 = 3741** | Measured single-threaded cargo gates on `ws3-docs-baseline`; Vitest matches expected baseline |
| **Corrected delta** | **3741 − 3729 = +12** | Not +49. A cloud run reporting 3741 against a 3729 anchor is **+12**, not a regression from 3778 |

## Branch divergence

| Branch | HEAD | Relationship |
|---|---|---|
| `ws3-export-integration` | `b80ba40` | Integration tip after Round 24a diagnostic logging |
| `ws3-export-modal` (Cursor) | `0bdc8a5` | Modal/docs work; **not** rebased onto `b80ba40` yet |

Do not compare modal-branch gate figures directly to integration @ `b80ba40` without rebasing first.

## Single-threaded cargo gates @ `b80ba40`

- `cargo test --lib -- --test-threads=1`: **360 / 0 / 6 = 366**
- `cargo test --features fa-inference -- --test-threads=1`: **446 / 0 / 36 = 482**

Parallel cargo runs are not a clean gate (whisper LRU flake).

# wip-preserve-2026-08-07.patch — split gzip form

`git lfs` is not installed on the machine that did this (T4, zero-warning push).
The plaintext patch is 75,973,751 bytes — over GitHub's 50MB recommendation.
gzip -9 only gets it to 61,145,796 bytes (still over 50MB): the file is a
`git format-patch` output whose payload is `GIT binary patch` blocks —
already zlib-compressed and base85-encoded, so it re-compresses poorly.

Replaced here with the gzip split into two parts, each under 50MB:

- `wip-preserve-2026-08-07.patch.gz.part-aa` (31,457,280 bytes)
- `wip-preserve-2026-08-07.patch.gz.part-ab` (29,688,516 bytes)

Reassemble and decompress:

```
cat wip-preserve-2026-08-07.patch.gz.part-* | gunzip > wip-preserve-2026-08-07.patch
```

Original plaintext SHA-256: `942b79b4b530e06bca635607c9e3c386d1f201db66ace47fcf9b6c4ec534cd09`
(reassembly verified byte-identical against this before the plaintext was removed.)

The plaintext `.patch` blob is already committed to history at commit
`bb7b0f8` (introduced) and reachable via `a0120f7` (main's HEAD before this
change) — this replacement does not rewrite that history, it only stops the
plaintext form from being tracked at the current tip going forward.

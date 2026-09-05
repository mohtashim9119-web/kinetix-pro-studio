# WS2-49 — Legacy v1 assets store purge (Phase 1 diagnosis)

> **Base SHA:** `eb5e517a0a0e9273060dc25902a409eacc30d00f`  
> **Worktree branch:** `ws2-49-legacy-v1-purge` at `.work-phase4/session-ws2-49-legacy-v1/wt`  
> **Profile measured:** `~/Library/WebKit/app/WebsiteData/Default/...` (tauri:dev origin; disambiguated by FINAL TEST V8 project id)  
> **Verdict:** **PHASE 1 STOP — do not implement purge.** 58 of 266 v1 rows have no v2 counterpart under any matching rule tested; deleting those rows is data loss, not cleanup.

---

## 1. Does migration preserve ids or assign new ones?

**Preserves ids.** The boot migration copies each legacy blob with the same `a.id` into v2:

```2252:2263:src/App.tsx
      const migrated = await migrateLegacyIfNeeded();
      if (migrated) {
        const legacyBlobs = await getLegacyAssets();
        await Promise.all(
          legacyBlobs.map(a =>
            putAsset(migrated.project.id, a.id, a.blob, {
              name: a.name,
              mimeType: a.mimeType,
            }).catch((err: unknown) =>
              console.warn('[kinetix] Migration: failed to copy asset', a.id, err),
            ),
          ),
        );
```

`putAsset` uses the supplied `id` as the v2 compound key's asset half (`assetStore.ts:63-69`). No re-keying occurs on this path.

**Implication of zero id overlap:** If these 266 v1 rows had been copied by this migration on this profile, their ids would appear in v2. Measured id overlap is **0/266**, so these rows were **not** migrated through this path on this profile. They are pre-v2-era writes left in the unscoped `assets` store while v2 assets were later created under **new** ids (re-import / restage), not copies of the v1 keys.

---

## 2. V1 → v2 counterpart measurement (local WebKit profile)

Tools: `scripts/ws2-49-measurement/measure_orphans.py` (row counts) plus a read-only v1↔v2 hash/name/size crosswalk on the same DB (2026-09-05).

| Metric | Count |
|---|---|
| Legacy v1 rows (`assets` store) | **266** |
| Legacy v1 blob bytes | **166.6 MiB** |
| assets-v2 rows (same DB) | 2039 |
| **V1 id ∩ V2 id (same id)** | **0** |
| V1 rows with v2 counterpart (content SHA-256 match) | **208** |
| V1 rows with **no** v2 counterpart (any rule) | **58** |
| V1 ids referenced in any `project.json` `project.assets` | **0** |

Matching rules applied per v1 row (any hit counts as “has counterpart”):

1. **same_id** — v2 row with identical asset id (any project)
2. **content_hash** — v2 blob SHA-256 equals v1 blob SHA-256
3. **name+size** — v2 row with same decoded name and blob byte length
4. **project.assets_ref** — id appears in a persisted project's asset list

Results: **208** matched only via **content_hash** (never same_id, name+size, or project ref). **58** matched nothing.

### 2a. Rows without any v2 counterpart (58) — **data loss if deleted**

| Size bucket | Count | What they appear to be |
|---|---|---|
| 211 bytes | 56 | macOS `com.apple.quarantine` xattr sidecar blobs (Brave download quarantine string visible in raw bytes) — not media |
| 3,807,747 bytes | 1 | Unmatched media blob (`3935f9bb-0976-4172-82c7-0eb77cc4db79`) |
| 4,623,187 bytes | 1 | Unmatched media blob (`e71220a2-5f91-49e8-9f52-7fbbb72296ce`) |

Unmatched bytes total: **~8.44 MiB** (of 166.6 MiB). The two large unmatched rows are unique content with no byte-identical v2 row on this profile.

### 2b. Rows with hash-only v2 counterparts (208)

All 208 hash matches point at v2 rows under project id `5df5050d-f470-4e57-871b-40922f31940e`, which has **no** `project.json` on disk (15 orphaned v2 rows). Counterparts use **different** asset ids than v1 (confirmed: 0 same_id matches). These are duplicate bytes under new keys, not id-preserving migration copies.

### 2c. UI reachability

- **Normal load / project switch** uses `getAllAssetsForProject` (v2 only) — `App.tsx:5926`.
- **`getLegacyAssets` is only called** inside the `migrateLegacyIfNeeded()` boot block (`App.tsx:2254`). It is not used on project open, export, or preview.
- **None** of the 266 v1 ids appear in any live `project.json` asset list on this profile.
- **Conclusion:** v1 rows are not reachable through any current UI path. The 58 without v2 counterparts are nonetheless **unique on-disk bytes** (especially the two ~4 MiB media blobs) and would be lost if deleted without a verified v2 copy.

---

## 3. `getLegacyAssets()` today

```159:174:src/services/assetStore.ts
export function getLegacyAssets(): Promise<LegacyStoredAsset[]> {
  return openAssetDB().then(
    (db) =>
      new Promise<LegacyStoredAsset[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(STORE_V1)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(STORE_V1, 'readonly');
        const req = tx.objectStore(STORE_V1).getAll();
        req.onsuccess = () => resolve(req.result as LegacyStoredAsset[]);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}
```

**Callers:** production — `App.tsx:2254` only (inside one-time localStorage migration). Tests mock it to `async () => []` (`App.teardownFlush.test.tsx`, `App.projectSwitch.test.tsx`, `App.newProjectDefaults.test.tsx`, `App.appSettings.test.tsx`).

**If it returns empty:** the migration block copies zero blobs; no error, no fallback read of v1 on later launches. Runtime asset hydration never consults v1.

**Current code never writes to v1:** `putAsset` targets `STORE_V2` only (`assetStore.ts:73-74`).

---

## 4. Migration frequency and post-purge reappearance

**Trigger:** `migrateLegacyIfNeeded()` reads `localStorage` key `kinetix:project:v1` (`projectStore.ts:725`). If absent, returns `null` immediately — asset copy skipped.

**Once per profile:** on success, `localStorage.removeItem(LEGACY_KEY)` runs (`projectStore.ts:747`), so the localStorage migration **does not run again** on that origin.

**Asset copy coupling:** v1→v2 blob copy runs **only when** the localStorage migration fires in the same boot (`App.tsx:2253-2268`). It is not a separate persisted flag; after `LEGACY_KEY` removal, `getLegacyAssets()` is never invoked again even if v1 rows remain.

**Can v1 rows reappear after purge?**

- Current app: **No write path to v1.** Purge would be stable unless the user runs an older build that still wrote to v1.
- Migration re-copy: **No** — `LEGACY_KEY` is already removed on upgraded profiles; boot will not call `getLegacyAssets()` again.
- **NOT DETERMINED:** whether a user who still has `kinetix:project:v1` in localStorage (never opened app since upgrade) would re-populate v2 from v1 on first launch after a v1-only purge. That scenario needs a fresh-profile test; this dev profile no longer has the legacy key.

**Packaged profile note:** the separate `com.kinetix.pro-studio` WebKit origin holds **5** legacy v1 rows (not 266). Counts are origin-specific.

---

## 5. Automatic vs explicit purge (recommendation — Phase 2 not authorized)

Even when every row has a verified counterpart, **recommend explicit user action** (e.g. App Settings → “Remove legacy asset copies”) rather than silent automatic deletion on migration:

1. **166 MiB is large** and irreversible (no undo; IndexedDB delete is immediate).
2. **Counterpart verification is non-trivial** — this profile shows hash match with **different ids**; id equality is insufficient.
3. **Profile variance** — dev profile 266 rows / packaged origin 5 rows; a measurement on one machine must not gate deletion for all users.
4. **Phase 1 failure mode** — 58/266 rows fail even a liberal hash match; automatic purge would delete ~8.4 MiB of unique content on this profile alone.

If Phase 2 is ever unblocked, runtime must verify **per row** (e.g. SHA-256 of v1 blob equals a specific v2 blob under the owning project) before delete; retain row on any miss.

---

## 6. Phase 2 gate

**Not entered.** Condition “every v1 row has a verified v2 counterpart” is **false** (58/266 fail).

---

## 7. Gates run (Phase 1 stop scope)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | *(run at commit time)* |
| `npm run lint` | *(run at commit time)* |
| vitest | **Not run** (Phase 1 stop; per brief) |
| gaplessInvariant / golden replay / K13 | **Not run** (Phase 1 stop) |

Baseline at eb5e517 (for future Phase 2): vitest 3132 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden replay 6/6; K13 3/3.

---

## 8. NOT DETERMINED

- Exact provenance of the 266 v1 rows (which app version last wrote to v1 on this profile) — inferred pre-v2-era writes, not log-proven.
- Whether `name`/`mimeType` can be reliably decoded from WebKit SerializedScriptValue for all rows (hash matching did not depend on it).
- First-launch behavior on a profile that still has `kinetix:project:v1` after a v1-only purge.
- Counterpart existence on other users' machines (this report is one developer profile only).

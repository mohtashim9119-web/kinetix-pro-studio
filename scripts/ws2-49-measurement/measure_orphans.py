#!/usr/bin/env python3
"""
ws2-49 orphan-classifier baseline measurement.

READ-ONLY. Opens WebKit's SQLite-backed IndexedDB files (and the OS-file
project store) in `mode=ro`, never mutates anything. No file under src/ or
docs/ is touched by this script.

Data sources (all on-disk paths specific to this machine / this app's
bundle id `com.kinetix.pro-studio`):

  - Project JSON (source of truth for project.assets, voiceoverId,
    lastTranscribedAssetId):
      ~/Library/Application Support/com.kinetix.pro-studio/projects/<id>/project.json

  - kinetix-assets IndexedDB (`assets-v2` object store, compound key
    [projectId, id]; legacy `assets` store, keyPath 'id'):
      ~/Library/WebKit/com.kinetix.pro-studio/WebsiteData/Default/<origin>/<origin>/IndexedDB/<hash>/IndexedDB.sqlite3
    identified by IDBDatabaseInfo.DatabaseName == 'kinetix-assets' (UTF-16LE).

  - kinetix-history IndexedDB (`history` store, keyPath 'projectId') and
    kinetix-waveforms IndexedDB (`waveforms` store, compound key
    [projectId, assetId]) - same layout, identified the same way.

Run with:
    python3 measure_orphans.py

Everything below re-derives the origin/hash directories from the DatabaseName
recorded in IDBDatabaseInfo rather than hardcoding the hash strings, so a
future run against a different profile snapshot on the same machine still
finds the right files as long as the WebKit WebsiteData root is unchanged.
"""
import hashlib
import json
import os
import struct
import sqlite3
import sys
import time
from collections import defaultdict

APP_SUPPORT = os.path.expanduser(
    "~/Library/Application Support/com.kinetix.pro-studio"
)
WEBKIT_ROOTS = [
    os.path.expanduser("~/Library/WebKit/com.kinetix.pro-studio/WebsiteData/Default"),
    # `npm run tauri:dev` runs as a raw dev binary with no CFBundleIdentifier
    # set, so WebKit falls back to a generic "app" folder here instead of
    # com.kinetix.pro-studio - discovered empirically in this investigation
    # (this is the origin actually holding FINAL TEST V8's data; the
    # com.kinetix.pro-studio origin is a separate, older packaged-build
    # profile whose kinetix-assets store does not contain V8 at all).
    os.path.expanduser("~/Library/WebKit/app/WebsiteData/Default"),
]

STRING_TAG = 0x60


def decode_string_array_key(key: bytes):
    """See idbkey.py docstring for the format this reverse-engineers."""
    pos = 0
    out = []
    while pos < len(key):
        if key[pos] == STRING_TAG and pos + 5 <= len(key):
            (length,) = struct.unpack_from("<I", key, pos + 1)
            start = pos + 5
            end = start + length * 2
            if end <= len(key) and 0 <= length < 10_000:
                out.append(key[start:end].decode("utf-16-le"))
                pos = end
                continue
        pos += 1
    return out


def find_idb_sqlite_by_dbname(target_name: str):
    """Walk every WEBKIT_ROOTS origin dir, open every IndexedDB.sqlite3
    found, and return the paths whose IDBDatabaseInfo.DatabaseName matches
    target_name (decoded from its stored UTF-16LE bytes). More than one
    match is possible - e.g. a packaged-build profile and a `tauri:dev`
    profile both exist on this machine - so the caller disambiguates by
    evidence (which one actually contains the project id being measured)."""
    matches = []
    for root in WEBKIT_ROOTS:
        for dirpath, dirnames, filenames in os.walk(root):
            if "IndexedDB.sqlite3" in filenames:
                path = os.path.join(dirpath, "IndexedDB.sqlite3")
                try:
                    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                    con.text_factory = bytes
                    cur = con.cursor()
                    cur.execute(
                        "SELECT value FROM IDBDatabaseInfo WHERE key='DatabaseName'"
                    )
                    row = cur.fetchone()
                    con.close()
                    if row and row[0].decode("utf-16-le") == target_name:
                        matches.append(path)
                except sqlite3.Error:
                    continue
    return matches


def db_contains_ascii(db_path, needle: str) -> bool:
    with open(db_path, "rb") as f:
        data = f.read()
    return needle.encode("ascii") in data


def load_projects():
    """Returns {projectId: {name, asset_ids:set, voiceoverId, lastTranscribedAssetId}}"""
    projects = {}
    proj_root = os.path.join(APP_SUPPORT, "projects")
    for pid in os.listdir(proj_root):
        pfile = os.path.join(proj_root, pid, "project.json")
        if not os.path.isfile(pfile):
            continue
        with open(pfile, "r") as f:
            data = json.load(f)
        p = data.get("project", {})
        assets = p.get("assets", [])
        projects[pid] = {
            "name": p.get("name"),
            "asset_ids": {a["id"] for a in assets},
            "voiceoverId": p.get("voiceoverId"),
            "lastTranscribedAssetId": p.get("lastTranscribedAssetId"),
        }
    return projects


def read_assets_v2_rows(db_path):
    """Returns list of dict(recordID, projectId, assetId, value_len)."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = bytes
    cur = con.cursor()
    cur.execute("SELECT id FROM ObjectStoreInfo WHERE name='assets-v2'")
    store_id = cur.fetchone()[0]
    cur.execute(
        "SELECT recordID, key, length(value) FROM Records WHERE objectStoreID=?",
        (store_id,),
    )
    rows = []
    for rid, key, vlen in cur.fetchall():
        pid, aid = decode_string_array_key(key)
        rows.append({"recordID": rid, "projectId": pid, "assetId": aid, "value_len": vlen})
    con.close()
    return rows


def read_legacy_assets_rows(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = bytes
    cur = con.cursor()
    cur.execute("SELECT id FROM ObjectStoreInfo WHERE name='assets'")
    row = cur.fetchone()
    if not row:
        con.close()
        return []
    store_id = row[0]
    cur.execute(
        "SELECT recordID, key FROM Records WHERE objectStoreID=?", (store_id,)
    )
    out = []
    for rid, key in cur.fetchall():
        (aid,) = decode_string_array_key(key)
        out.append({"recordID": rid, "assetId": aid})
    con.close()
    return out


def read_blob_map(db_path):
    """recordID (Records.recordID, i.e. BlobRecords.objectStoreRow) -> blob file path."""
    idb_dir = os.path.dirname(db_path)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()
    cur.execute(
        "SELECT br.objectStoreRow, bf.fileName FROM BlobRecords br "
        "JOIN BlobFiles bf ON br.blobURL = bf.blobURL"
    )
    m = {}
    for record_row, fname in cur.fetchall():
        m[record_row] = os.path.join(idb_dir, fname)
    con.close()
    return m


def read_waveform_pairs(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = bytes
    cur = con.cursor()
    cur.execute("SELECT id FROM ObjectStoreInfo WHERE name='waveforms'")
    store_id = cur.fetchone()[0]
    cur.execute("SELECT key FROM Records WHERE objectStoreID=?", (store_id,))
    pairs = set()
    for (key,) in cur.fetchall():
        pid, aid = decode_string_array_key(key)
        pairs.add((pid, aid))
    con.close()
    return pairs


def read_history_value_sizes(db_path):
    """{projectId: value_byte_length} - a cheap proxy for 'has real persisted
    undo/redo entries' without deserializing JSC's SerializedScriptValue
    format: an empty {past:[],future:[]} record is ~180-220 bytes; a record
    holding actual Project snapshots (segments+assets) is orders of
    magnitude larger. Confirmed empirically against this profile's own data
    (see report)."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = bytes
    cur = con.cursor()
    cur.execute("SELECT id FROM ObjectStoreInfo WHERE name='history'")
    store_id = cur.fetchone()[0]
    cur.execute(
        "SELECT key, length(value), value FROM Records WHERE objectStoreID=?",
        (store_id,),
    )
    out = {}
    raw = {}
    for key, vlen, value in cur.fetchall():
        (pid,) = decode_string_array_key(key)
        out[pid] = vlen
        raw[pid] = value
    con.close()
    return out, raw


def history_value_contains_id(raw_value: bytes, asset_id: str) -> bool:
    """Heuristic substring scan for an asset id inside a history record's
    raw SerializedScriptValue bytes. Verified format: this profile's JSC
    serializer stores plain-ASCII property names/values as single-byte
    Latin1 runs with a 0x80-flagged length tag (see the readable 'projectId'
    / uuid text visible directly in the raw bytes dumped during this
    investigation) - so a plain ASCII substring search is sufficient; no
    UTF-16 encoding of these values was observed in this store."""
    return asset_id.encode("ascii") in raw_value


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main():
    t_start = time.time()

    projects = load_projects()

    assets_db_matches = find_idb_sqlite_by_dbname("kinetix-assets")
    history_db_matches = find_idb_sqlite_by_dbname("kinetix-history")
    waveforms_db_matches = find_idb_sqlite_by_dbname("kinetix-waveforms")

    print(f"kinetix-assets DB(s) found: {assets_db_matches}")
    print(f"kinetix-history DB(s) found: {history_db_matches}")
    print(f"kinetix-waveforms DB(s) found: {waveforms_db_matches}")

    v8_pid_probe = next(
        pid for pid, p in load_projects().items() if p["name"] == "FINAL TEST V8"
    )

    if len(assets_db_matches) > 1:
        print(
            f"NOTE: {len(assets_db_matches)} kinetix-assets DBs exist on this machine "
            f"(a packaged-build profile and a tauri:dev profile both leave one behind). "
            f"Disambiguating by checking which one actually contains V8's project id "
            f"({v8_pid_probe})."
        )
        containing = [p for p in assets_db_matches if db_contains_ascii(p, v8_pid_probe)]
        for p in assets_db_matches:
            print(f"    {p}: contains V8 id = {p in containing}")
        assert len(containing) == 1, f"expected exactly one DB to contain V8; got {containing}"
        assets_db = containing[0]
    else:
        assets_db = assets_db_matches[0]
    print(f"Using kinetix-assets DB: {assets_db}")

    # history/waveforms live in the same origin dir as the chosen assets DB
    assets_origin_dir = os.path.dirname(os.path.dirname(assets_db))
    history_db = next((p for p in history_db_matches if os.path.dirname(os.path.dirname(p)) == assets_origin_dir), None)
    waveforms_db = next((p for p in waveforms_db_matches if os.path.dirname(os.path.dirname(p)) == assets_origin_dir), None)
    print(f"Using kinetix-history DB: {history_db}")
    print(f"Using kinetix-waveforms DB: {waveforms_db}")

    t0 = time.time()
    rows = read_assets_v2_rows(assets_db)
    t_read_rows = time.time() - t0

    legacy_rows = read_legacy_assets_rows(assets_db)

    blob_map = read_blob_map(assets_db)

    waveform_pairs = read_waveform_pairs(waveforms_db) if waveforms_db else set()
    history_sizes, history_raw = (
        read_history_value_sizes(history_db) if history_db else ({}, {})
    )

    # ---- per-project row counts vs referenced counts --------------------
    rows_by_project = defaultdict(list)
    for r in rows:
        rows_by_project[r["projectId"]].append(r)

    print("\n=== Per-project comparison (assets-v2 rows vs project.assets refs) ===")
    all_pids = set(rows_by_project) | set(projects)
    per_project_report = []
    for pid in sorted(all_pids):
        row_list = rows_by_project.get(pid, [])
        row_count = len(row_list)
        proj = projects.get(pid)
        ref_count = len(proj["asset_ids"]) if proj else 0
        name = proj["name"] if proj else "(NO PROJECT.JSON — deleted/unknown project)"
        ratio = (row_count / ref_count) if ref_count else float("inf") if row_count else 0
        per_project_report.append((pid, name, row_count, ref_count, ratio))
        print(f"{pid}  name={name!r:35s} rows={row_count:4d} refs={ref_count:4d} ratio={ratio}")

    # ---- V8 detail --------------------------------------------------------
    v8_name = "FINAL TEST V8"
    v8_pid = next(pid for pid, p in projects.items() if p["name"] == v8_name)
    v8_rows = rows_by_project.get(v8_pid, [])
    v8_row_ids = {r["assetId"] for r in v8_rows}
    v8_ref_ids = projects[v8_pid]["asset_ids"]
    v8_orphan_ids = v8_row_ids - v8_ref_ids
    v8_dup_within_store = len(v8_rows) - len(v8_row_ids)  # should be 0 (unique key)

    print(f"\n=== V8 detail (projectId={v8_pid}) ===")
    print(f"assets-v2 rows for V8:      {len(v8_rows)}")
    print(f"distinct asset ids (rows):  {len(v8_row_ids)}")
    print(f"project.assets references:  {len(v8_ref_ids)}")
    print(f"orphan rows (not referenced): {len(v8_orphan_ids)}")
    print(f"duplicate (projectId,id) rows in store (should be 0 - key is unique): {v8_dup_within_store}")

    # ---- orphan classification ------------------------------------------
    print("\n=== Orphan classification for V8 ===")
    voiceover_id = projects[v8_pid]["voiceoverId"]
    last_transcribed_id = projects[v8_pid]["lastTranscribedAssetId"]
    history_raw_v8 = history_raw.get(v8_pid, b"")
    history_size_v8 = history_sizes.get(v8_pid, 0)

    classification = {"historyPersist": [], "lastTranscribedAssetId": [], "waveformStore": [], "none": []}
    for aid in sorted(v8_orphan_ids):
        reasons = []
        if last_transcribed_id == aid:
            reasons.append("lastTranscribedAssetId")
        if (v8_pid, aid) in waveform_pairs:
            reasons.append("waveformStore")
        if history_raw_v8 and history_value_contains_id(history_raw_v8, aid):
            reasons.append("historyPersist")
        if reasons:
            for r in reasons:
                classification[r].append(aid)
        else:
            classification["none"].append(aid)

    for k, v in classification.items():
        print(f"  {k}: {len(v)}")
    print(f"  (note: voiceoverId {voiceover_id!r} is itself in project.assets refs already, "
          f"so it never appears as an orphan by definition)")
    print(f"  history record size for V8: {history_size_v8} bytes "
          f"({'looks empty' if history_size_v8 < 300 else 'looks NON-EMPTY'})")
    print("  staged voiceover: NOT persisted anywhere on disk per App.tsx's handleVoiceoverStaged "
          "comment ('Mints an in-memory Asset (no IndexedDB write yet)') - structurally unreachable "
          "from any file this script can read; 0 by code inspection, not by absence-of-evidence.")

    # ---- id shape / insertion order / blob size dup check ----------------
    print("\n=== Orphan id shape / blob evidence ===")
    # recordID gives WebKit's own insertion-ordered rowid.
    orphan_records = [r for r in v8_rows if r["assetId"] in v8_orphan_ids]
    ref_records = [r for r in v8_rows if r["assetId"] in v8_ref_ids]
    orphan_recids = sorted(r["recordID"] for r in orphan_records)
    ref_recids = sorted(r["recordID"] for r in ref_records)
    print(f"orphan recordID range: {orphan_recids[:5]}...{orphan_recids[-5:]} (n={len(orphan_recids)})")
    print(f"referenced recordID range: {ref_recids[:5]}...{ref_recids[-5:]} (n={len(ref_recids)})")
    contiguous = orphan_recids == list(range(orphan_recids[0], orphan_recids[0] + len(orphan_recids))) if orphan_recids else None
    print(f"orphan recordIDs form one contiguous block: {contiguous}")

    # blob size + hash comparison: for each orphan, hash its blob; compare
    # against hashes of all REFERENCED V8 assets to detect byte-identical
    # duplicates (upsert cannot cause this - same id overwrites in place -
    # so a match here means two DISTINCT ids point at identical bytes).
    t1 = time.time()
    ref_hash_by_id = {}
    for r in ref_records:
        bp = blob_map.get(r["recordID"])
        if bp and os.path.exists(bp):
            ref_hash_by_id[r["assetId"]] = (sha256_file(bp), os.path.getsize(bp))
    orphan_hash_by_id = {}
    for r in orphan_records:
        bp = blob_map.get(r["recordID"])
        if bp and os.path.exists(bp):
            orphan_hash_by_id[r["assetId"]] = (sha256_file(bp), os.path.getsize(bp))
    t_hash = time.time() - t1

    ref_hash_to_id = defaultdict(list)
    for aid, (h, sz) in ref_hash_by_id.items():
        ref_hash_to_id[h].append(aid)

    byte_identical_to_ref = {}
    for aid, (h, sz) in orphan_hash_by_id.items():
        if h in ref_hash_to_id:
            byte_identical_to_ref[aid] = ref_hash_to_id[h]

    print(f"orphans with a blob byte-identical to some REFERENCED V8 asset: {len(byte_identical_to_ref)} / {len(orphan_hash_by_id)}")
    for aid, matches in list(byte_identical_to_ref.items())[:10]:
        print(f"    orphan {aid} == referenced {matches} (size {orphan_hash_by_id[aid][1]} bytes)")

    # cross-check orphans against each other for internal duplicate content
    orphan_hash_to_ids = defaultdict(list)
    for aid, (h, sz) in orphan_hash_by_id.items():
        orphan_hash_to_ids[h].append(aid)
    internal_dupe_groups = {h: ids for h, ids in orphan_hash_to_ids.items() if len(ids) > 1}
    print(f"orphan-to-orphan byte-identical groups: {len(internal_dupe_groups)}")

    # ---- write-time evidence (blob file mtimes) --------------------------
    print("\n=== Write-time evidence (blob file mtimes, orphan batch vs referenced batch) ===")
    orphan_mtimes = []
    ref_mtimes = []
    for r in orphan_records:
        bp = blob_map.get(r["recordID"])
        if bp and os.path.exists(bp):
            orphan_mtimes.append(os.path.getmtime(bp))
    for r in ref_records:
        bp = blob_map.get(r["recordID"])
        if bp and os.path.exists(bp):
            ref_mtimes.append(os.path.getmtime(bp))
    orphan_mtimes.sort()
    ref_mtimes.sort()
    if orphan_mtimes and ref_mtimes:
        print(f"orphan batch blob mtimes:     {time.ctime(orphan_mtimes[0])}  ..  {time.ctime(orphan_mtimes[-1])}  (n={len(orphan_mtimes)})")
        print(f"referenced batch blob mtimes: {time.ctime(ref_mtimes[0])}  ..  {time.ctime(ref_mtimes[-1])}  (n={len(ref_mtimes)})")

    # ---- legacy (pre-v2, unscoped) store — separate orphan pool ----------
    print(f"\n=== Legacy 'assets' store (keyPath 'id', no projectId — pre-migration leftovers) ===")
    print(f"legacy store row count: {len(legacy_rows)} (cannot be attributed to V8 or any project without "
          f"decoding the value blob for a 'projectId'-shaped field, since the legacy schema never carried one)")

    # ---- full-store hash cost (what a real cleanup pass would pay) -------
    idb_dir = os.path.dirname(assets_db)
    all_blob_files = [f for f in os.listdir(idb_dir) if f.endswith(".blob")]
    t2 = time.time()
    total_bytes = 0
    for fn in all_blob_files:
        with open(os.path.join(idb_dir, fn), "rb") as fh:
            while True:
                b = fh.read(1 << 20)
                if not b:
                    break
                total_bytes += len(b)
    t_full_store_read = time.time() - t2

    total_time = time.time() - t_start
    print("\n=== Cost ===")
    print(f"decode all {len(rows)} assets-v2 keys (key-only, no blob I/O):        {t_read_rows:.3f}s")
    print(f"hash {len(ref_hash_by_id)+len(orphan_hash_by_id)} V8-only blob files (full read+sha256):    {t_hash:.3f}s")
    print(f"full-store blob read (ALL {len(all_blob_files)} files, {total_bytes/1e6:.0f} MB, no hashing): {t_full_store_read:.3f}s "
          f"({total_bytes/1e6/t_full_store_read:.0f} MB/s)")
    print(f"total wall time for this script:                                      {total_time:.3f}s")

    # dump machine-readable summary for the report to quote exactly
    summary = {
        "v8_project_id": v8_pid,
        "v8_assets_v2_row_count": len(v8_rows),
        "v8_distinct_referenced_assets": len(v8_ref_ids),
        "v8_orphan_count": len(v8_orphan_ids),
        "v8_ratio": len(v8_rows) / len(v8_ref_ids) if v8_ref_ids else None,
        "orphan_classification_counts": {k: len(v) for k, v in classification.items()},
        "orphans_byte_identical_to_referenced": len(byte_identical_to_ref),
        "orphan_internal_dupe_groups": len(internal_dupe_groups),
        "per_project": [
            {"projectId": pid, "name": name, "rows": rc, "refs": rf, "ratio": ratio}
            for pid, name, rc, rf, ratio in per_project_report
        ],
        "legacy_v1_store_row_count": len(legacy_rows),
        "orphan_batch_mtime_range": [time.ctime(orphan_mtimes[0]), time.ctime(orphan_mtimes[-1])] if orphan_mtimes else None,
        "referenced_batch_mtime_range": [time.ctime(ref_mtimes[0]), time.ctime(ref_mtimes[-1])] if ref_mtimes else None,
        "cost_seconds": {
            "decode_all_keys": t_read_rows,
            "hash_v8_blobs": t_hash,
            "full_store_blob_read_no_hash": t_full_store_read,
            "full_store_bytes": total_bytes,
            "total": total_time,
        },
        "assets_db_used": assets_db,
        "history_db_used": history_db,
        "waveforms_db_used": waveforms_db,
    }
    out_path = os.path.join(os.path.dirname(__file__), "measurement_result.json")
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nWrote machine-readable summary to {out_path}")


if __name__ == "__main__":
    main()

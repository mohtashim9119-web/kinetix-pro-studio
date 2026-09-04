# WS2-49 IndexedDB orphan measurement scripts

Read-only audit tooling for the dev-profile IDB orphan investigation (WS2 session ws2-49).
These scripts open WebKit SQLite IndexedDB files and the OS project store in `mode=ro`.

- `measure_orphans.py` — full orphan-classifier baseline measurement
- `idbkey.py` — WebKit IDBKeyData decoder for compound `[projectId, id]` keys

Run from repo root:

```bash
python3 scripts/ws2-49-measurement/measure_orphans.py
```

Requires a local Tauri dev or packaged profile with Kinetix data under
`~/Library/Application Support/com.kinetix.pro-studio` and WebKit WebsiteData.

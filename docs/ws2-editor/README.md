# WS2 — Editor / Timeline

Timeline drag-resize, gapless segment cascade, and WKWebView pointer-event quirks on
macOS.

**Current state:** WS2 closed for code; drag behavior is regression-locked by unit tests
and a standing manual checklist. Run the checklist before any release and after changes
to `dragSession.ts`, `dragCascade.ts`, `dragGeometry.ts`, or timeline CSS.

## Living docs

| Doc | Purpose |
|---|---|
| [`wkwebview-drag-checklist.md`](wkwebview-drag-checklist.md) | Standing manual QA procedure (10+ numbered steps) |

## Archived history

Checklist run history and closed drag investigations → [`docs/history.md`](../history.md)
("WKWebView Drag Checklist" section).

# Drag-Path Testability — Assessment and Recommendation

> **Status: AWAITING OWNER RULING. Design only — no code written, no commit made.**
> Written 2026-08-07, at HEAD `0e2ac5b`, working tree clean apart from the
> `package.json` test-gate change reported in Part 1.
>
> Companion to `docs/segments-invariant-ruling.md`.

---

## 1. The gap, stated precisely

No test in this repository mounts a React component. There is no `jsdom`, no
`happy-dom`, no `@testing-library/*`, no `react-test-renderer` in `package.json`.

Consequently the entire interactive drag path has **never been executed by any
test, and cannot be** in the current setup:

- `App.tsx`'s `onResizeStart` closure (lines ~3900–4095)
- `applyFrame` and the `requestAnimationFrame` loop
- every `el.style.left` / `el.style.width` write
- `handleUp`'s commit/revert branching
- pointer capture, `pointercancel`, the ghost-click swallow

Five test files import from `App.tsx`, but only pure exports
(`parseProjectData`, `evaluateCoverageGate`, `filterToCoveredSegments`, message
constants). They cause the module body to execute — which is why K17's broken
identifier still slipped through — but never render the component.

**This is the reason four commits were believed working while the app was
broken.** One half of that gap (type errors passing the suite) is now closed by
the `npm test` gate from Part 1, at zero cost. This document is about the other
half.

---

## 2. Two routes

### Route 1 — Full component mount
`jsdom` + `@testing-library/react` + `@testing-library/user-event`; render
`<App />`; drive real events.

**Mocking surface required** — measured across non-test files in `src/`:

| API family | Files touching it | Notes |
|---|---|---|
| `VideoDecoder`/WebCodecs | 13 | Absent in jsdom entirely |
| `localStorage` | 11 | jsdom provides |
| `createObjectURL` | 8 | Needs stubbing |
| `getBoundingClientRect` | 6 | jsdom returns **all zeros** — see §4.1 |
| `AudioContext` | 4 | Absent |
| `ResizeObserver` | 4 | Absent |
| `requestAnimationFrame` | 4 | jsdom shims via `setTimeout` |
| `__TAURI__` IPC | 3 | Absent |
| `indexedDB` | 2 | `fake-indexeddb` is *already* a devDependency ✓ |

Plus a WebGL2 context for `PreviewStage` → `useGlPreview`, which `<App />` mounts
unconditionally. `App.tsx` is **4,722 lines**.

**Cost: multiple days, high ongoing fragility.** Every future feature touching a
new browser API breaks the mount. My assessment: **not worth it.**

### Route 2 — Extract the drag session, then test it ⭐
Move the `onResizeStart` closure out of JSX into a module — e.g.
`services/dragSession.ts` — that receives its DOM dependencies by injection
(an element-lookup function, a `pixelsPerSecond` value, a rect origin, a commit
callback) and returns `{ onPointerMove, onPointerUp, onPointerCancel }`.

Then test it with `jsdom` supplying real `HTMLElement`s and real `style` objects,
driving it with hand-constructed pointer positions.

**Dependencies:** `jsdom` only (via vitest's `environment: 'jsdom'` set
**per-file** with a docblock, so the existing 55 node-environment files —
including the `fake-indexeddb` ones — are untouched). Optionally
`@testing-library/dom`; not required.

**Cost: roughly half a day to a day**, the bulk of which is the extraction
refactor, not the tests.

**Independent benefit:** the extraction is something `CLAUDE.md` already
mandates — *"Do not add features to App.tsx as a monolith — extract first, then
add"* — and the drag session is one of the last large behavioural closures still
embedded in JSX. This work is owed regardless of testing.

---

## 3. What a Route 2 harness would have caught

Assessed per failure, honestly, including the ones it does nothing for.

| # | Failure | Caught? | Why |
|---|---|---|---|
| **F1** | K17: `liveEls` undefined → `ReferenceError` every drag frame | **Already caught** — by the Part 1 `tsc` gate, at zero cost. Route 2 would also catch it (throws on first frame), but redundantly. | — |
| **F2** | K16 fault 3: start-edge drag wrote only `style.width`, moving the wrong edge | **YES** | Pure DOM-write readback: assert `style.left` changed on a start-edge drag. No layout needed. |
| **F3** | **Frozen neighbour → overlap during drag → snap on release** | **YES — the strongest case for building this** | Assert: after a frame growing A by *X*, B's `style.left` moved by *X*. Reads back styles the code itself wrote; no layout engine involved. |
| **F4** | K16 fault 1: the stale **24px** container-origin constant | **NO — and this matters** | See §4.1. jsdom has no layout engine. The test author must stub `rect.left`, so the `-24` gets baked into the expected value. A test written against the buggy code passes. |
| **F5** | K16 fault 2: missing grab offset | **Partial** | Expressible as a logic property against stubbed geometry ("edge preserves initial offset"), so it works as a *regression lock*. It would not have been *discovered* this way — you must already suspect it. |
| **F6** | K15a gap collapse | Already caught | `dragCascade.test.ts`, pure unit tests. No harness needed. |
| **F7** | K14 lock-toggle propagation | Already caught | `phase4-step-aa-unlock-repro.test.ts`. No harness needed. |
| **F8** | Uncommitted `dragCascade.ts` multi-hop semantic change passing all 20 existing tests | **NO** | A pure-logic coverage gap. The fix is more *unit* tests, not a DOM harness. Worth stating: a harness is not the answer to every gap here. |
| **F9** | Export desync from a gap (`segments-invariant-ruling.md` §1.3) | **NO** | Needs the invariant assertion from that document, or an export-level integration test. Far cheaper there. |

**Tally: 2 of 9 caught by the harness alone** (F2, F3), plus F5 as a regression
lock. Three were already covered more cheaply (F1, F6, F7); three are outside its
reach entirely (F4, F8, F9).

**But F3 is the bug you are actually chasing**, and nothing else in the toolchain
can catch it. That, not the count, is the argument.

---

## 4. What it would still miss — the honest limits

You asked to know the ceiling rather than discover it later. This is it.

### 4.1 No layout engine — the most important limit
`jsdom` and `happy-dom` implement the DOM API, **not CSS layout**.
`getBoundingClientRect()` returns all zeros. `offsetWidth`, `clientWidth`,
`getComputedStyle().paddingLeft` return zeros or defaults.

So every geometric fact must be **stubbed by the test author** — which means the
harness can only ever confirm that the code is self-consistent with the numbers
the test itself supplied. **Any constant-offset bug is structurally invisible.**
The 24px error was found by measuring the *real* container's computed padding in
a *real* browser. No headless DOM can find its successor.

### 4.2 Not WKWebView
This project has already been burned once, concretely: the WebKit bug where
`overflow:hidden` + `border-radius` + a `transform`-using child hides descendant
content — the one that rendered timeline cards fully black, documented in
`Timeline.tsx`'s lane-border-as-overlay workaround. **A jsdom harness would never
have found that**, and would not find its equivalent in pointer capture or
`touchAction` handling.

### 4.3 `requestAnimationFrame` is a `setTimeout` shim
Frame coalescing under a real flood of `pointermove` events is not reproduced.
The harness can verify *what* a frame writes; it cannot verify *how many* frames
run or whether any are dropped.

### 4.4 No compositor, no paint
Perceived smoothness, jank, dropped frames, and "the edge lags my pointer" are
unmeasurable. Nothing in a headless DOM speaks to feel.

### 4.5 Synthetic `PointerEvent` ≠ a real pointer
No implicit capture semantics, no coalesced or predicted events, no OS gesture
takeover firing `pointercancel`, no touch/pen paths, no high-frequency input.

### 4.6 React 19 concurrent batching may differ under test
Update timing in a test environment is not guaranteed to match the real app.

### 4.7 The reframing that matters most

**The K16 live check already ran in a real browser with real synthetic
`PointerEvent`s — strictly higher fidelity than jsdom — and still missed the
frozen neighbour.** Not because of fidelity, but because of what it asserted: it
observed the motionless neighbour and recorded it as *"the untouched neighbour
proving K15 locality holds."*

**Fidelity was never the binding constraint. The assertion was.**

The value of this harness is therefore **not** that it runs closer to the metal —
it runs *further* from it than the K16 check did. Its value is that it makes the
right assertions permanent and automatic, so they cannot be forgotten, reframed,
or scored as a success on the next pass. That is a real and sufficient
justification, but it is a different one from "more realistic," and it should be
bought for the right reason.

---

## 5. Recommendation

> ### ⭐ RECOMMENDATION: Build **Route 2**, **alongside** the invariant migration
> — specifically at step 5 of `segments-invariant-ruling.md` §6.1 — **not before
> it.** Do not build Route 1. Pair it with a short manual WKWebView checklist.

**Why alongside rather than before.** The harness's central assertion — *"every
segment the cascade touches moves in the same frame"* — is exactly the acceptance
test for the drag-preview fix. But **its correct form depends on the ruling**:
under Model P a shrink must close the space in the same frame, while under
Model S a shrink may legitimately open a visible gap (§4.4 of the ruling
document). Writing the assertion first risks permanently encoding the wrong
semantics — the same error, in miniature, that produced this whole situation.
Written alongside, the migration gets its regression lock for free and the lock
encodes what was actually ruled.

**Why not before.** The two highest-value gaps are already closed or cheaper
elsewhere: type errors by the Part 1 gate (done), and the export/gap invariant by
a dev-time assertion (ruling document, step 1). Neither needs a DOM.

**Why not Route 1.** Nine API families across 13+ files, a 4,722-line component,
and permanent fragility, for a small increment over Route 2.

**The manual complement — not an afterthought.** §4.1–4.6 describe real classes
no harness reaches. They need a short, written, repeatable WKWebView checklist
run in the packaged app: drag both edges at three zoom levels; confirm the edge
sits under the pointer; confirm the neighbour moves during the gesture; confirm
nothing jumps on release; drag off the window edge and back. Five minutes,
catches precisely what the harness cannot. This project's strongest results —
the 96.2% boundary verification, the Spanish scoring — all came from exactly this
kind of disciplined manual pass, and the drag path deserves the same.

---

## 6. What I need from you

1. **Approve or reject Route 2**, and the "alongside, not before" sequencing.
2. **Confirm Route 1 is off the table** (my recommendation), or say otherwise.
3. **Approve the manual WKWebView checklist** as a standing complement.

Nothing here is built. No dependency has been added.

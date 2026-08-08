/**
 * WS2 task 2 — the Route 2 drag-path test harness
 * (`docs/drag-path-testability-assessment.md`, §2 "Route 2 — Extract the drag
 * session, then test it").
 *
 * `dragSession.ts`'s `startDragSession` reaches the real DOM directly
 * (`document.getElementById`, `querySelectorAll`, `window.addEventListener`,
 * bare `requestAnimationFrame`) rather than through injected accessors — only
 * the React-state half of its dependencies is injectable
 * (`DragSessionDeps`). So this harness cannot intercept those calls with a
 * duck-typed fake (the approach `dragSession.test.ts`'s PART 1 uses for the
 * pre-extraction reference transcription); it must run inside a REAL jsdom
 * `document`/`window` — every test file that imports this harness needs a
 * leading `// @vitest-environment jsdom` docblock, opting that one file out
 * of the repo's default node environment.
 *
 * This class builds the DOM `startDragSession` expects (`#timeline-scroll-area`
 * plus one or more `[data-seg-id]` elements per segment, matching the real
 * Timeline's thumbnail + waveform lanes), stubs the two things jsdom
 * structurally cannot provide — `getBoundingClientRect` (jsdom has no layout
 * engine; every geometric fact is supplied by the test, exactly as
 * `drag-path-testability-assessment.md` §4.1 documents as this route's
 * ceiling) and `requestAnimationFrame` (replaced with a manually-flushed
 * stub so a test can assert the DOM state after each individual frame,
 * rather than guessing at real timer/rAF interleaving) — and implements
 * `DragSessionDeps` by holding the segment array as harness state, with
 * `commitDurationChange` calling the SAME `computeDragCascade` the real
 * `App.tsx`'s `applyDurationChange` calls (not a re-implementation of it).
 *
 * A drag GESTURE is expressed as a chain of intentions, not raw pointer
 * coordinates:
 *
 *   const harness = new DragSessionHarness(segments);
 *   harness.grab('B', 'end').moveBy(2).moveBy(1).release();
 *
 * `grab` computes the real down-position at the segment's own edge (offset
 * zero — the test can pass a non-zero `grabOffsetSeconds` to exercise K16's
 * grab-offset preservation); `moveBy(deltaSeconds)` advances the simulated
 * pointer and flushes exactly one animation frame, so the harness's DOM can
 * be inspected between moves; `release`/`cancel` dispatch the corresponding
 * window event and resolve to the same four-way outcome
 * `dragSession.test.ts`'s reference `CommitOutcome` type already names.
 */

import { afterEach } from 'vitest';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { startDragSession, type DragSessionDeps } from './dragSession';
import { computeDragCascade } from './dragCascade';
import { segmentEdgeContentX, type DragEdge } from './dragGeometry';

/**
 * Every harness constructed since the last test boundary. Populated by the
 * constructor, drained by the universal post-condition below. This module is
 * imported ONLY by test files (verified: `dragTriage.test.ts` and
 * `dragSessionHarness.test.ts`; nothing in the app's import graph reaches it),
 * which is what makes the top-level `afterEach` import legitimate here.
 */
const harnessRegistry: DragSessionHarness[] = [];
let harnessSeq = 0;

/**
 * THE UNIVERSAL POST-CONDITION (WS2 re-scope, 2026-08-08).
 *
 * Registered at module scope, so it runs after EVERY test in EVERY file that
 * imports this harness — there is no per-test opt-in, and no way to use the
 * harness without it. That is the point. Manual checklist step 10 found a
 * `pointercancel` leaving two pieces of state dirty (an armed ghost-click
 * swallower and a stale speed baseline) while the harness's own pointercancel
 * test passed, because that test asserted on the resulting SEGMENT ARRAY and
 * never on teardown. A green suite that cannot see leaked listeners is not
 * evidence of a clean teardown; this closes that gap by construction.
 *
 * HOOK-ORDER SAFETY: vitest runs `afterEach` hooks in reverse registration
 * order, so a test file's own `afterEach(() => harness.dispose())` — registered
 * later, at file evaluation — runs BEFORE this one. `dispose()` clears the very
 * state being audited (notably the `resizing` body class), so checking here
 * would read a cleaned-up world and pass vacuously. `dispose()` therefore
 * SNAPSHOTS its residue before cleaning, and this hook reads that snapshot.
 * Correct regardless of which hook wins.
 */
afterEach(() => {
  const failures: string[] = [];
  // Reverse order: harnesses stack their global patches (rAF, window listener
  // pair) at construction, so they must be unwound LIFO for the restore chain
  // to be correct when two are alive at once.
  for (let i = harnessRegistry.length - 1; i >= 0; i--) {
    const harness = harnessRegistry[i]!;
    const residue = harness.collectResidueAndDispose();
    if (residue.length > 0) {
      failures.push(`${harness.harnessLabel}:\n      - ${residue.join('\n      - ')}`);
    }
  }
  harnessRegistry.length = 0;
  if (failures.length > 0) {
    throw new Error(
      'DragSessionHarness universal post-condition FAILED — the drag session left residue ' +
      'after this test:\n    ' + failures.join('\n    ') +
      '\n\n  This hook audits teardown, not behaviour: a test can assert the right segment ' +
      'array and still leak listeners or session state (manual checklist step 10). If the ' +
      'residue is deliberate and pinned by this test, declare it with ' +
      '`harness.acknowledgeKnownResidue(reason)` rather than suppressing this hook.',
    );
  }
});

export interface DragHarnessConfig {
  /** Timeline zoom. Defaults to 100 px/s, matching every existing drag test. */
  pixelsPerSecond?: number;
  assets?: Asset[];
  transcriptTokens?: TranscriptToken[];
  /** Simulated `#timeline-scroll-area`'s `getBoundingClientRect().left`. */
  rectLeft?: number;
  /** Simulated `#timeline-scroll-area`'s `scrollLeft`. */
  scrollLeft?: number;
  /** DOM elements mounted per segment id. The real Timeline tags both its
   *  thumbnail-lane cell and its waveform-lane cell with the same
   *  `data-seg-id` (2); default matches that. */
  elementsPerSegment?: number;
  /** Segment ids to deliberately leave un-mounted — characterizes
   *  `writeGeometry`'s defensive `if (!els) continue;` guard for a segment
   *  present in the array but not (yet) rendered in the DOM. */
  unmountedIds?: string[];
  /** Simulated `#timeline-scroll-area`'s `clientWidth` — the visible viewport.
   *  jsdom reports 0 (no layout engine), which disables edge auto-scroll
   *  entirely, so a step-9 test must supply this. */
  viewportWidth?: number;
  /** Simulated `#timeline-scroll-area`'s `scrollWidth` — the full content
   *  extent. `scrollWidth - clientWidth` is the scroll range auto-scroll
   *  clamps against; leaving it at jsdom's 0 pins `scrollLeft` at 0. */
  scrollWidth?: number;
}

/** Mirrors `dragSession.test.ts`'s reference `CommitOutcome`, historically —
 *  that file transcribes PRE-F7 `App.tsx` and still names `'reverted-negligible'`
 *  as one of its four outcomes. The real session can no longer reach it (F7,
 *  2026-08-08 owner ruling — the negligible-drag threshold is withdrawn, so a
 *  drag that moved always reaches `commitDurationChange`); kept here anyway so
 *  a caller pattern-matching on `DragOutcomeKind` gets an exhaustiveness error
 *  instead of silent undefined behaviour if it's ever reintroduced, and so
 *  this type continues to name every outcome the historical reference does. */
export type DragOutcomeKind =
  | 'no-op-not-moved'
  | 'reverted-negligible'
  | 'reverted-blocked'
  | 'reverted-cancelled'
  | 'committed';

export interface DragOutcome {
  kind: DragOutcomeKind;
  /** Segment ids `onLockedBlock` was called with, in call order (empty
   *  unless `kind === 'reverted-blocked'`). */
  blockedIds: string[];
  /** The harness's segment array after this gesture resolved. */
  segments: VideoSegment[];
}

/** One mounted `[data-seg-id]` element's read-back live geometry, or `null`
 *  if this frame never wrote to it (matches `writeGeometry`'s own
 *  diff-and-skip — an untouched segment keeps its ORIGINAL geometry, which
 *  the caller already has). */
export interface LiveGeometry {
  leftPx: number | null;
  widthPx: number | null;
}

export class DragSessionHarness {
  readonly pixelsPerSecond: number;
  private assets: Asset[];
  private transcriptTokens: TranscriptToken[] | undefined;
  private readonly rectLeft: number;
  private readonly timeline: HTMLDivElement;
  private readonly elsBySegId = new Map<string, HTMLElement[]>();
  private segments: VideoSegment[];

  private resizingId: string | null = null;
  private resizingType: DragEdge | null = null;
  private isResizingFlag = false;
  private speedBaselineCleared = false;

  private rafCallback: FrameRequestCallback | null = null;
  private rafHandle = 0;
  private readonly prevRaf: typeof requestAnimationFrame;
  private readonly prevCancelRaf: typeof cancelAnimationFrame;

  // --- universal post-condition instrumentation (see the module-level hook) ---
  readonly harnessLabel: string;
  private readonly prevAddListener: typeof window.addEventListener;
  private readonly prevRemoveListener: typeof window.removeEventListener;
  /** Window listeners added but not yet removed, in add order. A pointer-event
   *  listener surviving a resolved gesture is a leak; a `click` one is the
   *  ghost-click swallower and is expected exactly `expectedSwallowers` times. */
  private readonly liveListeners: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject | null;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  /** Net setPointerCapture-minus-releasePointerCapture across this harness's
   *  elements. `startDragSession` never captures today (the real app captures
   *  on the Timeline HANDLE, in `Timeline.tsx`, which this harness does not
   *  mount) — so this check is VACUOUS for the current code path, and is here
   *  to fail loudly if capture is ever moved into the session without a
   *  matching release. Counted, not inferred: jsdom's `hasPointerCapture`
   *  cannot be queried without a pointerId, and the harness dispatches
   *  MouseEvents that carry none. */
  private capturesOutstanding = 0;

  // --- deterministic frame clock for edge auto-scroll (checklist step 9) ---
  /** Live backing field behind the timeline's `scrollLeft` accessor. */
  private scrollLeftValue = 0;
  private readonly autoScrollFrames = new Map<number, (timeMs: number) => void>();
  private autoScrollSeq = 0;
  private virtualNowMs = 0;

  private movedThisGesture = false;
  private expectedSwallowers = 0;
  private acknowledgedResidue: string | null = null;
  private residueSnapshot: string[] | null = null;

  private currentClientX = 0;
  private commitAttempted = false;
  private reverted = false;
  private blockedIds: string[] = [];
  private disposed = false;
  /** Set by `cancel()` for the CURRENT gesture only, reset on every `grab()` —
   *  distinguishes a `reverted-cancelled` outcome (ruled 2026-08-08: a
   *  pointercancel discards) from `reverted-blocked` (a locked segment refused
   *  the drag), the other case that resolves through `revertSegments` with
   *  `commitAttempted` never having been set. Before the F7 ruling withdrew
   *  the negligible-drag threshold, an ordinary sub-threshold RELEASE also
   *  reverted this way — that third case can no longer happen: a drag that
   *  moved always reaches `commitDurationChange` now (see `dragSession.ts`'s
   *  `handleUp`), so `reverted && !commitAttempted` is unambiguous without
   *  this flag for that case. It survives only to name the cancel case. */
  private cancelledThisGesture = false;

  constructor(initialSegments: VideoSegment[], config: DragHarnessConfig = {}) {
    this.segments = initialSegments;
    this.pixelsPerSecond = config.pixelsPerSecond ?? 100;
    this.assets = config.assets ?? [];
    this.transcriptTokens = config.transcriptTokens;
    this.rectLeft = config.rectLeft ?? 0;

    this.timeline = document.createElement('div');
    this.timeline.id = 'timeline-scroll-area';
    // jsdom has no layout engine — getBoundingClientRect() is all zeros by
    // construction (assessment §4.1). Stubbed here, supplied by the test.
    this.timeline.getBoundingClientRect = () => ({
      left: this.rectLeft, right: this.rectLeft, top: 0, bottom: 0,
      width: 0, height: 0, x: this.rectLeft, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    // jsdom's scrollLeft/clientWidth/scrollWidth are all layout-derived and
    // therefore inert (scrollLeft silently refuses writes, the other two are
    // permanently 0). Backed by real fields here so the auto-scroll loop has a
    // scroll range to move within and a viewport to measure against — supplied
    // by the test, exactly like getBoundingClientRect above.
    this.scrollLeftValue = config.scrollLeft ?? 0;
    Object.defineProperty(this.timeline, 'scrollLeft', {
      configurable: true,
      get: () => this.scrollLeftValue,
      set: (v: number) => { this.scrollLeftValue = v; },
    });
    Object.defineProperty(this.timeline, 'clientWidth', {
      configurable: true,
      get: () => config.viewportWidth ?? 0,
    });
    Object.defineProperty(this.timeline, 'scrollWidth', {
      configurable: true,
      get: () => config.scrollWidth ?? 0,
    });
    this.instrumentPointerCapture(this.timeline);
    document.body.appendChild(this.timeline);

    const perSeg = config.elementsPerSegment ?? 2;
    const unmounted = new Set(config.unmountedIds ?? []);
    for (const s of initialSegments) {
      if (unmounted.has(s.id)) continue;
      this.mountElementsFor(s.id, perSeg);
    }

    // Purpose-built rAF stub (assessment §4.3: "rAF is a setTimeout shim" —
    // real frame coalescing under a flood of pointermove is not
    // reproducible in jsdom regardless; this makes that limit an explicit,
    // manually-driven one instead of an implicit timer race). `dragSession.ts`
    // calls the BARE `requestAnimationFrame`/`cancelAnimationFrame`
    // identifiers, which resolve through `globalThis` — overriding it here
    // is what the module actually observes.
    this.prevRaf = globalThis.requestAnimationFrame;
    this.prevCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      this.rafCallback = cb;
      return ++this.rafHandle;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number): void => {
      if (handle === this.rafHandle) this.rafCallback = null;
    }) as typeof cancelAnimationFrame;

    // Window listener bookkeeping for the universal post-condition. Wrapping
    // rather than counting after the fact, because the question is not "how
    // many listeners exist" (jsdom exposes no registry) but "did every add get
    // a matching remove" — which only the call pairs can answer.
    this.harnessLabel = `harness#${++harnessSeq} [${initialSegments.map(s => s.id).join(',')}]`;
    this.prevAddListener = window.addEventListener.bind(window);
    this.prevRemoveListener = window.removeEventListener.bind(window);
    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      this.liveListeners.push({ type, listener, options });
      this.prevAddListener(type, listener as EventListener, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void => {
      const idx = this.liveListeners.findIndex(l => l.type === type && l.listener === listener);
      if (idx >= 0) this.liveListeners.splice(idx, 1);
      this.prevRemoveListener(type, listener as EventListener, options);
    }) as typeof window.removeEventListener;

    harnessRegistry.push(this);
  }

  private mountElementsFor(segId: string, count: number): void {
    const els: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.dataset.segId = segId;
      this.instrumentPointerCapture(el);
      this.timeline.appendChild(el);
      els.push(el);
    }
    this.elsBySegId.set(segId, els);
  }

  /** See `capturesOutstanding` — jsdom does not implement the pointer-capture
   *  pair on HTMLElement, so these are defined rather than wrapped. */
  private instrumentPointerCapture(el: HTMLElement): void {
    el.setPointerCapture = (): void => { this.capturesOutstanding++; };
    el.releasePointerCapture = (): void => { this.capturesOutstanding--; };
  }

  /** Mounts an extra `[data-seg-id]`-less element into the timeline, to
   *  characterize the real `querySelectorAll('[data-seg-id]')` selector's
   *  own filtering (an element with no attribute is never even selected —
   *  the pre-extraction reference test simulated this by hand; here it is
   *  the real DOM query doing the filtering). */
  mountElementWithNoSegId(): void {
    this.timeline.appendChild(document.createElement('div'));
  }

  private deps(): DragSessionDeps {
    return {
      getSegments: () => this.segments,
      getPixelsPerSecond: () => this.pixelsPerSecond,
      getAssets: () => this.assets,
      getTranscriptTokens: () => this.transcriptTokens,
      setResizingId: (id) => { this.resizingId = id; },
      setResizingType: (type) => { this.resizingType = type; },
      setIsResizing: (value) => { this.isResizingFlag = value; },
      clearSpeedBaseline: () => { this.speedBaselineCleared = true; },
      commitDurationChange: (originalSegments, segmentId, newDuration, finalTrimStart, fromSide, additionalUpdates, options) => {
        this.commitAttempted = true;
        const draggedIdx = originalSegments.findIndex(s => s.id === segmentId);
        const blocked: string[] = [];
        const result = computeDragCascade(
          originalSegments,
          draggedIdx,
          newDuration,
          finalTrimStart,
          fromSide,
          (_segIdx, segId) => blocked.push(segId),
          this.transcriptTokens,
          // Forwarded, not dropped (owner ruling 2026-08-08). `App.tsx`'s real
          // `applyDurationChange` forwards this param, so a harness that
          // swallowed it would run the drag path under the playback-speed
          // slider's semantics — silently, and precisely at the tail index the
          // ruling is about. The harness's entire value is that its commit is
          // the same call the app makes.
          options,
        );
        if (result === null) {
          this.blockedIds = blocked;
          return false;
        }
        this.segments = additionalUpdates
          ? result.map(s => s.id === segmentId ? { ...s, ...additionalUpdates } : s)
          : result;
        return true;
      },
      revertSegments: (originalSegments) => {
        this.reverted = true;
        this.segments = originalSegments;
      },
      // Auto-scroll runs on THIS clock, not the globalThis rAF stub the live
      // preview uses. Keeping them separate is deliberate: a test can advance
      // scroll time without also flushing a preview frame, and the two loops
      // cannot fight over the stub's single callback slot.
      scheduler: {
        requestFrame: (cb) => {
          const handle = ++this.autoScrollSeq;
          this.autoScrollFrames.set(handle, cb);
          return handle;
        },
        cancelFrame: (handle) => { this.autoScrollFrames.delete(handle); },
        now: () => this.virtualNowMs,
      },
    };
  }

  /**
   * Advances the virtual clock by `ms`, split across `frames` auto-scroll
   * ticks, running each pending frame callback. One tick of a large `ms` and
   * many ticks of a small one are both realistic; `dragSession.ts` clamps any
   * single tick's delta to 50ms, so a coarse advance scrolls LESS than the same
   * time split finely — which is itself worth asserting.
   */
  advanceTime(ms: number, frames = 1): this {
    this.assertNotDisposed();
    const perFrame = ms / frames;
    for (let i = 0; i < frames; i++) {
      this.virtualNowMs += perFrame;
      const pending = [...this.autoScrollFrames.values()];
      this.autoScrollFrames.clear();
      for (const cb of pending) cb(this.virtualNowMs);
    }
    return this;
  }

  /** True while an auto-scroll frame is queued — i.e. the ramp is running. */
  get autoScrollActive(): boolean {
    return this.autoScrollFrames.size > 0;
  }

  /** Live `scrollLeft` of the simulated timeline container. */
  get scrollLeft(): number {
    return this.scrollLeftValue;
  }

  /** Sets `scrollLeft` directly, bypassing the ramp. For landing a scroll on an
   *  exact boundary when a test needs to compare two gestures that reached the
   *  same content-x by different routes — the ramp advances by a
   *  velocity-and-elapsed-time product and will not stop on a round number. */
  forceScrollLeft(px: number): this {
    this.scrollLeftValue = px;
    return this;
  }

  /** Moves the simulated pointer to an ABSOLUTE clientX (rather than by a
   *  time delta), for parking it inside an edge zone where `moveBy`'s
   *  time-relative framing does not read naturally. */
  movePointerTo(clientX: number): this {
    this.currentClientX = clientX;
    this.movedThisGesture = true;
    this.dispatchPointer('pointermove');
    this.flushFrame();
    return this;
  }

  /** Grabs `id`'s `edge` at its own current position (offset zero — the
   *  pointer lands exactly on the handle). `grabOffsetSeconds` simulates a
   *  press that did not land exactly on the edge, to exercise K16's
   *  grab-offset preservation. */
  grab(id: string, edge: DragEdge, grabOffsetSeconds = 0): this {
    this.assertNotDisposed();
    this.commitAttempted = false;
    this.reverted = false;
    this.cancelledThisGesture = false;
    this.movedThisGesture = false;
    this.blockedIds = [];
    const segment = this.segments.find(s => s.id === id);
    const edgePx = segment ? segmentEdgeContentX(segment, edge, this.pixelsPerSecond) : 0;
    this.currentClientX = this.rectLeft + edgePx + grabOffsetSeconds * this.pixelsPerSecond;
    startDragSession(id, edge, this.currentClientX, this.deps());
    return this;
  }

  /** Advances the simulated pointer by `deltaSeconds` (content-space,
   *  converted through `pixelsPerSecond`) and flushes exactly one animation
   *  frame — mirroring one real `pointermove` reaching one real rAF tick. */
  moveBy(deltaSeconds: number): this {
    this.currentClientX += deltaSeconds * this.pixelsPerSecond;
    this.movedThisGesture = true;
    this.dispatchPointer('pointermove');
    this.flushFrame();
    return this;
  }

  /** Like `moveBy`, but leaves the pending rAF frame UN-flushed — for
   *  characterizing `handleUp`'s own "final pointer position even if the
   *  last frame hadn't fired yet" fallback (`edgeXFor(pendingEvent.clientX)`). */
  moveByWithoutFlush(deltaSeconds: number): this {
    this.currentClientX += deltaSeconds * this.pixelsPerSecond;
    this.movedThisGesture = true;
    this.dispatchPointer('pointermove');
    return this;
  }

  private dispatchPointer(type: 'pointermove' | 'pointerup' | 'pointercancel'): void {
    window.dispatchEvent(new MouseEvent(type, {
      clientX: this.currentClientX,
      bubbles: true,
      cancelable: true,
    }));
  }

  private flushFrame(): void {
    const cb = this.rafCallback;
    this.rafCallback = null;
    if (cb) cb(0);
  }

  /** True while a pending, un-flushed rAF frame is queued (i.e. a `moveBy`
   *  happened but no frame ran yet) — for asserting frame-coalescing. */
  get hasPendingFrame(): boolean {
    return this.rafCallback !== null;
  }

  release(): DragOutcome {
    // A genuine release of a gesture that MOVED arms one ghost-click swallower
    // (`dragSession.ts`'s teardown). It is `{once: true}` and the harness never
    // dispatches a click to consume it, so it legitimately outlives the
    // gesture — the post-condition expects exactly this many, no more and no
    // fewer. An early-bail `grab` never attached listeners and so never arms
    // one, which is why liveness is read from the DOM rather than assumed.
    if (this.movedThisGesture && this.liveListeners.some(l => l.type === 'pointermove')) {
      this.expectedSwallowers++;
    }
    this.dispatchPointer('pointerup');
    return this.resolveOutcome();
  }

  cancel(): DragOutcome {
    this.cancelledThisGesture = true;
    this.dispatchPointer('pointercancel');
    return this.resolveOutcome();
  }

  private resolveOutcome(): DragOutcome {
    let kind: DragOutcomeKind;
    if (!this.commitAttempted && !this.reverted) kind = 'no-op-not-moved';
    else if (this.reverted && !this.commitAttempted) {
      kind = this.cancelledThisGesture ? 'reverted-cancelled' : 'reverted-negligible';
    }
    else if (this.reverted && this.commitAttempted) kind = 'reverted-blocked';
    else kind = 'committed';
    return { kind, blockedIds: this.blockedIds, segments: this.segments };
  }

  /** Current harness segment state — the array `commitDurationChange`/
   *  `revertSegments` last wrote (or the initial array, before any release). */
  get currentSegments(): VideoSegment[] {
    return this.segments;
  }

  get resizingIdValue(): string | null {
    return this.resizingId;
  }

  get resizingTypeValue(): DragEdge | null {
    return this.resizingType;
  }

  get isResizingValue(): boolean {
    return this.isResizingFlag;
  }

  get speedBaselineWasCleared(): boolean {
    return this.speedBaselineCleared;
  }

  get bodyHasResizingClass(): boolean {
    return document.body.classList.contains('resizing');
  }

  /** Number of `[data-seg-id]` elements mounted for `segId` (the real
   *  Timeline mounts one per lane — thumbnail + waveform). */
  mountedElementCountFor(segId: string): number {
    return this.elsBySegId.get(segId)?.length ?? 0;
  }

  /** Reads back ONE mounted element's live `style.left`/`style.width` for
   *  `segId`, in pixels — `null` for a component never written this
   *  gesture (matches `writeGeometry`'s skip-if-unchanged diff). When
   *  `elementsPerSegment > 1`, asserts every mounted element for this id
   *  agrees (the real bug this guards: the two lanes visibly disagreeing
   *  for a whole gesture, `Timeline.tsx`'s K16 note). */
  liveGeometryFor(segId: string): LiveGeometry {
    const els = this.elsBySegId.get(segId);
    if (!els || els.length === 0) return { leftPx: null, widthPx: null };
    const reads = els.map(el => ({
      leftPx: el.style.left === '' ? null : parseFloat(el.style.left),
      widthPx: el.style.width === '' ? null : parseFloat(el.style.width),
    }));
    const first = reads[0]!;
    for (const r of reads) {
      if (r.leftPx !== first.leftPx || r.widthPx !== first.widthPx) {
        throw new Error(
          `liveGeometryFor(${segId}): mounted elements disagree — ${JSON.stringify(reads)}`,
        );
      }
    }
    return first;
  }

  /** Reconstructs a full `{id, startTime, duration}` array from the LIVE DOM
   *  (falling back to `originalSegments`' own values for any id this
   *  gesture hasn't written yet) — the read-back half of the "gapless
   *  invariant asserted after every step" requirement: callers feed this
   *  into `checkTimelineIsGapless` per frame, not just at the end. */
  readLiveSegments(originalSegments: VideoSegment[]): Pick<VideoSegment, 'id' | 'startTime' | 'duration' | 'locked'>[] {
    return originalSegments.map((orig) => {
      const live = this.liveGeometryFor(orig.id);
      if (live.leftPx === null || live.widthPx === null) {
        return { id: orig.id, startTime: orig.startTime, duration: orig.duration, locked: orig.locked };
      }
      return {
        id: orig.id,
        startTime: live.leftPx / this.pixelsPerSecond,
        duration: live.widthPx / this.pixelsPerSecond,
        locked: orig.locked,
      };
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('DragSessionHarness used after dispose()');
  }

  /**
   * Declares that THIS test deliberately leaves session state dirty, so the
   * universal post-condition reports it as expected rather than as a failure.
   *
   * Deliberately narrow: it whitelists only the stuck `resizingId`/
   * `resizingType`/`resizing`-class trio (the documented early-bail bug — see
   * `dragSession.ts`'s "FOUND, NOT FIXED" header note). Leaked listeners and
   * unbalanced pointer captures are never acknowledgeable, because no test has
   * a legitimate reason to leave those behind.
   *
   * It also fails if the residue is NOT present, so the acknowledgement cannot
   * quietly rot into a no-op once the underlying bug is fixed — whoever fixes
   * it is forced to come back here.
   */
  acknowledgeKnownResidue(reason: string): void {
    this.acknowledgedResidue = reason;
  }

  /** The audit the universal post-condition runs. Pure read — no cleanup. */
  private computeResidue(): string[] {
    const problems: string[] = [];

    const leakedPointerListeners = this.liveListeners.filter(
      l => l.type === 'pointermove' || l.type === 'pointerup' || l.type === 'pointercancel',
    );
    if (leakedPointerListeners.length > 0) {
      problems.push(
        `${leakedPointerListeners.length} window pointer listener(s) added but never removed ` +
        `(${[...new Set(leakedPointerListeners.map(l => l.type))].join(', ')}) — the drag ` +
        `session is still armed and will react to pointer events after the gesture ended`,
      );
    }

    const swallowers = this.liveListeners.filter(l => l.type === 'click').length;
    if (swallowers !== this.expectedSwallowers) {
      problems.push(
        `${swallowers} ghost-click swallower(s) armed, expected ${this.expectedSwallowers} ` +
        `(one per gesture that moved and ended in a genuine pointerup). ` +
        (swallowers > this.expectedSwallowers
          ? 'A surplus one will silently eat the user\'s next real click anywhere in the app — ' +
            'this is manual checklist step 10\'s exact failure.'
          : 'A missing one means the D12 ghost-click swallow no longer happens and a left-edge ' +
            'drag will fire a stray seek on release.'),
      );
    }

    if (this.autoScrollFrames.size > 0) {
      problems.push(
        `${this.autoScrollFrames.size} auto-scroll frame(s) still queued — the edge-scroll ramp ` +
        're-arms itself every tick and stops only on pointer re-entry, so a gesture that ended ' +
        'with the pointer parked in an edge zone would scroll the timeline forever',
      );
    }

    if (this.capturesOutstanding !== 0) {
      problems.push(
        `${this.capturesOutstanding} unreleased pointer capture(s) — setPointerCapture without a ` +
        'matching releasePointerCapture strands the pointer on a detached element',
      );
    }

    const stateResidue: string[] = [];
    if (this.resizingId !== null) stateResidue.push(`resizingId still ${JSON.stringify(this.resizingId)}`);
    if (this.resizingType !== null) stateResidue.push(`resizingType still ${JSON.stringify(this.resizingType)}`);
    if (document.body.classList.contains('resizing')) stateResidue.push("<body> still has the 'resizing' class");

    if (this.acknowledgedResidue !== null) {
      if (stateResidue.length === 0) {
        problems.push(
          `acknowledgeKnownResidue(${JSON.stringify(this.acknowledgedResidue)}) was called, but no ` +
          'residual session state was found. The acknowledged bug appears to be FIXED — remove the ' +
          'acknowledgement and assert the clean behaviour instead.',
        );
      }
    } else if (stateResidue.length > 0) {
      problems.push(
        `residual session state: ${stateResidue.join('; ')} — the next drag starts against a dirty ` +
        'session, and the resizing cursor stays stuck on the document',
      );
    }

    if (document.querySelectorAll('#timeline-scroll-area').length > 1) {
      problems.push(
        'more than one #timeline-scroll-area is attached to the document — a previous harness leaked ' +
        'its DOM, and getElementById will resolve to the wrong one',
      );
    }

    return problems;
  }

  /**
   * Audits, then disposes. Idempotent, and safe to call after a test file's own
   * `afterEach` already disposed this harness — `dispose()` snapshots the audit
   * before cleaning up, precisely so the result does not depend on which hook
   * ran first (see the module-level hook's HOOK-ORDER SAFETY note).
   */
  collectResidueAndDispose(): string[] {
    if (this.residueSnapshot === null) this.residueSnapshot = this.computeResidue();
    const snapshot = this.residueSnapshot;
    this.dispose();
    return snapshot;
  }

  /** Restores the global rAF pair and removes this harness's DOM subtree —
   *  required between tests in the same file, since vitest's jsdom
   *  environment is shared per FILE, not reset per test: a second harness's
   *  `#timeline-scroll-area` would otherwise shadow-collide with a prior
   *  one still attached to `document.body` (`getElementById` returns the
   *  first match in document order). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    // Snapshot the audit BEFORE any cleanup — the lines below deliberately
    // erase the very residue the universal post-condition exists to find (the
    // body class especially), and a test file's own afterEach may well call
    // this first. See the module-level hook's HOOK-ORDER SAFETY note.
    if (this.residueSnapshot === null) this.residueSnapshot = this.computeResidue();
    this.disposed = true;
    globalThis.requestAnimationFrame = this.prevRaf;
    globalThis.cancelAnimationFrame = this.prevCancelRaf;
    window.addEventListener = this.prevAddListener;
    window.removeEventListener = this.prevRemoveListener;
    // Remove anything the session left armed — chiefly the {once:true}
    // ghost-click swallowers, which no click ever consumes in a harness run and
    // which would otherwise survive into the next test (jsdom's window is
    // per-FILE, not per-test).
    for (const l of this.liveListeners.splice(0)) {
      this.prevRemoveListener(l.type, l.listener as EventListener, l.options);
    }
    this.autoScrollFrames.clear();
    this.timeline.remove();
    document.body.classList.remove('resizing');
  }
}

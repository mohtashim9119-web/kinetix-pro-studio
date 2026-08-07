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

import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { startDragSession, type DragSessionDeps } from './dragSession';
import { computeDragCascade } from './dragCascade';
import { segmentEdgeContentX, type DragEdge } from './dragGeometry';

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
}

/** Mirrors `dragSession.test.ts`'s reference `CommitOutcome` — the harness's
 *  proof obligation is that the REAL session reaches the same four outcomes. */
export type DragOutcomeKind =
  | 'no-op-not-moved'
  | 'reverted-negligible'
  | 'reverted-blocked'
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

  private currentClientX = 0;
  private commitAttempted = false;
  private reverted = false;
  private blockedIds: string[] = [];
  private disposed = false;

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
    this.timeline.scrollLeft = config.scrollLeft ?? 0;
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
  }

  private mountElementsFor(segId: string, count: number): void {
    const els: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.dataset.segId = segId;
      this.timeline.appendChild(el);
      els.push(el);
    }
    this.elsBySegId.set(segId, els);
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
      commitDurationChange: (originalSegments, segmentId, newDuration, finalTrimStart, fromSide, additionalUpdates) => {
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
    };
  }

  /** Grabs `id`'s `edge` at its own current position (offset zero — the
   *  pointer lands exactly on the handle). `grabOffsetSeconds` simulates a
   *  press that did not land exactly on the edge, to exercise K16's
   *  grab-offset preservation. */
  grab(id: string, edge: DragEdge, grabOffsetSeconds = 0): this {
    this.assertNotDisposed();
    this.commitAttempted = false;
    this.reverted = false;
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
    this.dispatchPointer('pointermove');
    this.flushFrame();
    return this;
  }

  /** Like `moveBy`, but leaves the pending rAF frame UN-flushed — for
   *  characterizing `handleUp`'s own "final pointer position even if the
   *  last frame hadn't fired yet" fallback (`edgeXFor(pendingEvent.clientX)`). */
  moveByWithoutFlush(deltaSeconds: number): this {
    this.currentClientX += deltaSeconds * this.pixelsPerSecond;
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
    this.dispatchPointer('pointerup');
    return this.resolveOutcome();
  }

  cancel(): DragOutcome {
    this.dispatchPointer('pointercancel');
    return this.resolveOutcome();
  }

  private resolveOutcome(): DragOutcome {
    let kind: DragOutcomeKind;
    if (!this.commitAttempted && !this.reverted) kind = 'no-op-not-moved';
    else if (this.reverted && !this.commitAttempted) kind = 'reverted-negligible';
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

  /** Restores the global rAF pair and removes this harness's DOM subtree —
   *  required between tests in the same file, since vitest's jsdom
   *  environment is shared per FILE, not reset per test: a second harness's
   *  `#timeline-scroll-area` would otherwise shadow-collide with a prior
   *  one still attached to `document.body` (`getElementById` returns the
   *  first match in document order). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    globalThis.requestAnimationFrame = this.prevRaf;
    globalThis.cancelAnimationFrame = this.prevCancelRaf;
    this.timeline.remove();
    document.body.classList.remove('resizing');
  }
}

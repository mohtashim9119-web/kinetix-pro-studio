import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderSegmentFrame, releaseBlendVideo, clearFrameRendererCache, FrameGlobalConfig } from './frameRenderer';
import { VideoSegment, Asset, AnimationType, TransitionType } from '../types';

// ---------------------------------------------------------------------------
// Transition-blend video-element isolation.
//
// Confirms the fix for the same-URL transition spike: during a segment's
// trailing-transition window the OUTGOING (primary) render and the INCOMING
// (blend) render both go through renderSegmentFrame for what can be the SAME
// source URL. Before the fix they shared one cached <video> element and seeked
// it back and forth between two timestamps every frame. renderSegmentFrame now
// routes the blend render (useBlendVideoCache: true) to a separate cache, so
// the two never collide.
//
// The module runs in plain node (no DOM), so we stub the minimum DOM surface
// renderSegmentFrame touches on the video path and count how many distinct
// <video> elements get created for a single URL.
// ---------------------------------------------------------------------------

const URL = 'blob:same-source-url';

/** Fake <video> whose metadata is ready and whose seeks resolve immediately. */
function makeFakeVideo(): Record<string, unknown> {
  const listeners: Record<string, Array<() => void>> = {};
  let currentTime = 0;
  const video: Record<string, unknown> = {
    tagName: 'VIDEO',
    src: '',
    muted: false,
    playsInline: false,
    crossOrigin: '',
    preload: '',
    readyState: 4,      // >= HAVE_METADATA so ensureMetadata resolves synchronously
    duration: 10,
    networkState: 1,
    videoWidth: 1920,
    videoHeight: 1080,
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    // rVFC present → waitForVideoFrame resolves on the next microtask (no 400ms wait).
    requestVideoFrameCallback(cb: () => void) {
      queueMicrotask(cb);
      return 1;
    },
    cancelVideoFrameCallback() {},
  };
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: (t: number) => {
      currentTime = t;
      // Real elements fire `seeked` asynchronously after a currentTime change.
      queueMicrotask(() => (listeners['seeked'] ?? []).slice().forEach((fn) => fn()));
    },
  });
  return video;
}

/** No-op 2D context: every method is a no-op, every property set is accepted. */
function makeCtx(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

let createdVideos: Array<Record<string, unknown>>;

beforeEach(() => {
  createdVideos = [];
  // instanceof HTMLVideoElement must not throw in node; the fakes are plain
  // objects (not instances), which makes drawImageCover read naturalWidth and
  // bail early — fine, this test only cares about element identity, not pixels.
  vi.stubGlobal('HTMLVideoElement', function HTMLVideoElement() {});
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'video') {
        const v = makeFakeVideo();
        createdVideos.push(v);
        return v;
      }
      throw new Error(`unexpected document.createElement('${tag}')`);
    },
    fonts: { load: () => Promise.resolve() },
  });
});

afterEach(() => {
  clearFrameRendererCache();
  vi.unstubAllGlobals();
});

const asset: Asset = { id: 'a1', name: 'clip.mp4', type: 'video', url: URL };

const globalConfig: FrameGlobalConfig = {
  overlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'sans-serif' },
};

function makeSegment(id: string): VideoSegment {
  return {
    id,
    assetId: 'a1',
    startTime: 0,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    showOverlay: false,
    text: '',
  } as unknown as VideoSegment;
}

async function renderPrimary(id: string): Promise<void> {
  await renderSegmentFrame({
    segment: makeSegment(id),
    asset,
    timeInSegment: 0,
    ctx: makeCtx(),
    width: 320,
    height: 180,
    global: globalConfig,
  });
}

async function renderBlend(id: string): Promise<void> {
  await renderSegmentFrame({
    segment: makeSegment(id),
    asset,
    timeInSegment: 0,
    ctx: makeCtx(),
    width: 320,
    height: 180,
    global: globalConfig,
    useBlendVideoCache: true,
  });
}

describe('frameRenderer transition-blend video isolation', () => {
  it('gives the blend (incoming) render its own <video>, separate from the primary render of the same URL', async () => {
    await renderPrimary('outgoing'); // primary cache element for URL
    await renderBlend('incoming');   // blend cache element for the SAME URL

    // Two distinct elements — the same-URL transition no longer thrashes one.
    expect(createdVideos).toHaveLength(2);
    expect(createdVideos[0]).not.toBe(createdVideos[1]);
  });

  it('dedupes within each cache — repeated primary and repeated blend reuse their own element', async () => {
    await renderPrimary('outgoing');
    await renderPrimary('outgoing'); // primary cache hit, no new element
    await renderBlend('incoming');
    await renderBlend('incoming');   // blend cache hit, no new element

    // Exactly one primary + one blend element created despite four renders.
    expect(createdVideos).toHaveLength(2);
  });

  it('releaseBlendVideo frees only the blend element; the primary element is untouched', async () => {
    await renderPrimary('outgoing');
    await renderBlend('incoming');
    expect(createdVideos).toHaveLength(2);
    const primaryEl = createdVideos[0];
    const blendEl = createdVideos[1];

    // Pipeline advances past the transition window → blend element released.
    releaseBlendVideo(URL);
    expect(blendEl!.src).toBe(''); // detached so the browser can free buffers

    // A subsequent primary render reuses the SAME primary element (still cached).
    await renderPrimary('incoming-now-current');
    expect(createdVideos).toHaveLength(2);
    expect(createdVideos[1]).toBe(blendEl); // no new element from the primary render
    expect(createdVideos[0]).toBe(primaryEl);

    // A subsequent blend render must create a FRESH element (old one was released).
    await renderBlend('another-incoming');
    expect(createdVideos).toHaveLength(3);
    expect(createdVideos[2]).not.toBe(blendEl);
  });
});

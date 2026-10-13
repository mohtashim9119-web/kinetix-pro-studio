/**
 * Dedicated per-spot decode/still sessions for GL export.
 *
 * NEVER uses the preview decoder pool (`videoDecoderPool`) and NEVER the
 * run's shared segment `DecodeCursorRegistry` — eviction there would steal
 * the main timeline's GOP. Each active video-spot window owns one
 * `decodeSegmentFrames` generator; it closes when the playhead leaves the
 * window. Spot audio is never decoded (video-only sequential decode).
 */

import type { Asset } from '../../types';
import {
  decodeSegmentFrames,
  decodeResourceCounts,
  DecodeStallError,
  DecoderModeUnsupportedError,
} from './sequentialDecode';
import {
  specActiveAt,
  specEndSec,
  type SpotRenderSpec,
} from './spotRenderSpec';
import type { UploadSource } from '../gl/glCompositor';

export class SpotAssetError extends Error {
  readonly assetId: string;
  constructor(assetId: string, detail: string) {
    super(`Spot asset "${assetId}" ${detail}`);
    this.name = 'SpotAssetError';
    this.assetId = assetId;
  }
}

/**
 * A spot clip's decoder stalled (or could not be built) on every rung it was
 * allowed — the honest failure at the end of the one-downgrade ladder. Names
 * the asset; never retried again in this run.
 */
export class SpotDecodeStalledError extends Error {
  readonly assetId: string;
  /** Decoders tried for this asset in this run (1 or 2 — never more). */
  readonly attempts: number;
  readonly waitedMs: number;
  readonly awaitName: string;
  constructor(assetId: string, attempts: number, waitedMs: number, awaitName: string, detail: string) {
    super(`Spot clip "${assetId}" stopped decoding: ${detail}`);
    this.name = 'SpotDecodeStalledError';
    this.assetId = assetId;
    this.attempts = attempts;
    this.waitedMs = waitedMs;
    this.awaitName = awaitName;
  }
}

/** `'default'` = the demuxer's config untouched (no `hardwareAcceleration`). */
export type SpotDecodeRung = 'default' | 'prefer-software';

/**
 * The platform the proactive route is gated to: Windows (WebView2, Chromium),
 * where `hardwareAcceleration` is honoured and the field stall was observed.
 * macOS (WKWebView) never reproduced the stall and its handling of
 * `prefer-software` is unproven, so it keeps the default decoder.
 */
export function isWindowsDecoderPlatform(userAgent: string | undefined | null): boolean {
  return typeof userAgent === 'string' && /\bWindows NT\b/.test(userAgent);
}

export interface SpotPlaybackOptions {
  /** Proactive route: open the spot decoder `prefer-software` whenever a
   *  non-software decoder is already open in this realm. Set from
   *  `isWindowsDecoderPlatform` by the worker. */
  preferSoftwareWhenContended?: boolean;
  /** Per-wait bound handed to `decodeSegmentFrames` — the stall signal the
   *  reactive route listens for. */
  stallBoundMs?: number;
}

interface VideoSpotSession {
  kind: 'video';
  spec: SpotRenderSpec;
  url: string;
  decodeEnd: number;
  rung: SpotDecodeRung;
  gen: AsyncGenerator<VideoFrame>;
  pending: VideoFrame | null;
  current: VideoFrame | null;
  exhausted: boolean;
  sourceDurationSec: number;
}

interface ImageSpotSession {
  kind: 'image';
  spec: SpotRenderSpec;
  bitmap: ImageBitmap;
}

type SpotSession = VideoSpotSession | ImageSpotSession;

export interface SpotSample {
  spec: SpotRenderSpec;
  source: UploadSource;
  nativeW: number;
  nativeH: number;
}

export class SpotPlaybackController {
  private readonly assets: Map<string, Asset>;
  private readonly specs: readonly SpotRenderSpec[];
  private readonly sessions = new Map<string, SpotSession>();
  private readonly findings: string[] = [];
  private readonly shortNoted = new Set<string>();
  peakOpenVideoDecoders = 0;
  private openVideoDecoders = 0;
  private readonly options: SpotPlaybackOptions;
  /** Per-ASSET ladder memory, across windows: once an asset has been moved
   *  to software it starts there, and it is never moved again. */
  private readonly assetRung = new Map<string, SpotDecodeRung>();
  private readonly downgraded = new Set<string>();
  private readonly softwareUnavailable = new Set<string>();
  private readonly attemptsByAsset = new Map<string, number>();

  constructor(assets: readonly Asset[], specs: readonly SpotRenderSpec[], options: SpotPlaybackOptions = {}) {
    this.assets = new Map(assets.map((a) => [a.id, a]));
    this.specs = specs;
    this.options = options;
  }

  snapshotFindings(): readonly string[] {
    return this.findings;
  }

  resourceCounts(): { decodersCreated: number; decodersOpen: number; peakOpenVideoDecoders: number; openSpotSessions: number } {
    const { decodersCreated, decodersOpen } = decodeResourceCounts();
    return {
      decodersCreated,
      decodersOpen,
      peakOpenVideoDecoders: this.peakOpenVideoDecoders,
      openSpotSessions: this.sessions.size,
    };
  }

  async sampleAt(timelineSec: number): Promise<SpotSample[]> {
    await this.closeInactive(timelineSec);
    const out: SpotSample[] = [];
    for (const spec of this.specs) {
      if (!specActiveAt(spec, timelineSec)) continue;
      const session = await this.ensureSession(spec);
      const localSec = timelineSec - spec.startSec;
      if (session.kind === 'image') {
        out.push({
          spec,
          source: session.bitmap,
          nativeW: session.bitmap.width,
          nativeH: session.bitmap.height,
        });
        continue;
      }
      const frame = await this.videoFrameAt(session, localSec);
      if (!frame) continue;
      out.push({
        spec,
        source: frame,
        nativeW: frame.displayWidth,
        nativeH: frame.displayHeight,
      });
    }
    return out;
  }

  async dispose(): Promise<void> {
    for (const spec of [...this.sessions.keys()]) {
      await this.closeSession(spec);
    }
  }

  private sessionKey(spec: SpotRenderSpec): string {
    return `${spec.assetId}|${spec.startSec}|${spec.durSec}|${spec.xPct}|${spec.yPct}|${spec.wPct}|${spec.hPct}`;
  }

  private async ensureSession(spec: SpotRenderSpec): Promise<SpotSession> {
    const key = this.sessionKey(spec);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const asset = this.assets.get(spec.assetId);
    if (!asset?.url) {
      throw new SpotAssetError(spec.assetId, 'is missing or unloadable');
    }
    if (asset.type === 'audio') {
      throw new SpotAssetError(spec.assetId, 'is audio — spot audio is never decoded');
    }
    if (asset.type === 'image') {
      const bitmap = await this.loadImage(asset);
      const session: ImageSpotSession = { kind: 'image', spec, bitmap };
      this.sessions.set(key, session);
      return session;
    }
    const sourceDurationSec = asset.duration ?? spec.durSec;
    if (sourceDurationSec + 1e-6 < spec.durSec && !this.shortNoted.has(key)) {
      this.shortNoted.add(key);
      this.findings.push(
        `spot-clip-short: asset "${spec.assetId}" duration ${sourceDurationSec}s < spec ${spec.durSec}s; clamped`,
      );
    }
    const decodeEnd = Math.max(Math.min(spec.durSec, sourceDurationSec), 1 / 120);
    const rung = this.initialRung(spec.assetId);
    const session: VideoSpotSession = {
      kind: 'video',
      spec,
      url: asset.url,
      decodeEnd,
      rung,
      gen: this.openDecode(spec.assetId, asset.url, decodeEnd, rung),
      pending: null,
      current: null,
      exhausted: false,
      sourceDurationSec,
    };
    this.sessions.set(key, session);
    this.openVideoDecoders++;
    if (this.openVideoDecoders > this.peakOpenVideoDecoders) {
      this.peakOpenVideoDecoders = this.openVideoDecoders;
    }
    return session;
  }

  /** Proactive route first: a known-downgraded asset stays in software; a
   *  gated platform with a non-software decoder already open starts the spot
   *  in software so the two never contend; everything else is the default. */
  private initialRung(assetId: string): SpotDecodeRung {
    const remembered = this.assetRung.get(assetId);
    if (remembered) return remembered;
    if (
      this.options.preferSoftwareWhenContended &&
      !this.softwareUnavailable.has(assetId) &&
      decodeResourceCounts().nonSoftwareDecodersOpen > 0
    ) {
      return 'prefer-software';
    }
    return 'default';
  }

  private openDecode(assetId: string, url: string, decodeEnd: number, rung: SpotDecodeRung): AsyncGenerator<VideoFrame> {
    this.attemptsByAsset.set(assetId, (this.attemptsByAsset.get(assetId) ?? 0) + 1);
    return decodeSegmentFrames(url, 0, decodeEnd, {
      ...(rung === 'prefer-software' ? { hardwareAcceleration: 'prefer-software' as const } : {}),
      ...(this.options.stallBoundMs !== undefined ? { stallBoundMs: this.options.stallBoundMs } : {}),
    });
  }

  /**
   * The ladder. Returns the rung to retry on, or throws the honest failure.
   *  - stall on default            -> ONE retry in software (once per asset);
   *  - software unsupported, reached proactively -> back to default (what
   *    works today on every other machine), software marked unavailable;
   *  - anything else (stall in software, a second default stall, software
   *    unsupported after a stall) -> SpotDecodeStalledError naming the asset.
   */
  private nextRung(session: VideoSpotSession, err: DecodeStallError | DecoderModeUnsupportedError): SpotDecodeRung {
    const assetId = session.spec.assetId;
    const attempts = this.attemptsByAsset.get(assetId) ?? 1;
    const waitedMs = err instanceof DecodeStallError ? err.waitedMs : 0;
    const awaitName = err instanceof DecodeStallError ? err.awaitName : 'decoder-configure';
    if (err instanceof DecoderModeUnsupportedError) {
      this.softwareUnavailable.add(assetId);
      if (!this.downgraded.has(assetId)) {
        this.assetRung.set(assetId, 'default');
        this.findings.push(`spot-decoder-software-unsupported: asset "${assetId}" falls back to the default decoder`);
        return 'default';
      }
      throw new SpotDecodeStalledError(
        assetId,
        attempts,
        waitedMs,
        awaitName,
        `it stalled in the default decoder and this engine has no software decoder for it (${err.message})`,
      );
    }
    if (session.rung === 'default' && !this.downgraded.has(assetId) && !this.softwareUnavailable.has(assetId)) {
      this.downgraded.add(assetId);
      this.assetRung.set(assetId, 'prefer-software');
      this.findings.push(
        `spot-decoder-downgraded: asset "${assetId}" produced no frame for ${Math.round(err.waitedMs)}ms ` +
          `(${err.awaitName}); retrying once with prefer-software`,
      );
      return 'prefer-software';
    }
    throw new SpotDecodeStalledError(
      assetId,
      attempts,
      waitedMs,
      awaitName,
      `no frame for ${Math.round(err.waitedMs)}ms (${err.awaitName}) with ${session.rung === 'prefer-software' ? 'the software decoder' : 'the default decoder'} after ${attempts} attempt(s)`,
    );
  }

  private async loadImage(asset: Asset): Promise<ImageBitmap> {
    try {
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return await createImageBitmap(blob);
    } catch (err) {
      throw new SpotAssetError(asset.id, `could not be loaded (${(err as Error).message})`);
    }
  }

  private async videoFrameAt(session: VideoSpotSession, localSec: number): Promise<VideoFrame | null> {
    const targetUs = localSec * 1e6;
    while (!session.exhausted) {
      if (session.pending === null) {
        let next: IteratorResult<VideoFrame>;
        try {
          next = await session.gen.next();
        } catch (e) {
          if (!(e instanceof DecodeStallError) && !(e instanceof DecoderModeUnsupportedError)) throw e;
          const rung = this.nextRung(session, e);
          // The failed generator has already closed its decoder and finished.
          // Restart from the window's start; frames before the target are
          // decoded and passed over by this same loop.
          session.current?.close();
          session.current = null;
          session.rung = rung;
          session.gen = this.openDecode(session.spec.assetId, session.url, session.decodeEnd, rung);
          continue;
        }
        if (next.done) {
          session.exhausted = true;
          break;
        }
        session.pending = next.value;
      }
      const pending = session.pending;
      if (pending.timestamp > targetUs && session.current) {
        return session.current;
      }
      if (session.current) session.current.close();
      session.current = pending;
      session.pending = null;
      if (session.current.timestamp >= targetUs) return session.current;
    }
    return session.current;
  }

  private async closeInactive(timelineSec: number): Promise<void> {
    for (const [key, session] of [...this.sessions.entries()]) {
      if (timelineSec < specEndSec(session.spec)) continue;
      await this.closeSession(key);
    }
  }

  private async closeSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    if (session.kind === 'image') {
      session.bitmap.close();
      return;
    }
    this.openVideoDecoders = Math.max(0, this.openVideoDecoders - 1);
    session.pending?.close();
    session.current?.close();
    await session.gen.return(undefined).catch(() => {});
  }
}

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
import { decodeSegmentFrames, decodeResourceCounts } from './sequentialDecode';
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

interface VideoSpotSession {
  kind: 'video';
  spec: SpotRenderSpec;
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

  constructor(assets: readonly Asset[], specs: readonly SpotRenderSpec[]) {
    this.assets = new Map(assets.map((a) => [a.id, a]));
    this.specs = specs;
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
    return `${spec.assetId}|${spec.startSec}|${spec.durSec}|${spec.corner}|${spec.heightPct}`;
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
    const decodeEnd = Math.min(spec.durSec, sourceDurationSec);
    const session: VideoSpotSession = {
      kind: 'video',
      spec,
      gen: decodeSegmentFrames(asset.url, 0, Math.max(decodeEnd, 1 / 120)),
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
        const next = await session.gen.next();
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

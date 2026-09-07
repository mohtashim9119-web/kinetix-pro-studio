/**
 * Production-safe preview decode diagnostics for Windows field capture.
 * Gated by localStorage (`kinetix:previewDiagnosticsEnabled:v1`) — not DEV-only.
 * When disabled, `previewDiagnosticsActive()` is false and hook sites return
 * immediately (single boolean check, no allocations).
 */

const STORAGE_KEY = 'kinetix:previewDiagnosticsEnabled:v1';

/** In-memory mirror of the localStorage flag — refreshed on read/toggle only. */
let active = false;

export function isPreviewDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPreviewDiagnosticsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false');
  } catch {
    // private mode / blocked storage — best effort
  }
  active = on;
  if (on) resetPreviewDiagnosticsState();
}

/** Call once on app boot and after toggling the setting. */
export function syncPreviewDiagnosticsEnabled(): void {
  active = isPreviewDiagnosticsEnabled();
  if (active) resetPreviewDiagnosticsState();
}

export function previewDiagnosticsActive(): boolean {
  return active;
}

export interface PreviewDiagnosticsConfigSnapshot {
  codec: string;
  codedWidth?: number;
  codedHeight?: number;
  descriptionBytes: number;
  hardwareAcceleration?: VideoDecoderConfig['hardwareAcceleration'];
  optimizeForLatency?: boolean;
}

export interface PreviewDiagnosticsConfigureRecord {
  assetUrl: string;
  segmentId: string;
  sourceFps: number | null;
  config: PreviewDiagnosticsConfigSnapshot;
  isConfigSupported: { supported: boolean; config?: PreviewDiagnosticsConfigSnapshot } | null;
  isConfigSupportedError: { name: string; message: string } | null;
  configureThrew: boolean;
  configureError: { name: string; message: string } | null;
  decoderStateAfterConfigure: string | null;
  at: string;
}

export interface PreviewDiagnosticsSessionCounters {
  segmentId: string;
  assetUrl: string;
  sourceFps: number | null;
  chunksDecoded: number;
  decoderOutputCallbacks: number;
  framesAdmitted: number;
  framesDropped: number;
  framesPresented: number;
  lastFrameTimestampSec: number | null;
  lastPresentTimelineSec: number | null;
  decoderStateTransitions: Array<{ from: string; to: string; at: string }>;
  currentDecoderState: string | null;
}

export interface PreviewDiagnosticsSelectionEvent {
  selectedSegmentId: string | null;
  activeAssetId: string | null;
  mediaType: 'video' | 'image' | 'other' | null;
  compositorBoundAssetId: string | null;
  compositorBoundSegmentId: string | null;
  textureRebound: boolean;
  requestedTimelineSec: number;
  activeFrameTimestampSec: number | null;
  at: string;
}

export interface PreviewDiagnosticsPresentation {
  rafTicks: number;
  rafTicksPerSec: number | null;
  requestedFpsEstimate: number | null;
  achievedPresentFps: number | null;
  lastTimelineSec: number | null;
  lastPresentTimestampSec: number | null;
}

export interface PreviewDiagnosticsSnapshot {
  enabled: true;
  capturedAt: string;
  userAgent: string;
  platform: {
    webCodecsPreviewSupported: boolean;
  };
  firstError: { name: string; message: string; stack: string | null; at: string } | null;
  configureAttempts: PreviewDiagnosticsConfigureRecord[];
  sessions: PreviewDiagnosticsSessionCounters[];
  presentation: PreviewDiagnosticsPresentation;
  selectionEvents: PreviewDiagnosticsSelectionEvent[];
  notes: string[];
}

interface MutableSession extends PreviewDiagnosticsSessionCounters {
  lastDecoderState: string | null;
}

interface MutableState {
  configureAttempts: PreviewDiagnosticsConfigureRecord[];
  sessions: Map<string, MutableSession>;
  selectionEvents: PreviewDiagnosticsSelectionEvent[];
  firstError: PreviewDiagnosticsSnapshot['firstError'];
  presentation: {
    rafTickTimes: number[];
    presentTimes: number[];
    lastTimelineSec: number | null;
    lastPresentTimestampSec: number | null;
  };
}

let state: MutableState | null = null;

function ensureState(): MutableState {
  if (!state) {
    state = {
      configureAttempts: [],
      sessions: new Map(),
      selectionEvents: [],
      firstError: null,
      presentation: {
        rafTickTimes: [],
        presentTimes: [],
        lastTimelineSec: null,
        lastPresentTimestampSec: null,
      },
    };
  }
  return state;
}

export function resetPreviewDiagnosticsState(): void {
  state = {
    configureAttempts: [],
    sessions: new Map(),
    selectionEvents: [],
    firstError: null,
    presentation: {
      rafTickTimes: [],
      presentTimes: [],
      lastTimelineSec: null,
      lastPresentTimestampSec: null,
    },
  };
}

function domError(err: unknown): { name: string; message: string } {
  if (err instanceof DOMException) return { name: err.name, message: err.message };
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'Error', message: String(err) };
}

function stackOf(err: unknown): string | null {
  if (err instanceof Error && err.stack) return err.stack;
  return null;
}

export function recordPreviewDiagnosticsError(err: unknown): void {
  if (!active) return;
  const s = ensureState();
  if (s.firstError) return;
  const d = domError(err);
  s.firstError = { ...d, stack: stackOf(err), at: new Date().toISOString() };
}

export function serializeVideoDecoderConfig(
  config: VideoDecoderConfig,
): PreviewDiagnosticsConfigSnapshot {
  return {
    codec: config.codec,
    codedWidth: config.codedWidth,
    codedHeight: config.codedHeight,
    descriptionBytes: config.description ? config.description.byteLength : 0,
    hardwareAcceleration: config.hardwareAcceleration,
    optimizeForLatency: config.optimizeForLatency,
  };
}

export async function probeAndRecordConfigure(
  segmentId: string,
  assetUrl: string,
  sourceFps: number | null,
  config: VideoDecoderConfig,
  configure: () => void,
  readDecoderState: () => string,
): Promise<void> {
  if (!active) {
    configure();
    return;
  }
  const s = ensureState();
  const record: PreviewDiagnosticsConfigureRecord = {
    assetUrl,
    segmentId,
    sourceFps,
    config: serializeVideoDecoderConfig(config),
    isConfigSupported: null,
    isConfigSupportedError: null,
    configureThrew: false,
    configureError: null,
    decoderStateAfterConfigure: null,
    at: new Date().toISOString(),
  };

  if (typeof VideoDecoder.isConfigSupported === 'function') {
    try {
      const result = await VideoDecoder.isConfigSupported(config);
      record.isConfigSupported = {
        supported: result.supported === true,
        config: result.config ? serializeVideoDecoderConfig(result.config) : undefined,
      };
    } catch (err) {
      record.isConfigSupportedError = domError(err);
      recordPreviewDiagnosticsError(err);
    }
  }

  try {
    configure();
    record.decoderStateAfterConfigure = readDecoderState();
  } catch (err) {
    record.configureThrew = true;
    record.configureError = domError(err);
    recordPreviewDiagnosticsError(err);
    s.configureAttempts.push(record);
    throw err;
  }

  s.configureAttempts.push(record);
}

export function sessionCountersFor(segmentId: string, assetUrl: string, sourceFps: number | null): MutableSession {
  if (!active) {
    return {
      segmentId,
      assetUrl,
      sourceFps,
      chunksDecoded: 0,
      decoderOutputCallbacks: 0,
      framesAdmitted: 0,
      framesDropped: 0,
      framesPresented: 0,
      lastFrameTimestampSec: null,
      lastPresentTimelineSec: null,
      decoderStateTransitions: [],
      currentDecoderState: null,
      lastDecoderState: null,
    };
  }
  const s = ensureState();
  let entry = s.sessions.get(segmentId);
  if (!entry) {
    entry = {
      segmentId,
      assetUrl,
      sourceFps,
      chunksDecoded: 0,
      decoderOutputCallbacks: 0,
      framesAdmitted: 0,
      framesDropped: 0,
      framesPresented: 0,
      lastFrameTimestampSec: null,
      lastPresentTimelineSec: null,
      decoderStateTransitions: [],
      currentDecoderState: null,
      lastDecoderState: null,
    };
    s.sessions.set(segmentId, entry);
  }
  return entry;
}

export function recordDecoderState(session: MutableSession, nextState: string): void {
  if (!active) return;
  if (session.lastDecoderState === nextState) return;
  if (session.lastDecoderState !== null) {
    session.decoderStateTransitions.push({
      from: session.lastDecoderState,
      to: nextState,
      at: new Date().toISOString(),
    });
  }
  session.lastDecoderState = nextState;
  session.currentDecoderState = nextState;
}

export function recordChunkDecoded(session: MutableSession): void {
  if (!active) return;
  session.chunksDecoded++;
}

export function recordDecoderOutput(session: MutableSession, admitted: boolean, timestampSec: number): void {
  if (!active) return;
  session.decoderOutputCallbacks++;
  if (admitted) {
    session.framesAdmitted++;
    session.lastFrameTimestampSec = timestampSec;
  } else {
    session.framesDropped++;
  }
}

export function recordFramePresented(
  session: MutableSession,
  timelineSec: number,
  frameTimestampSec: number,
): void {
  if (!active) return;
  session.framesPresented++;
  session.lastPresentTimelineSec = timelineSec;
  session.lastFrameTimestampSec = frameTimestampSec;
  const s = ensureState();
  const now = performance.now();
  s.presentation.presentTimes.push(now);
  s.presentation.lastTimelineSec = timelineSec;
  s.presentation.lastPresentTimestampSec = frameTimestampSec;
  trimRollingWindow(s.presentation.presentTimes, now, 2000);
}

export function recordRafTick(timelineSec: number): void {
  if (!active) return;
  const s = ensureState();
  const now = performance.now();
  s.presentation.rafTickTimes.push(now);
  s.presentation.lastTimelineSec = timelineSec;
  trimRollingWindow(s.presentation.rafTickTimes, now, 2000);
}

export function recordSelectionChange(event: Omit<PreviewDiagnosticsSelectionEvent, 'at'>): void {
  if (!active) return;
  const s = ensureState();
  const full: PreviewDiagnosticsSelectionEvent = { ...event, at: new Date().toISOString() };
  s.selectionEvents.push(full);
  if (s.selectionEvents.length > 32) s.selectionEvents.shift();
}

export function recordTextureUpload(
  segmentId: string,
  assetId: string,
  mediaType: 'video' | 'image',
  rebound: boolean,
  frameTimestampSec: number | null,
  timelineSec: number,
): void {
  if (!active) return;
  recordSelectionChange({
    selectedSegmentId: segmentId,
    activeAssetId: assetId,
    mediaType,
    compositorBoundAssetId: assetId,
    compositorBoundSegmentId: segmentId,
    textureRebound: rebound,
    requestedTimelineSec: timelineSec,
    activeFrameTimestampSec: frameTimestampSec,
  });
}

function trimRollingWindow(times: number[], now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  while (times.length > 0 && times[0]! < cutoff) times.shift();
}

function ratePerSec(times: number[], now: number, windowMs: number): number | null {
  const cutoff = now - windowMs;
  const recent = times.filter((t) => t >= cutoff);
  if (recent.length < 2) return null;
  const spanSec = (recent[recent.length - 1]! - recent[0]!) / 1000;
  if (spanSec <= 0) return null;
  return (recent.length - 1) / spanSec;
}

function webCodecsPreviewSupported(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

export function buildPreviewDiagnosticsSnapshot(
  notes: string[] = [],
): PreviewDiagnosticsSnapshot {
  const s = state ?? {
    configureAttempts: [],
    sessions: new Map<string, MutableSession>(),
    selectionEvents: [],
    firstError: null,
    presentation: {
      rafTickTimes: [],
      presentTimes: [],
      lastTimelineSec: null,
      lastPresentTimestampSec: null,
    },
  };
  const now = performance.now();
  const rafRate = ratePerSec(s.presentation.rafTickTimes, now, 1000);
  const presentRate = ratePerSec(s.presentation.presentTimes, now, 1000);

  return {
    enabled: true,
    capturedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    platform: { webCodecsPreviewSupported: webCodecsPreviewSupported() },
    firstError: s.firstError,
    configureAttempts: [...s.configureAttempts],
    sessions: Array.from(s.sessions.values()).map(({ lastDecoderState: _l, ...rest }) => rest),
    presentation: {
      rafTicks: s.presentation.rafTickTimes.length,
      rafTicksPerSec: rafRate,
      requestedFpsEstimate: rafRate,
      achievedPresentFps: presentRate,
      lastTimelineSec: s.presentation.lastTimelineSec,
      lastPresentTimestampSec: s.presentation.lastPresentTimestampSec,
    },
    selectionEvents: [...s.selectionEvents],
    notes,
  };
}

export async function copyPreviewDiagnosticsToClipboard(notes: string[] = []): Promise<boolean> {
  const json = JSON.stringify(buildPreviewDiagnosticsSnapshot(notes), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

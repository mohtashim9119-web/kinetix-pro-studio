/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Per-project COST + TIME LEDGER — display only. Append-only history of real
// billed occurrences (a stage run, an attempt's unattributed remainder, a
// cache-hit marker, a timeline build). Entries are never rewritten, recomputed
// or replaced; the ledger reads events after the fact and never takes part in
// a decision (no job, retry, cancel or sync path consults it).
//
// Stage taxonomy: Setup | Transcription | Alignment | Timeline Build | Other.
// The gateway's per-job view reports one GPU-seconds figure that INCLUDES a
// cold boot (a container's first job is billed from boot), so the client
// cannot split boot out. Stage runs therefore land whole under their stage and
// carry `bootIncluded`; a 'setup' entry is only written when a boot figure is
// actually supplied — nothing is invented.

export type LedgerStage = 'setup' | 'transcription' | 'alignment' | 'timeline' | 'other';
export const LEDGER_STAGES: readonly LedgerStage[] = ['setup', 'transcription', 'alignment', 'timeline'];
export const LEDGER_STAGE_LABEL: Record<LedgerStage, string> = {
  setup: 'Setup', transcription: 'Transcription', alignment: 'Alignment', timeline: 'Timeline Build', other: 'Other',
};

export interface LedgerEntry {
  /** 1-based attempt this occurred in. */
  attempt: number;
  at: number;
  stage: LedgerStage;
  sec: number;
  usd: number;
  /** Zero-cost marker: the cache answered, no work was done for this project. */
  cached: boolean;
  jobId?: string;
  /** The seconds include a cold container boot. */
  bootIncluded?: boolean;
  /** An 'other' remainder: billed on the attempt but not tied to a stage run. */
  note?: string;
}

export interface ProjectLedger {
  v: 1;
  projectId: string;
  /** Attempts settled so far; entries since belong to attempt `settled.length + 1`. */
  settled: number[];
  entries: LedgerEntry[];
}

export const LEDGER_KEY = 'kinetix:cost-ledger:v1';
const MAX_ENTRIES = 400;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LedgerDeps {
  storage?: Store;
  usdPerSec: number;
  isDeleted?: (projectId: string) => boolean;
  now?: () => number;
}

export class ProjectCostLedger {
  private ledgers = new Map<string, ProjectLedger>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly deps: LedgerDeps) {
    try {
      const raw = deps.storage?.getItem(LEDGER_KEY);
      const parsed = raw ? JSON.parse(raw) as { ledgers?: unknown } : null;
      const list = Array.isArray(parsed?.ledgers) ? parsed!.ledgers as ProjectLedger[] : [];
      for (const l of list) {
        if (l && l.v === 1 && typeof l.projectId === 'string' && Array.isArray(l.entries) && Array.isArray(l.settled)) this.ledgers.set(l.projectId, l);
      }
    } catch { /* unreadable: start empty rather than guess */ }
  }

  get(projectId: string): Readonly<ProjectLedger> | undefined { return this.ledgers.get(projectId); }
  getVersion(): number { return this.version; }
  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  private append(projectId: string, entry: Omit<LedgerEntry, 'attempt' | 'at'>): void {
    if (this.deps.isDeleted?.(projectId)) return;
    let ledger = this.ledgers.get(projectId);
    if (!ledger) { ledger = { v: 1, projectId, settled: [], entries: [] }; this.ledgers.set(projectId, ledger); }
    if (ledger.entries.length >= MAX_ENTRIES) return;
    ledger.entries.push({ ...entry, attempt: ledger.settled.length + 1, at: (this.deps.now ?? Date.now)() });
    this.commit();
  }

  /** A stage run finished (a real job, or a cache hit written as a $0 marker). */
  noteStage(ev: { ownerId: string; stage: 'transcribe' | 'align'; jobId?: string; workerSec: number; cached: boolean; handedOff: boolean }): void {
    const stage: LedgerStage = ev.stage === 'transcribe' ? 'transcription' : 'alignment';
    if (ev.cached || !(ev.workerSec > 0)) {
      this.append(ev.ownerId, { stage, sec: 0, usd: 0, cached: true, jobId: ev.jobId });
      return;
    }
    this.append(ev.ownerId, {
      stage, sec: ev.workerSec, usd: ev.workerSec * this.deps.usdPerSec, cached: false, jobId: ev.jobId,
      bootIncluded: ev.handedOff ? undefined : true,
    });
  }

  /** A boot figure the gateway reported separately (none does today). */
  noteSetup(projectId: string, sec: number): void {
    if (sec > 0) this.append(projectId, { stage: 'setup', sec, usd: sec * this.deps.usdPerSec, cached: false });
  }

  /** The local Build Timeline ran: time only, always $0. */
  noteTimeline(projectId: string, sec: number): void {
    this.append(projectId, { stage: 'timeline', sec: Math.max(0, sec), usd: 0, cached: false });
  }

  /**
   * An attempt was billed (`billingAttempts` gained a line). Any billed
   * seconds the stage entries did not account for (e.g. a stage that failed
   * after spending GPU time) land in "Other" — never dropped, never merged
   * into a stage. Then the attempt closes: later entries are the next attempt.
   */
  settleAttempt(projectId: string, at: number, workerSec: number): void {
    if (this.deps.isDeleted?.(projectId)) return;
    const ledger = this.ledgers.get(projectId);
    if (ledger?.settled.includes(at)) return;
    const attempt = (ledger?.settled.length ?? 0) + 1;
    const attributed = (ledger?.entries ?? [])
      .filter(e => e.attempt === attempt && e.stage !== 'timeline')
      .reduce((s, e) => s + e.sec, 0);
    const rest = workerSec - attributed;
    if (rest > 0.5) {
      this.append(projectId, { stage: 'other', sec: rest, usd: rest * this.deps.usdPerSec, cached: false, note: 'billed on this attempt, not tied to a finished stage' });
    }
    const l = this.ledgers.get(projectId) ?? { v: 1 as const, projectId, settled: [], entries: [] };
    this.ledgers.set(projectId, l);
    l.settled.push(at);
    this.commit();
  }

  /** The project was deleted: its ledger goes with it. */
  forget(projectId: string): void {
    if (this.ledgers.delete(projectId)) this.commit();
  }

  private commit(): void {
    this.version += 1;
    try {
      this.deps.storage?.setItem(LEDGER_KEY, JSON.stringify({ ledgers: [...this.ledgers.values()] }));
    } catch (err) { console.warn('[ledger] persist failed:', err); }
    for (const l of this.listeners) l();
  }
}

// ---------------------------------------------------------------------------
// Summary — what the popover shows. Pure over a ledger + the row's legacy
// attempt lines (attempts billed before the ledger existed: sum only).
// ---------------------------------------------------------------------------

export interface StageAttempt { attempt: number; usd: number; sec: number; cached: boolean; bootIncluded: boolean; note?: string }
export interface StageSummary { stage: LedgerStage; ran: boolean; usd: number; sec: number; cachedOnly: boolean; bootIncluded: boolean; attempts: StageAttempt[] }
export interface LedgerSummary {
  totalUsd: number;
  totalSec: number;
  stages: StageSummary[];
  /** Attempts the batch record billed that the ledger never saw: sum-only. */
  legacy: { attempt: number; sec: number; usd: number }[];
  paid: boolean;
}

export function summarizeLedger(
  ledger: Readonly<ProjectLedger> | undefined,
  billingAttempts: readonly { at: number; workerSec: number }[] | undefined,
  usdPerSec: number,
): LedgerSummary {
  const entries = ledger?.entries ?? [];
  const seen = new Set(ledger?.settled ?? []);
  const legacy = (billingAttempts ?? [])
    .map((a, i) => ({ a, attempt: i + 1 }))
    .filter(({ a }) => !seen.has(a.at))
    .map(({ a, attempt }) => ({ attempt, sec: a.workerSec, usd: a.workerSec * usdPerSec }));
  const order: LedgerStage[] = [...LEDGER_STAGES, ...(entries.some(e => e.stage === 'other') ? ['other' as const] : [])];
  const stages = order.map((stage): StageSummary => {
    const mine = entries.filter(e => e.stage === stage);
    return {
      stage,
      ran: mine.length > 0,
      usd: mine.reduce((s, e) => s + e.usd, 0),
      sec: mine.reduce((s, e) => s + e.sec, 0),
      cachedOnly: mine.length > 0 && mine.every(e => e.cached),
      bootIncluded: mine.some(e => e.bootIncluded),
      attempts: mine.map(e => ({ attempt: e.attempt, usd: e.usd, sec: e.sec, cached: e.cached, bootIncluded: !!e.bootIncluded, note: e.note })),
    };
  });
  const totalUsd = stages.reduce((s, x) => s + x.usd, 0) + legacy.reduce((s, x) => s + x.usd, 0);
  const totalSec = stages.reduce((s, x) => s + x.sec, 0) + legacy.reduce((s, x) => s + x.sec, 0);
  return { totalUsd, totalSec, stages, legacy, paid: totalUsd > 0 };
}

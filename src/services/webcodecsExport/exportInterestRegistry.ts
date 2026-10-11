/**
 * Who still needs which export sessions — the collector's "do not touch" list.
 *
 * The abandoned-session collector runs at every export start. Before this, the
 * only things it knew to keep were that export's own offer and fresh session,
 * so it deleted checkpoints other work was about to use (a bulk row waiting to
 * Retry, another project's cancelled run). Owners now publish their interest
 * here and the collector skips it:
 *   - a PROJECT interest ("bulk has a queued / running / awaiting-Retry row for
 *     this project") keeps every session of that project from any OTHER
 *     owner's collector;
 *   - a SESSION interest ("this run is using this session") keeps that session
 *     from every collector.
 *
 * One instance per app, created by the caller and passed down — never a module
 * singleton. Each owner REPLACES its own sets, so a stale entry cannot outlive
 * the owner's next publish, and `clear` withdraws everything it held.
 */
export interface ExportInterestView {
  /** Session ids some owner needs kept. */
  protectedSessionIds(): ReadonlySet<string>;
  /** True when an owner other than `owner` has live interest in `projectId`. */
  heldByOther(projectId: string, owner: string | undefined): boolean;
}

export class ExportInterestRegistry implements ExportInterestView {
  private readonly projects = new Map<string, ReadonlySet<string>>();
  private readonly sessions = new Map<string, ReadonlySet<string>>();

  /** Replaces `owner`'s project interests. */
  setProjects(owner: string, projectIds: Iterable<string>): void {
    const next = new Set(projectIds);
    if (next.size === 0) this.projects.delete(owner);
    else this.projects.set(owner, next);
  }

  /** Replaces `owner`'s session interests. */
  setSessions(owner: string, sessionIds: Iterable<string>): void {
    const next = new Set([...sessionIds].filter((id) => id.length > 0));
    if (next.size === 0) this.sessions.delete(owner);
    else this.sessions.set(owner, next);
  }

  /** Withdraws everything `owner` published. */
  clear(owner: string): void {
    this.projects.delete(owner);
    this.sessions.delete(owner);
  }

  protectedSessionIds(): ReadonlySet<string> {
    const all = new Set<string>();
    for (const ids of this.sessions.values()) for (const id of ids) all.add(id);
    return all;
  }

  heldByOther(projectId: string, owner: string | undefined): boolean {
    for (const [holder, ids] of this.projects) {
      if (holder !== owner && ids.has(projectId)) return true;
    }
    return false;
  }

  /** What is held, for diagnostics and tests. */
  snapshot(): { projects: Record<string, string[]>; sessions: Record<string, string[]> } {
    return {
      projects: Object.fromEntries([...this.projects].map(([o, ids]) => [o, [...ids]])),
      sessions: Object.fromEntries([...this.sessions].map(([o, ids]) => [o, [...ids]])),
    };
  }
}

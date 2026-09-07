/**
 * THROWAWAY — Round 6 autorun: 40s equivalence, then ceiling suite.
 */

import { persistLivenessReport } from './autorunFlag';
import { runRound6Equivalence40s, runRound6CeilingSuite } from './runRound6';
import { isTauri } from '../../services/tauriFfmpeg';

const LOCK_PREFIX = 'ws3-r6-autorun-lock-v10-';
const AUTORUN_URL = '/_spike/ws3-autorun.json';

async function readPhase(): Promise<'equiv-40s' | 'ceiling' | 'all' | null> {
  try {
    const resp = await fetch(AUTORUN_URL, { cache: 'no-store' });
    if (!resp.ok) return null;
    const body = (await resp.text()).trim();
    if (body === 'run') return 'all';
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as { run?: boolean; phase?: string };
    if (rec.run !== true) return null;
    if (rec.phase === 'equiv-40s' || rec.phase === 'ceiling' || rec.phase === 'all') return rec.phase;
    return 'all';
  } catch {
    return null;
  }
}

void (async () => {
  try {
    if (!isTauri()) return;
    const phase = await readPhase();
    if (!phase) return;
    const lock = `${LOCK_PREFIX}${phase}`;
    if (sessionStorage.getItem(lock) === '1') return;
    sessionStorage.setItem(lock, '1');
    persistLivenessReport('round6-autorun-start', { t: Date.now(), phase });

    if (phase === 'equiv-40s' || phase === 'all') {
      const equiv = await runRound6Equivalence40s();
      persistLivenessReport('round6-equiv-40s', equiv);
    }
    if (phase === 'ceiling' || phase === 'all') {
      const ceiling = await runRound6CeilingSuite();
      persistLivenessReport('round6-ceiling', ceiling);
    }
  } catch (e) {
    persistLivenessReport('round6-autorun-error', { message: e instanceof Error ? e.message : String(e) });
  }
})();

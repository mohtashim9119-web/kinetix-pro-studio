/**
 * THROWAWAY — Part C autorun: 500-segment transitioned live export, then the
 * 40s digest-reproducibility check.
 */

import { persistLivenessReport } from './autorunFlag';
import { runPartC500, runPartCDigestRepro40s } from './runPartC';
import { isTauri } from '../../services/tauriFfmpeg';

const LOCK_PREFIX = 'ws3-partc-autorun-lock-v1-';
const AUTORUN_URL = '/_spike/ws3-autorun.json';

async function readPhase(): Promise<'part-c-500' | 'part-c-digest' | 'part-c-all' | null> {
  try {
    const resp = await fetch(AUTORUN_URL, { cache: 'no-store' });
    if (!resp.ok) return null;
    const parsed: unknown = JSON.parse((await resp.text()).trim());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as { run?: boolean; phase?: string; label?: string };
    if (rec.run !== true) return null;
    if (rec.phase === 'part-c-500' || rec.phase === 'part-c-digest' || rec.phase === 'part-c-all') return rec.phase;
    return null;
  } catch {
    return null;
  }
}

async function readLabel(): Promise<string | null> {
  try {
    const resp = await fetch(AUTORUN_URL, { cache: 'no-store' });
    if (!resp.ok) return null;
    const parsed: unknown = JSON.parse((await resp.text()).trim());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const label = (parsed as { label?: string }).label;
    return typeof label === 'string' ? label : null;
  } catch {
    return null;
  }
}

void (async () => {
  try {
    if (!isTauri()) return;
    const phase = await readPhase();
    if (!phase) return;
    const label = await readLabel();
    const lock = `${LOCK_PREFIX}${phase}${label ? `-${label}` : ''}`;
    if (sessionStorage.getItem(lock) === '1') return;
    sessionStorage.setItem(lock, '1');
    persistLivenessReport('part-c-autorun-start', { t: Date.now(), phase, label });

    if (phase === 'part-c-500' || phase === 'part-c-all') {
      const row = await runPartC500();
      persistLivenessReport('part-c-500-done', row);
    }
    if (phase === 'part-c-digest' || phase === 'part-c-all') {
      const digest = await runPartCDigestRepro40s();
      persistLivenessReport('part-c-digest-done', digest);
    }
  } catch (e) {
    persistLivenessReport('part-c-autorun-error', { message: e instanceof Error ? e.message : String(e) });
  }
})();

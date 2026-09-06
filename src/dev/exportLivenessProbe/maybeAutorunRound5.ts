/**
 * THROWAWAY — Round 5 autorun: pipeline bisection arms, then variant quantities.
 */

import { shouldAutorun, persistLivenessReport } from './autorunFlag';
import { runVariantQuantities } from './runVariantQuantities';
import { isTauri } from '../../services/tauriFfmpeg';

const LOCK = 'ws3-r5-autorun-lock-v6';

void (async () => {
  try {
    if (!isTauri()) return;
    if (sessionStorage.getItem(LOCK) === '1') return;
    if (!(await shouldAutorun())) return;
    sessionStorage.setItem(LOCK, '1');
    persistLivenessReport('round5-autorun-start', { t: Date.now() });

    const remaining = ['720p-30fps', 'longer-timeline-same-frames', '1-unique-video'];
    persistLivenessReport('round5-resume-variants', { remaining });
    const quantities = await runVariantQuantities(remaining);
    persistLivenessReport('round5-quantities-remainder', quantities);
  } catch (e) {
    persistLivenessReport('round5-autorun-error', { message: e instanceof Error ? e.message : String(e) });
  }
})();

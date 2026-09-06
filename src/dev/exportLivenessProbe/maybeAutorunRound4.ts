/**
 * THROWAWAY — Round 4 autorun: encoder isolation first, then variant quantities.
 */

import { shouldAutorun, persistLivenessReport } from './autorunFlag';
import { runEncoderIsolation, runEncoderIsolationSuite } from './runEncoderIsolation';
import { runVariantQuantities } from './runVariantQuantities';
import { isTauri } from '../../services/tauriFfmpeg';

const LOCK = 'ws3-r4-autorun-lock-v1';

void (async () => {
  try {
    if (!isTauri()) return;
    if (sessionStorage.getItem(LOCK) === '1') return;
    if (!(await shouldAutorun())) return;
    sessionStorage.setItem(LOCK, '1');
    persistLivenessReport('round4-autorun-start', { t: Date.now() });

    const encoderOnly = await runEncoderIsolation('encoder-only');
    persistLivenessReport('round4-encoder-only', encoderOnly);

    if (encoderOnly.failure === null && encoderOnly.framesEncoded >= encoderOnly.framesTarget) {
      persistLivenessReport('round4-stop', {
        reason: 'encoder-only clean to 200s — ceiling is pipeline not platform',
        encoderOnly,
      });
      return;
    }

    const suite = await runEncoderIsolationSuite();
    persistLivenessReport('round4-encoder-suite', suite);

    const quantities = await runVariantQuantities();
    persistLivenessReport('round4-quantities', quantities);
  } catch (e) {
    persistLivenessReport('round4-autorun-error', { message: e instanceof Error ? e.message : String(e) });
  }
})();

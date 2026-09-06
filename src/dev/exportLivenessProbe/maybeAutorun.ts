/**
 * THROWAWAY — if /_spike/ws3-autorun.json says run, execute Part 1 + live
 * export inside the Tauri webview. Imported only from main.tsx behind
 * `import.meta.env.DEV`. Vite HMR of this file reloads the page.
 */

import { shouldAutorun, persistLivenessReport } from './autorunFlag';
import { runTickProbe } from './runTickProbe';
import { runLiveExport } from './runLiveExport';
import { runCeilingBisect } from './runCeilingBisect';

const LOCK = 'ws3-r3-live-export-lock-v1';

void (async () => {
  try {
    persistLivenessReport('autorun-boot', { href: location.href, ua: navigator.userAgent, t: Date.now() });
    if (sessionStorage.getItem(LOCK) === '1') {
      persistLivenessReport('autorun-locked', { href: location.href, t: Date.now() });
      return;
    }
    if (!(await shouldAutorun())) {
      persistLivenessReport('autorun-skipped', { href: location.href, t: Date.now() });
      return;
    }
    sessionStorage.setItem(LOCK, '1');
    persistLivenessReport('autorun-starting', { href: location.href, t: Date.now() });
    // eslint-disable-next-line no-console
    console.info('[ws3-liveness] autorun starting part1 + live export');
    await runTickProbe();
    const live = await runLiveExport();
    persistLivenessReport('round3-live', live);
    const bisect = await runCeilingBisect(['baseline-30fps-1080p-4assets', '15fps-same-timeline', '720p-30fps', 'longer-timeline-same-frames', '1-unique-video']);
    persistLivenessReport('round3-bisect', bisect);
  } catch (e) {
    persistLivenessReport('autorun-error', { message: e instanceof Error ? e.message : String(e), t: Date.now() });
    // eslint-disable-next-line no-console
    console.info('[ws3-liveness] autorun error', e instanceof Error ? e.message : String(e));
  }
})();

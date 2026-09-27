/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// U4 hotfix — source pins on App.tsx's cloud-pause answers. The operator's
// click check found both staging-dialog buttons were no-ops: they re-drove
// `handleVoiceoverStaged` with the pending file through the plain re-drop
// path, which refuses it (runtime probe: `EARLY-RETURN same-file-already-
// pending`), and the local choice lived in a ref a reload wiped. Render
// tests proved the buttons existed, not that they acted; these pin the
// wiring the fix depends on. Fail on dac689a.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const APP = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');

function body(name: string): string {
  const start = APP.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = APP.indexOf('\n  }, [', start);
  return APP.slice(start, end);
}

describe('U4 hotfix — the cloud-pause answers actually act', () => {
  it('"Try the cloud again" re-drives staging as an explicit re-run', () => {
    expect(body('handleCloudTranscriptionRetry')).toMatch(/handleVoiceoverStaged\(pending\.file, \{ rerun: true \}\)/);
  });

  it('"Transcribe on this computer" records the choice (persisted) BEFORE re-driving staging as a re-run', () => {
    const b = body('handleCloudTranscriptionUseLocal');
    const save = b.indexOf('saveRunHostOverride(');
    const rerun = b.search(/handleVoiceoverStaged\(pending\.file, \{ rerun: true \}\)/);
    expect(save).toBeGreaterThan(-1);
    expect(rerun).toBeGreaterThan(save);
  });

  it('Apply Sync\'s "run this sync on this computer" persists the choice, then takes the Retry path', () => {
    const b = body('handleSyncPausedUseLocal');
    expect(b.indexOf('saveRunHostOverride(')).toBeGreaterThan(-1);
    expect(b.indexOf('handleSyncPausedRetry()')).toBeGreaterThan(b.indexOf('saveRunHostOverride('));
  });

  it('the override is never held in a React ref again (a reload would wipe it)', () => {
    expect(APP).not.toMatch(/useRef<RunHostOverride/);
    expect(APP).toMatch(/hostForRun\(readSyncEngineHost\(\), readRunHostOverride\(projectRef\.current\.id\)/);
  });

  it('the staging guard is the shared decision, with the re-run flag threaded through', () => {
    expect(APP).toMatch(/const handleVoiceoverStaged = useCallback\(\(file: File, opts\?: \{ rerun\?: boolean \}\)/);
    expect(APP).toMatch(/shouldStartStaging\(\{[\s\S]{0,200}rerun: opts\?\.rerun === true/);
  });
});

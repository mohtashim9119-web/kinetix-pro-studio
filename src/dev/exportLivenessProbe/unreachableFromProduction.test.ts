/**
 * Guards the throwaway Round 2 fixture/probe: no production src/ file may
 * import this directory. src/dev/ itself and this test are excluded.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');
const MARKER = 'dev/exportLivenessProbe';

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'exportLivenessProbe') continue;
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('exportLivenessProbe is unreachable from production', () => {
  it('no non-dev src/ file imports src/dev/exportLivenessProbe', () => {
    const hits: string[] = [];
    for (const full of collectSourceFiles(SRC)) {
      const rel = relative(SRC, full).split('\\').join('/');
      if (rel.startsWith('dev/')) continue;
      if (/\.test\.tsx?$/.test(rel)) continue;
      const src = readFileSync(full, 'utf8');
      if (!(src.includes(MARKER) || src.includes('exportLivenessProbe'))) continue;
      // main.tsx may dynamically import the autorun ONLY inside a DEV gate —
      // Vite DCE drops that branch from the production bundle.
      if (rel === 'main.tsx' && src.includes('import.meta.env.DEV')) continue;
      hits.push(rel);
    }
    expect(hits).toEqual([]);
  });
});

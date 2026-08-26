/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session M — onnxruntime bundle guards. Two classes made impossible, not
// two instances fixed (the same intent as `faDefaultDrift.test.ts`).
//
// THE FINDING THIS EXISTS TO PREVENT RECURRING. For the entire programme, the
// forced-alignment runtime was resolved via `ORT_DYLIB_PATH` pointing at a dylib
// inside `.work-phase4/spike-runtime` — a gitignored Python-spike scratch
// directory, outside the repo's control and never on a shipped code path. The
// app never set that variable, so forced alignment had never once executed
// inside the application, and every fixture in the record came from that
// out-of-tree driver. Session M bundles the dylib as a real Tauri resource and
// has the app resolve it itself (ruling R-N).
//
// GUARD 1 (class: a shipped runtime dependency resolves into throwaway scratch).
// No production code path — the runtime resolver in `fa_onnx.rs`, and the
// bundle declaration in `tauri.conf.json` — may point a runtime dependency into
// a gitignored SCRATCH directory (`.work-phase4`, `spike-runtime`, the phase-4
// venvs, the listening-clip stores). NB this is deliberately the scratch class,
// NOT "any gitignored path": the whisper `.bin` model and the ffmpeg/whisper
// sidecars are themselves gitignored-but-provisioned resources, and the
// onnxruntime dylib now joins them — being gitignored is the NORMAL state of a
// large bundled binary. What must never happen is a shipped path reaching into
// throwaway spike scratch.
//
// GUARD 2 (class: the bundled runtime version drifts from what `ort` requires).
// The committed manifest's onnxruntime API version must equal the version the
// pinned `ort` in `Cargo.toml` computes (ort-sys `version.rs`: 17 + one per
// enabled `api-NN` feature), and the bundled minor version must clear it. A
// future `ort` bump that raises the required C-API version fails HERE, loudly,
// instead of silently at the first in-app FA call.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SRC_TAURI = resolve(REPO, 'src-tauri');

const CARGO_TOML = readFileSync(resolve(SRC_TAURI, 'Cargo.toml'), 'utf8');
const TAURI_CONF = JSON.parse(readFileSync(resolve(SRC_TAURI, 'tauri.conf.json'), 'utf8'));
const MANIFEST = JSON.parse(
  readFileSync(resolve(SRC_TAURI, 'onnxruntime', 'onnxruntime.manifest.json'), 'utf8'),
);
const FA_ONNX_RS = readFileSync(resolve(SRC_TAURI, 'src', 'fa_onnx.rs'), 'utf8');

/** Gitignored THROWAWAY scratch directories — never a shipped runtime path.
 *  (Distinct from gitignored-but-provisioned bundle resources like the whisper
 *  model or the sidecars, which are a normal part of the bundle.) */
const FORBIDDEN_SCRATCH = ['.work-phase4', 'spike-runtime', '.venv-phase4', '.listening-clips', '.answer-keys'];

/** Extracts one `fn`/`pub fn <name>` body from Rust source by brace-matching,
 *  so a guard can scan the EXECUTABLE body of a production resolver without
 *  tripping on the many legitimate `.work-phase4` mentions in this file's doc
 *  comments and `#[cfg(test)]` modules. Returns the body between the first `{`
 *  after the signature and its matching `}`. */
function extractFnBody(src: string, fnName: string): string {
  const sig = new RegExp(`fn\\s+${fnName}\\s*(?:<[^>]*>)?\\s*\\(`);
  const m = sig.exec(src);
  if (!m) throw new Error(`resolver fn ${fnName} not found in fa_onnx.rs — did it get renamed?`);
  const open = src.indexOf('{', m.index);
  if (open === -1) throw new Error(`no opening brace for fn ${fnName}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated body for fn ${fnName}`);
}

/** Strips Rust line comments and block comments, so the guard scans EXECUTABLE
 *  code only. A comment that mentions `.work-phase4` to explain that we
 *  deliberately do NOT resolve into it is documentation, not a code path, and
 *  must not trip the guard. */
function stripComments(src: string): string {
  const block = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const line = new RegExp('//[^\\n]*', 'g');
  return src.replace(block, ' ').replace(line, ' ');
}

describe('GUARD 1 — no shipped runtime dependency resolves into throwaway scratch', () => {
  // The production runtime resolver. Its whole job is to point `ORT_DYLIB_PATH`
  // at the bundled library; a scratch path anywhere in its executable body is
  // exactly the class Session M closes.
  for (const fn of ['ensure_ort_dylib', 'resolve_bundled_ort_dylib', 'probe_ort_runtime', 'align_chunked_for_language']) {
    it(`fa_onnx.rs::${fn} body names no throwaway scratch directory`, () => {
      const body = stripComments(extractFnBody(FA_ONNX_RS, fn));
      const hits = FORBIDDEN_SCRATCH.filter((s) => body.includes(s));
      expect(
        hits,
        `${fn} resolves a runtime path into gitignored scratch (${hits.join(', ')}). ` +
          'Runtime dependencies ship as committed/provisioned Tauri resources, never from spike scratch.',
      ).toEqual([]);
    });
  }

  it('tauri.conf.json bundles no resource or external binary from scratch', () => {
    const resourcePaths: string[] = [
      ...Object.keys(TAURI_CONF.bundle?.resources ?? {}),
      ...Object.values(TAURI_CONF.bundle?.resources ?? {}).map(String),
      ...(TAURI_CONF.bundle?.externalBin ?? []),
    ];
    const offenders = resourcePaths.filter((p) => FORBIDDEN_SCRATCH.some((s) => p.includes(s)));
    expect(offenders, `bundle points into scratch: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the onnxruntime runtime IS bundled as a committed resource (the fix is actually wired)', () => {
    const keys = Object.keys(TAURI_CONF.bundle?.resources ?? {});
    expect(
      keys.some((k) => k.startsWith('onnxruntime/')),
      'tauri.conf.json must bundle onnxruntime/* as a resource — otherwise the app cannot resolve its own runtime.',
    ).toBe(true);
  });
});

// WS2 Step 13 Phase 4 — widened from a single flat manifest object to a
// `targets` array, one row per (os, arch) `fa_onnx.rs::SUPPORTED_ORT_TARGETS`
// accepts. `onnxruntime_providers_shared.dll` is a same-directory DEPENDENCY
// of the Windows `onnxruntime.dll` row, not a second engine — it carries no
// `apiVersion`/`minorVersion` of its own and is excluded from Guard 2's
// per-engine version checks (still covered by the "fully specified" and
// sha256-shape checks via a separate, narrower assertion).
const ENGINE_TARGETS: Array<Record<string, unknown>> = (MANIFEST.targets ?? []).filter(
  (t: Record<string, unknown>) => t.apiVersion !== undefined,
);
const DEPENDENCY_TARGETS: Array<Record<string, unknown>> = (MANIFEST.targets ?? []).filter(
  (t: Record<string, unknown>) => t.apiVersion === undefined,
);

describe('GUARD 2 — the bundled onnxruntime version matches what the pinned ort requires', () => {
  /** The onnxruntime C-API version the pinned `ort` computes, replicating
   *  ort-sys `version.rs`: 17 (the floor) plus one per enabled `api-NN`
   *  feature, which chain cumulatively (api-22 implies 18..22), so the required
   *  version is the highest `api-NN` listed, or 17 when none is. */
  function requiredApiVersionFromCargo(): number {
    const ortLine = CARGO_TOML.split('\n').find((l) => l.trimStart().startsWith('ort ='));
    if (!ortLine) throw new Error('no `ort =` dependency line in Cargo.toml');
    const featuresMatch = /features\s*=\s*\[([^\]]*)\]/.exec(ortLine);
    const features = featuresMatch?.[1] ?? '';
    const apiNumbers = [...features.matchAll(/api-(\d+)/g)].map((m) => Number(m[1]));
    return apiNumbers.length > 0 ? Math.max(...apiNumbers) : 17;
  }

  it('the ort pin is exactly =2.0.0-rc.13 — a bump must force re-deriving this mapping', () => {
    // Guard 2's math (and the manifest's apiVersionRationale) is verified
    // against rc.13's version.rs. If the pin moves, the version→API mapping may
    // move with it; break here so a human re-checks rather than the app failing
    // silently at the first FA call.
    expect(CARGO_TOML).toMatch(/ort\s*=\s*\{\s*version\s*=\s*"=2\.0\.0-rc\.13"/);
  });

  it('at least one engine target is declared', () => {
    expect(ENGINE_TARGETS.length).toBeGreaterThan(0);
  });

  it.each(ENGINE_TARGETS.map((t) => [`${t.os}-${t.arch}`, t] as const))(
    '%s: apiVersion equals the required onnxruntime C-API version',
    (_label, target) => {
      const required = requiredApiVersionFromCargo();
      expect(target.apiVersion).toBe(required);
    },
  );

  it.each(ENGINE_TARGETS.map((t) => [`${t.os}-${t.arch}`, t] as const))(
    '%s: the bundled minor version clears the required API version',
    (_label, target) => {
      expect(target.minorVersion as number).toBeGreaterThanOrEqual(target.apiVersion as number);
    },
  );

  it.each(ENGINE_TARGETS.map((t) => [`${t.os}-${t.arch}`, t] as const))(
    '%s: minorVersion agrees with version',
    (_label, target) => {
      const minorFromVersion = Number(String(target.version).split('.')[1]);
      expect(target.minorVersion).toBe(minorFromVersion);
    },
  );

  it('every SUPPORTED_ORT_TARGETS row in fa_onnx.rs has a matching manifest engine target', () => {
    // Mirrors extractFnBody's brace-matching approach to pull just the
    // SUPPORTED_ORT_TARGETS array literal, so this doesn't need a full Rust
    // parser — a regex over the whole file could false-match unrelated
    // "os:"/"arch:" text elsewhere.
    const tableMatch = /const SUPPORTED_ORT_TARGETS:[^=]*=\s*&\[([\s\S]*?)\];/.exec(FA_ONNX_RS);
    expect(tableMatch, 'SUPPORTED_ORT_TARGETS not found in fa_onnx.rs').not.toBeNull();
    const tableBody: string = tableMatch?.[1] ?? '';
    const rows = [...tableBody.matchAll(/os:\s*"([^"]+)",\s*arch:\s*"([^"]+)",\s*filename:\s*([A-Z_]+)/g)];
    expect(rows.length).toBeGreaterThan(0);
    for (const [, os, arch, filenameConst] of rows) {
      const manifestRow = ENGINE_TARGETS.find((t) => t.os === os && t.arch === arch);
      expect(manifestRow, `fa_onnx.rs declares ${os}-${arch} but the manifest has no engine target for it`).toBeDefined();
      // The Rust side references a FILENAME CONSTANT (ORT_DYLIB_FILENAME_MACOS
      // / _WINDOWS), not a literal — resolve it the same way, rather than
      // regex-matching a filename string that isn't in this snippet.
      const constDef = new RegExp(`const ${filenameConst}:\\s*&str\\s*=\\s*"([^"]+)"`).exec(FA_ONNX_RS);
      expect(constDef, `${filenameConst} constant not found in fa_onnx.rs`).not.toBeNull();
      expect(manifestRow!.filename).toBe(constDef![1]);
    }
  });

  it('the manifest is fully specified (no silently-empty guard)', () => {
    for (const target of ENGINE_TARGETS) {
      for (const key of ['filename', 'version', 'minorVersion', 'apiVersion', 'os', 'arch', 'sha256']) {
        expect(target[key], `engine target ${target.os}-${target.arch} is missing ${key}`).toBeDefined();
      }
      expect(String(target.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const target of DEPENDENCY_TARGETS) {
      for (const key of ['filename', 'os', 'arch', 'sha256']) {
        expect(target[key], `dependency target ${target.os}-${target.arch}/${target.filename} is missing ${key}`).toBeDefined();
      }
      expect(String(target.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

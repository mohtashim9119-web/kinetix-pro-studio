/**
 * PROMPT 28 (Round 22) — shared, dependency-free types for export-path
 * selection diagnostics and the grade-loss fail-loud refusal.
 *
 * Deliberately its own file with NO imports from `useExport.ts` or
 * `exportPipelineWebCodecs.ts`: `exportPipeline.ts` (the legacy pipeline,
 * which `exportPipelineWebCodecs.ts` itself imports from) needs
 * `WebCodecsCapabilityFailureCode` on `ExportError.gradeLossRefusal`, and
 * `useExport.ts` needs the same type for its capability diagnosis. Putting
 * both in one leaf module avoids a hook file importing from a pipeline file
 * that imports back from the hook, or from `exportPipeline.ts` importing
 * from `exportPipelineWebCodecs.ts` (the reverse of every existing import
 * in this codebase).
 */
import type { WebGL2SupportDiagnosis } from '../gl/glContext';

/**
 * Which of the five `isWebCodecsExportCapable()` clauses failed, in
 * evaluation order. `no-window` is the one clause that, when true, means
 * none of the others were safely checkable.
 */
export type WebCodecsCapabilityFailureCode =
  | 'no-window'
  | 'no-webcodecs'
  | 'no-webgl2'
  | 'no-worker'
  | 'no-module-worker';

export interface WebCodecsCapabilityDiagnosis {
  capable: boolean;
  failures: readonly WebCodecsCapabilityFailureCode[];
  /** Only set when `no-webgl2` is among `failures`. */
  webgl2Failure: WebGL2SupportDiagnosis | null;
}

/**
 * STEP 2 (CRITICAL) — a project carries a non-neutral `effectGrade` on at
 * least one segment that would be rendered by the canvas/legacy path
 * (which has no grade renderer — see `glCompositable.ts` and
 * `docs/ws3-export-pipeline/export-path-selection-audit.md` STEP 3). Recorded on
 * `ExportError.gradeLossRefusal` so the UI and diagnostics blob can name
 * exactly why the export was refused before any work started.
 */
export interface GradeLossRefusal {
  /** Zero-based indices into `project.segments` that carry a non-neutral
   *  `effectGrade` and would land on a path with no grade renderer. */
  affectedSegmentIndices: readonly number[];
  /** Non-null when the refusal is because the TOP-LEVEL gate is closed
   *  (whole project routes to legacy) — names which capability clauses
   *  failed. Null when the gate is open but per-segment tier routing put
   *  a graded segment on the canvas tier within WebCodecs. */
  failedGateClauses: readonly WebCodecsCapabilityFailureCode[] | null;
  remediation: readonly string[];
}

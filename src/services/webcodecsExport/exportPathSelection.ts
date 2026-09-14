/**
 * PROMPT 28 (Round 22) — export-path-selection support: grade-loss detection
 * and the diagnostics shape recorded on every run (`exportPathSelection`).
 *
 * See `docs/ws3-export-pipeline/export-path-selection-audit.md` for the full
 * investigation this implements. Summary of the defect this file exists to
 * close: the canvas/legacy paths (`frameRenderer.ts`/`segmentEncoder.ts`)
 * have NO renderer for `VideoSegment.effectGrade` — it is GL-only
 * (`services/gl/compositeParams.ts`). A project carrying a non-neutral grade
 * that lands on either path today exports successfully, silently missing
 * the grade. This module identifies exactly which segments would lose their
 * grade before any encoding starts, so the caller (`useExport.ts`) can
 * refuse instead of shipping a silently-wrong file.
 */
import type { Project, SegmentGrade } from '../../types';
import type { WebCodecsRoutingSummary } from './exportPipelineWebCodecs';
import type {
  GradeLossRefusal,
  WebCodecsCapabilityFailureCode,
} from './exportPathSelectionTypes';

/** `0`/`undefined` on every channel is the neutral grade — matches
 *  `compositeParams.ts`'s own `NEUTRAL_GRADE` fallback semantics without
 *  importing the GL module from this pipeline-selection file. */
export function isNeutralGrade(grade: SegmentGrade | undefined): boolean {
  if (!grade) return true;
  return grade.brightness === 0 && grade.contrast === 0 && grade.saturation === 0 && grade.temperature === 0;
}

/**
 * Every segment index (into `project.segments`) that carries a non-neutral
 * `effectGrade`.
 */
export function nonNeutralGradeSegmentIndices(project: Project): number[] {
  const indices: number[] = [];
  project.segments.forEach((segment, index) => {
    if (!isNeutralGrade(segment.effectGrade)) indices.push(index);
  });
  return indices;
}

/**
 * Segment indices whose tier (per `routing.pieces`) is `'canvas'` — the
 * WebCodecs-internal tier with no grade renderer, same gap as the top-level
 * legacy path. `pieces[].startIndex`/`segmentCount` partition
 * `project.segments` contiguously and completely (see `buildPiecePlans`),
 * so walking them reconstructs the per-segment tier without needing a
 * separate export from `exportPipelineWebCodecs.ts`.
 */
function canvasTierSegmentIndices(routing: WebCodecsRoutingSummary): Set<number> {
  const indices = new Set<number>();
  for (const piece of routing.pieces) {
    if (piece.tier !== 'canvas') continue;
    for (let i = piece.startIndex; i < piece.startIndex + piece.segmentCount; i++) indices.add(i);
  }
  return indices;
}

/**
 * The refusal decision itself (STEP 2 policy, CC-confirmed scope: hard-
 * refuse ONLY on grade loss — every other canvas-routed feature already
 * renders correctly on canvas, see the parity matrix in the audit doc, so
 * those cases get the slow-path warning (5.2) instead of a refusal).
 *
 * - `gateOpen: false` — the WHOLE project runs on the legacy path, which has
 *   no grade renderer at all: ANY non-neutral-grade segment triggers refusal.
 * - `gateOpen: true` — only segments whose tier resolved to `'canvas'`
 *   within WebCodecs lose their grade; GL-tier segments render it correctly.
 */
export function evaluateGradeLossRefusal(
  project: Project,
  args: { gateOpen: boolean; capabilityFailures: readonly WebCodecsCapabilityFailureCode[]; routing: WebCodecsRoutingSummary | null },
): GradeLossRefusal | null {
  const gradedIndices = nonNeutralGradeSegmentIndices(project);
  if (gradedIndices.length === 0) return null;

  const affected = args.gateOpen && args.routing
    ? gradedIndices.filter((i) => canvasTierSegmentIndices(args.routing!).has(i))
    : gradedIndices;

  if (affected.length === 0) return null;

  const remediation = args.gateOpen
    ? [
        'This project mixes a color grade with an effect that cannot run on the accelerated (GL) export path on the affected segment(s).',
        'Remove the color grade from the affected segment(s), or remove the conflicting filter/transition/animation so the segment qualifies for the GL path.',
      ]
    : [
        'This machine cannot use the accelerated (GL) export path, and the compatibility path cannot render color grade.',
        'Update your GPU driver, ensure hardware acceleration is enabled, and avoid remote/virtual-desktop sessions without GPU passthrough, then retry.',
        'See docs/ws3-export-pipeline/windows-throughput-audit.md for the WebView2/driver diagnostic steps.',
      ];

  return {
    affectedSegmentIndices: affected,
    failedGateClauses: args.gateOpen ? null : args.capabilityFailures,
    remediation,
  };
}

/** The full `exportPathSelection` diagnostics block (STEP 1 / audit §5.1). */
export interface ExportPathSelectionDiagnostics {
  topLevelPath: 'webcodecs' | 'legacy';
  gate: {
    capable: boolean;
    toggleOn: boolean;
    open: boolean;
    capabilityFailures: readonly WebCodecsCapabilityFailureCode[];
  };
  routing: WebCodecsRoutingSummary | null;
  progressInterpretation: {
    pieceOrSegmentTotal: number;
    encoderSessionsPlanned: number | null;
  };
}

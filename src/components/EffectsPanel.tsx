import { useState, useRef, useMemo, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shuffle, ChevronDown, Save, Trash2, Wand2, RotateCcw, Ban } from "lucide-react";
import {
  TRANSITIONS,
  ANIMATIONS,
  ANIMATIONS_VISIBLE,
  OVERLAYS,
  OVERLAYS_VISIBLE,
  TRANSITION_NONE,
  ANIMATION_NONE,
  OVERLAY_NONE,
  type EffectOption,
} from "../effectsOptions";
import type { SegmentGrade } from "../types";

/* ============================================================
   Kinetix Pro Studio — Effects Panel
   React + TypeScript + Tailwind + Framer Motion
   ============================================================ */

/* ---------- Types ---------- */

export type ApplyScope = "selected" | "all";

export interface Preset {
  id: string;
  name: string;
  transition: string;
  transitionDur: number;
  animation: string;
  animationDur: number;
  overlay: string;
}

export type ApplyEvent =
  | { type: "transition"; scope: ApplyScope; value: string; duration: number }
  | { type: "animation"; scope: ApplyScope; value: string; duration: number }
  | { type: "overlay"; scope: ApplyScope; value: string }
  | { type: "randomize-transitions"; pool: string[] }
  | { type: "randomize-animations"; pool: string[] }
  | { type: "grade"; scope: ApplyScope; value: SegmentGrade }
  | { type: "grade-clear"; scope: ApplyScope }
  | { type: "preset"; scope: ApplyScope; preset: Preset };

export const NEUTRAL_GRADE: SegmentGrade = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

const GRADE_CHANNELS: { key: keyof SegmentGrade; label: string }[] = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "temperature", label: "Temperature" },
];

const isNeutralGrade = (g: SegmentGrade): boolean =>
  g.brightness === 0 && g.contrast === 0 && g.saturation === 0 && g.temperature === 0;

/** Value equality (not reference) — used by GradeSection's sync effect (grade
 *  bug audit Fix B) so an unrelated parent re-render that produces a new
 *  activeGrade object with the SAME field values doesn't count as "the stored
 *  grade changed" and re-sync/clobber a not-yet-applied slider draft. */
const gradesEqual = (a: SegmentGrade, b: SegmentGrade): boolean =>
  a.brightness === b.brightness && a.contrast === b.contrast && a.saturation === b.saturation && a.temperature === b.temperature;

/** Result summary of an auto-grade run, surfaced back to the Auto button's flash. */
export interface AutoGradeResult {
  applied: number;
  failed: number;
}

export interface EffectsPanelProps {
  /** Seed presets on mount (e.g. loaded from a Tauri store). */
  initialPresets?: Preset[];
  /** Fired whenever the presets list changes — persist it here. */
  onPresetsChange?: (presets: Preset[]) => void;
  /** Fired when any "Apply" button is pressed. Wire this to your timeline. */
  onApply?: (event: ApplyEvent) => void;
  /** One-shot auto color-grade over the given scope's segments. Async: samples
   *  one clean source frame per segment (owned by the preview stage), computes
   *  per-segment grade values, writes them, and reports how many succeeded /
   *  had no analyzable frame. Absent = the Auto buttons are inert. */
  onAutoGrade?: (scope: ApplyScope) => Promise<AutoGradeResult>;
  /** Live grade write-through, debounced by the GRADE section: fired while the
   *  sliders are dragged so the preview updates without an Apply click. Wire it
   *  to write effectGrade on the ACTIVE segment only — the same one
   *  activeGrade/activeGradeSegmentId identify. Absent = sliders are
   *  draft-only until Apply (the pre-live-preview behavior). */
  onGradeLive?: (grade: SegmentGrade) => void;
  /** Grade to sync the GRADE section's sliders FROM (grade bug audit Fix B) —
   *  the single selected segment's effectGrade if exactly one segment is
   *  selected, else the playhead segment's, else NEUTRAL_GRADE. Paired with
   *  activeGradeSegmentId. Absent = sliders never sync from a segment (pure
   *  local authoring, the pre-fix behavior). */
  activeGrade?: SegmentGrade;
  /** Id of the segment activeGrade was read from, or undefined if none — lets
   *  the sync effect distinguish "a different segment is now active" from
   *  "same segment, its stored grade changed value" (both should re-sync). */
  activeGradeSegmentId?: string;
  /** Count of segments currently batch-selected (drives "Apply to selected (N)").
   *  Distinct from the per-block randomize `picks` Set. */
  selectedCount?: number;
  /** Displayed in the panel header. */
  projectName?: string;
}

/* ---------- Effect data (Step 2: from shared effectsOptions source) ---------- */

// Each list's "None" off-state is excluded from its randomize pool (you don't
// shuffle "no effect" onto segments). The animation pool draws from the VISIBLE
// list, not the full catalog — randomize must only ever land a slug the user
// could have picked by hand.
const TRANSITION_POOL: EffectOption[] = TRANSITIONS.slice(1);
const ANIMATION_POOL: EffectOption[] = ANIMATIONS_VISIBLE.slice(1);

/** Look up a display label by stored value; falls back to the raw value.
 *  Callers pass a FULL catalog (never a *_VISIBLE subset) so a segment or
 *  preset holding a hidden slug still shows its real name. */
const labelOf = (opts: EffectOption[], value: string): string =>
  opts.find((o) => o.value === value)?.label ?? value;

const MAX_PRESETS = 20;

/* ---------- Shared class strings ---------- */

const cls = {
  box: "bg-[#1a1a1d] border-[0.5px] border-[rgba(224,124,58,0.25)] rounded-xl p-3.5",
  label: "text-[12px] font-medium tracking-[0.08em] text-[#e07c3a]",
  select:
    "w-full h-11 pl-3 pr-9 bg-[#0e0e10] text-[#f0f0f2] border-[0.5px] border-[#34343a] rounded-lg text-[15px] outline-none focus:border-[#e07c3a] cursor-pointer appearance-none",
  durInput:
    "w-16 h-11 text-center font-medium bg-[#0e0e10] text-[#f0f0f2] border-[0.5px] border-[#34343a] rounded-lg text-[15px] outline-none focus:border-[#e07c3a]",
  textInput:
    "flex-1 min-w-0 h-10 px-3 bg-[#0e0e10] text-[#f0f0f2] border-[0.5px] border-[#34343a] rounded-lg text-[14px] outline-none focus:border-[#e07c3a] placeholder:text-[#6e6e76]",
  btn:
    "flex-1 inline-flex items-center justify-center h-10 px-3.5 bg-[#232327] border-[0.5px] border-[#3a3a40] rounded-lg text-[12px] whitespace-nowrap text-[#e8e8ec] cursor-pointer transition-colors hover:bg-[#2c2c31] hover:border-[#48484f] active:scale-[0.98]",
  btnAccent:
    "w-full inline-flex items-center justify-center h-10 mt-2.5 bg-[rgba(224,124,58,0.1)] border-[0.5px] border-[#5a3a1e] rounded-lg text-[14px] text-[#e07c3a] cursor-pointer transition-colors hover:bg-[rgba(224,124,58,0.18)] active:scale-[0.98]",
  toggle:
    "w-full flex items-center justify-between h-10 px-3 bg-[#1f1f23] border-[0.5px] border-[#34343a] rounded-lg text-[14px] text-[#e8e8ec] cursor-pointer transition-colors hover:bg-[#26262b]",
  divider: "h-[0.5px] bg-[#2a2a2e] my-3.5",
};

/* ---------- Flash button (transient confirmation) ---------- */

type FlashResult = { text: string; warn?: boolean };

function FlashButton({
  onAction,
  children,
  className = "",
  disabled = false,
  pendingText,
}: {
  /** Sync returns flash immediately; a Promise shows `pendingText` until it
   *  resolves, then flashes the resolved result (async auto-grade path). */
  onAction: () => FlashResult | Promise<FlashResult>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  pendingText?: string;
}) {
  const [flash, setFlash] = useState<FlashResult | null>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showResult = (res: FlashResult) => {
    setFlash(res);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1100);
  };

  const inert = disabled || pending;

  return (
    <button
      type="button"
      disabled={inert}
      className={`${className}${inert ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
      style={flash ? { color: flash.warn ? "#e07c3a" : "#6fd089" } : undefined}
      onClick={() => {
        if (inert) return;
        const res = onAction();
        if (res instanceof Promise) {
          setPending(true);
          if (pendingText) setFlash({ text: pendingText });
          res
            .then((r) => {
              setPending(false);
              showResult(r);
            })
            .catch(() => {
              setPending(false);
              showResult({ text: "Failed", warn: true });
            });
        } else {
          showResult(res);
        }
      }}
    >
      {flash ? flash.text : children}
    </button>
  );
}

/* ---------- Styled native select with custom chevron ---------- */

function SelectField({
  value,
  onChange,
  options,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: EffectOption[];
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={cls.select}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#a8a8b0]" />
    </div>
  );
}

/* ---------- Apply-to-selected / Apply-to-all pair ---------- */

function ApplyPair({
  isNone,
  onSelected,
  onAll,
  selectedCount,
  variant = "apply",
}: {
  isNone: boolean;
  onSelected: () => void;
  onAll: () => void;
  selectedCount: number;
  /** "clear" swaps the button labels/flash text for a destructive-clear action
   *  (grade's "Clear grading" control, grade bug audit Fix C) while keeping
   *  the same selected/all layout, disabled-when-none-selected behavior, and
   *  FlashButton confirmation every existing ApplyPair caller already relies
   *  on. Defaults to "apply" so every pre-existing call site (transition/
   *  animation/overlay/preset/grade Apply) is byte-identical to before. */
  variant?: "apply" | "clear";
}) {
  const isClear = variant === "clear";
  return (
    <div className="flex gap-2">
      <FlashButton
        className={cls.btn}
        disabled={selectedCount === 0}
        onAction={() => {
          onSelected();
          return { text: isClear ? "Cleared selected ✓" : "Applied to selected ✓" };
        }}
      >
        {isClear ? `Clear selected (${selectedCount})` : `Apply to selected (${selectedCount})`}
      </FlashButton>
      <FlashButton
        className={cls.btn}
        onAction={() => {
          onAll();
          return { text: isClear ? "Cleared all ✓" : isNone ? "Cleared on all ✓" : "Applied to all ✓" };
        }}
      >
        {isClear ? "Clear all" : "Apply to all"}
      </FlashButton>
    </div>
  );
}

/* ---------- Effect section (transition / animation) ---------- */

function EffectSection({
  kind,
  title,
  options,
  pool,
  noneValue,
  value,
  onValueChange,
  duration,
  onDurationChange,
  picks,
  onTogglePick,
  onApply,
  selectedCount,
}: {
  kind: "transition" | "animation";
  title: string;
  options: EffectOption[];
  pool: EffectOption[];
  /** Value treated as the "no effect" baseline (e.g. Hard Cut); omit if none. */
  noneValue?: string;
  value: string;
  onValueChange: (v: string) => void;
  duration: string;
  onDurationChange: (v: string) => void;
  picks: Set<string>;
  onTogglePick: (name: string) => void;
  onApply?: (event: ApplyEvent) => void;
  selectedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const isNone = noneValue != null && value === noneValue;
  const randType = kind === "transition" ? "randomize-transitions" : "randomize-animations";

  return (
    <section className={cls.box}>
      <h3 className={`${cls.label} mb-3`}>{title}</h3>

      <div className="flex gap-2 mb-2.5">
        <SelectField className="flex-1" ariaLabel={`${title} effect`} value={value} onChange={onValueChange} options={options} />
        <div className="flex flex-col items-center">
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={duration}
            onChange={(e) => onDurationChange(e.target.value)}
            aria-label={`${title} duration in seconds`}
            className={cls.durInput}
          />
          <span className="text-[10px] text-[#6e6e76] mt-[3px] tracking-[0.04em]">SECONDS</span>
        </div>
      </div>

      <ApplyPair
        isNone={isNone}
        selectedCount={selectedCount}
        onSelected={() => onApply?.({ type: kind, scope: "selected", value, duration: parseFloat(duration) || 0 })}
        onAll={() => onApply?.({ type: kind, scope: "all", value, duration: parseFloat(duration) || 0 })}
      />

      <div className={cls.divider} />

      <button type="button" className={cls.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          <Shuffle size={16} className="text-[#e07c3a]" />
          Randomize across segments
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: picks.size > 0 ? "#e07c3a" : "#6e6e76" }}>
            {picks.size} selected
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex">
            <ChevronDown size={16} />
          </motion.span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {pool.map((opt) => {
                const checked = picks.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-[7px] px-[9px] py-[7px] rounded-lg text-[12px] text-[#c8c8ce] cursor-pointer select-none border-[0.5px] transition-colors"
                    style={{
                      background: checked ? "rgba(224,124,58,0.08)" : "#0e0e10",
                      borderColor: checked ? "#5a3a1e" : "#2a2a2e",
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => onTogglePick(opt.value)} className="w-3.5 h-3.5 cursor-pointer accent-[#e07c3a]" />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>

            <FlashButton
              className={cls.btnAccent}
              onAction={() => {
                if (picks.size === 0) return { text: "Pick at least one", warn: true };
                onApply?.({ type: randType, pool: [...picks] } as ApplyEvent);
                return { text: `Shuffled ${picks.size} across all ✓` };
              }}
            >
              Apply to all
            </FlashButton>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------- Grade section (color grading) ---------- */

const fmtGrade = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

/** Debounce on the live write-through below: long enough that dragging a slider
 *  commits a handful of setProject calls instead of one per pixel of travel,
 *  short enough that the preview still reads as following the cursor. */
const GRADE_LIVE_DEBOUNCE_MS = 120;

function GradeSection({
  grade,
  onGradeChange,
  onGradeLive,
  onApply,
  onAutoGrade,
  selectedCount,
  activeGrade,
  activeGradeSegmentId,
}: {
  grade: SegmentGrade;
  onGradeChange: (g: SegmentGrade) => void;
  onGradeLive?: (g: SegmentGrade) => void;
  onApply?: (event: ApplyEvent) => void;
  onAutoGrade?: (scope: ApplyScope) => Promise<AutoGradeResult>;
  selectedCount: number;
  activeGrade?: SegmentGrade;
  activeGradeSegmentId?: string;
}) {
  // Live grade preview — dragging a slider writes effectGrade straight onto the
  // active segment (debounced), so the preview follows the cursor with no Apply
  // click. `onGradeLive` targets ONLY that segment; Apply-to-selected/all stays
  // the way to push a dialed-in grade anywhere else.
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last value we ourselves live-wrote, so the sync effect below can tell
  // our own echo apart from a genuine outside change. See its `isEcho` branch.
  const selfWriteRef = useRef<{ id: string | undefined; grade: SegmentGrade } | null>(null);

  const cancelPendingLiveWrite = (): void => {
    if (liveTimerRef.current !== null) {
      clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
  };

  // Drop a queued write if the panel goes away mid-drag.
  useEffect(() => cancelPendingLiveWrite, []);

  /** Performs the live-write now and tags it as ours for the sync effect. */
  const writeLiveNow = (next: SegmentGrade): void => {
    if (!onGradeLive || !activeGradeSegmentId) return;
    selfWriteRef.current = { id: activeGradeSegmentId, grade: next };
    onGradeLive(next);
  };

  /** Debounced live-write, for the continuous stream a slider drag produces. */
  const queueLiveWrite = (next: SegmentGrade): void => {
    if (!onGradeLive || !activeGradeSegmentId) return;
    cancelPendingLiveWrite();
    liveTimerRef.current = setTimeout(() => {
      liveTimerRef.current = null;
      writeLiveNow(next);
    }, GRADE_LIVE_DEBOUNCE_MS);
  };

  // Grade bug audit Fix B — sync the local draft from whichever segment is
  // "active" (the single selected segment, else the playhead segment)
  // whenever that segment changes OR its STORED grade actually changes value
  // (e.g. after Apply/Auto-adjust commits a new value for the segment
  // currently shown). Comparing VALUES (gradesEqual), not the incoming prop's
  // object identity, is what stops an unrelated parent re-render — e.g.
  // editing a different segment's duration on the timeline, which produces a
  // new `project.segments` array and therefore a new `activeGrade` object
  // with the SAME field values for THIS segment — from clobbering an
  // in-progress slider drag.
  const lastSyncRef = useRef<{ id: string | undefined; grade: SegmentGrade } | null>(null);
  useEffect(() => {
    const incoming = activeGrade ?? NEUTRAL_GRADE;
    const prev = lastSyncRef.current;

    // The active segment changed under us — any queued live-write was aimed at
    // the segment we just left, so drop it rather than let it land on this one.
    if (prev && prev.id !== activeGradeSegmentId) {
      cancelPendingLiveWrite();
      selfWriteRef.current = null;
    }

    const changed = !prev || prev.id !== activeGradeSegmentId || !gradesEqual(prev.grade, incoming);
    if (!changed) return;

    // This `incoming` is our OWN live-write echoing back through
    // project.segments, not an outside change — the draft is already the source
    // of this value and the drag has likely moved PAST it in the ~120ms since.
    // Record it as synced but don't push it back into the draft: that would
    // snap the slider back to wherever the last debounced write landed on every
    // single write, which is exactly the fight the live-write would otherwise
    // pick with this effect. Changes from anywhere else (Apply, Auto-adjust, a
    // different segment) fail the id/value match and re-sync normally.
    const self = selfWriteRef.current;
    const isEcho = self !== null && self.id === activeGradeSegmentId && gradesEqual(self.grade, incoming);
    if (isEcho) {
      lastSyncRef.current = { id: activeGradeSegmentId, grade: incoming };
      selfWriteRef.current = null;
      return;
    }

    onGradeChange(incoming);
    lastSyncRef.current = { id: activeGradeSegmentId, grade: incoming };
    // onGradeChange is the parent's useState setter (stable identity) — only
    // the SOURCE (which segment, or its stored value) should trigger a re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGradeSegmentId, activeGrade]);

  const setChannel = (key: keyof SegmentGrade, value: number) => {
    const next = { ...grade, [key]: value };
    onGradeChange(next);
    queueLiveWrite(next);
  };

  // Reset sliders — returns the draft to neutral AND live-writes that neutral to
  // the active segment, so the preview actually goes back to its ungraded look.
  // Before the live-write existed this was draft-only, which was coherent (the
  // sliders were just an unapplied scratchpad). Once dragging started committing
  // to the segment, draft-only left the sliders reading 0 over a still-graded
  // preview — the inconsistency this fixes.
  //
  // Written immediately rather than through queueLiveWrite: a click is one
  // discrete event, so there is no stream to coalesce. It must still CANCEL any
  // write the preceding drag left queued, though — otherwise that stale value
  // fires ~GRADE_LIVE_DEBOUNCE_MS later and silently re-grades the segment the
  // user just reset.
  //
  // Distinct from "Clear grading" (unchanged): this writes a neutral
  // {0,0,0,0} on the ACTIVE segment only, where Clear writes `undefined` over a
  // selected/all scope. Both look identical in the preview today — config.grade
  // is intentionally left unset (PreviewStage's glConfig), so effectGrade
  // neutral and effectGrade undefined both resolve to NEUTRAL_GRADE — but they
  // stay semantically different: neutral is "explicitly graded to nothing",
  // undefined is "never graded", which is what a project-level grade fallback
  // would key off if one is ever wired up.
  const resetSliders = (): void => {
    cancelPendingLiveWrite();
    onGradeChange(NEUTRAL_GRADE);
    writeLiveNow(NEUTRAL_GRADE);
  };

  const autoAction = (scope: ApplyScope) => async (): Promise<FlashResult> => {
    if (!onAutoGrade) return { text: "Auto unavailable", warn: true };
    const { applied, failed } = await onAutoGrade(scope);
    if (applied === 0) return { text: failed > 0 ? "No analyzable frames" : "Nothing to grade", warn: true };
    return { text: failed > 0 ? `Auto-graded ${applied} ✓ (${failed} skipped)` : `Auto-graded ${applied} ✓` };
  };

  return (
    <section className={cls.box}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={cls.label}>GRADE</h3>
        <button
          type="button"
          onClick={resetSliders}
          disabled={isNeutralGrade(grade)}
          className={`inline-flex items-center gap-1.5 text-[11px] text-[#a8a8b0] hover:text-[#e07c3a] transition-colors${isNeutralGrade(grade) ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
          aria-label="Reset sliders to neutral — returns the active segment's preview to its ungraded look"
        >
          <RotateCcw size={13} />
          Reset sliders
        </button>
      </div>

      <div className="flex flex-col gap-2.5 mb-3">
        {GRADE_CHANNELS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2.5">
            <span className="w-[86px] shrink-0 text-[12px] text-[#c8c8ce]">{label}</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={grade[key]}
              onChange={(e) => setChannel(key, parseFloat(e.target.value))}
              aria-label={`${label} grade`}
              className="flex-1 min-w-0 accent-[#e07c3a] cursor-pointer"
            />
            <span className="w-[46px] shrink-0 text-right text-[12px] tabular-nums text-[#a8a8b0]">{fmtGrade(grade[key])}</span>
          </div>
        ))}
      </div>

      <ApplyPair
        isNone={isNeutralGrade(grade)}
        selectedCount={selectedCount}
        onSelected={() => onApply?.({ type: "grade", scope: "selected", value: grade })}
        onAll={() => onApply?.({ type: "grade", scope: "all", value: grade })}
      />

      <div className={cls.divider} />

      <div className="flex items-center gap-2 mb-1">
        <Ban size={16} className="text-[#e07c3a]" />
        <span className="text-[12px] text-[#c8c8ce]">Clear grading (remove applied effect)</span>
      </div>
      <ApplyPair
        isNone={false}
        variant="clear"
        selectedCount={selectedCount}
        onSelected={() => onApply?.({ type: "grade-clear", scope: "selected" })}
        onAll={() => onApply?.({ type: "grade-clear", scope: "all" })}
      />

      <div className={cls.divider} />

      <div className="flex items-center gap-2 mb-1">
        <Wand2 size={16} className="text-[#e07c3a]" />
        <span className="text-[12px] text-[#c8c8ce]">Auto-adjust (analyze &amp; grade)</span>
      </div>
      <div className="flex gap-2">
        <FlashButton
          className={cls.btn}
          disabled={selectedCount === 0 || !onAutoGrade}
          pendingText="Analyzing…"
          onAction={autoAction("selected")}
        >
          Auto selected ({selectedCount})
        </FlashButton>
        <FlashButton
          className={cls.btn}
          disabled={!onAutoGrade}
          pendingText="Analyzing…"
          onAction={autoAction("all")}
        >
          Auto all
        </FlashButton>
      </div>
    </section>
  );
}

/* ---------- Main panel ---------- */

export default function EffectsPanel({ initialPresets = [], onPresetsChange, onApply, onAutoGrade, onGradeLive, activeGrade, activeGradeSegmentId, selectedCount = 0, projectName }: EffectsPanelProps) {
  const [transition, setTransition] = useState(TRANSITIONS[0]!.value);
  const [transitionDur, setTransitionDur] = useState("0.5");
  const [animation, setAnimation] = useState(ANIMATIONS[0]!.value);
  const [animationDur, setAnimationDur] = useState("1.0");
  // No picker is bound to this any more — the OVERLAYS section is Coming-Soon
  // inert (see below). It survives only so the preset round-trip keeps its
  // shape: savePreset reads it and applyPreset writes it back. Effectively
  // pinned at OVERLAYS[0] ('none') unless an older preset carries something else.
  const [overlay, setOverlay] = useState(OVERLAYS[0]!.value);
  const [grade, setGrade] = useState<SegmentGrade>(NEUTRAL_GRADE);

  const [transitionPicks, setTransitionPicks] = useState<Set<string>>(new Set());
  const [animationPicks, setAnimationPicks] = useState<Set<string>>(new Set());

  const [presets, setPresets] = useState<Preset[]>(initialPresets);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");

  // The parent owns persistence and is the source of truth (e.g. after a save is
  // refused by the cap). Re-sync whenever it re-supplies the authoritative list.
  useEffect(() => {
    setPresets(initialPresets);
  }, [initialPresets]);

  const activePreset = useMemo(() => presets.find((p) => p.id === activeId) ?? null, [presets, activeId]);

  const togglePick = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    next.has(name) ? next.delete(name) : next.add(name);
    setter(next);
  };

  const commitPresets = (next: Preset[]) => {
    setPresets(next);
    onPresetsChange?.(next);
  };

  const savePreset = (): { text: string; warn?: boolean } => {
    if (presets.length >= MAX_PRESETS) return { text: `Max ${MAX_PRESETS} reached`, warn: true };
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: presetName.trim() || `Preset ${presets.length + 1}`,
      transition,
      transitionDur: Number(transitionDur),
      animation,
      animationDur: Number(animationDur),
      overlay,
    };
    commitPresets([...presets, preset]);
    setActiveId(preset.id);
    setPresetName("");
    return { text: "Saved ✓" };
  };

  const restorePreset = (p: Preset) => {
    setTransition(p.transition);
    setTransitionDur(String(p.transitionDur));
    setAnimation(p.animation);
    setAnimationDur(String(p.animationDur));
    setOverlay(p.overlay);
    setActiveId(p.id);
  };

  const deletePreset = (id: string) => {
    commitPresets(presets.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
  };

  return (
    <div className="bg-[#121214] border-[0.5px] border-[#2a2a2e] rounded-2xl p-3.5 max-w-[420px] text-[#f0f0f2] font-sans">
      <header className="flex items-center justify-between px-1 pb-3">
        <span className="text-[13px] font-medium tracking-[0.06em] text-[#a8a8b0]">EFFECTS</span>
        <span className="text-[12px] text-[#6e6e76]">{projectName ?? 'Untitled Project'}</span>
      </header>

      <div className="flex flex-col gap-3">
        <EffectSection
          kind="transition"
          title="TRANSITIONS"
          options={TRANSITIONS}
          pool={TRANSITION_POOL}
          noneValue={TRANSITION_NONE}
          value={transition}
          onValueChange={setTransition}
          duration={transitionDur}
          onDurationChange={setTransitionDur}
          picks={transitionPicks}
          onTogglePick={(n) => togglePick(transitionPicks, setTransitionPicks, n)}
          onApply={onApply}
          selectedCount={selectedCount}
        />

        {/* options={ANIMATIONS_VISIBLE} — the picker offers None + the two GL
            zooms only. The rest of the ANIMATIONS catalog (Ken Burns + the 5
            filters) stays fully implemented and rendering on both paths; it is
            hidden here, not retired, and existing segments using it are left
            untouched. See effectsOptions.ts's ANIMATIONS doc comment. */}
        <EffectSection
          kind="animation"
          title="ANIMATIONS"
          options={ANIMATIONS_VISIBLE}
          pool={ANIMATION_POOL}
          noneValue={ANIMATION_NONE}
          value={animation}
          onValueChange={setAnimation}
          duration={animationDur}
          onDurationChange={setAnimationDur}
          picks={animationPicks}
          onTogglePick={(n) => togglePick(animationPicks, setAnimationPicks, n)}
          onApply={onApply}
          selectedCount={selectedCount}
        />

        {/* Overlays — COMING SOON, deliberately visible but inert.
            None of the overlay slugs were ever implemented: `effectOverlay` has
            no renderer on either path (preview or export), so picking one has
            never done anything. Rather than ship a picker that silently no-ops,
            the section stays on screen (so the feature reads as planned, not
            missing) with its controls removed and the dropdown reduced to None.
            `aria-hidden` + `pointer-events-none` keep it out of both the tab
            order and the accessibility tree — visible, not interactive. */}
        <section className={cls.box} aria-hidden="true">
          <div className="flex items-center justify-between mb-3">
            <h3 className={cls.label}>OVERLAYS</h3>
            <span className="px-2 py-0.5 rounded-full bg-[#232327] border-[0.5px] border-[#3a3a40] text-[10px] font-semibold uppercase tracking-wider text-[#6e6e76]">
              Coming Soon
            </span>
          </div>
          <div className="opacity-40 pointer-events-none select-none">
            <SelectField ariaLabel="Overlay effect" value={OVERLAY_NONE} onChange={() => {}} options={OVERLAYS_VISIBLE} />
          </div>
        </section>

        {/* Grade */}
        <GradeSection
          grade={grade}
          onGradeChange={setGrade}
          onGradeLive={onGradeLive}
          onApply={onApply}
          onAutoGrade={onAutoGrade}
          selectedCount={selectedCount}
          activeGrade={activeGrade}
          activeGradeSegmentId={activeGradeSegmentId}
        />

        {/* Presets */}
        <section className={cls.box}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={cls.label}>PRESETS</h3>
            <span className="text-[11px] text-[#6e6e76]">
              {presets.length} / {MAX_PRESETS}
            </span>
          </div>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              maxLength={24}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Name this combo"
              aria-label="Preset name"
              className={cls.textInput}
            />
            <FlashButton className={`${cls.btn} flex-none whitespace-nowrap`} onAction={savePreset}>
              <Save size={15} className="mr-1.5" />
              Save current
            </FlashButton>
          </div>

          <div className="flex flex-col gap-1.5">
            {presets.length === 0 ? (
              <p className="text-[12px] text-[#6e6e76] italic px-0.5 py-1">No presets saved yet</p>
            ) : (
              presets.map((p) => {
                const active = p.id === activeId;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => restorePreset(p)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && restorePreset(p)}
                    className="flex items-center gap-2.5 px-[11px] py-[9px] rounded-lg cursor-pointer border-[0.5px] transition-colors"
                    style={{
                      background: active ? "rgba(224,124,58,0.1)" : "#0e0e10",
                      borderColor: active ? "#5a3a1e" : "#2a2a2e",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate" style={{ color: active ? "#e07c3a" : "#e8e8ec" }}>
                        {p.name}
                      </div>
                      <div className="text-[11px] text-[#7a7a82] truncate mt-0.5">
                        {labelOf(TRANSITIONS, p.transition)} · {labelOf(ANIMATIONS, p.animation)} · {labelOf(OVERLAYS, p.overlay)}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePreset(p.id);
                      }}
                      className="p-1 text-[#6e6e76] hover:text-[#e07c3a] transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <AnimatePresence initial={false}>
            {activePreset && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t-[0.5px] border-[#2a2a2e]">
                  <p className="text-[11px] text-[#a8a8b0] mb-2">
                    Restored <span className="text-[#e07c3a] font-medium">{activePreset.name}</span>
                  </p>
                  <ApplyPair
                    isNone={false}
                    selectedCount={selectedCount}
                    onSelected={() => onApply?.({ type: "preset", scope: "selected", preset: activePreset })}
                    onAll={() => onApply?.({ type: "preset", scope: "all", preset: activePreset })}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}

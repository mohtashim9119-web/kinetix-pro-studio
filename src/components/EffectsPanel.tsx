import { useState, useRef, useMemo, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shuffle, ChevronDown, Save, Trash2 } from "lucide-react";
import { TRANSITIONS, ANIMATIONS, OVERLAYS, TRANSITION_NONE, ANIMATION_NONE, OVERLAY_NONE, type EffectOption } from "../effectsOptions";

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
  | { type: "preset"; scope: ApplyScope; preset: Preset };

export interface EffectsPanelProps {
  /** Seed presets on mount (e.g. loaded from a Tauri store). */
  initialPresets?: Preset[];
  /** Fired whenever the presets list changes — persist it here. */
  onPresetsChange?: (presets: Preset[]) => void;
  /** Fired when any "Apply" button is pressed. Wire this to your timeline. */
  onApply?: (event: ApplyEvent) => void;
  /** Count of segments currently batch-selected (drives "Apply to selected (N)").
   *  Distinct from the per-block randomize `picks` Set. */
  selectedCount?: number;
}

/* ---------- Effect data (Step 2: from shared effectsOptions source) ---------- */

// Each list's "None"/"Hard Cut" off-state is excluded from its randomize pool
// (you don't shuffle "no effect" onto segments).
const TRANSITION_POOL: EffectOption[] = TRANSITIONS.slice(1);
const ANIMATION_POOL: EffectOption[] = ANIMATIONS.slice(1);

/** Look up a display label by stored value; falls back to the raw value. */
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

function FlashButton({
  onAction,
  children,
  className = "",
  disabled = false,
}: {
  onAction: () => { text: string; warn?: boolean };
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [flash, setFlash] = useState<{ text: string; warn?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <button
      type="button"
      disabled={disabled}
      className={`${className}${disabled ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
      style={flash ? { color: flash.warn ? "#e07c3a" : "#6fd089" } : undefined}
      onClick={() => {
        if (disabled) return;
        const res = onAction();
        setFlash(res);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFlash(null), 1100);
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
}: {
  isNone: boolean;
  onSelected: () => void;
  onAll: () => void;
  selectedCount: number;
}) {
  return (
    <div className="flex gap-2">
      <FlashButton
        className={cls.btn}
        disabled={selectedCount === 0}
        onAction={() => {
          onSelected();
          return { text: "Applied to selected ✓" };
        }}
      >
        Apply to selected ({selectedCount})
      </FlashButton>
      <FlashButton
        className={cls.btn}
        onAction={() => {
          onAll();
          return { text: isNone ? "Cleared on all ✓" : "Applied to all ✓" };
        }}
      >
        Apply to all
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

/* ---------- Main panel ---------- */

export default function EffectsPanel({ initialPresets = [], onPresetsChange, onApply, selectedCount = 0 }: EffectsPanelProps) {
  const [transition, setTransition] = useState(TRANSITIONS[0]!.value);
  const [transitionDur, setTransitionDur] = useState("0.5");
  const [animation, setAnimation] = useState(ANIMATIONS[0]!.value);
  const [animationDur, setAnimationDur] = useState("1.0");
  const [overlay, setOverlay] = useState(OVERLAYS[0]!.value);

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
        <span className="text-[12px] text-[#6e6e76]">Untitled Project</span>
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

        <EffectSection
          kind="animation"
          title="ANIMATIONS"
          options={ANIMATIONS}
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

        {/* Overlays */}
        <section className={cls.box}>
          <h3 className={`${cls.label} mb-3`}>OVERLAYS</h3>
          <SelectField className="mb-2.5" ariaLabel="Overlay effect" value={overlay} onChange={setOverlay} options={OVERLAYS} />
          <ApplyPair
            isNone={overlay === OVERLAY_NONE}
            selectedCount={selectedCount}
            onSelected={() => onApply?.({ type: "overlay", scope: "selected", value: overlay })}
            onAll={() => onApply?.({ type: "overlay", scope: "all", value: overlay })}
          />
        </section>

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

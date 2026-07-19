/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const SPEED_LADDER = [1, 2, 4, 8] as const;

interface Props {
  speed: number;
  onCycle: () => void;
}

export function SpeedBadge({ speed, onCycle }: Props) {
  return (
    <button
      onClick={onCycle}
      aria-label="Playback speed"
      title="Playback speed (click to cycle, ←/→ to adjust)"
      className="bg-[#0D0D0D]/90 backdrop-blur-sm border border-[#2A2A2A] rounded-full px-2 py-1 text-[10px] font-mono tabular-nums text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer select-none"
    >
      {speed}×
    </button>
  );
}

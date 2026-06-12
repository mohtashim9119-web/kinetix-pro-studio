// src/components/PresetPicker.tsx
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import {
  loadPresets,
  savePreset,
  deletePreset,
  type PresetCategory,
  type StylePreset,
} from '../services/presetService';

// Re-export so SettingsPanel can import from a single location
export type { OverlayConfigPreset } from '../services/presetService';

interface Props {
  category: PresetCategory;
  label: string; // e.g. "Transition", "Overlay Style"
  currentValue: StylePreset['value'];
  onApply: (value: StylePreset['value']) => void;
}

export function PresetPicker({ category, label, currentValue, onApply }: Props) {
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setPresets(loadPresets(category));
  }, [category]);

  const handleSave = () => {
    if (!newName.trim()) return;
    savePreset(newName.trim(), category, currentValue);
    setPresets(loadPresets(category));
    setNewName('');
    setSaving(false);
  };

  const handleDelete = (id: string) => {
    deletePreset(id);
    setPresets(loadPresets(category));
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400 uppercase tracking-wider">{label} Presets</span>
        <button
          onClick={() => setSaving(s => !s)}
          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
        >
          <Plus size={11} />
          Save current
        </button>
      </div>

      {saving && (
        <div className="flex gap-1 mb-1">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Preset name..."
            className="flex-1 text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white placeholder-zinc-500 outline-none focus:border-orange-500"
          />
          <button
            onClick={handleSave}
            className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-2 py-1 rounded"
          >
            Save
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {presets.map(preset => (
          <div
            key={preset.id}
            className="group flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 cursor-pointer text-xs text-zinc-300 hover:text-white transition-colors"
            onClick={() => onApply(preset.value)}
          >
            <Check size={10} className="text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span>{preset.name}</span>
            {!preset.builtIn && (
              <button
                onClick={e => { e.stopPropagation(); handleDelete(preset.id); }}
                className="ml-1 text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={10} />
              </button>
            )}
            {preset.builtIn && (
              <span className="ml-1 text-[9px] text-zinc-600 uppercase">built-in</span>
            )}
          </div>
        ))}
        {presets.length === 0 && (
          <span className="text-xs text-zinc-600 italic">No presets saved yet</span>
        )}
      </div>
    </div>
  );
}

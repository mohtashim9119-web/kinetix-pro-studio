// src/components/TextLayersPanel.tsx
// Global text layers panel — shown inside the Segments tab of DropZonePanel.
import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { TextOverlay, VideoSegment } from '../types';
import { FONT_FAMILIES } from '../constants';

interface Props {
  textLayers: TextOverlay[];
  segments: VideoSegment[];
  onAddTextLayer: () => void;
  onUpdateTextLayer: (id: string, updates: Partial<TextOverlay>) => void;
  onDeleteTextLayer: (id: string) => void;
  onToggleTextLayerOnSegment: (layerId: string, segmentId: string) => void;
}

export function TextLayersPanel({
  textLayers,
  segments,
  onAddTextLayer,
  onUpdateTextLayer,
  onDeleteTextLayer,
  onToggleTextLayerOnSegment,
}: Props): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-[#1A1A1A] flex-shrink-0">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        {collapsed
          ? <ChevronRight size={12} className="text-gray-600" />
          : <ChevronDown size={12} className="text-gray-600" />
        }
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 flex-1">
          Global Text Layers
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onAddTextLayer(); setCollapsed(false); }}
          className="p-1 rounded-lg hover:bg-[#1A1A1A] text-[#F27D26] hover:text-orange-300 transition-colors"
          title="Add global text layer"
          aria-label="Add global text layer"
        >
          <Plus size={12} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {textLayers.length === 0 && (
            <p className="text-[10px] text-gray-700 italic px-1 py-1">
              No global text layers. Click + to add one.
            </p>
          )}
          {textLayers.map((layer) => {
            const isExpanded = expanded === layer.id;
            return (
              <div key={layer.id} className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-xl overflow-hidden">
                {/* Layer row */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#111] transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : layer.id)}
                >
                  {isExpanded
                    ? <ChevronDown size={10} className="text-gray-600 flex-shrink-0" />
                    : <ChevronRight size={10} className="text-gray-600 flex-shrink-0" />
                  }
                  <span className="flex-1 text-[10px] font-bold text-white truncate">{layer.text}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTextLayer(layer.id); }}
                    className="flex-shrink-0 p-1 rounded hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors"
                    aria-label="Delete text layer"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>

                {/* Expanded editor */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-[#1A1A1A]">
                    {/* Text content */}
                    <div className="space-y-1 pt-2">
                      <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Text</label>
                      <input
                        type="text"
                        value={layer.text}
                        onChange={(e) => onUpdateTextLayer(layer.id, { text: e.target.value })}
                        className="w-full bg-[#141414] border border-[#282828] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#F27D26]"
                      />
                    </div>

                    {/* Position */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">X %</label>
                        <input
                          type="number"
                          min={0} max={100}
                          value={Math.round(layer.position.x)}
                          onChange={(e) => onUpdateTextLayer(layer.id, { position: { ...layer.position, x: Number(e.target.value) } })}
                          className="w-full bg-[#141414] border border-[#282828] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#F27D26]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Y %</label>
                        <input
                          type="number"
                          min={0} max={100}
                          value={Math.round(layer.position.y)}
                          onChange={(e) => onUpdateTextLayer(layer.id, { position: { ...layer.position, y: Number(e.target.value) } })}
                          className="w-full bg-[#141414] border border-[#282828] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#F27D26]"
                        />
                      </div>
                    </div>

                    {/* Colors + font size */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Color</label>
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(e) => onUpdateTextLayer(layer.id, { color: e.target.value })}
                          className="w-full h-7 bg-transparent border-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">BG</label>
                        <input
                          type="color"
                          value={layer.backgroundColor === 'transparent' ? '#000000' : layer.backgroundColor}
                          onChange={(e) => onUpdateTextLayer(layer.id, { backgroundColor: e.target.value })}
                          className="w-full h-7 bg-transparent border-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Size</label>
                        <input
                          type="number"
                          min={8} max={200}
                          value={layer.fontSize}
                          onChange={(e) => onUpdateTextLayer(layer.id, { fontSize: Number(e.target.value) })}
                          className="w-full bg-[#141414] border border-[#282828] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#F27D26]"
                        />
                      </div>
                    </div>

                    {/* Font family */}
                    <div className="space-y-1">
                      <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Font</label>
                      <select
                        value={layer.fontFamily}
                        onChange={(e) => onUpdateTextLayer(layer.id, { fontFamily: e.target.value })}
                        className="w-full bg-[#141414] border border-[#282828] rounded-lg px-2 py-1.5 text-[10px] text-white outline-none focus:border-[#F27D26]"
                      >
                        {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    {/* Per-segment visibility toggles */}
                    {segments.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase tracking-widest text-gray-600 font-bold block">Hide on Segments</label>
                        <div className="space-y-0.5 max-h-28 overflow-y-auto custom-scrollbar">
                          {segments.map((seg) => {
                            const isHidden = (layer.hiddenOnSegments ?? []).includes(seg.id);
                            return (
                              <button
                                key={seg.id}
                                onClick={() => onToggleTextLayerOnSegment(layer.id, seg.id)}
                                className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition-colors ${
                                  isHidden
                                    ? 'bg-red-900/20 border border-red-900/40 text-red-400'
                                    : 'bg-[#141414] border border-[#282828] text-gray-400 hover:border-[#383838]'
                                }`}
                              >
                                {isHidden
                                  ? <EyeOff size={9} className="flex-shrink-0" />
                                  : <Eye size={9} className="flex-shrink-0" />
                                }
                                <span className="text-[9px] truncate">
                                  {seg.heading || `Scene ${seg.order + 1}`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

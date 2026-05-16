/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Plus, Trash2, Maximize, Video, Type, Music } from 'lucide-react';
import { VideoSegment, Asset, TextOverlay, TransitionType, AnimationType } from '../types';
import { FONT_FAMILIES, TEXT_ANIMATIONS } from '../constants';

interface Props {
  script: string;
  segments: VideoSegment[];
  assets: Asset[];
  globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']>;
  onAddSegment: (seg: VideoSegment) => void;
  onDeleteSegment: (id: string) => void;
  onEditSegment: (seg: VideoSegment) => void;
  onOpenStockSearch: (segmentId: string) => void;
  onUpdateSegment: (idx: number, updates: Partial<VideoSegment>) => void;
  onUpdateSegmentOverlay: (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>) => void;
  onUpdateExtraOverlay: (segIdx: number, oIdx: number, updates: Partial<TextOverlay>) => void;
  onSegmentDurationChange: (idx: number, duration: number) => void;
  onToggleOverlay: (idx: number) => void;
  onSetOverlayPreset: (idx: number, preset: 'cyber' | 'retro' | 'brutal') => void;
  onAddExtraOverlay: (idx: number) => void;
}

export function SegmentEditorPanel({
  script,
  segments,
  assets,
  globalOverlayConfig,
  onAddSegment,
  onDeleteSegment,
  onEditSegment,
  onOpenStockSearch,
  onUpdateSegment,
  onUpdateSegmentOverlay,
  onUpdateExtraOverlay,
  onSegmentDurationChange,
  onToggleOverlay,
  onSetOverlayPreset,
  onAddExtraOverlay,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Script Context</h3>
        <div className="p-4 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl max-h-40 overflow-y-auto custom-scrollbar text-[11px] font-mono text-gray-500 leading-relaxed">
          {script.split('\n').map((line, idx) => (
            <div key={idx} className={line.startsWith('[') ? 'text-[#F27D26] mt-2' : ''}>{line}</div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Scene Editor</h2>
        <button
          onClick={() => {
            const last = segments[segments.length - 1];
            const newSeg: VideoSegment = {
              id: crypto.randomUUID(),
              text: 'New Scene Text',
              startTime: last ? last.startTime + last.duration : 0,
              duration: 5,
              order: segments.length,
              transition: TransitionType.FADE,
              animation: AnimationType.KEN_BURNS,
              showOverlay: false,
              extraOverlays: [],
            };
            onAddSegment(newSeg);
          }}
          className="p-2 bg-[#F27D26]/10 text-[#F27D26] rounded-lg hover:bg-[#F27D26] hover:text-white transition-all flex items-center gap-2 text-[10px] uppercase font-black"
        >
          <Plus size={14} /> Add Scene
        </button>
      </div>

      <div className="space-y-4">
        {segments.map((s, idx) => (
          <div key={s.id} className="p-4 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl space-y-4 group hover:border-[#F27D26]/30 transition-all">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Scene #{idx + 1}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => onEditSegment(s)}
                  className="p-1.5 text-gray-700 hover:text-blue-500 transition-colors"
                  title="Expand to Full Edit Mode"
                >
                  <Maximize size={12} />
                </button>
                <button
                  onClick={() => onDeleteSegment(s.id)}
                  className="p-1.5 text-gray-700 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[7px] uppercase font-bold text-gray-500">Duration (s)</label>
                <input
                  type="number"
                  step="0.1"
                  value={s.duration}
                  onChange={(e) => onSegmentDurationChange(idx, parseFloat(e.target.value) || 0.1)}
                  className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[10px] font-bold outline-none focus:border-[#F27D26]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[7px] uppercase font-bold text-gray-500">Heading</label>
                <input
                  placeholder="Scene Heading"
                  value={s.heading ?? ''}
                  onChange={(e) => onUpdateSegment(idx, { heading: e.target.value })}
                  className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                />
              </div>
              <div className="col-span-2">
                <textarea
                  placeholder="Scene Script Text"
                  value={s.text}
                  onChange={(e) => onUpdateSegment(idx, { text: e.target.value })}
                  className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[11px] h-20 outline-none focus:border-[#F27D26] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1">
                <select
                  value={s.assetId ?? ''}
                  onChange={(e) => onUpdateSegment(idx, { assetId: e.target.value })}
                  className="w-full bg-[#121212] border border-[#282828] p-2 rounded-lg text-[9px] font-bold uppercase tracking-widest outline-none"
                >
                  <option value="">No Visual Asset</option>
                  {assets.filter(a => a.type !== 'audio').map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => onOpenStockSearch(s.id)}
                className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                title="Search Stock Media"
              >
                <Video size={14} />
              </button>
              <button
                onClick={() => onToggleOverlay(idx)}
                className={`p-2 rounded-lg border transition-all ${s.showOverlay ? 'bg-[#F27D26] border-[#F27D26] text-white' : 'bg-[#121212] border-[#282828] text-gray-500'}`}
                title="Toggle Main Text Overlay"
              >
                <Type size={14} />
              </button>
            </div>

            {s.showOverlay && (
              <div className="p-3 bg-[#111] rounded-xl border border-[#222] space-y-3">
                <p className="text-[7px] font-black uppercase tracking-widest text-[#F27D26]">Overlay Styling</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Font Family</label>
                    <select
                      value={s.overlayConfig?.fontFamily ?? globalOverlayConfig.fontFamily}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontFamily: e.target.value })}
                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                    >
                      {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Font Size</label>
                    <input
                      type="number"
                      value={s.overlayConfig?.fontSize ?? 60}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontSize: parseInt(e.target.value) })}
                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                    <select
                      value={s.overlayConfig?.fontWeight ?? 'bold'}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { fontWeight: e.target.value })}
                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Style</label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onUpdateSegmentOverlay(idx, { fontStyle: s.overlayConfig?.fontStyle === 'italic' ? 'normal' : 'italic' })}
                        className={`flex-1 text-[7px] p-1 rounded font-bold ${s.overlayConfig?.fontStyle === 'italic' ? 'bg-[#F27D26]' : 'bg-[#050505]'}`}
                      >IT</button>
                      <input
                        type="color"
                        value={s.overlayConfig?.color ?? '#FFFFFF'}
                        onChange={(e) => onUpdateSegmentOverlay(idx, { color: e.target.value })}
                        className="flex-1 h-5 bg-transparent"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Shadow</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onUpdateSegmentOverlay(idx, { textShadow: s.overlayConfig?.textShadow ? '' : '0 4px 15px rgba(0,0,0,1)' })}
                        className={`flex-1 text-[7px] p-1 rounded font-bold ${s.overlayConfig?.textShadow ? 'bg-[#F27D26]' : 'bg-[#050505]'}`}
                      >ENABLED</button>
                      <input
                        type="color"
                        value="#000000"
                        onChange={(e) => onUpdateSegmentOverlay(idx, { textShadow: `0 4px 15px ${e.target.value}` })}
                        className="h-5 flex-1 bg-transparent"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Animation Preset</label>
                    <select
                      value={s.overlayConfig?.animation ?? 'fade'}
                      onChange={(e) => onUpdateSegmentOverlay(idx, { animation: e.target.value })}
                      className="w-full bg-[#050505] p-1 rounded text-[10px] uppercase font-bold"
                    >
                      {TEXT_ANIMATIONS.map(a => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 pt-2">
              <button
                onClick={() => onSetOverlayPreset(idx, 'cyber')}
                className="p-1.5 bg-green-500/10 border border-green-500/20 text-green-500 rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-green-500 hover:text-white transition-all"
              >Cyber Bold</button>
              <button
                onClick={() => onSetOverlayPreset(idx, 'retro')}
                className="p-1.5 bg-pink-500/10 border border-pink-500/20 text-pink-500 rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-pink-500 hover:text-white transition-all"
              >Retro Neon</button>
              <button
                onClick={() => onSetOverlayPreset(idx, 'brutal')}
                className="p-1.5 bg-orange-500/10 border border-orange-500/20 text-[#F27D26] rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all"
              >Brutal Bold</button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <label className="text-[7px] uppercase font-bold text-gray-600 flex justify-between">
                  <span>Playback Speed</span>
                  <span className="text-[#F27D26]">{(s.playbackSpeed ?? 1).toFixed(2)}x</span>
                </label>
                <input
                  type="range" min="0.1" max="3" step="0.1"
                  value={s.playbackSpeed ?? 1}
                  onChange={(e) => onUpdateSegment(idx, { playbackSpeed: parseFloat(e.target.value) })}
                  className="w-full accent-[#F27D26]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[7px] uppercase font-bold text-gray-600 flex justify-between">
                  <span>Trim Start (s)</span>
                  <span className="text-blue-400">{(s.trimStart ?? 0).toFixed(1)}s</span>
                </label>
                <input
                  type="range" min="0" max={s.sourceDuration ?? 60} step="0.5"
                  value={s.trimStart ?? 0}
                  onChange={(e) => onUpdateSegment(idx, { trimStart: parseFloat(e.target.value) })}
                  className="w-full accent-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdateSegment(idx, { isMuted: !s.isMuted })}
                  className={`p-1.5 rounded text-[8px] uppercase font-black tracking-widest flex items-center gap-1 ${s.isMuted ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}
                >
                  {s.isMuted ? <Music size={10} className="line-through" /> : <Music size={10} />}
                  {s.isMuted ? 'Muted' : 'Audio On'}
                </button>
              </div>
              <button
                onClick={() => onAddExtraOverlay(idx)}
                className="p-1.5 bg-[#1A1A1A] text-gray-500 rounded-lg hover:border-[#F27D26] border border-transparent transition-all flex items-center gap-1 text-[8px] uppercase font-bold"
              >
                <Plus size={10} /> Overlay
              </button>
            </div>

            {s.extraOverlays?.map((overlay, oIdx) => (
              <div key={overlay.id} className="p-3 bg-[#050505] border border-[#1A1A1A] rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[8px] font-black text-gray-700 uppercase tracking-widest">Overlay #{oIdx + 1}</span>
                  <button
                    onClick={() => onUpdateSegment(idx, { extraOverlays: s.extraOverlays?.filter(o => o.id !== overlay.id) })}
                    className="text-red-900 hover:text-red-500"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                <input
                  value={overlay.text}
                  onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { text: e.target.value })}
                  className="w-full bg-[#121212] border border-[#282828] p-2 rounded-lg text-[10px] outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1 col-span-2">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Font Family</label>
                    <select
                      value={overlay.fontFamily}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { fontFamily: e.target.value })}
                      className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[10px]"
                    >
                      {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Text</label>
                    <input
                      type="color"
                      value={overlay.color}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { color: e.target.value })}
                      className="w-full h-6 bg-transparent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Back</label>
                    <input
                      type="color"
                      value={overlay.backgroundColor}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { backgroundColor: e.target.value })}
                      className="w-full h-6 bg-transparent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Size</label>
                    <input
                      type="number"
                      value={overlay.fontSize}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { fontSize: parseInt(e.target.value) })}
                      className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[9px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                    <select
                      value={overlay.fontWeight ?? 'normal'}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { fontWeight: e.target.value })}
                      className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[9px]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Animation</label>
                    <select
                      value={overlay.animation ?? 'fade'}
                      onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { animation: e.target.value })}
                      className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[8px] uppercase font-bold"
                    >
                      {TEXT_ANIMATIONS.map(a => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Shadow</label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onUpdateExtraOverlay(idx, oIdx, { textShadow: overlay.textShadow ? '' : '0 2px 10px rgba(0,0,0,1)' })}
                        className={`flex-1 text-[7px] p-1 rounded font-bold ${overlay.textShadow ? 'bg-[#F27D26]' : 'bg-[#121212]'}`}
                      >SH</button>
                      <input
                        type="color"
                        value="#000000"
                        onChange={(e) => onUpdateExtraOverlay(idx, oIdx, { textShadow: `0 2px 10px ${e.target.value}` })}
                        className="flex-1 h-5 bg-transparent"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[7px] uppercase font-bold text-gray-600">Align</label>
                    <div className="flex gap-1">
                      {(['left', 'center', 'right'] as const).map(align => (
                        <button
                          key={align}
                          onClick={() => onUpdateExtraOverlay(idx, oIdx, { textAlign: align })}
                          className={`flex-1 text-[7px] uppercase font-bold p-1 rounded ${overlay.textAlign === align ? 'bg-[#F27D26] text-white' : 'bg-[#121212] text-gray-500'}`}
                        >
                          {align.charAt(0).toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import { MonitorPlay, X, RefreshCw, AlertCircle, ChevronRight } from 'lucide-react';
import { Asset, VideoSegment } from '../types';
import { isFuzzyMatch, findAssetByContext } from '../services/syncEngine';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  sceneDetails: string;
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverName: string;
  onClose: () => void;
  onFinalizeSync: () => void;
  onApplyAdjustments: () => void;
  onOpenStockSearch: (targetId: string) => void;
  onAssetChange: (segmentIndex: number, assetId: string) => void;
}

export function SyncReviewModal({
  sceneDetails,
  segments,
  assets,
  voiceoverName,
  onClose,
  onFinalizeSync,
  onApplyAdjustments,
  onOpenStockSearch,
  onAssetChange,
}: Props) {
  const sceneBlocks = sceneDetails.split(/\r?\n\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const trapRef = useFocusTrap<HTMLDivElement>();

  return (
    <>
      {/* Pre-sync: scene details review with fuzzy-matched assets */}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-12 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          ref={trapRef}
          className="w-full max-w-6xl bg-[#080808] border border-[#1A1A1A] rounded-[32px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(242,125,38,0.2)]"
        >
          <div className="p-8 border-b border-[#1A1A1A] flex justify-between items-center bg-[#050505]">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#F27D26]/20 rounded-2xl text-[#F27D26]">
                <MonitorPlay size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-widest text-white">Advanced Sync Review</h2>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em]">Map assets to scenes and verify script alignment</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close review" className="text-gray-500 hover:text-white transition-colors border border-white/5 p-3 rounded-2xl bg-white/5">
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-12 space-y-4 custom-scrollbar">
            {sceneBlocks.map((block, idx) => {
              const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
              const tag = lines[0] ?? 'Scene';
              const desc = lines.slice(1).join(' ');
              const nameMatch = tag.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i) ?? tag.match(/\[(.*?)\]/);
              const name = nameMatch?.[1] ?? 'Unknown';
              const matchedAsset = assets.find(a => isFuzzyMatch(name, a.name));
              const asset = matchedAsset ?? findAssetByContext(desc, assets);

              return (
                <div key={idx} className="flex gap-8 bg-[#0C0C0C] p-8 rounded-[2rem] border border-white/5 hover:border-[#F27D26]/30 transition-all group items-center">
                  <div className="w-16 h-16 bg-[#1A1A1A] rounded-2xl flex items-center justify-center shrink-0 border border-white/5 group-hover:border-[#F27D26]/20">
                    <span className="text-2xl font-black text-[#F27D26]/40 group-hover:text-[#F27D26]">{idx + 1}</span>
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-[#F27D26]/10 text-[#F27D26] text-[8px] font-black uppercase rounded-full tracking-widest">Scene Logic</span>
                      <span className="text-[10px] font-mono text-gray-500 truncate max-w-[200px]">{tag}</span>
                    </div>
                    <p className="text-[13px] text-gray-400 font-medium leading-relaxed line-clamp-3 italic">
                      &ldquo;{desc || 'No script text provided for this scene.'}&rdquo;
                    </p>
                  </div>

                  <div className="w-[300px] space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Matched Visual</span>
                      <button
                        onClick={() => onOpenStockSearch(`sync-${idx}`)}
                        className="text-[9px] font-black uppercase text-blue-500 hover:text-blue-400"
                      >
                        Change Asset
                      </button>
                    </div>
                    <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-[#1A1A1A] relative shadow-2xl">
                      {asset ? (
                        <>
                          {asset.type === 'video' ? (
                            <video src={asset.url} className="w-full h-full object-cover opacity-60" muted autoPlay loop />
                          ) : (
                            <img src={asset.url} className="w-full h-full object-cover opacity-60" alt={asset.name} />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end">
                            <p className="text-[10px] font-black text-white uppercase truncate">{asset.name}</p>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-red-500/5 text-red-500/20">
                          <AlertCircle size={32} />
                          <span className="text-[9px] font-black uppercase tracking-widest">Unlinked Asset</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-8 border-t border-[#1A1A1A] bg-[#050505] flex justify-between items-center px-12">
            <div className="flex flex-col">
              <span className="text-white text-lg font-black uppercase tracking-widest">Review Complete?</span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Everything looks perfectly synced. Ready to finalize.</span>
            </div>
            <div className="flex gap-4">
              <button
                onClick={onClose}
                className="px-8 py-4 border border-[#1A1A1A] rounded-2xl text-[10px] uppercase font-black tracking-widest text-gray-500 hover:bg-white/5 transition-all"
              >
                Keep Editing
              </button>
              <button
                onClick={() => { onClose(); onFinalizeSync(); }}
                className="bg-[#F27D26] text-white px-12 py-4 rounded-2xl font-black uppercase tracking-widest hover:scale-105 transition-all shadow-[0_30px_60px_-15px_rgba(242,125,38,0.4)] flex items-center gap-3"
              >
                <RefreshCw size={14} /> Finalize Sync
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Post-sync: segment-level asset assignment review */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[2000] flex items-center justify-center p-10 bg-black/90 backdrop-blur-xl"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-[40px] w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        >
          <div className="p-8 border-b border-[#1A1A1A] flex items-center justify-between bg-[#0D0D0D]">
            <div>
              <h2 className="text-[14px] font-black uppercase tracking-[0.5em] text-[#F27D26] mb-1">Mapping Intelligence Review</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Verify and adjust every visual-audio connection</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close review"
              className="p-3 bg-[#1A1A1A] rounded-2xl hover:text-red-500 transition-all border border-white/5"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
            <div className="grid gap-6">
              {segments.map((seg, i) => {
                const asset = assets.find(a => a.id === seg.assetId);
                return (
                  <div key={seg.id} className="group overflow-hidden bg-[#0F0F0F] border border-[#1A1A1A] rounded-3xl flex items-center gap-10 p-6 hover:border-[#F27D26]/30 transition-all">
                    <div className="w-16 h-16 bg-[#1A1A1A] rounded-2xl flex items-center justify-center shrink-0 border border-white/5">
                      <span className="text-2xl font-black text-[#F27D26]">{i + 1}</span>
                    </div>

                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-4">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Scene Script</span>
                        <div className="h-px flex-1 bg-[#1A1A1A]" />
                      </div>
                      <p className="text-xs font-light text-gray-300 italic leading-relaxed">
                        &ldquo;{seg.text || '(No script for this scene)'}&rdquo;
                      </p>
                    </div>

                    <div className="w-80 space-y-4">
                      <div className="flex items-center gap-4">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Matched Asset</span>
                        <div className="h-px flex-1 bg-[#1A1A1A]" />
                      </div>
                      <div className="relative group/asset">
                        <select
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none appearance-none cursor-pointer hover:border-[#F27D26] transition-all"
                          value={seg.assetId ?? ''}
                          onChange={(e) => onAssetChange(i, e.target.value)}
                        >
                          <option value="">(None)</option>
                          {assets.filter(a => a.type !== 'audio').map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                        <div className="absolute inset-0 rounded-2xl pointer-events-none border border-[#F27D26] opacity-0 group-hover/asset:opacity-20 transition-opacity" />
                        <ChevronRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                      </div>
                    </div>

                    <div className="w-48 h-28 bg-black rounded-2xl overflow-hidden relative border border-[#1A1A1A] shrink-0 group-hover:scale-[1.02] transition-transform">
                      {asset?.url ? (
                        asset.type === 'video' ? (
                          <video src={asset.url} className="w-full h-full object-cover opacity-60" />
                        ) : (
                          <img src={asset.url} className="w-full h-full object-cover opacity-60" alt={asset.name} />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <AlertCircle size={20} className="text-red-900" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-[#F27D26]/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-8 bg-[#080808] border-t border-[#1A1A1A] flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Project Density</span>
                <span className="text-[10px] font-mono text-gray-600">{segments.length} Scenes / {voiceoverName}</span>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={onClose}
                className="px-10 py-3 bg-[#1A1A1A] border border-[#282828] rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-white hover:text-black transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => { onClose(); onApplyAdjustments(); }}
                className="px-10 py-3 bg-[#F27D26] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#ff8c3a] shadow-xl hover:scale-105 active:scale-95 transition-all"
              >
                Apply Adjustments
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}

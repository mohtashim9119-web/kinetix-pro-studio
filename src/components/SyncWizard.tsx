/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RefreshCw, Info } from 'lucide-react';

interface SyncValidation {
  voMatch: boolean;
  scriptScenesMatch: boolean;
  assetsMatch: boolean;
  missingAssets: string[];
}

interface Props {
  syncStep: 0 | 1 | 2 | 3 | 4;
  syncValidation: SyncValidation;
  isProcessing: boolean;
  sceneCount: number;
  audioDuration: number;
  onRunStep1: () => void;
  onRunStep2: () => void;
  onRunStep3: () => void;
  onFinalizeSync: () => void;
  onExport: () => void;
  onReviewMapping: () => void;
}

export function SyncWizard({
  syncStep,
  syncValidation,
  isProcessing,
  sceneCount,
  audioDuration,
  onRunStep1,
  onRunStep2,
  onRunStep3,
  onFinalizeSync,
  onExport,
  onReviewMapping,
}: Props) {
  return (
    <div className="flex items-center gap-4">
      {isProcessing && (
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#F27D26] font-bold">
          <RefreshCw size={14} className="animate-spin" /> Analyzing Story...
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center bg-[#1A1A1A] rounded-full p-1 gap-1 border border-[#282828] shadow-inner">
          <button
            onClick={onRunStep1}
            className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.voMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500'}`}
          >
            {syncValidation.voMatch ? '✓ Audio Linked' : '1. Link Audio'}
          </button>
          <button
            onClick={onRunStep2}
            disabled={syncStep < 1}
            className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.scriptScenesMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500 disabled:opacity-30'}`}
          >
            {syncValidation.scriptScenesMatch ? `✓ Scene Count (${sceneCount})` : '2. Mapping'}
          </button>
          <button
            onClick={onRunStep3}
            disabled={syncStep < 2}
            className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.assetsMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500 disabled:opacity-30'}`}
          >
            {syncValidation.assetsMatch ? '✓ Visuals Detected' : '3. Assets'}
          </button>
        </div>
        {syncStep > 0 && (
          <div className="flex items-center gap-3 px-3 text-[8px] font-mono text-gray-600 uppercase tracking-tighter">
            <button
              onClick={onReviewMapping}
              className="flex items-center gap-1 hover:text-[#F27D26] transition-colors group"
            >
              <Info size={10} className="group-hover:animate-pulse" /> Review Mapping
            </button>
            <span>•</span>
            <span>Scenes: {sceneCount}</span>
            <span>•</span>
            <span>Audio: {audioDuration.toFixed(1)}s</span>
            {syncValidation.missingAssets.length > 0 && (
              <>
                <span>•</span>
                <span className="text-red-500">Missing: {syncValidation.missingAssets.length}</span>
              </>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onFinalizeSync}
        disabled={isProcessing || syncStep < 3}
        className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95 shadow-xl ${
          syncStep >= 3
            ? 'bg-[#F27D26] text-white hover:bg-[#ff8c3a]'
            : 'bg-[#1A1A1A] text-gray-700 border border-[#282828] cursor-not-allowed'
        }`}
      >
        <RefreshCw size={14} className={isProcessing ? 'animate-spin' : ''} />
        Finalize Sync
      </button>
      <button
        onClick={onExport}
        className="bg-white text-black px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#F27D26] hover:text-white transition-all transform hover:scale-105 active:scale-95 shadow-xl"
      >
        Export
      </button>
    </div>
  );
}

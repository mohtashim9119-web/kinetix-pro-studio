import React from 'react';
import { Project, TransitionType, AnimationType } from '../types';
import { FILTERS, FONT_FAMILIES, TRANSITION_OPTIONS, ANIMATION_OPTIONS } from '../constants';
import { RefreshCw, Sparkles, Layers, Trash2 } from 'lucide-react';

interface Props {
  project: Project;
  onProjectChange: (updates: Partial<Project>) => void;
  onApplyTransitionToAll: () => void;
  onApplyAnimationToAll: () => void;
  onApplyFilterToAll: () => void;
  onExportScenesJson: () => void;
  onImportScenesJson: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNewProject: () => void;
  /** Export resolution. Defaults to '1080p'. */
  exportResolution: '1080p' | '4k';
  onExportResolutionChange: (r: '1080p' | '4k') => void;
  /** Export FPS. Defaults to 30. */
  exportFps: 24 | 30 | 60;
  onExportFpsChange: (fps: 24 | 30 | 60) => void;
  /** Dev-only: renders the current frame to a visible canvas for visual diffing. */
  onRenderTestFrame?: () => void;
  /** Dev-only: encodes the current segment to MP4 and triggers download. */
  onEncodeTestSegment?: () => void;
}

export function SettingsPanel({
  project,
  onProjectChange,
  onApplyTransitionToAll,
  onApplyAnimationToAll,
  onApplyFilterToAll,
  onExportScenesJson,
  onImportScenesJson,
  onNewProject,
  exportResolution,
  onExportResolutionChange,
  exportFps,
  onExportFpsChange,
  onRenderTestFrame,
  onEncodeTestSegment,
}: Props): React.ReactElement {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Global Aesthetics</h3>
        <div className="space-y-2">
          <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold block">Project Identity</label>
          <input
            type="text"
            value={project.name}
            onChange={(e) => onProjectChange({ name: e.target.value })}
            className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[12px] font-bold outline-none focus:border-[#F27D26]"
            placeholder="Project Name"
          />
        </div>
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block flex justify-between items-center">
            Hide On-Screen Text
            <button
              onClick={() => onProjectChange({ hideAllText: !project.hideAllText })}
              aria-label={project.hideAllText ? 'Show on-screen text' : 'Hide on-screen text'}
              aria-pressed={project.hideAllText}
              className={`w-10 h-5 rounded-full transition-colors relative ${project.hideAllText ? 'bg-[#F27D26]' : 'bg-[#1A1A1A] border border-[#282828]'}`}
            >
              <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${project.hideAllText ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Transition Style</label>
          <select
            value={project.globalTransition}
            onChange={(e) => onProjectChange({ globalTransition: e.target.value as TransitionType })}
            className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
          >
            {TRANSITION_OPTIONS.map(t => (
              <option key={t} value={t}>{t === TransitionType.NONE ? 'instant (none)' : t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Camera Dynamics</label>
          <select
            value={project.globalAnimation}
            onChange={(e) => onProjectChange({ globalAnimation: e.target.value as AnimationType })}
            className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
          >
            {ANIMATION_OPTIONS.map(a => (
              <option key={a} value={a}>{a === AnimationType.NONE ? 'static (none)' : a.replace('-', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Aesthetic Overlay Filter (50+ Styles)</label>
          <select
            value={project.globalOverlayFilter || 'none'}
            onChange={(e) => onProjectChange({ globalOverlayFilter: e.target.value })}
            className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
          >
            {FILTERS.map(f => <option key={f} value={f}>{f.replace('-', ' ')}</option>)}
          </select>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Transition Duration (s)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="5"
            value={project.globalTransitionDuration}
            onChange={(e) => onProjectChange({ globalTransitionDuration: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] font-bold outline-none focus:border-[#F27D26]"
          />
        </div>

        <div className="space-y-4 pt-4">
          <div className="flex flex-col gap-3">
            <button
              onClick={onApplyTransitionToAll}
              title="Writes the global transition onto every segment's own field, overriding any per-segment choices. Only needed if you want to diverge per-segment after this point — the global transition setting applies automatically without clicking this."
              className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw size={12} /> Override all per-segment transitions
            </button>
            <button
              onClick={onApplyAnimationToAll}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <Sparkles size={12} /> Apply Camera Dynamics to All
            </button>
            <button
              onClick={onApplyFilterToAll}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <Layers size={12} /> Apply Aesthetic Filter to All
            </button>
          </div>
          <h4 className="text-[10px] uppercase tracking-widest text-gray-600 font-black">Overlay Customization</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Text Color</label>
              <input
                type="color"
                value={project.globalOverlayConfig.color}
                onChange={(e) => onProjectChange({ globalOverlayConfig: { ...project.globalOverlayConfig, color: e.target.value } })}
                className="w-full h-8 bg-transparent border-none cursor-pointer"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Background Color</label>
              <input
                type="color"
                value={project.globalOverlayConfig.backgroundColor}
                onChange={(e) => onProjectChange({ globalOverlayConfig: { ...project.globalOverlayConfig, backgroundColor: e.target.value } })}
                className="w-full h-8 bg-transparent border-none cursor-pointer"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Font Family</label>
            <select
              value={project.globalOverlayConfig.fontFamily}
              onChange={(e) => onProjectChange({ globalOverlayConfig: { ...project.globalOverlayConfig, fontFamily: e.target.value } })}
              className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none"
            >
              {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </div>
          <div className="flex gap-4 pt-4">
            <button
              onClick={onExportScenesJson}
              className="flex-1 bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] uppercase font-bold tracking-widest hover:border-[#F27D26] transition-all"
            >
              Export Scenes JSON
            </button>
            <label className="flex-1 bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] uppercase font-bold tracking-widest hover:border-[#F27D26] transition-all cursor-pointer text-center">
              Import Scenes JSON
              <input type="file" accept=".json" className="hidden" onChange={onImportScenesJson} />
            </label>
          </div>

          {/* Export quality settings */}
          <div className="space-y-3 pt-2">
            <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold block">Export Quality</label>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-700 font-bold block">Resolution</label>
                <select
                  value={exportResolution}
                  onChange={(e) => onExportResolutionChange(e.target.value as '1080p' | '4k')}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                >
                  <option value="1080p">1080p (1920×1080)</option>
                  <option value="4k">4K (3840×2160)</option>
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[8px] uppercase tracking-widest text-gray-700 font-bold block">Frame Rate</label>
                <select
                  value={exportFps}
                  onChange={(e) => onExportFpsChange(Number(e.target.value) as 24 | 30 | 60)}
                  className="w-full bg-[#1A1A1A] border border-[#282828] p-2 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        {import.meta.env.DEV && (onRenderTestFrame ?? onEncodeTestSegment) && (
          <section className="space-y-3 pt-4 border-t border-[#1A1A1A]">
            <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-yellow-600">Dev Tools</h3>
            {onRenderTestFrame && (
              <button
                onClick={onRenderTestFrame}
                className="w-full bg-[#1A1A1A] border border-yellow-900 p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-yellow-600 hover:bg-yellow-600 hover:text-black hover:border-yellow-600 transition-all"
              >
                Render Current Frame to Canvas
              </button>
            )}
            {onEncodeTestSegment && (
              <button
                onClick={onEncodeTestSegment}
                className="w-full bg-[#1A1A1A] border border-yellow-900 p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-yellow-600 hover:bg-yellow-600 hover:text-black hover:border-yellow-600 transition-all"
              >
                Encode Current Segment → MP4
              </button>
            )}
          </section>
        )}
        <section className="space-y-3 pt-4 border-t border-[#1A1A1A]">
          <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-red-500">Danger Zone</h3>
          <button
            onClick={onNewProject}
            className="w-full bg-transparent border border-red-900 p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all flex items-center justify-center gap-2"
          >
            <Trash2 size={12} /> New Project
          </button>
        </section>
      </section>
    </div>
  );
}

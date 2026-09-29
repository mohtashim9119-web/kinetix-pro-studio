/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared DropZonePanel test props — every callback a no-op, every slot empty.
// Test-only; imported by the panel's mount tests.

import type { ComponentProps } from 'react';
import type { DropZonePanel } from './DropZonePanel';
import { TransitionType } from '../types';

export type DropZonePanelProps = ComponentProps<typeof DropZonePanel>;

export function makeProps(overrides: Partial<DropZonePanelProps> = {}): DropZonePanelProps {
  const noop = () => {};
  return {
    projectId: 'dropzone-test-project',
    segments: [], headings: [], assets: [],
    onUndo: noop, onRedo: noop, canUndo: false, canRedo: false,
    voiceoverId: undefined, script: '',
    persistedScript: '', persistedScriptName: '', persistedScriptUpdatedAt: undefined,
    persistedSceneDetails: '', persistedSceneDetailsName: '', persistedSceneDetailsUpdatedAt: undefined,
    persistedVoiceoverName: '', persistedAssetCount: 0, isSynced: true,
    onClearScript: noop, onClearSceneDetails: noop,
    onDeleteAsset: noop, onDeleteAllAssets: noop, onDeleteVoiceover: noop, onOpenRelinkMedia: noop,
    onHighlightUsage: noop, onIngestComplete: noop, onIngestError: noop, onBundleImportFailed: noop,
    onApplySync: noop, onStagedFilesChange: noop, stagedFilesClearSignal: 0,
    onVoiceoverStaged: noop, onVoiceoverUnstaged: noop, applySyncDisabled: false,
    onVoiceoverRestored: () => Promise.resolve(true),
    onVoiceoverTranscribeRequested: noop,
    voiceoverNeedsExplicitTranscribe: false,
    onSegmentClick: noop, onToggleLock: noop, onLockAll: noop, onUnlockAll: noop,
    allLocked: false, onOpenReviewMapping: noop, onInsertHeading: noop,
    selectedSegmentId: undefined, currentSegmentId: undefined,
    selectedSegmentIds: new Set(), onToggleSegmentSelect: noop,
    onSelectAllSegments: noop, onClearSegmentSelection: noop, onApplyEffect: noop,
    globalTransition: TransitionType.NONE, globalTransitionDuration: 0.5,
    globalAnimation: 'none', globalOverlayFilter: 'none',
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    currentTransition: 'none', currentAnimation: 'none', currentOverlayFilter: 'none',
    currentOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    onTransitionChange: noop, onTransitionDurationChange: noop, onApplyTransitionToAll: noop,
    onAnimationChange: noop, onApplyAnimationToAll: noop, onFilterChange: noop,
    onApplyFilterToAll: noop, onOverlayConfigChange: noop,
    onApplyTransitionPreset: noop, onApplyAnimationPreset: noop,
    onApplyOverlayFilterPreset: noop, onApplyOverlayConfigPreset: noop,
    onBackToProjects: noop, projectName: 'Test Project', onRename: noop,
    activeLeftTab: 'files', onActiveLeftTabChange: noop, isPlaying: false,
    ...overrides,
  };
}

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncLoadingOverlay } from './SyncLoadingOverlay';

describe('SyncLoadingOverlay', () => {
  it('renders progress text at partial waveform completion', () => {
    const html = renderToStaticMarkup(
      <SyncLoadingOverlay
        isProcessing={true}
        isWaveformReady={false}
        waveformReadyCount={210}
        waveformTotalCount={294}
      />,
    );
    expect(html).toContain('Building waveforms: 210/294');
  });

  it('shows a generic message during pre-work, before any waveform batch has begun', () => {
    // Mirrors the gap between Apply Sync's click and beginGeneration() actually
    // firing (asset persistence + parseProjectData + align/timing) — isProcessing
    // is already true but the tracker defaults (isWaveformReady=true, total=0)
    // haven't moved yet.
    const html = renderToStaticMarkup(
      <SyncLoadingOverlay
        isProcessing={true}
        isWaveformReady={true}
        waveformReadyCount={0}
        waveformTotalCount={0}
      />,
    );
    expect(html).toContain('Applying sync');
    expect(html).not.toContain('Building waveforms');
  });

  it('does not render once both isProcessing is false and waveforms are ready', () => {
    const html = renderToStaticMarkup(
      <SyncLoadingOverlay
        isProcessing={false}
        isWaveformReady={true}
        waveformReadyCount={294}
        waveformTotalCount={294}
      />,
    );
    expect(html).toBe('');
  });

  it('stays visible if isProcessing has cleared but the waveform batch has not settled yet', () => {
    const html = renderToStaticMarkup(
      <SyncLoadingOverlay
        isProcessing={false}
        isWaveformReady={false}
        waveformReadyCount={5}
        waveformTotalCount={12}
      />,
    );
    expect(html).toContain('Building waveforms: 5/12');
  });

  it('handles waveformTotalCount = 0 gracefully when no voiceover is loaded (still processing)', () => {
    const html = renderToStaticMarkup(
      <SyncLoadingOverlay
        isProcessing={true}
        isWaveformReady={true}
        waveformReadyCount={0}
        waveformTotalCount={0}
      />,
    );
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('/0');
  });
});

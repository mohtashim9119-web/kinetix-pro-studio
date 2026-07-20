import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncLoadingOverlay } from './SyncLoadingOverlay';

describe('SyncLoadingOverlay', () => {
  it('shows the fresh-sync message while isProcessing is true', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={true} />);
    expect(html).toContain('Preparing your project');
  });

  it('shows no technical jargon (no waveforms / counts)', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={true} />);
    expect(html).not.toContain('waveform');
    expect(html).not.toContain('Building');
    expect(html).not.toContain('segment');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('does not render at all once isProcessing is false (never on plain reload)', () => {
    const html = renderToStaticMarkup(<SyncLoadingOverlay isProcessing={false} />);
    expect(html).toBe('');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VaultRecoveryNotice } from './VaultRecoveryNotice';
import type { VaultRecoveryFinding } from '../services/vaultRecovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const finding: VaultRecoveryFinding = {
  kind: 'vault-registry-recovered', mode: 'salvage', atMs: 1, entriesRecovered: 4,
  corruptSha256: 'ab'.repeat(32), corruptBytes: 10, quarantinePath: '/q', detail: 'd', acknowledged: false,
};

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

function mount(findings: VaultRecoveryFinding[], onDismiss = vi.fn()): ReturnType<typeof vi.fn> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<VaultRecoveryNotice findings={findings} onDismiss={onDismiss} />); });
  return onDismiss;
}

describe('VaultRecoveryNotice', () => {
  it('renders nothing once there is no unacknowledged finding', () => {
    mount([]);
    expect(container!.querySelector('[data-testid="vault-recovery-notice"]')).toBeNull();
  });
  it('states what happened in plain words and points at Storage settings', () => {
    mount([finding]);
    const text = container!.textContent ?? '';
    expect(text).toContain('repaired with nothing lost (4 media items kept)');
    expect(text).toContain('Settings → Storage');
  });
  it('dismissing calls the acknowledge handler', () => {
    const onDismiss = mount([finding]);
    act(() => { (container!.querySelector('button[aria-label="Dismiss media library notice"]') as HTMLElement).click(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

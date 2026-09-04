// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 3 — the recovery banner's behaviour.
//
// The assertions that matter here are the two failure directions, not the
// happy path:
//
//   • A FAILED apply must leave the banner exactly as it was — mounted, both
//     buttons live. This is the mid-flight/end-state distinction WS2 T4.7's
//     own sibling lesson names: asserting only "the banner eventually
//     disappeared on success" would pass with a regression that leaves the
//     banner permanently disabled after a failure, holding the user's only
//     recovery path hostage. So the disabled state is inspected DURING the
//     apply (held pending), and the re-enabled state after it fails.
//
//   • Neither button fires on its own. The banner must never self-apply and
//     never self-discard; a mount with no interaction calls nothing.
//
// The banner does not own the record — App.tsx does — so "vanishes on
// Discard/Apply" is tested as the composition it actually is: a parent that
// renders the banner while a record is present and drops it when the record
// goes away.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { UnappliedTranscriptBanner } from './UnappliedTranscriptBanner';
import { buildUnappliedTranscript } from '../services/unappliedTranscript';
import type { UnappliedTranscript } from '../types';

const RECORD: UnappliedTranscript = buildUnappliedTranscript(
  [{ text: 'hello', startSec: 0, endSec: 0.4 }],
  'asset-1',
  'vo.mp3|5|1700000000000',
  new Date('2026-09-04T12:00:00.000Z'),
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const banner = (): HTMLElement | null => container.querySelector('[data-testid="unapplied-transcript-banner"]');
const button = (label: RegExp): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(b => label.test(b.textContent ?? ''));
  if (!found) throw new Error(`no button matching ${label}; saw: ${[...container.querySelectorAll('button')].map(b => b.textContent).join(' | ')}`);
  return found as HTMLButtonElement;
};
const click = (el: HTMLElement): void => {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

/** The real composition: a parent holding the record, exactly as App.tsx does. */
function Host({ onApply, onDiscard }: {
  onApply: () => Promise<boolean>;
  onDiscard?: () => void;
}): React.JSX.Element | null {
  const [record, setRecord] = useState<UnappliedTranscript | null>(RECORD);
  if (!record) return null;
  return (
    <UnappliedTranscriptBanner
      record={record}
      staleness="fresh"
      onApply={async () => {
        const ok = await onApply();
        // App.tsx's clear happens inside Apply Sync's own atomic commit; the
        // banner disappears because the record does, never because the banner
        // decided to hide itself.
        if (ok) setRecord(null);
        return ok;
      }}
      onDiscard={() => { onDiscard?.(); setRecord(null); }}
    />
  );
}

describe('rendering', () => {
  it('appears whenever a record is present, and describes it', () => {
    act(() => { root.render(<Host onApply={async () => true} />); });
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toMatch(/never applied to the timeline/i);
    expect(banner()!.textContent).toMatch(/1 word/);
  });

  it('never acts on its own — mounting fires neither callback', () => {
    const onApply = vi.fn(async () => true);
    const onDiscard = vi.fn();
    act(() => { root.render(<Host onApply={onApply} onDiscard={onDiscard} />); });
    expect(onApply).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('warns about changed audio when the record is stale, and still offers both buttons', () => {
    act(() => {
      root.render(
        <UnappliedTranscriptBanner
          record={RECORD}
          staleness="stale"
          onApply={async () => true}
          onDiscard={() => {}}
        />,
      );
    });
    expect(banner()!.textContent).toMatch(/voiceover has changed/i);
    // Staleness downgrades the wording; it never removes the choice.
    expect(button(/Apply Sync to Timeline/).disabled).toBe(false);
    expect(button(/Discard/).disabled).toBe(false);
  });

  it('an unknown staleness reads as the ordinary offer, not the warning', () => {
    act(() => {
      root.render(
        <UnappliedTranscriptBanner
          record={RECORD}
          staleness="unknown"
          onApply={async () => true}
          onDiscard={() => {}}
        />,
      );
    });
    expect(banner()!.textContent).not.toMatch(/voiceover has changed/i);
  });
});

describe('Discard', () => {
  it('vanishes on Discard', () => {
    const onDiscard = vi.fn();
    act(() => { root.render(<Host onApply={async () => true} onDiscard={onDiscard} />); });
    click(button(/Discard/));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });
});

describe('Apply', () => {
  it('vanishes on a successful Apply', async () => {
    const onApply = vi.fn(async () => true);
    act(() => { root.render(<Host onApply={onApply} />); });
    await act(async () => { button(/Apply Sync to Timeline/).click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it('holds both buttons disabled MID-FLIGHT so a second apply cannot be started', async () => {
    // Held pending deliberately: a green end-state assertion is compatible with
    // a regression that only corrupts the in-progress UI.
    let release: (ok: boolean) => void = () => {};
    const onApply = vi.fn(() => new Promise<boolean>(res => { release = res; }));
    act(() => { root.render(<Host onApply={onApply} />); });

    await act(async () => { button(/Applying|Apply Sync/).click(); });
    expect(button(/Applying/).disabled).toBe(true);
    expect(button(/Discard/).disabled).toBe(true);
    expect(button(/Applying/).textContent).toMatch(/Applying/);

    // A second click while in flight must not start a second apply.
    click(button(/Applying/));
    expect(onApply).toHaveBeenCalledTimes(1);

    await act(async () => { release(true); });
    expect(banner()).toBeNull();
  });

  it('STAYS on screen with both buttons live when the apply fails', async () => {
    const onApply = vi.fn(async () => false);
    act(() => { root.render(<Host onApply={onApply} />); });
    await act(async () => { button(/Apply Sync to Timeline/).click(); });

    expect(banner(), 'a failed apply must leave the offer on screen').not.toBeNull();
    expect(button(/Apply Sync to Timeline/).disabled).toBe(false);
    expect(button(/Discard/).disabled).toBe(false);
  });

  it('is retryable after a failure', async () => {
    let ok = false;
    const onApply = vi.fn(async () => ok);
    act(() => { root.render(<Host onApply={onApply} />); });

    await act(async () => { button(/Apply Sync to Timeline/).click(); });
    expect(banner()).not.toBeNull();

    ok = true;
    await act(async () => { button(/Apply Sync to Timeline/).click(); });
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
  });

  it('re-enables its buttons when the apply THROWS, not just when it returns false', async () => {
    const onApply = vi.fn(async () => { throw new Error('sync exploded'); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => { root.render(<Host onApply={onApply} />); });

    await act(async () => { button(/Apply Sync to Timeline/).click(); });

    expect(banner()).not.toBeNull();
    expect(button(/Apply Sync to Timeline/).disabled).toBe(false);
    // ...and the throw was absorbed and reported, not left to escape the click
    // handler as an unhandled rejection (invisible in the WKWebView shell).
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

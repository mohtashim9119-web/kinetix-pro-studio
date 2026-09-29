/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wave 3 U1 — the cloud-key row inside App Settings' Sync Engine block.
 *
 * IMMEDIATE, not draft-then-commit: saving or removing the key takes effect
 * at once, the same stated exemption the Models rows beside it carry (a key
 * is a credential on disk, not a preference waiting for Save). The key goes
 * straight to Rust and is never read back — the field clears on save and the
 * row only ever shows "connected as <member>", never the key.
 *
 * Wave 3 U7 — the real Cloud/Local engine picker (it replaced U2's interim
 * switch). Always visible in the desktop app; writes the app-level
 * `syncEngineHost` at once. Rules it carries:
 *   - Cloud can only be CHOSEN while the key tests connected. Nothing here
 *     ever converts a chosen Cloud into Local on its own for a reachability
 *     problem: an unreachable server stays Cloud and the run pauses and asks
 *     (G3 offline contract). Only a key that is GONE resets to Local, since a
 *     cloud choice with no key can never run at all.
 *   - The default stays Local until U10's green gate (D3); the signed plan's
 *     Cloud default is a one-constant flip in `syncEngineHost.ts`.
 *   - Spine honesty is inherited, not re-implemented: the host is folded into
 *     `computeSyncEngineKey`, so a switch here makes every synced project
 *     read "not synced" until it is rebuilt on the new engine.
 *   - The per-project High-Precision (FA) switch applies under BOTH engines.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../services/tauriFfmpeg';
import { onSyncEngineHostChange, readSyncEngineHost, writeSyncEngineHost, type SyncEngineHost } from '../services/syncEngineHost';
import {
  cloudKeyClear,
  cloudKeySet,
  cloudKeyStatus,
  cloudPing,
  describeCloudError,
  toCloudError,
  type CloudPing,
} from '../services/cloudGateway';

type RowState =
  | { phase: 'loading' }
  | { phase: 'unconfigured'; error?: string }
  | { phase: 'testing' }
  | { phase: 'connected'; ping: CloudPing }
  | { phase: 'failed'; error: string };

const BUTTON = 'bg-transparent border border-[#282828] px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:border-gray-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed';

export function CloudSyncSection(): React.ReactElement {
  const available = isTauri();
  const [state, setState] = useState<RowState>({ phase: 'loading' });
  const [draftKey, setDraftKey] = useState('');
  const [host, setHost] = useState<SyncEngineHost>(readSyncEngineHost);
  useEffect(() => onSyncEngineHostChange(setHost), []);

  const test = useCallback(async (): Promise<void> => {
    setState({ phase: 'testing' });
    try {
      setState({ phase: 'connected', ping: await cloudPing() });
    } catch (err) {
      setState({ phase: 'failed', error: describeCloudError(toCloudError(err)) });
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    cloudKeyStatus()
      .then(status => {
        if (!alive) return;
        if (status.configured) void test();
        else {
          // A cloud choice with no key can never run: reset it (also covers
          // the key having been removed by another window or by hand).
          if (readSyncEngineHost() === 'cloud') writeSyncEngineHost('local');
          setState({ phase: 'unconfigured' });
        }
      })
      .catch(err => alive && setState({ phase: 'failed', error: describeCloudError(toCloudError(err)) }));
    return () => { alive = false; };
  }, [available, test]);

  const save = async (): Promise<void> => {
    try {
      await cloudKeySet(draftKey);
      setDraftKey('');
      await test();
    } catch (err) {
      setState({ phase: 'unconfigured', error: describeCloudError(toCloudError(err)) });
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await cloudKeyClear();
      // No key, no cloud: never leave sync pointed at an engine that can
      // only fail.
      if (readSyncEngineHost() === 'cloud') writeSyncEngineHost('local');
      setState({ phase: 'unconfigured' });
    } catch (err) {
      setState({ phase: 'failed', error: describeCloudError(toCloudError(err)) });
    }
  };

  return (
    <div data-testid="cloud-sync-section" className="mb-5 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Cloud sync</p>
      <p className="text-[9px] text-gray-600 leading-snug">
        Cloud sync sends a compressed, audio-only copy of the voiceover — never video — to the
        Kinetix sync server. Audio is deleted 7 days after last use and results after 30 days;
        nothing is used for training. Your key takes effect immediately.
      </p>

      {!available && (
        <p className="text-[9px] text-gray-600" data-testid="cloud-sync-unavailable">Available in the desktop app.</p>
      )}

      {available && state.phase === 'loading' && (
        <p className="text-[9px] text-gray-600">Checking…</p>
      )}

      {available && state.phase === 'unconfigured' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your cloud key (kx_…)"
              aria-label="Cloud sync key"
              data-testid="cloud-sync-key-input"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && draftKey.trim()) void save(); }}
              className="flex-1 min-w-0 bg-[#1A1A1A] border border-[#282828] p-2 rounded-lg text-[11px] outline-none focus:border-[#F27D26] transition-colors"
            />
            <button
              type="button"
              data-testid="cloud-sync-key-save"
              disabled={!draftKey.trim()}
              onClick={() => void save()}
              className={BUTTON}
            >
              Save &amp; test
            </button>
          </div>
          {state.error && <p className="text-[9px] text-red-400 leading-snug" data-testid="cloud-sync-error">{state.error}</p>}
        </div>
      )}

      {available && state.phase === 'testing' && (
        <p className="text-[9px] text-gray-500" data-testid="cloud-sync-testing">Connecting to the sync server…</p>
      )}

      {available && (state.phase === 'connected' || state.phase === 'failed') && (
        <div className="flex items-center justify-between gap-3">
          {state.phase === 'connected' ? (
            <p className="text-[9px] text-emerald-400 leading-snug" data-testid="cloud-sync-connected">
              Connected as {state.ping.member} · {state.ping.latencyMs} ms
            </p>
          ) : (
            <p className="text-[9px] text-red-400 leading-snug" data-testid="cloud-sync-error">{state.error}</p>
          )}
          <div className="flex gap-2 shrink-0">
            <button type="button" data-testid="cloud-sync-test" onClick={() => void test()} className={BUTTON}>Test</button>
            <button type="button" data-testid="cloud-sync-key-remove" onClick={() => void remove()} className={BUTTON}>Remove key</button>
          </div>
        </div>
      )}

      {available && (
        <fieldset className="pt-1 space-y-1.5" data-testid="sync-engine-picker">
          <legend className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Sync runs on</legend>
          {(['cloud', 'local'] as const).map(option => {
            const connected = state.phase === 'connected';
            // Cloud is choosable only while connected; an ALREADY-chosen
            // Cloud stays selected (and enabled) through a failed test.
            const disabled = option === 'cloud' && !connected && host !== 'cloud';
            return (
              <label
                key={option}
                className={`flex items-start gap-2 text-[10px] leading-snug ${disabled ? 'text-gray-600' : 'text-gray-300'}`}
              >
                <input
                  type="radio"
                  name="sync-engine-host"
                  value={option}
                  checked={host === option}
                  disabled={disabled}
                  data-testid={`sync-engine-${option}`}
                  onChange={() => writeSyncEngineHost(option)}
                  className="mt-0.5 accent-[#F27D26]"
                />
                <span>
                  <span className="font-bold uppercase tracking-widest">{option === 'cloud' ? 'Cloud' : 'This computer'}</span>
                  <span className="block text-[9px] text-gray-500">
                    {option === 'cloud'
                      ? disabled
                        ? 'Add and test your cloud key above to use this.'
                        : 'Transcription and alignment run on the Kinetix sync server.'
                      : 'Transcription and alignment run on this computer.'}
                  </span>
                </span>
              </label>
            );
          })}
          {host === 'cloud' && state.phase === 'failed' && (
            <p className="text-[9px] text-amber-400 leading-snug" data-testid="sync-engine-cloud-unreachable">
              Cloud stays selected. If the server can’t be reached when you build a timeline, sync
              pauses and asks — it never switches to this computer on its own.
            </p>
          )}
          <p className="text-[9px] text-gray-600 leading-snug">
            High-Precision Auto-Sync is set per project and applies to both. Switching the engine
            marks synced timelines as needing a rebuild.
          </p>
        </fieldset>
      )}
    </div>
  );
}

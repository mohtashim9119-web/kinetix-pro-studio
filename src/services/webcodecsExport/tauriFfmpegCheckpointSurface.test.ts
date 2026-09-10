/**
 * WS3 Round 10, Blocker 3 — the checkpoint surface is OPTIONAL on
 * `WebCodecsFfmpeg`, so this pins that the production implementation actually
 * has every member. Without this, a rename or a dropped method would silently
 * turn durable checkpointing into a no-op in the app while every test stayed
 * green — the exact shape of an unmeasured-reach fixture.
 */
import { describe, it, expect } from 'vitest';
import { TauriFfmpeg } from '../tauriFfmpeg';

describe('TauriFfmpeg satisfies the durable-checkpoint surface', () => {
  const proto = TauriFfmpeg.prototype as unknown as Record<string, unknown>;

  it('exposes its session id, which the manifest must carry for Rust to accept it', () => {
    const descriptor = Object.getOwnPropertyDescriptor(TauriFfmpeg.prototype, 'sessionId');
    expect(descriptor).toBeDefined();
    expect(typeof descriptor!.get).toBe('function');
  });

  it.each([
    'writeExportState',
    'readExportState',
    'prepareCheckpointResume',
    'sessionFileSize',
    'truncateAnnexbToOffset',
    'countAnnexbFrames',
    'destroy',
  ])('has %s', (name) => {
    expect(typeof proto[name]).toBe('function');
  });

  it.each(['listResumableSessionIds', 'reenter'])('has the static %s', (name) => {
    expect(typeof (TauriFfmpeg as unknown as Record<string, unknown>)[name]).toBe('function');
  });
});

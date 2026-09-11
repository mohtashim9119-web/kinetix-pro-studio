/**
 * WS3 STEP 10 (H9) — the TS-side destination-path length check. Pure logic;
 * `useExport.test.ts` pins the wiring (rejected before any render starts).
 */
import { describe, it, expect } from 'vitest';
import {
  WINDOWS_MAX_PATH,
  looksLikeWindowsPath,
  checkExportDestinationPathLength,
} from './exportDestinationPath';

describe('looksLikeWindowsPath', () => {
  it('recognizes a drive-letter path', () => {
    expect(looksLikeWindowsPath('C:\\Users\\alice\\Videos\\out.mp4')).toBe(true);
    expect(looksLikeWindowsPath('D:/Videos/out.mp4')).toBe(true);
  });

  it('recognizes a UNC path', () => {
    expect(looksLikeWindowsPath('\\\\server\\share\\project\\out.mp4')).toBe(true);
  });

  it('does not misclassify a macOS/Linux path', () => {
    expect(looksLikeWindowsPath('/Users/alice/Movies/out.mp4')).toBe(false);
    expect(looksLikeWindowsPath('/home/alice/videos/out.mp4')).toBe(false);
  });
});

describe('checkExportDestinationPathLength', () => {
  it('rejects a Windows path at or over WINDOWS_MAX_PATH', () => {
    const longDir = 'C:\\' + 'a'.repeat(300) + '\\';
    const longPath = longDir + 'out.mp4';
    expect(longPath.length).toBeGreaterThan(WINDOWS_MAX_PATH);
    const message = checkExportDestinationPathLength(longPath);
    expect(message).not.toBeNull();
    expect(message).toContain(String(longPath.length));
    expect(message).toContain(String(WINDOWS_MAX_PATH));
  });

  it('accepts a Windows path comfortably under the limit', () => {
    expect(checkExportDestinationPathLength('C:\\Users\\alice\\Videos\\out.mp4')).toBeNull();
  });

  // DESTRUCTIVE PROBE: a macOS path of the SAME excessive length as the
  // rejected Windows one above must NEVER be rejected — this is the
  // invariant that keeps macOS behavior (what this environment can verify)
  // completely unchanged. Without the looksLikeWindowsPath gate, this
  // assertion would fail (a bare length check rejects every long path
  // regardless of platform).
  it('NEVER rejects a macOS/Linux path, even one far longer than WINDOWS_MAX_PATH', () => {
    const longDir = '/Users/alice/' + 'a'.repeat(300) + '/';
    const longPath = longDir + 'out.mp4';
    expect(longPath.length).toBeGreaterThan(WINDOWS_MAX_PATH);
    expect(checkExportDestinationPathLength(longPath)).toBeNull();
  });

  it('a UNC path is also subject to the limit', () => {
    const longPath = '\\\\server\\share\\' + 'a'.repeat(280) + '\\out.mp4';
    expect(longPath.length).toBeGreaterThan(WINDOWS_MAX_PATH);
    expect(checkExportDestinationPathLength(longPath)).not.toBeNull();
  });
});

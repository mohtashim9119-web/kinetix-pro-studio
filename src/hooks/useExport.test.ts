import { describe, it, expect } from 'vitest';
import { parentDir } from './useExport';

describe('parentDir', () => {
  it('returns the parent directory of a macOS/POSIX path', () => {
    expect(parentDir('/Users/name/video.mp4')).toBe('/Users/name');
  });

  it('returns the parent directory of a Windows path (backslash separators)', () => {
    expect(parentDir('C:\\Users\\name\\video.mp4')).toBe('C:\\Users\\name');
  });

  it('handles a Windows path with mixed separators, splitting on the last of either', () => {
    expect(parentDir('C:\\Users\\name/video.mp4')).toBe('C:\\Users\\name');
  });

  it('returns null when the path has no directory component', () => {
    expect(parentDir('video.mp4')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { parseInsufficientSpaceError } from './storageRootRelocationParse';

describe('parseInsufficientSpaceError', () => {
  it('extracts required and available bytes from the exact storage_root.rs error shape', () => {
    const parsed = parseInsufficientSpaceError(
      'not enough free space: needs about 5450000000 bytes, 120000000 available at /Volumes/Media',
    );
    expect(parsed).toEqual({ requiredBytes: 5_450_000_000, availableBytes: 120_000_000 });
  });

  it('returns null for an unrelated error message rather than guessing', () => {
    expect(parseInsufficientSpaceError('cannot create /Volumes/Media: Permission denied')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseInsufficientSpaceError('')).toBeNull();
  });
});

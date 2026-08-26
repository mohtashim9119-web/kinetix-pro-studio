/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { describeInvokeError } from './invokeError';

describe('describeInvokeError', () => {
  it('uses an Error instance\'s own message', () => {
    expect(describeInvokeError(new Error('boom'))).toBe('boom');
  });

  it('falls back to name when an Error has no message', () => {
    const err = new Error();
    err.name = 'CustomError';
    expect(describeInvokeError(err)).toBe('CustomError');
  });

  it('passes a raw string through unchanged', () => {
    expect(describeInvokeError('plain string rejection')).toBe('plain string rejection');
  });

  // The defect this exists to fix: a #[tauri::command] returning
  // Err(FaError { kind, message }) rejects invoke()'s promise with a plain
  // JSON object, never an Error instance.
  it('extracts .message from a serde-serialized Tauri command error object', () => {
    const rejection = {
      kind: 'OrtInit',
      message:
        'failed to initialize onnxruntime: no bundled onnxruntime C runtime for this target (windows-x86_64)',
    };
    expect(describeInvokeError(rejection)).toBe(
      'failed to initialize onnxruntime: no bundled onnxruntime C runtime for this target (windows-x86_64)',
    );
  });

  it('never collapses an object rejection to "[object Object]"', () => {
    const rejection = { kind: 'InferenceFailed', message: 'model load failed' };
    expect(describeInvokeError(rejection)).not.toBe('[object Object]');
  });

  it('JSON-dumps an object with no usable message field rather than stringifying it away', () => {
    const rejection = { kind: 'ModelHashMismatch' };
    expect(describeInvokeError(rejection)).toBe(JSON.stringify(rejection));
  });

  it('ignores a non-string message field and falls through to JSON dump', () => {
    const rejection = { message: 42 };
    expect(describeInvokeError(rejection)).toBe(JSON.stringify(rejection));
  });

  it('ignores an empty-string message field and falls through to JSON dump', () => {
    const rejection = { kind: 'X', message: '' };
    expect(describeInvokeError(rejection)).toBe(JSON.stringify(rejection));
  });

  it('handles null and undefined without throwing', () => {
    expect(describeInvokeError(null)).toBe('null');
    expect(describeInvokeError(undefined)).toBe(String(undefined));
  });
});

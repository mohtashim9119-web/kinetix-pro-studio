/**
 * WS3 Batch 2 (STEP 3, 3A) — parses the specific insufficient-space error
 * text `storage_root.rs`'s `ensure_relocation_space` throws, so
 * `StorageRootRelocationView` can show real required/available byte figures
 * without a new native preview command. Per 3A's instruction, the modal is
 * fed from the two EXISTING endpoints (`storage_root_status`, `size_report`)
 * plus whatever `storage_root_relocate` itself already reports on refusal —
 * no new Rust surface for this.
 *
 * Exact source string (storage_root.rs): `"not enough free space: needs
 * about {required} bytes, {available} available"`. If that format ever
 * changes, this returns null (never throws) and the caller falls back to
 * validationState 'error' with unknown byte figures — a display
 * degradation, never a crash.
 */
const PATTERN = /not enough free space: needs about (\d+) bytes, (\d+) available/;

export interface ParsedInsufficientSpace {
  requiredBytes: number;
  availableBytes: number;
}

export function parseInsufficientSpaceError(message: string): ParsedInsufficientSpace | null {
  const match = PATTERN.exec(message);
  if (!match) return null;
  const requiredBytes = Number(match[1]);
  const availableBytes = Number(match[2]);
  if (!Number.isFinite(requiredBytes) || !Number.isFinite(availableBytes)) return null;
  return { requiredBytes, availableBytes };
}

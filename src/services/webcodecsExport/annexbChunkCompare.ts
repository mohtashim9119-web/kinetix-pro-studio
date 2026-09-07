/** Fingerprints of encoded annexb chunks — the Part 3 output-equivalence gate. */

export interface ChunkFingerprint {
  index: number;
  sha256: string;
  byteLength: number;
  timestamp: number | null;
}

export interface EncodedOutputDigest {
  pieceSha256: string;
  chunkCount: number;
  keyframeCount: number;
  encodedBytes: number;
  chunks: ChunkFingerprint[];
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const buf = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digestEncodedOutput(
  chunks: readonly { bytes: BufferSource; timestamp: number | null; keyframe: boolean }[],
): Promise<EncodedOutputDigest> {
  const fingerprints: ChunkFingerprint[] = [];
  const parts: Uint8Array[] = [];
  let encodedBytes = 0;
  let keyframeCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const bytes = c.bytes instanceof Uint8Array ? c.bytes : new Uint8Array(c.bytes as ArrayBuffer);
    parts.push(bytes);
    encodedBytes += bytes.byteLength;
    if (c.keyframe) keyframeCount++;
    fingerprints.push({
      index: i,
      sha256: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
      timestamp: c.timestamp,
    });
  }
  const joined = new Uint8Array(encodedBytes);
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.byteLength;
  }
  return {
    pieceSha256: await sha256Hex(joined),
    chunkCount: chunks.length,
    keyframeCount,
    encodedBytes,
    chunks: fingerprints,
  };
}

export function firstChunkMismatch(
  a: readonly ChunkFingerprint[],
  b: readonly ChunkFingerprint[],
): { index: number; timestamp: number | null } | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]!.sha256 !== b[i]!.sha256) return { index: i, timestamp: a[i]!.timestamp };
  }
  if (a.length !== b.length) return { index: n, timestamp: (a[n] ?? b[n])?.timestamp ?? null };
  return null;
}

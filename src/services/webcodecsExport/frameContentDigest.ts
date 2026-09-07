/**
 * Rolling digest of the frame CONTENT the export worker submits to the encoder.
 *
 * Round 6 established that this project's VideoEncoder is not bit-reproducible:
 * two runs of identical code over the identical fixture produced different
 * annexb bytes (only 6.3% of chunks matched), with encodedBytes tracking wall
 * time while keyframeCount stayed fixed — i.e. deterministic GOP structure,
 * scheduler-dependent rate control. So `pieceSha256` over encoded output cannot
 * serve as an output-neutrality gate for a worker change: it moves on its own.
 *
 * This hashes the composited RGBA the worker hands to `VideoEncoder.encode()`,
 * BEFORE the encoder can add that noise. Two runs whose frame digests agree
 * submitted pixel-identical input; any difference in the encoded bytes is then
 * attributable to rate control, not to the change under test.
 *
 * Diagnostic-only and opt-in — `frameContentDigest` defaults off on the worker
 * init message, so a production export never pays the per-frame readback.
 */

/** Rolling fold: digest_n = SHA-256(digest_{n-1} || SHA-256(frame_n)). */
const EMPTY_FOLD = new Uint8Array(32);

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // `.slice()` — a view over a worker-owned buffer is not a stable BufferSource
  // for subtle.digest across a transfer boundary.
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Minimal surface of VideoFrame this needs — keeps the unit test DOM-free. */
export interface FrameLike {
  allocationSize(): number;
  copyTo(destination: Uint8Array): Promise<unknown>;
}

export class FrameContentDigest {
  private fold: Uint8Array = EMPTY_FOLD;
  private frames = 0;
  private buffer: Uint8Array | null = null;

  get frameCount(): number {
    return this.frames;
  }

  /** Hash one frame's pixels and fold it into the running digest, in order. */
  async add(frame: FrameLike): Promise<void> {
    const size = frame.allocationSize();
    if (!this.buffer || this.buffer.byteLength !== size) {
      this.buffer = new Uint8Array(size);
    }
    await frame.copyTo(this.buffer);
    const frameHash = await sha256(this.buffer);
    const combined = new Uint8Array(this.fold.byteLength + frameHash.byteLength);
    combined.set(this.fold, 0);
    combined.set(frameHash, this.fold.byteLength);
    this.fold = await sha256(combined);
    this.frames++;
  }

  /** Hex of the fold over every frame added so far. */
  digestHex(): string {
    return toHex(this.fold);
  }
}

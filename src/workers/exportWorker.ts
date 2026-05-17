/**
 * exportWorker.ts
 *
 * Comlink-exposed service that owns a single FFmpeg instance.
 * Runs in a dedicated Web Worker so that ffmpeg.wasm (which in turn spawns
 * its own internal worker) does not block the main thread during encode/mux.
 *
 * Usage (main thread):
 *   import * as Comlink from 'comlink';
 *   const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
 *   const svc = Comlink.wrap<FfmpegWorkerService>(worker);
 *   await svc.load();
 *   await svc.writeFile('frame_00001.png', pngBytes);
 *   await svc.exec(['-framerate', '30', '-i', 'frame_%05d.png', ...]);
 *   const mp4 = await svc.readFile('out.mp4');
 *   await svc.deleteFiles(['frame_00001.png', 'out.mp4']);
 */

import * as Comlink from 'comlink';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const FFMPEG_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

export class FfmpegWorkerService {
  #ffmpeg: FFmpeg | null = null;
  #loaded = false;

  async load(): Promise<void> {
    if (this.#loaded) return;
    const ffmpeg = new FFmpeg();

    // Forward ffmpeg log lines to the worker's console so they still appear
    // in DevTools (worker logs show up under the worker context).
    ffmpeg.on('log', ({ message }) => {
      // eslint-disable-next-line no-console
      console.debug('[ffmpeg-worker]', message);
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    this.#ffmpeg = ffmpeg;
    this.#loaded = true;
  }

  #ensureLoaded(): FFmpeg {
    if (!this.#ffmpeg) throw new Error('FfmpegWorkerService: call load() first');
    return this.#ffmpeg;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.#ensureLoaded().writeFile(path, data);
  }

  /**
   * Run an ffmpeg command. Returns the exit code (0 = success).
   */
  async exec(args: string[]): Promise<number> {
    const ff = this.#ensureLoaded();
    return ff.exec(args);
  }

  /**
   * Read a file from the virtual FS, always as Uint8Array.
   */
  async readFile(path: string): Promise<Uint8Array> {
    const ff = this.#ensureLoaded();
    const data = await ff.readFile(path);
    return data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.#ensureLoaded().deleteFile(path);
    } catch {
      // Ignore — file may already be absent
    }
  }

  async deleteFiles(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map(p => this.deleteFile(p)));
  }
}

Comlink.expose(new FfmpegWorkerService());

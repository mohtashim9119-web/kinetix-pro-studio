import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/**
 * Lazy-loads and caches a single FFmpeg instance backed by ffmpeg.wasm.
 * Requires the page to be served with COOP/COEP headers so that
 * SharedArrayBuffer is available. If crossOriginIsolated is false the
 * single-threaded fallback core is used instead (slower, but functional).
 */
export async function loadFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    if (!crossOriginIsolated) {
      console.warn(
        '[ffmpegLoader] crossOriginIsolated is false — ' +
          'SharedArrayBuffer unavailable. The multi-threaded ffmpeg core ' +
          'will not load. Falling back to single-threaded core (slower). ' +
          'Ensure the server sends Cross-Origin-Opener-Policy: same-origin ' +
          'and Cross-Origin-Embedder-Policy: require-corp.'
      );
    }

    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.debug('[ffmpeg]', message);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    const version = await getFFmpegVersion(ffmpeg);
    console.info('[ffmpegLoader] loaded — version:', version);

    instance = ffmpeg;
    return ffmpeg;
  })();

  return loading;
}

async function getFFmpegVersion(ffmpeg: FFmpeg): Promise<string> {
  const lines: string[] = [];
  const handler = ({ message }: { message: string }) => lines.push(message);
  ffmpeg.on('log', handler);
  try {
    await ffmpeg.exec(['-version']);
  } catch {
    // -version exits non-zero; that's expected
  }
  ffmpeg.off('log', handler);
  const versionLine = lines.find((l) => l.startsWith('ffmpeg version'));
  return versionLine?.split(' ')[2] ?? 'unknown';
}

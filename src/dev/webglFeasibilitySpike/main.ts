/**
 * THROWAWAY FEASIBILITY SPIKE — WebGL2 effects-compositor engine decision.
 *
 * Standalone. Not imported by any real app code. Purpose: on the REAL Tauri
 * WKWebView (macOS) — and, as a cheaper first pass, on Chromium — empirically
 * answer the questions the WebGL/WebGPU architecture plan
 * (docs/webgl-architecture-plan.md, Part 2) needs answered with evidence,
 * not assumptions:
 *
 *   1. Does a real WebGL2 context create successfully? (version/renderer strings)
 *   2. Is WebGPU (navigator.gpu) even PRESENT in this WKWebView build, and does
 *      requestAdapter() return an adapter? (data point only — not the chosen engine
 *      unless it wins; the install-base argument is made in the doc)
 *   3. THE integration-critical check: does a WebCodecs VideoFrame (from the same
 *      demux+decode pipeline videoDemuxer.ts/videoDecoderPool.ts already use in
 *      shipped code) upload cleanly and performantly to a WebGL2 texture via
 *      gl.texImage2D, and render correctly?
 *   4. Do the actual effects this rebuild scopes (cross-dissolve, dip-to-black,
 *      dip-to-white, light-leak, zoom in/out, color grading) compile and render
 *      correctly as GLSL ES 3.0 shaders, verified by pixel readback?
 *   5. Throughput: single-texture upload+draw per decoded frame, and the
 *      worst-case transition load (TWO VideoFrame uploads + blended draw per frame).
 *
 * It exfiltrates its structured result via HTTP POST to a local listener (see
 * EXFIL_URL) AND to console, because the definitive run happens inside WKWebView
 * (not Chromium) where there is no automatable devtools — same methodology as
 * spike-webcodecs-audit.html / the WKWebView Cross-Check in
 * docs/webcodecs-architecture-plan.md.
 */

import { createFile, MP4BoxBuffer, DataStream, Endianness, type Movie, type Track } from 'mp4box';

type VideoTrack = Track & { video: { width: number; height: number } };

const SAMPLE_URL = '/_spike/sample.mp4';
const EXFIL_URL = 'http://127.0.0.1:8799/result';

/* eslint-disable @typescript-eslint/no-explicit-any */

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.log('[WEBGL-SPIKE] ' + msg);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ tag, payload, ts: Date.now() });
  try {
    await fetch(EXFIL_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, mode: 'cors', keepalive: true });
  } catch (e) {
    log('exfil POST failed (listener may be down): ' + (e instanceof Error ? e.message : String(e)));
  }
}

// ---------------------------------------------------------------------------
// Check 1+2 — engine presence
// ---------------------------------------------------------------------------

interface EnvReport {
  userAgent: string;
  webgl2: {
    present: boolean;
    version: string | null;
    shadingLanguageVersion: string | null;
    vendor: string | null;
    renderer: string | null;
    unmaskedVendor: string | null;   // via WEBGL_debug_renderer_info if exposed
    unmaskedRenderer: string | null;
    maxTextureSize: number | null;
  };
  webgpu: {
    navigatorGpuPresent: boolean;
    adapterReturned: boolean | null; // null = not attempted (gpu absent)
    adapterError: string | null;
  };
  hasVideoDecoder: boolean;
  hasVideoFrame: boolean;
}

async function probeEnv(gl: WebGL2RenderingContext | null): Promise<EnvReport> {
  const r: EnvReport = {
    userAgent: navigator.userAgent,
    webgl2: {
      present: gl !== null,
      version: null, shadingLanguageVersion: null, vendor: null, renderer: null,
      unmaskedVendor: null, unmaskedRenderer: null, maxTextureSize: null,
    },
    webgpu: { navigatorGpuPresent: false, adapterReturned: null, adapterError: null },
    hasVideoDecoder: typeof (globalThis as any).VideoDecoder !== 'undefined',
    hasVideoFrame: typeof (globalThis as any).VideoFrame !== 'undefined',
  };

  if (gl) {
    r.webgl2.version = gl.getParameter(gl.VERSION) as string;
    r.webgl2.shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string;
    r.webgl2.vendor = gl.getParameter(gl.VENDOR) as string;
    r.webgl2.renderer = gl.getParameter(gl.RENDERER) as string;
    r.webgl2.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      r.webgl2.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
      r.webgl2.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
    }
  }

  const gpu = (navigator as any).gpu;
  r.webgpu.navigatorGpuPresent = typeof gpu !== 'undefined' && gpu !== null;
  if (r.webgpu.navigatorGpuPresent) {
    try {
      const adapter = await gpu.requestAdapter();
      r.webgpu.adapterReturned = adapter !== null;
    } catch (e) {
      r.webgpu.adapterReturned = false;
      r.webgpu.adapterError = e instanceof Error ? e.message : String(e);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Shader plumbing
// ---------------------------------------------------------------------------

const VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  // Fullscreen triangle; UV y flipped so top-left-origin video content reads upright.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Single texture, straight blit (baseline for the upload test). */
const FRAG_BLIT = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA;
void main() { o = texture(u_texA, v_uv); }`;

/** cross-dissolve: mix two live textures by progress. */
const FRAG_CROSS_DISSOLVE = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA; uniform sampler2D u_texB; uniform float u_progress;
void main() { o = mix(texture(u_texA, v_uv), texture(u_texB, v_uv), u_progress); }`;

/** dip-to-black / dip-to-white: A fades to u_dipColor in first half, B fades in from it in second. */
const FRAG_DIP = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA; uniform sampler2D u_texB; uniform float u_progress; uniform vec3 u_dipColor;
void main() {
  vec3 a = texture(u_texA, v_uv).rgb;
  vec3 b = texture(u_texB, v_uv).rgb;
  vec3 c = (u_progress < 0.5)
    ? mix(a, u_dipColor, u_progress * 2.0)
    : mix(u_dipColor, b, (u_progress - 0.5) * 2.0);
  o = vec4(c, 1.0);
}`;

/** light-leak: cross-dissolve + procedural warm radial bloom, screen-blended,
 *  peaking mid-transition (alpha*(1-alpha)*4 — same shaping as the Canvas2D
 *  implementation in frameRenderer.ts's applyTransitionBlend). */
const FRAG_LIGHT_LEAK = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA; uniform sampler2D u_texB; uniform float u_progress;
void main() {
  vec3 base = mix(texture(u_texA, v_uv).rgb, texture(u_texB, v_uv).rgb, u_progress);
  float strength = u_progress * (1.0 - u_progress) * 4.0;
  vec2 center = vec2(0.75, 0.25);
  float d = distance(v_uv, center);
  vec3 leak = vec3(1.0, 0.85, 0.6) * smoothstep(0.9, 0.0, d) * strength;
  o = vec4(1.0 - (1.0 - base) * (1.0 - leak), 1.0); // screen blend
}`;

/** zoom in/out: UV scale around center driven by u_scale (matches the
 *  1.0 + 0.05*t math canvasAnimations.ts / getAnimationWrapperProps share). */
const FRAG_ZOOM = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA; uniform float u_scale;
void main() {
  vec2 uv = (v_uv - 0.5) / u_scale + 0.5;
  o = texture(u_texA, uv);
}`;

/** color grade: brightness/contrast/saturation/temperature — the proposed
 *  initial manual-adjustment set from the plan's Part 3. */
const FRAG_GRADE = `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_texA;
uniform float u_brightness; // -1..1, 0 = neutral
uniform float u_contrast;   // -1..1, 0 = neutral
uniform float u_saturation; // -1..1, 0 = neutral
uniform float u_temperature;// -1..1, 0 = neutral (+ = warm)
void main() {
  vec3 c = texture(u_texA, v_uv).rgb;
  c += u_brightness;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + u_saturation);
  c.r += u_temperature * 0.1;
  c.b -= u_temperature * 0.1;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compileProgram(gl: WebGL2RenderingContext, fragSrc: string): { program: WebGLProgram | null; error: string | null } {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, VERT);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    return { program: null, error: 'vert: ' + gl.getShaderInfoLog(vs) };
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    return { program: null, error: 'frag: ' + gl.getShaderInfoLog(fs) };
  }
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return { program: null, error: 'link: ' + gl.getProgramInfoLog(program) };
  }
  return { program, error: null };
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function readCenterPixel(gl: WebGL2RenderingContext, w: number, h: number): [number, number, number, number] {
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0]!, px[1]!, px[2]!, px[3]!];
}

// ---------------------------------------------------------------------------
// Check 3+5 — VideoFrame → texture upload + throughput, via real demux/decode
// ---------------------------------------------------------------------------

function getDescription(isoFile: ReturnType<typeof createFile>, track: VideoTrack): Uint8Array {
  const trak = isoFile.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = (entry as any).avcC ?? (entry as any).hvcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error('avcC/hvcC box not found on video track');
}

interface UploadReport {
  framesDecoded: number;
  framesUploaded: number;
  dualUploadFrames: number;       // frames that took the worst-case 2-upload transition path
  glErrorCount: number;
  firstGlError: string | null;
  // pixel readbacks (proof of real rendered content, not a black canvas)
  blitPixelSamples: Array<{ frame: number; rgba: number[] }>;
  blitPixelsVaryAcrossFrames: boolean | null;
  blitPixelsNonBlack: boolean | null;
  // throughput
  singleUploadDrawMsTotal: number;
  singleUploadDrawFps: number | null;
  dualUploadBlendMsTotal: number;
  dualUploadBlendFps: number | null;
  error: string | null;
}

async function runUploadTest(
  gl: WebGL2RenderingContext,
  canvasW: number,
  canvasH: number,
  blitProgram: WebGLProgram,
  dissolveProgram: WebGLProgram,
  texA: WebGLTexture,
  texB: WebGLTexture,
): Promise<UploadReport> {
  const r: UploadReport = {
    framesDecoded: 0, framesUploaded: 0, dualUploadFrames: 0,
    glErrorCount: 0, firstGlError: null,
    blitPixelSamples: [], blitPixelsVaryAcrossFrames: null, blitPixelsNonBlack: null,
    singleUploadDrawMsTotal: 0, singleUploadDrawFps: null,
    dualUploadBlendMsTotal: 0, dualUploadBlendFps: null,
    error: null,
  };

  const blitLocA = gl.getUniformLocation(blitProgram, 'u_texA');
  const disLocA = gl.getUniformLocation(dissolveProgram, 'u_texA');
  const disLocB = gl.getUniformLocation(dissolveProgram, 'u_texB');
  const disLocP = gl.getUniformLocation(dissolveProgram, 'u_progress');

  const SAMPLE_FRAMES = [10, 100, 250]; // readback checkpoints (readPixels is sync — keep rare)
  let singleCount = 0;
  let dualCount = 0;

  const checkGlError = () => {
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      r.glErrorCount++;
      if (!r.firstGlError) r.firstGlError = '0x' + err.toString(16) + ' at frame ' + r.framesUploaded;
    }
  };

  const decoder = new VideoDecoder({
    output(frame) {
      const i = r.framesDecoded++;
      try {
        // Frames 100-199: worst-case transition load — TWO uploads + blended draw.
        const dual = i >= 100 && i < 200;
        const t0 = performance.now();
        if (dual) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texA);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, texB);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
          gl.useProgram(dissolveProgram);
          gl.uniform1i(disLocA, 0);
          gl.uniform1i(disLocB, 1);
          gl.uniform1f(disLocP, (i - 100) / 100);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          r.dualUploadFrames = ++dualCount;
          r.dualUploadBlendMsTotal += performance.now() - t0;
        } else {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texA);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
          gl.useProgram(blitProgram);
          gl.uniform1i(blitLocA, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          singleCount++;
          r.singleUploadDrawMsTotal += performance.now() - t0;
        }
        r.framesUploaded++;
        checkGlError();
        if (SAMPLE_FRAMES.includes(i)) {
          gl.finish();
          const rgba = readCenterPixel(gl, canvasW, canvasH);
          r.blitPixelSamples.push({ frame: i, rgba: Array.from(rgba) });
        }
      } finally {
        frame.close();
      }
    },
    error(e) {
      r.error = 'decoder error cb: ' + e.message;
      log('DECODER ERROR CB: ' + e.message);
    },
  });

  try {
    const resp = await fetch(SAMPLE_URL);
    if (!resp.ok) throw new Error('fetch sample.mp4 failed: ' + resp.status);
    const buf = await resp.arrayBuffer();

    const mp4boxFile = createFile(true);
    let videoTrack: VideoTrack | null = null;
    let received = 0;

    await new Promise<void>((resolve, reject) => {
      mp4boxFile.onError = (module: string, msg: string) => reject(new Error(`mp4box [${module}]: ${msg}`));
      mp4boxFile.onSamples = (_id: number, _u: unknown, samples) => {
        for (const s of samples) {
          if (!s.data) continue;
          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: (1e6 * s.cts) / s.timescale,
            duration: (1e6 * s.duration) / s.timescale,
            data: s.data,
          }));
        }
        received += samples.length;
        if (videoTrack && received >= videoTrack.nb_samples) resolve();
      };
      mp4boxFile.onReady = (info: Movie) => {
        const t = info.videoTracks[0];
        if (!t || !t.video) { reject(new Error('no video track')); return; }
        videoTrack = t as VideoTrack;
        const description = getDescription(mp4boxFile, videoTrack);
        decoder.configure({
          codec: videoTrack.codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          description,
        });
        mp4boxFile.setExtractionOptions(videoTrack.id, null, { nbSamples: videoTrack.nb_samples });
        mp4boxFile.start();
      };
      mp4boxFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0));
    });

    await decoder.flush();
    gl.finish();

    if (singleCount > 0) r.singleUploadDrawFps = singleCount / (r.singleUploadDrawMsTotal / 1000);
    if (dualCount > 0) r.dualUploadBlendFps = dualCount / (r.dualUploadBlendMsTotal / 1000);

    const samples = r.blitPixelSamples;
    r.blitPixelsNonBlack = samples.some((s) => s.rgba[0]! + s.rgba[1]! + s.rgba[2]! > 30);
    r.blitPixelsVaryAcrossFrames = samples.length >= 2 && samples.some((s, i) =>
      i > 0 && s.rgba.some((v, ch) => Math.abs(v - samples[i - 1]!.rgba[ch]!) > 8),
    );
  } catch (e) {
    r.error = (r.error ? r.error + ' | ' : '') + (e instanceof Error ? e.message : String(e));
    log('UPLOAD TEST FAILED: ' + r.error);
  } finally {
    try { if (decoder.state !== 'closed') decoder.close(); } catch { /* noop */ }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Check 4 — effect shader correctness (pixel-verified)
// ---------------------------------------------------------------------------

interface ShaderReport {
  name: string;
  compiled: boolean;
  compileError: string | null;
  pixelChecks: Array<{ desc: string; rgba: number[]; pass: boolean }>;
  pass: boolean;
}

function runShaderChecks(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  programs: Record<string, { program: WebGLProgram | null; error: string | null }>,
  texA: WebGLTexture,
  texB: WebGLTexture,
): ShaderReport[] {
  const reports: ShaderReport[] = [];
  const bindAB = (p: WebGLProgram) => {
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    const la = gl.getUniformLocation(p, 'u_texA');
    const lb = gl.getUniformLocation(p, 'u_texB');
    if (la) gl.uniform1i(la, 0);
    if (lb) gl.uniform1i(lb, 1);
  };
  const draw = () => { gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish(); };

  // For each effect: render at characteristic uniform values, read center pixel,
  // check an assertable property (dip@0.5 = pure dip color; grades move the pixel
  // in the expected direction; zoom/dissolve render non-black content).
  for (const [name, { program, error }] of Object.entries(programs)) {
    const rep: ShaderReport = { name, compiled: program !== null, compileError: error, pixelChecks: [], pass: false };
    if (!program) { reports.push(rep); continue; }
    bindAB(program);

    if (name === 'dip-to-black' || name === 'dip-to-white') {
      const isBlack = name === 'dip-to-black';
      const locP = gl.getUniformLocation(program, 'u_progress');
      const locC = gl.getUniformLocation(program, 'u_dipColor');
      gl.uniform3f(locC, isBlack ? 0 : 1, isBlack ? 0 : 1, isBlack ? 0 : 1);
      gl.uniform1f(locP, 0.5);
      draw();
      const mid = readCenterPixel(gl, w, h);
      const midPass = isBlack
        ? mid[0] < 8 && mid[1] < 8 && mid[2] < 8
        : mid[0] > 247 && mid[1] > 247 && mid[2] > 247;
      rep.pixelChecks.push({ desc: 'progress=0.5 → pure dip color', rgba: Array.from(mid), pass: midPass });
      gl.uniform1f(locP, 0.0);
      draw();
      const start = readCenterPixel(gl, w, h);
      const startPass = start[0] + start[1] + start[2] > 30; // = texA content, not the dip color
      rep.pixelChecks.push({ desc: 'progress=0 → texA content', rgba: Array.from(start), pass: isBlack ? startPass : true });
    } else if (name === 'cross-dissolve' || name === 'light-leak') {
      const locP = gl.getUniformLocation(program, 'u_progress');
      gl.uniform1f(locP, 0.5);
      draw();
      const mid = readCenterPixel(gl, w, h);
      rep.pixelChecks.push({ desc: 'progress=0.5 renders non-black', rgba: Array.from(mid), pass: mid[0] + mid[1] + mid[2] > 30 });
      if (name === 'light-leak') {
        // Light leak peaks at 0.5: corner near the leak center should be brighter than at progress=0.
        const px = new Uint8Array(4);
        gl.readPixels(Math.floor(w * 0.75), Math.floor(h * 0.75), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const leakMid = px[0]! + px[1]! + px[2]!;
        gl.uniform1f(locP, 0.0);
        draw();
        gl.readPixels(Math.floor(w * 0.75), Math.floor(h * 0.75), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const leakStart = px[0]! + px[1]! + px[2]!;
        rep.pixelChecks.push({ desc: 'leak brighter at 0.5 than 0', rgba: [leakMid, leakStart], pass: leakMid > leakStart });
      }
    } else if (name === 'zoom') {
      const locS = gl.getUniformLocation(program, 'u_scale');
      gl.uniform1f(locS, 1.5);
      draw();
      const mid = readCenterPixel(gl, w, h);
      rep.pixelChecks.push({ desc: 'scale=1.5 renders non-black', rgba: Array.from(mid), pass: mid[0] + mid[1] + mid[2] > 30 });
    } else if (name === 'color-grade') {
      const set = (b: number, c: number, s: number, t: number) => {
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), b);
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), c);
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), s);
        gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), t);
      };
      set(0, 0, 0, 0);
      draw();
      const neutral = readCenterPixel(gl, w, h);
      set(0.3, 0, 0, 0);
      draw();
      const brighter = readCenterPixel(gl, w, h);
      const brightPass = brighter[0]! > neutral[0]! && brighter[1]! > neutral[1]!;
      rep.pixelChecks.push({ desc: 'brightness +0.3 raises RGB', rgba: [...Array.from(neutral), ...Array.from(brighter)], pass: brightPass });
      set(0, 0, 0, 1);
      draw();
      const warm = readCenterPixel(gl, w, h);
      rep.pixelChecks.push({ desc: 'temperature +1 shifts R up / B down vs neutral', rgba: Array.from(warm), pass: warm[0]! >= neutral[0]! && warm[2]! <= neutral[2]! });
    } else if (name === 'blit') {
      draw();
      const mid = readCenterPixel(gl, w, h);
      rep.pixelChecks.push({ desc: 'blit renders non-black', rgba: Array.from(mid), pass: mid[0] + mid[1] + mid[2] > 30 });
    }

    rep.pass = rep.pixelChecks.length > 0 && rep.pixelChecks.every((c) => c.pass);
    reports.push(rep);
  }
  return reports;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log('WebGL2 feasibility spike starting — UA: ' + navigator.userAgent);

  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const W = canvas.width;
  const H = canvas.height;
  // preserveDrawingBuffer so readPixels sees the last draw even after RAF boundaries;
  // fine for a spike (the real compositor won't need it).
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });

  const env = await probeEnv(gl);
  log('env: ' + JSON.stringify(env, null, 1));
  await exfil('env', env);

  if (!gl) {
    log('NO WEBGL2 CONTEXT — spike cannot continue. VERDICT: NO-GO on this runtime.');
    await exfil('DONE', { env, verdict: { webgl2Go: false, reason: 'no webgl2 context' } });
    return;
  }

  // Fullscreen triangle
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, W, H);

  const programs = {
    'blit': compileProgram(gl, FRAG_BLIT),
    'cross-dissolve': compileProgram(gl, FRAG_CROSS_DISSOLVE),
    'dip-to-black': compileProgram(gl, FRAG_DIP),
    'dip-to-white': compileProgram(gl, FRAG_DIP),
    'light-leak': compileProgram(gl, FRAG_LIGHT_LEAK),
    'zoom': compileProgram(gl, FRAG_ZOOM),
    'color-grade': compileProgram(gl, FRAG_GRADE),
  };
  const compileSummary = Object.fromEntries(Object.entries(programs).map(([k, v]) => [k, v.error ?? 'OK']));
  log('shader compile: ' + JSON.stringify(compileSummary, null, 1));
  await exfil('shaders-compiled', compileSummary);

  const texA = makeTexture(gl);
  const texB = makeTexture(gl);

  let upload: UploadReport | null = null;
  if (env.hasVideoDecoder && programs['blit'].program && programs['cross-dissolve'].program) {
    upload = await runUploadTest(gl, W, H, programs['blit'].program, programs['cross-dissolve'].program, texA, texB);
    log('upload test: ' + JSON.stringify(upload, null, 1));
    await exfil('upload', upload);
  } else {
    log('SKIPPING upload test (no VideoDecoder or required programs failed to compile)');
  }

  // texA/texB now hold real decoded frames (different content — texB last touched
  // at frame 199, texA at the final frame) — run the pixel-verified effect checks.
  const shaderReports = runShaderChecks(gl, W, H, programs, texA, texB);
  log('shader checks: ' + JSON.stringify(shaderReports, null, 1));
  await exfil('shader-checks', shaderReports);

  const verdict = {
    webgl2Go: env.webgl2.present,
    webgpuPresent: env.webgpu.navigatorGpuPresent,
    webgpuAdapter: env.webgpu.adapterReturned,
    videoFrameUploadGo: upload !== null && upload.error === null && upload.framesUploaded > 0
      && upload.glErrorCount === 0 && upload.blitPixelsNonBlack === true && upload.blitPixelsVaryAcrossFrames === true,
    singleUploadDrawFps: upload?.singleUploadDrawFps ?? null,
    dualUploadBlendFps: upload?.dualUploadBlendFps ?? null,
    allEffectShadersPass: shaderReports.every((s) => s.pass),
    failedShaders: shaderReports.filter((s) => !s.pass).map((s) => s.name),
  };
  (window as any).__webglSpikeResult = { env, upload, shaderReports, verdict };
  log('=== VERDICT: ' + JSON.stringify(verdict, null, 1));
  log('=== SPIKE COMPLETE — full result at window.__webglSpikeResult and exfil listener ===');
  await exfil('DONE', { env, upload, shaderReports, verdict });
}

document.getElementById('rerun')?.addEventListener('click', () => void main());
void main();

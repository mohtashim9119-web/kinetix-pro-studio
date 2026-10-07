/**
 * GL PiP quad + border, drawn AFTER GlCompositor.renderFrame and BEFORE
 * GLTextRenderer.renderFrame (scene < spots < captions).
 */

import { requireGl } from '../gl/glContext';
import type { UploadSource } from '../gl/glCompositor';
import { coverUv } from '../spots/spotGeometry';
import {
  SPOT_BORDER_RGBA,
  spotBorderRect,
  spotQuadRect,
  type SpotRenderSpec,
} from './spotRenderSpec';

const QUAD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_uv;
uniform vec4 u_rectPx;
uniform vec2 u_canvasSize;
// (u0, v0, u1, v1): the center-crop "cover" window of the source texture.
uniform vec4 u_uvWin;
out vec2 v_uv;
void main() {
  v_uv = mix(u_uvWin.xy, u_uvWin.zw, a_uv);
  vec2 pixelPos = u_rectPx.xy + a_uv * u_rectPx.zw;
  vec2 ndc = vec2(
    pixelPos.x / u_canvasSize.x * 2.0 - 1.0,
    1.0 - pixelPos.y / u_canvasSize.y * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const TEXTURED_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_tex;
void main() {
  o_color = texture(u_tex, v_uv);
}`;

const SOLID_FRAG = `#version 300 es
precision mediump float;
out vec4 o_color;
uniform vec4 u_color;
void main() {
  o_color = u_color;
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireGl(gl, gl.createShader(type), 'SpotLayerRenderer: gl.createShader()');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`SpotLayerRenderer: shader compile failed: ${info ?? '(no info log)'}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, QUAD_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = requireGl(gl, gl.createProgram(), 'SpotLayerRenderer: gl.createProgram()');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`SpotLayerRenderer: program link failed: ${info ?? '(no info log)'}`);
  }
  return program;
}

export interface SpotDrawCommand {
  spec: SpotRenderSpec;
  source: UploadSource;
  nativeW: number;
  nativeH: number;
}

export class SpotLayerRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly texProgram: WebGLProgram;
  private readonly solidProgram: WebGLProgram;
  private readonly uTexRect: WebGLUniformLocation | null;
  private readonly uTexCanvas: WebGLUniformLocation | null;
  private readonly uTex: WebGLUniformLocation | null;
  private readonly uTexUvWin: WebGLUniformLocation | null;
  private readonly uSolidUvWin: WebGLUniformLocation | null;
  private readonly uSolidRect: WebGLUniformLocation | null;
  private readonly uSolidCanvas: WebGLUniformLocation | null;
  private readonly uColor: WebGLUniformLocation | null;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly texture: WebGLTexture;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.texProgram = linkProgram(gl, TEXTURED_FRAG);
    this.solidProgram = linkProgram(gl, SOLID_FRAG);
    this.uTexRect = gl.getUniformLocation(this.texProgram, 'u_rectPx');
    this.uTexCanvas = gl.getUniformLocation(this.texProgram, 'u_canvasSize');
    this.uTex = gl.getUniformLocation(this.texProgram, 'u_tex');
    this.uTexUvWin = gl.getUniformLocation(this.texProgram, 'u_uvWin');
    this.uSolidUvWin = gl.getUniformLocation(this.solidProgram, 'u_uvWin');
    this.uSolidRect = gl.getUniformLocation(this.solidProgram, 'u_rectPx');
    this.uSolidCanvas = gl.getUniformLocation(this.solidProgram, 'u_canvasSize');
    this.uColor = gl.getUniformLocation(this.solidProgram, 'u_color');
    this.vao = requireGl(gl, gl.createVertexArray(), 'SpotLayerRenderer: vao');
    gl.bindVertexArray(this.vao);
    this.vbo = requireGl(gl, gl.createBuffer(), 'SpotLayerRenderer: vbo');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.texture = requireGl(gl, gl.createTexture(), 'SpotLayerRenderer: texture');
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  render(draws: readonly SpotDrawCommand[], frameW: number, frameH: number): void {
    if (draws.length === 0) return;
    const gl = this.gl;
    gl.viewport(0, 0, frameW, frameH);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const draw of draws) {
      const quad = spotQuadRect(draw.spec, frameW, frameH);
      const border = spotBorderRect(quad, frameH);
      this.drawSolid(border, frameW, frameH, SPOT_BORDER_RGBA);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw.source as unknown as TexImageSource);
      gl.useProgram(this.texProgram);
      gl.uniform4f(this.uTexRect, quad.x, quad.y, quad.w, quad.h);
      gl.uniform2f(this.uTexCanvas, frameW, frameH);
      // Cover (center-crop) — the same crop the preview's object-cover shows.
      const win = coverUv(quad.w / quad.h, draw.nativeW, draw.nativeH);
      gl.uniform4f(this.uTexUvWin, win.u0, win.v0, win.u1, win.v1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uTex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private drawSolid(
    rect: { x: number; y: number; w: number; h: number },
    frameW: number,
    frameH: number,
    rgba: readonly [number, number, number, number],
  ): void {
    const gl = this.gl;
    gl.useProgram(this.solidProgram);
    gl.uniform4f(this.uSolidRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2f(this.uSolidCanvas, frameW, frameH);
    gl.uniform4f(this.uSolidUvWin, 0, 0, 1, 1);
    gl.uniform4f(this.uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.texProgram);
    gl.deleteProgram(this.solidProgram);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texture);
  }
}

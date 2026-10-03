/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dashboard card preview frames: one JPEG per (projectId, preview-spine hash).
 * Source of truth is the persisted file (or keyed localStorage fallback), never
 * a shared in-memory slot. Last-opened cannot overwrite another card.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Asset, Project, ProjectMeta } from '../types';
import { isTauri } from './tauriFfmpeg';
import { mediaVaultGenerateThumbnail, mediaVaultReadBlob, mediaVaultReadThumbnail } from './mediaVaultClient';
import { loadAllMetas, loadProject, upsertProjectMeta } from './projectStore';

const BROWSER_KEY = (projectId: string, hash: string): string =>
  `kinetix:thumb-file:${projectId}:${hash}`;

const objectUrls = new Map<string, string>();
const inflight = new Map<string, Promise<boolean>>();
const generateOnce = new Set<string>();

export type ThumbBackend = {
  write(projectId: string, hash: string, jpeg: Uint8Array): Promise<void>;
  read(projectId: string, hash: string): Promise<Uint8Array | null>;
  has(projectId: string, hash: string): Promise<boolean>;
};

const memoryOnly = new Map<string, Uint8Array>();

const browserBackend: ThumbBackend = {
  async write(projectId, hash, jpeg) {
    const b64 = bytesToB64(jpeg);
    try {
      localStorage.setItem(BROWSER_KEY(projectId, hash), b64);
    } catch {
      memoryOnly.set(`${projectId}:${hash}`, jpeg);
    }
  },
  async read(projectId, hash) {
    const mem = memoryOnly.get(`${projectId}:${hash}`);
    if (mem) return mem;
    const b64 = localStorage.getItem(BROWSER_KEY(projectId, hash));
    return b64 ? b64ToBytes(b64) : null;
  },
  async has(projectId, hash) {
    return (await this.read(projectId, hash)) !== null;
  },
};

const tauriBackend: ThumbBackend = {
  async write(projectId, hash, jpeg) {
    try {
      await invoke<void>('project_thumbnail_write', jpeg, {
        headers: { 'project-id': projectId, 'preview-hash': hash },
      });
    } catch {
      await browserBackend.write(projectId, hash, jpeg);
    }
  },
  async read(projectId, hash) {
    try {
      const bytes = await invoke<number[] | null>('project_thumbnail_read', {
        projectId,
        previewHash: hash,
      });
      if (bytes) return new Uint8Array(bytes);
    } catch {
      /* fall through */
    }
    return browserBackend.read(projectId, hash);
  },
  async has(projectId, hash) {
    try {
      if (await invoke<boolean>('project_thumbnail_has', { projectId, previewHash: hash })) return true;
    } catch {
      /* fall through */
    }
    return browserBackend.has(projectId, hash);
  },
};

let backendOverride: ThumbBackend | null = null;

function activeBackend(): ThumbBackend {
  if (backendOverride) return backendOverride;
  return isTauri() ? tauriBackend : browserBackend;
}

export function __setThumbBackendForTests(next: ThumbBackend | null): void {
  backendOverride = next;
  memoryOnly.clear();
  generateOnce.clear();
  inflight.clear();
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

export function previewSpineHash(
  project: Pick<Project, 'segments' | 'assets'>,
): string {
  let h = 2166136261;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const seg of project.segments) {
    feed(seg.id);
    feed('|');
    feed(seg.assetId ?? '');
    feed(',');
  }
  feed('#');
  for (const a of project.assets) {
    if (a.type !== 'image' && a.type !== 'video') continue;
    feed(a.id);
    feed(':');
    feed(a.contentHash ?? '');
    feed(',');
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function previewVisualAsset(project: Pick<Project, 'segments' | 'assets'>): Asset | undefined {
  for (const seg of project.segments) {
    if (!seg.assetId) continue;
    const a = project.assets.find(x => x.id === seg.assetId);
    if (a && (a.type === 'image' || a.type === 'video')) return a;
  }
  return project.assets.find(a => a.type === 'image' || a.type === 'video');
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function dataUrlToJpeg(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/jpeg;base64,(.+)$/i.exec(dataUrl);
  if (!m?.[1]) return null;
  return b64ToBytes(m[1]);
}

export async function jpegBytesFromImageUrl(url: string | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const dataUrl = await new Promise<string | undefined>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(undefined); return; }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 320, 180);
        const scale = Math.min(320 / img.width, 180 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (320 - w) / 2, (180 - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(undefined);
      img.src = url;
    });
    return dataUrl ? dataUrlToJpeg(dataUrl) : null;
  } catch {
    return null;
  }
}

async function jpegFromRawBytes(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes.length < 80_000) {
    return bytes;
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: mime || 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  try {
    return await jpegBytesFromImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Closed projects have empty asset.url — pull bytes from vault / native / IDB. */
export async function extractPreviewJpeg(project: Project): Promise<Uint8Array | null> {
  const visual = previewVisualAsset(project);
  if (!visual) return null;

  if (visual.url) {
    const fromUrl = await jpegBytesFromImageUrl(visual.url);
    if (fromUrl) return fromUrl;
  }

  const hashed = [visual, ...project.assets.filter(a => a !== visual && (a.type === 'image' || a.type === 'video'))];
  for (const asset of hashed) {
    if (!asset.contentHash) continue;
    if (asset.type === 'video') {
      await mediaVaultGenerateThumbnail(asset.contentHash);
      try {
        const vault = await mediaVaultReadThumbnail(asset.contentHash);
        if (vault && vault.length >= 4 && vault[0] === 0xFF && vault[1] === 0xD8) return vault;
      } catch {
        /* next */
      }
    } else {
      try {
        const blob = await mediaVaultReadBlob(asset.contentHash);
        if (blob) {
          const jpeg = await jpegFromRawBytes(blob, 'image/jpeg');
          if (jpeg) return jpeg;
        }
      } catch {
        /* next */
      }
    }
  }

  try {
    const { readAssetNative } = await import('./nativeAssetStore');
    const native = await readAssetNative(project.id, visual.id);
    if (native?.length) {
      if (visual.type === 'image') {
        const jpeg = await jpegFromRawBytes(native, 'image/jpeg');
        if (jpeg) return jpeg;
      } else if (native[0] === 0xFF && native[1] === 0xD8) {
        return native;
      }
    }
  } catch {
    /* next */
  }

  try {
    const { getAsset } = await import('./assetStore');
    const stored = await getAsset(project.id, visual.id);
    if (stored?.blob) {
      const buf = new Uint8Array(await stored.blob.arrayBuffer());
      if (visual.type === 'image') {
        const jpeg = await jpegFromRawBytes(buf, stored.mimeType || 'image/jpeg');
        if (jpeg) return jpeg;
      } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
        return buf;
      }
    }
  } catch {
    /* none */
  }
  return null;
}

export async function hasPersistedThumbnail(projectId: string, hash: string): Promise<boolean> {
  try {
    return await activeBackend().has(projectId, hash);
  } catch {
    return false;
  }
}

export async function readPersistedThumbnail(projectId: string, hash: string): Promise<Uint8Array | null> {
  try {
    return await activeBackend().read(projectId, hash);
  } catch {
    return null;
  }
}

export async function writePersistedThumbnail(
  projectId: string,
  hash: string,
  jpeg: Uint8Array,
): Promise<void> {
  await activeBackend().write(projectId, hash, jpeg);
}

function announceThumb(projectId: string, hash: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('kinetix-thumb-ready', { detail: { projectId, hash } }));
}

export async function persistPreviewThumbnail(project: Project): Promise<boolean> {
  const hash = previewSpineHash(project);
  const key = `${project.id}:${hash}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = (async (): Promise<boolean> => {
    if (await hasPersistedThumbnail(project.id, hash)) {
      stampMetaHash(project, hash);
      announceThumb(project.id, hash);
      return true;
    }
    const jpeg = await extractPreviewJpeg(project);
    if (!jpeg) return false;
    await writePersistedThumbnail(project.id, hash, jpeg);
    stampMetaHash(project, hash);
    announceThumb(project.id, hash);
    return true;
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

function stampMetaHash(project: Project, hash: string): void {
  const prev = loadAllMetas().find(m => m.id === project.id);
  upsertProjectMeta({
    id: project.id,
    name: project.name,
    savedAt: prev?.savedAt ?? Date.now(),
    segmentCount: project.segments.length,
    thumbnailHash: hash,
    thumbnailAssetId: previewVisualAsset(project)?.id,
  });
}

export async function objectUrlForThumbnail(projectId: string, hash: string): Promise<string | null> {
  const cacheKey = `${projectId}:${hash}`;
  const hit = objectUrls.get(cacheKey);
  if (hit) return hit;
  const bytes = await readPersistedThumbnail(projectId, hash);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
  objectUrls.set(cacheKey, url);
  return url;
}

export function releaseThumbnailObjectUrl(projectId: string, hash: string): void {
  const cacheKey = `${projectId}:${hash}`;
  const url = objectUrls.get(cacheKey);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(cacheKey);
  }
}

export function enqueueBackgroundThumbnail(meta: ProjectMeta): void {
  if (!meta.segmentCount) return;
  void generateFromStoredProject(meta);
}

async function generateFromStoredProject(meta: ProjectMeta): Promise<void> {
  const guard = `bg:${meta.id}`;
  if (generateOnce.has(guard)) return;
  generateOnce.add(guard);
  try {
    const loaded = await loadProject(meta.id);
    if (!loaded) {
      generateOnce.delete(guard);
      return;
    }
    const ok = await persistPreviewThumbnail(loaded.project);
    if (!ok) generateOnce.delete(guard);
  } catch {
    generateOnce.delete(guard);
  }
}

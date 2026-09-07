/**
 * THROWAWAY — persist Round 2 measurements where the Tauri CSP allows:
 * same-origin fetch of /_spike/ws3-autorun.json and localStorage.
 * connect-src in tauri.conf.json does not include 127.0.0.1:8799.
 */

const AUTORUN_URL = '/_spike/ws3-autorun.json';
const STORE_KEY = 'kinetix:ws3-liveness:v1';
/** Fetch-spec keepalive request-body cap (64 KiB); stay clear of it. */
const KEEPALIVE_BODY_LIMIT_BYTES = 60_000;

export function persistLivenessReport(tag: string, payload: unknown): void {
  try {
    const prev = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
    prev[tag] = payload;
    prev.updatedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(prev));
  } catch {
    // quota / private mode — console is the fallback
  }
  // Same-origin POST — allowed by Tauri CSP `'self'`; Vite middleware writes
  // public/_spike/ws3-result.jsonl (gitignored).
  //
  // `keepalive` caps the total request body at 64 KiB per the Fetch spec. A
  // 1200-entry per-chunk hash array is ~80 KB, so a keepalive POST of it is
  // rejected outright and swallowed by the .catch below — the row silently
  // never reaches the jsonl. Only ask for keepalive when the body fits.
  const body = JSON.stringify({ tag, payload, ts: Date.now() });
  const fitsKeepalive = body.length < KEEPALIVE_BODY_LIMIT_BYTES;
  void fetch('/__ws3-liveness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    ...(fitsKeepalive ? { keepalive: true } : {}),
  }).catch(() => undefined);
  // eslint-disable-next-line no-console
  console.info('[ws3-liveness]', tag, payload);
}

export async function shouldAutorun(): Promise<boolean> {
  try {
    const resp = await fetch(AUTORUN_URL, { cache: 'no-store' });
    if (!resp.ok) return false;
    const body = (await resp.text()).trim();
    if (body === 'run') return true;
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === 'object' && parsed !== null && (parsed as { run?: boolean }).run === true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

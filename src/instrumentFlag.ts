// instrumentFlag.ts — rehydrates the __WF_INSTRUMENT__ waveform-pipeline debug
// flag from localStorage before any other app module evaluates. Must be the
// FIRST static import in main.tsx: ES modules evaluate sibling imports in the
// order they're written, so importing this before App.tsx guarantees the flag
// is set before any module further down the chain runs its own top-level code
// (e.g. waveformImageCache.ts's eager connection warm-up) — otherwise such
// eager code could run before the flag was set, silently disabling its own
// instrumentation for that one call regardless of localStorage's value.
//
// Enable once in the console: localStorage.setItem('kinetix:wf-instrument', '1')
// Disable: localStorage.removeItem('kinetix:wf-instrument')
// Survives reloads/restarts (unlike a plain globalThis.__WF_INSTRUMENT__ = true
// set in the console, which a fresh JS context always wipes).
try {
  if (localStorage.getItem('kinetix:wf-instrument') === '1') {
    (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ = true;
  }
} catch {
  /* localStorage unavailable — instrumentation just stays off */
}

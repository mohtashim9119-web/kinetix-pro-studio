const UI_STATE_KEY = 'kinetix:ui:v1';

export function readUiState(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? '{}'); }
  catch { return {}; }
}

export function patchUiState(partial: Record<string, unknown>): void {
  try { localStorage.setItem(UI_STATE_KEY, JSON.stringify({ ...readUiState(), ...partial })); }
  catch { /* quota exceeded or unavailable — ignore */ }
}

/**
 * Round 28 — in-app viewer for `kinetix-diagnostic.log`. Reads via
 * `getDiagnosticLogText` (`exportDiagnosticLog.ts`), which is the one door
 * onto the native `get_diagnostic_log_text` command — this component never
 * touches the file path itself. Presentation only: no polling, no
 * auto-refresh — the user hits Refresh when they want the latest lines.
 */

import React, { useEffect, useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getDiagnosticLogText } from '../services/exportDiagnosticLog';

export interface DiagnosticLogModalProps {
  onClose: () => void;
}

export function DiagnosticLogModal({ onClose }: DiagnosticLogModalProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [text, setText] = useState<string>('Loading…');
  const [copied, setCopied] = useState(false);

  const load = (): void => {
    setText('Loading…');
    void getDiagnosticLogText().then(
      (contents) => setText(contents),
      (err: unknown) => setText(`Failed to read diagnostic log: ${err instanceof Error ? err.message : String(err)}`),
    );
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagnostic log"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        ref={trapRef}
        data-testid="diagnostic-log-modal"
        className="bg-[#111] border border-[#282828] rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">Diagnostic log</h2>
          <button
            type="button"
            data-testid="diagnostic-log-close"
            aria-label="Close diagnostic log"
            onClick={onClose}
            className="shrink-0 p-1.5 text-gray-500 hover:text-white border border-transparent hover:border-[#282828] rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <pre
          data-testid="diagnostic-log-text"
          className="flex-1 min-h-0 overflow-auto bg-[#0A0A0A] border border-[#282828] rounded-lg p-3 text-[10px] font-mono text-gray-300 whitespace-pre-wrap break-all"
        >
          {text}
        </pre>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            data-testid="diagnostic-log-refresh"
            onClick={load}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-transparent border border-[#282828] p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:border-gray-500 transition-all"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          <button
            type="button"
            data-testid="diagnostic-log-copy"
            onClick={handleCopy}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F27D26] text-black p-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-400 transition-all"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}

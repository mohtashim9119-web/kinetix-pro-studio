import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (import.meta.env.DEV) {
  // Round 6 cursor-release verification autorun (dev-only).
  void import('./dev/exportLivenessProbe/maybeAutorunRound6');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

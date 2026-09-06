import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (import.meta.env.DEV) {
  // Round 5 pipeline bisection autorun (dev-only).
  void import('./dev/exportLivenessProbe/maybeAutorunRound5');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

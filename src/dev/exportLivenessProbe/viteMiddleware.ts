/**
 * THROWAWAY — Vite-only same-origin sink for Round 2 measurements.
 * Imported from vite.config.ts (dev server), never from production src/.
 */
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

const OUT = path.resolve(process.cwd(), 'public/_spike/ws3-result.jsonl');

export function ws3LivenessMiddleware(): Plugin {
  return {
    name: 'ws3-liveness-middleware',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ws3-liveness', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        req.on('end', () => {
          try {
            fs.mkdirSync(path.dirname(OUT), { recursive: true });
            fs.appendFileSync(OUT, Buffer.concat(chunks).toString('utf8') + '\n');
            res.statusCode = 204;
            res.end();
          } catch (e) {
            res.statusCode = 500;
            res.end(e instanceof Error ? e.message : 'write failed');
          }
        });
      });
    },
  };
}

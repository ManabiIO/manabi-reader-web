/** @license BSD-3-Clause */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../apps/web/build/', import.meta.url));
const base = process.env.BASE_PATH ?? '/reader-web';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    if (url.pathname === '/' && base) { response.writeHead(302, { Location: `${base}/` }).end(); return; }
    if (!url.pathname.startsWith(`${base}/`)) { response.writeHead(404).end('Not found'); return; }
    const relative = decodeURIComponent(url.pathname.slice(base.length + 1));
    const resolved = path.resolve(root, relative || 'index.html');
    if (!resolved.startsWith(root)) { response.writeHead(403).end(); return; }
    let file = resolved;
    try { if (!(await fs.stat(file)).isFile()) throw new Error(); } catch { if (!path.extname(relative)) file = path.join(root, relative ? `${relative}.html` : 'index.html'); else throw new Error(); }
    const body = await fs.readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`Reader preview: http://127.0.0.1:${process.env.PORT ?? 4173}${base}/`));

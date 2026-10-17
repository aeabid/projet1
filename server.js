// تشغيل محلي: قاعدة Postgres محلية (أو DATABASE_URL) + الواجهة + الـ API
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { createHandler } from './lib/app.js';

const root = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC = path.join(root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const { NetlifyDB } = await import('@netlify/database-dev');
  const local = new NetlifyDB({ directory: path.join(root, 'data', 'pg') });
  connectionString = await local.start();
  await local.applyMigrations(path.join(root, 'netlify', 'database', 'migrations'));
}

const handle = createHandler(new pg.Pool({ connectionString }), {
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handle(
      new Request(url, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      })
    );
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type'),
      'Cache-Control': response.headers.get('cache-control') || 'no-store',
      'Set-Cookie': response.headers.getSetCookie(),
    });
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  try {
    if (!file.startsWith(PUBLIC)) throw new Error('outside');
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`التطبيق يعمل على http://localhost:${port} (admin / ${process.env.ADMIN_PASSWORD ? '***' : 'admin123'})`));

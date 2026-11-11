// Zero-dependency local development server for Coworking Hub
// Runs the exact Cloudflare Worker (src/worker.js) locally using Node's built-in node:sqlite

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from './src/worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '.local.sqlite');
const PORT = parseInt(process.env.PORT || '8787', 10);

function loadDevVars() {
  const vars = {
    ARENA_CHANNEL_STATUS: 'closed',
    ...process.env
  };
  const devVarsPath = path.join(__dirname, '.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const lines = fs.readFileSync(devVarsPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) vars[key] = val;
    }
  }
  return vars;
}

// Cloudflare D1 compatible wrapper around node:sqlite DatabaseSync
function createD1Adapter(sqliteDb) {
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  function makePrepared(sql, boundParams = []) {
    return {
      bind(...params) {
        return makePrepared(sql, params);
      },
      async all() {
        const stmt = sqliteDb.prepare(sql);
        const rows = stmt.all(...boundParams);
        return { results: rows, success: true };
      },
      async first() {
        const stmt = sqliteDb.prepare(sql);
        const row = stmt.get(...boundParams);
        return row === undefined ? null : row;
      },
      async run() {
        const stmt = sqliteDb.prepare(sql);
        const res = stmt.run(...boundParams);
        return {
          success: true,
          meta: {
            last_row_id: Number(res.lastInsertRowid || 0),
            changes: Number(res.changes || 0)
          }
        };
      }
    };
  }

  return {
    prepare(sql) {
      return makePrepared(sql);
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) {
        out.push(await s.run());
      }
      return out;
    }
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function createAssetsAdapter() {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      let reqPath = decodeURIComponent(url.pathname);
      if (reqPath === '/') reqPath = '/index.html';

      const resolved = path.normalize(path.join(PUBLIC_DIR, reqPath));
      if (!resolved.startsWith(PUBLIC_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        return new Response('Not found', { status: 404 });
      }
      const ext = path.extname(resolved).toLowerCase();
      const body = fs.readFileSync(resolved);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        }
      });
    }
  };
}

const sqlite = new DatabaseSync(DB_PATH);
const env = {
  ...loadDevVars(),
  DB: createD1Adapter(sqlite),
  ASSETS: createAssetsAdapter()
};

const server = http.createServer(async (req, res) => {
  try {
    const protocol = 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const fullUrl = `${protocol}://${host}${req.url}`;

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const method = req.method || 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD' && bodyBuffer.length > 0;

    const webReq = new Request(fullUrl, {
      method,
      headers,
      body: hasBody ? bodyBuffer : undefined
    });

    const webRes = await worker.fetch(webReq, env);

    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    const respBytes = Buffer.from(await webRes.arrayBuffer());
    res.end(respBytes);
  } catch (err) {
    console.error('Local server error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message || 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`Coworking Hub running locally at http://localhost:${PORT}`);
  console.log(`SQLite DB: ${DB_PATH}`);
  console.log(`Are.na token configured: ${Boolean(env.ARENA_ACCESS_TOKEN)}`);
});

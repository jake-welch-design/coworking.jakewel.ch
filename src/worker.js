// Cloudflare Worker Backend for Coworking Hub
// Handles Auth, Group Chat, Are.na Resource Folders & Blocks, File Uploads, and Calendar

const SESSION_COOKIE = 'coworking_session';
const SESSION_TTL_DAYS = 30;
const D1_CHUNK_SIZE = 950_000; // ~950 KB per row (well below Cloudflare D1's 2 MB row limit)
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB max per file drop

export const ALLOWED_FONTS = [
  'Georgia, serif',
  "'Courier New', monospace",
  "'Times New Roman', serif",
  'Verdana, sans-serif',
  "'Trebuchet MS', sans-serif",
  'Impact, sans-serif',
  "'Comic Sans MS', cursive",
  "Palatino, 'Palatino Linotype', serif",
  'Garamond, serif',
  "'Arial Black', sans-serif",
  'Monaco, Consolas, monospace',
  "'Brush Script MT', cursive"
];

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name_color TEXT NOT NULL DEFAULT '#000000',
    name_font TEXT NOT NULL DEFAULT 'Georgia, serif',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`,
  `CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    arena_channel_id INTEGER,
    arena_channel_slug TEXT,
    arena_status TEXT NOT NULL DEFAULT 'closed',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    arena_block_id INTEGER,
    block_type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    source_url TEXT,
    image_url TEXT,
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    arena_author TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blocks_folder ON blocks(folder_id, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_arena_unique ON blocks(folder_id, arena_block_id) WHERE arena_block_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS uploaded_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage TEXT NOT NULL DEFAULT 'd1',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS uploaded_file_chunks (
    file_id TEXT NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (file_id, chunk_index)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    location TEXT NOT NULL DEFAULT 'FaceTime',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at ASC)`,
  `CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS shared_timer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    ends_at INTEGER,
    remaining_ms INTEGER NOT NULL DEFAULT 0,
    minutes INTEGER NOT NULL DEFAULT 25,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS app_counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dm_participants ON direct_messages(
    CASE WHEN from_user_id < to_user_id THEN from_user_id ELSE to_user_id END,
    CASE WHEN from_user_id < to_user_id THEN to_user_id ELSE from_user_id END,
    id ASC
  )`
];

// Column additions for existing databases; "duplicate column" errors mean it's already applied
const COLUMN_MIGRATIONS = [
  `ALTER TABLE blocks ADD COLUMN note TEXT`,
  `ALTER TABLE users ADD COLUMN allow_emails INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN last_seen_at TEXT`,
  `ALTER TABLE users ADD COLUMN presence TEXT NOT NULL DEFAULT 'offline'`
];

// A user counts as offline if no heartbeat arrived within this window
// (clients ping every 30s; hidden tabs can be throttled to ~1/min)
const PRESENCE_TIMEOUT_MS = 150000;

let schemaInitialized = false;

async function ensureSchema(db) {
  if (schemaInitialized) return;
  for (const sql of SCHEMA_STATEMENTS) {
    await db.prepare(sql).run();
  }
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message || err))) throw err;
    }
  }
  schemaInitialized = true;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function sanitizeColor(color) {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
    return color.trim().toLowerCase();
  }
  return '#000000';
}

function sanitizeFont(font) {
  if (typeof font === 'string' && ALLOWED_FONTS.includes(font)) {
    return font;
  }
  return ALLOWED_FONTS[0];
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha256Hex(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2_sha256$100000$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

function makeSessionCookie(token, maxAgeSeconds, isSecure) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

async function getCurrentUser(request, db) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  let rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) rawToken = auth.slice(7).trim();
  }
  if (!rawToken) return null;

  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.username, u.name_color, u.name_font, u.allow_emails
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .bind(tokenHash, nowIso)
    .first();
  return row || null;
}

async function createSession(userId, db, isSecure) {
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = bytesToHex(rawBytes);
  const tokenHash = await sha256Hex(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400 * 1000);
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(tokenHash, userId, expires.toISOString(), now.toISOString())
    .run();
  return makeSessionCookie(rawToken, SESSION_TTL_DAYS * 86400, isSecure);
}

// --- Data Query Helpers ---

async function fetchMessages(db, afterId = 0, limit = 150) {
  if (afterId > 0) {
    const { results } = await db
      .prepare(
        `SELECT m.id, m.body, m.created_at,
                u.id AS user_id, u.username, u.name_color, u.name_font
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.id > ?
         ORDER BY m.id ASC
         LIMIT ?`
      )
      .bind(afterId, limit)
      .all();
    return results || [];
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT m.id, m.body, m.created_at,
                u.id AS user_id, u.username, u.name_color, u.name_font
         FROM messages m
         JOIN users u ON u.id = m.user_id
         ORDER BY m.id DESC
         LIMIT ?
       ) ORDER BY id ASC`
    )
    .bind(limit)
    .all();
  return results || [];
}

async function fetchFolders(db) {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.title, f.arena_channel_id, f.arena_channel_slug, f.arena_status,
              f.created_by, f.created_at,
              u.username AS creator_username, u.name_color AS creator_color, u.name_font AS creator_font,
              (SELECT COUNT(*) FROM blocks b WHERE b.folder_id = f.id) AS block_count
       FROM folders f
       LEFT JOIN users u ON u.id = f.created_by
       ORDER BY f.id DESC`
    )
    .all();
  return results || [];
}

async function fetchFolderBlocks(db, folderId) {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.folder_id, b.arena_block_id, b.block_type, b.title, b.content,
              b.source_url, b.image_url, b.file_name, b.mime_type, b.file_size,
              b.created_by, b.arena_author, b.created_at, b.note,
              u.username AS creator_username, u.name_color AS creator_color, u.name_font AS creator_font
       FROM blocks b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.folder_id = ?
       ORDER BY b.id DESC`
    )
    .bind(folderId)
    .all();
  return results || [];
}

// Emails are only shared with logged-in viewers, and only for users who opted in
async function fetchUsers(db, viewer = null) {
  const { results } = await db
    .prepare(
      `SELECT id, username, name_color, name_font, allow_emails, email, last_seen_at, presence
       FROM users ORDER BY username COLLATE NOCASE ASC`
    )
    .all();
  const now = Date.now();
  return (results || []).map(({ email, allow_emails, last_seen_at, presence, ...u }) => {
    const fresh = last_seen_at && now - Date.parse(last_seen_at) < PRESENCE_TIMEOUT_MS;
    return {
      ...u,
      allow_emails: Boolean(allow_emails),
      status: fresh && presence !== 'offline' ? (presence === 'away' ? 'away' : 'online') : 'offline',
      ...(viewer && allow_emails ? { email } : {})
    };
  });
}

async function fetchDMs(db, userA, userB, limit = 100) {
  const lo = Math.min(userA, userB);
  const hi = Math.max(userA, userB);
  const { results } = await db
    .prepare(
      `SELECT dm.id, dm.body, dm.created_at,
              dm.from_user_id, dm.to_user_id,
              u.username, u.name_color, u.name_font
       FROM direct_messages dm
       JOIN users u ON u.id = dm.from_user_id
       WHERE (dm.from_user_id = ? AND dm.to_user_id = ?)
          OR (dm.from_user_id = ? AND dm.to_user_id = ?)
       ORDER BY dm.id ASC
       LIMIT ?`
    )
    .bind(lo, hi, hi, lo, limit)
    .all();
  return results || [];
}

async function fetchEvents(db) {
  // Return events from 60 days ago onward so calendar month navigation has context
  const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
  const { results: events } = await db
    .prepare(
      `SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.location, e.notes,
              e.created_by, e.created_at,
              u.username AS creator_username, u.name_color AS creator_color, u.name_font AS creator_font
       FROM events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.starts_at >= ?
       ORDER BY e.starts_at ASC`
    )
    .bind(cutoff)
    .all();

  const list = events || [];
  if (list.length === 0) return [];

  const { results: rsvps } = await db
    .prepare(
      `SELECT r.event_id, u.id AS user_id, u.username, u.name_color, u.name_font
       FROM event_rsvps r
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at ASC`
    )
    .all();

  const byEvent = new Map();
  for (const r of rsvps || []) {
    if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
    byEvent.get(r.event_id).push({
      id: r.user_id,
      username: r.username,
      name_color: r.name_color,
      name_font: r.name_font
    });
  }

  return list.map((ev) => ({
    ...ev,
    attendees: byEvent.get(ev.id) || []
  }));
}

function computeNextEvent(events) {
  const now = Date.now();
  for (const ev of events) {
    const startMs = Date.parse(ev.starts_at);
    if (Number.isNaN(startMs)) continue;
    const endMs = startMs + (ev.duration_minutes || 60) * 60_000;
    if (endMs > now) {
      return ev;
    }
  }
  return null;
}

async function computeStateToken(db) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM folders) AS f,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM blocks) AS b,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM events) AS e,
         (SELECT COUNT(*) FROM event_rsvps) AS r,
         (SELECT COALESCE(MAX(id), 0) || ':' || COALESCE(SUM(allow_emails), 0) FROM users) AS u,
         (SELECT COALESCE(MAX(id), 0) FROM direct_messages) AS dm,
         (SELECT COALESCE(MAX(value), 0) FROM app_counters WHERE name = 'messages_deleted') AS md,
         (SELECT COALESCE(MAX(updated_at), '') FROM shared_timer) AS t`
    )
    .first();
  if (!row) return '0';
  return `${row.f}|${row.b}|${row.e}|${row.r}|${row.u}|${row.dm}|${row.md}|${row.t}`;
}

// --- Shared session timer (one row for the whole room) ---

// Returns remaining time as of now, so clients don't depend on matching clocks.
// A running timer whose end has passed reads as 'done' until someone dismisses it.
async function fetchTimer(db) {
  const row = await db
    .prepare(
      `SELECT t.status, t.ends_at, t.remaining_ms, t.minutes, t.updated_at, u.username AS updated_by_username
       FROM shared_timer t
       LEFT JOIN users u ON u.id = t.updated_by
       WHERE t.id = 1`
    )
    .first();
  if (!row) return { status: 'idle', remaining_ms: 0, minutes: 25, updated_by_username: null, updated_at: '' };
  let { status } = row;
  let remaining = status === 'paused' ? row.remaining_ms : 0;
  if (status === 'running') {
    remaining = Math.max(0, (row.ends_at || 0) - Date.now());
    if (remaining === 0) status = 'done';
  }
  return {
    status,
    remaining_ms: remaining,
    minutes: row.minutes,
    updated_by_username: row.updated_by_username || null,
    updated_at: row.updated_at
  };
}

async function updateTimer(db, action, minutesInput, userId) {
  const current = await fetchTimer(db);
  const now = Date.now();
  let status = 'idle', endsAt = null, remaining = 0;
  let minutes = Math.min(600, Math.max(1, parseInt(minutesInput, 10) || current.minutes || 25));

  if (action === 'play') {
    const ms = current.status === 'paused' && current.remaining_ms > 0 ? current.remaining_ms : minutes * 60000;
    if (current.status === 'paused') minutes = current.minutes;
    status = 'running';
    endsAt = now + ms;
  } else if (action === 'pause') {
    if (current.status !== 'running') return current;
    status = 'paused';
    remaining = current.remaining_ms;
    minutes = current.minutes;
  } else if (action !== 'stop' && action !== 'dismiss') {
    throw new Error('Unknown timer action.');
  }

  await db
    .prepare(
      `INSERT INTO shared_timer (id, status, ends_at, remaining_ms, minutes, updated_by, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, ends_at = excluded.ends_at, remaining_ms = excluded.remaining_ms,
         minutes = excluded.minutes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(status, endsAt, remaining, minutes, userId, new Date(now).toISOString())
    .run();
  return fetchTimer(db);
}

// --- Are.na API Helpers ---

// Are.na API v3 — https://www.are.na/developers
const ARENA_API = 'https://api.are.na/v3';

function arenaToken(env) {
  // Tolerate stray whitespace/newlines or a pasted "Bearer " prefix in the secret
  return String(env.ARENA_ACCESS_TOKEN || '').trim().replace(/^Bearer\s+/i, '');
}

function arenaHeaders(env) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'CoworkingHub/1.0'
  };
  const token = arenaToken(env);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function arenaFetch(path, env, options = {}) {
  return fetch(`${ARENA_API}${path}`, { ...options, headers: arenaHeaders(env) });
}

async function arenaError(res, action) {
  const text = await res.text().catch(() => '');
  let detail = text.slice(0, 180);
  try {
    const j = JSON.parse(text);
    detail = j.details?.message || j.error || j.message || detail;
  } catch {}
  let hint = '';
  if (res.status === 401) hint = ' Check that ARENA_ACCESS_TOKEN is a valid personal access token.';
  if (res.status === 403) hint = ' The token needs the "write" access level.';
  return new Error(`Are.na ${action} failed (${res.status}): ${detail}${hint}`);
}

// Best available image URL on a v3 block
function arenaImage(item) {
  const img = item?.image;
  return img?.large?.src || img?.medium?.src || img?.src || null;
}

// Block description text from Are.na (v3 returns markdown/plain/html variants)
function arenaDescription(item) {
  const d = item?.description;
  if (typeof d === 'string') return d || null;
  return d?.markdown || d?.plain || null;
}

// Plain text body of a v3 Text block
function arenaText(item) {
  const c = item?.content;
  if (typeof c === 'string') return c;
  return c?.markdown ?? c?.plain ?? null;
}

function extractArenaSlug(input) {
  const trimmed = String(input || '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const u = new URL(trimmed);
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    }
  } catch {
    // ignore URL parse error
  }
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

async function createArenaChannel(title, env) {
  if (!arenaToken(env)) return null;
  const visibility = env.ARENA_CHANNEL_STATUS || 'closed';

  let res = await arenaFetch('/channels', env, {
    method: 'POST',
    body: JSON.stringify({ title, visibility })
  });

  // If private isn't allowed for this account, fall back to "closed" (auth errors are not retried)
  if (!res.ok && visibility === 'private' && ![401, 403].includes(res.status)) {
    res = await arenaFetch('/channels', env, {
      method: 'POST',
      body: JSON.stringify({ title, visibility: 'closed' })
    });
  }

  if (!res.ok) throw await arenaError(res, 'channel creation');
  return await res.json();
}

async function getArenaChannel(slug, env) {
  const res = await arenaFetch(`/channels/${encodeURIComponent(slug)}`, env, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Could not find Are.na channel "${slug}" (${res.status}).`);
  }
  return await res.json();
}

async function pushBlockToArena({ slug, sourceUrl, content, title, note, username }, env) {
  if (!arenaToken(env) || !slug) return null;

  // Are.na servers cannot fetch localhost URLs during local testing
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return null;
      }
    } catch {
      return null;
    }
  }

  // v3: one call creates the block (URL or text in `value`) and connects it to the channel
  const payload = {
    value: sourceUrl || content || '',
    channels: [{ id: slug }]
  };
  if (title) payload.title = title;
  // The note becomes the block's description on Are.na, followed by who added it
  const credit = username ? `Added by ${username}` : '';
  const description = [note, credit].filter(Boolean).join('\n\n');
  if (description) payload.description = description;

  const res = await arenaFetch('/blocks', env, { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) {
    console.warn((await arenaError(res, 'block push')).message);
    return null;
  }
  return await res.json();
}

// Contents listing items; tolerate either top-level key
function arenaContentsItems(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.contents)) return data.contents;
  return [];
}

// v3 removes a block from a channel by its connection id, which only the contents listing exposes
async function removeBlockFromArena(slug, blockId, env) {
  for (let page = 1; page <= 20; page++) {
    const res = await arenaFetch(
      `/channels/${encodeURIComponent(slug)}/contents?per=100&page=${page}`,
      env,
      { method: 'GET' }
    );
    if (!res.ok) return;
    const data = await res.json();
    const match = arenaContentsItems(data).find((i) => i?.id === blockId && i?.type !== 'Channel');
    if (match?.connection?.id) {
      await arenaFetch(`/connections/${match.connection.id}`, env, { method: 'DELETE' });
      return;
    }
    if (!data?.meta?.has_more_pages) return;
  }
}

async function syncFolderWithArena(folder, db, env) {
  if (!folder.arena_channel_slug) return;
  try {
    const res = await arenaFetch(
      `/channels/${encodeURIComponent(folder.arena_channel_slug)}/contents?per=100`,
      env,
      { method: 'GET' }
    );
    if (!res.ok) return;
    const contents = arenaContentsItems(await res.json());

    for (const item of contents) {
      if (!item || !item.id) continue;
      const isChannel = item.type === 'Channel' || item.base_type === 'Channel';
      if (item.type === 'PendingBlock') continue;

      const existing = await db
        .prepare(`SELECT id, title, image_url, source_url FROM blocks WHERE folder_id = ? AND arena_block_id = ?`)
        .bind(folder.id, item.id)
        .first();

      const itemImage = arenaImage(item);
      const itemTitle = item.title || null;
      const itemSource =
        item.source?.url ||
        item.attachment?.url ||
        (isChannel && item.slug
          ? `https://www.are.na/${item.owner?.slug || 'channel'}/${item.slug}`
          : null);

      if (existing) {
        if ((!existing.image_url && itemImage) || (!existing.title && itemTitle)) {
          await db
            .prepare(
              `UPDATE blocks
               SET title = COALESCE(title, ?),
                   image_url = COALESCE(image_url, ?),
                   source_url = COALESCE(source_url, ?)
               WHERE id = ?`
            )
            .bind(itemTitle, itemImage, itemSource, existing.id)
            .run();
        }
        continue;
      }

      let blockType = 'link';
      if (item.type === 'Text') blockType = 'text';
      else if (item.type === 'Image') blockType = 'image';
      else if (item.type === 'Attachment') blockType = 'file';

      const author = item.user || item.owner;
      const authorName = author?.username || author?.name || author?.slug || 'Are.na';
      await db
        .prepare(
          `INSERT OR IGNORE INTO blocks (
             folder_id, arena_block_id, block_type, title, content,
             source_url, image_url, file_name, mime_type, created_by, arena_author, created_at, note
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .bind(
          folder.id,
          item.id,
          blockType,
          itemTitle,
          blockType === 'text' ? arenaText(item) : null,
          itemSource,
          itemImage,
          item.attachment?.filename || item.image?.filename || null,
          item.attachment?.content_type || item.image?.content_type || null,
          authorName,
          item.created_at || new Date().toISOString(),
          arenaDescription(item)
        )
        .run();
    }
  } catch (err) {
    console.warn('Are.na sync skipped:', err?.message || err);
  }
}

// --- File Upload & Serving Helpers ---

async function storeUploadedFile(file, userId, db, env) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('File exceeds 15 MB limit.');
  }

  const fileId = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  const filename = (file.name || 'upload.bin').replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'upload.bin';
  const mimeType = file.type || 'application/octet-stream';
  const nowIso = new Date().toISOString();

  if (env.FILES_BUCKET) {
    await env.FILES_BUCKET.put(`${fileId}/${filename}`, bytes, {
      httpMetadata: { contentType: mimeType }
    });
    await db
      .prepare(
        `INSERT INTO uploaded_files (id, filename, mime_type, size_bytes, storage, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, 'r2', ?, ?)`
      )
      .bind(fileId, filename, mimeType, bytes.byteLength, userId, nowIso)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO uploaded_files (id, filename, mime_type, size_bytes, storage, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, 'd1', ?, ?)`
      )
      .bind(fileId, filename, mimeType, bytes.byteLength, userId, nowIso)
      .run();

    let chunkIndex = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += D1_CHUNK_SIZE) {
      const slice = bytes.subarray(offset, Math.min(offset + D1_CHUNK_SIZE, bytes.byteLength));
      await db
        .prepare(
          `INSERT INTO uploaded_file_chunks (file_id, chunk_index, data)
           VALUES (?, ?, ?)`
        )
        .bind(fileId, chunkIndex, slice)
        .run();
      chunkIndex++;
    }
  }

  return { fileId, filename, mimeType, sizeBytes: bytes.byteLength };
}

function isSafeInlineMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/svg+xml') return false; // Force download on SVGs to prevent inline script execution
  return (
    m.startsWith('image/') ||
    m === 'application/pdf' ||
    m.startsWith('audio/') ||
    m.startsWith('video/') ||
    m.startsWith('text/plain')
  );
}

async function serveUploadedFile(fileId, db, env) {
  const meta = await db
    .prepare(`SELECT id, filename, mime_type, size_bytes, storage FROM uploaded_files WHERE id = ?`)
    .bind(fileId)
    .first();
  if (!meta) return new Response('File not found', { status: 404 });

  const disposition = isSafeInlineMime(meta.mime_type)
    ? `inline; filename="${meta.filename.replace(/"/g, '')}"`
    : `attachment; filename="${meta.filename.replace(/"/g, '')}"`;

  const headers = {
    'Content-Type': meta.mime_type || 'application/octet-stream',
    'Content-Disposition': disposition,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable'
  };

  if (meta.storage === 'r2' && env.FILES_BUCKET) {
    const obj = await env.FILES_BUCKET.get(`${meta.id}/${meta.filename}`);
    if (!obj) return new Response('File missing from bucket', { status: 404 });
    return new Response(obj.body, { headers });
  }

  const { results } = await db
    .prepare(`SELECT data FROM uploaded_file_chunks WHERE file_id = ? ORDER BY chunk_index ASC`)
    .bind(meta.id)
    .all();

  const total = new Uint8Array(meta.size_bytes);
  let offset = 0;
  for (const row of results || []) {
    const chunk = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
    total.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(total, { headers });
}

function looksLikeUrl(str) {
  const trimmed = String(str || '').trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

// --- Main Worker Router ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Delegate non-API paths to Cloudflare Static Assets when deployed
    if (!pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Not found', { status: 404 });
    }

    if (!env.DB) {
      return errorResponse(
        'Cloudflare D1 database binding "DB" is not configured yet. Check wrangler.toml instructions.',
        500
      );
    }

    await ensureSchema(env.DB);
    const method = request.method.toUpperCase();
    const isSecure = url.protocol === 'https:';

    try {
      // 1. Public File Serving (used by browser & Are.na block ingestion)
      if (method === 'GET' && pathname.startsWith('/api/files/')) {
        const parts = pathname.slice('/api/files/'.length).split('/');
        const fileId = parts[0];
        if (!fileId) return errorResponse('Missing file ID', 400);
        return await serveUploadedFile(fileId, env.DB, env);
      }

      // 2. Bootstrap Endpoint
      if (method === 'GET' && pathname === '/api/bootstrap') {
        const user = await getCurrentUser(request, env.DB);
        const [messages, folders, events, stateToken, users, timer] = await Promise.all([
          fetchMessages(env.DB, 0, 150),
          fetchFolders(env.DB),
          fetchEvents(env.DB),
          computeStateToken(env.DB),
          fetchUsers(env.DB, user),
          fetchTimer(env.DB)
        ]);
        return jsonResponse({
          user,
          users,
          config: {
            arenaConfigured: Boolean(arenaToken(env)),
            passcodeRequired: Boolean(env.SIGNUP_PASSCODE),
            allowedFonts: ALLOWED_FONTS
          },
          messages,
          folders,
          events,
          nextEvent: computeNextEvent(events),
          timer,
          stateToken
        });
      }

      // 3. Lightweight Live Poll
      if (method === 'GET' && pathname === '/api/poll') {
        const afterMsg = Math.max(0, parseInt(url.searchParams.get('after_msg') || '0', 10) || 0);
        const [messages, stateToken] = await Promise.all([
          fetchMessages(env.DB, afterMsg, 100),
          computeStateToken(env.DB)
        ]);
        return jsonResponse({ messages, stateToken });
      }

      // 4. Auth: Sign Up
      if (method === 'POST' && pathname === '/api/auth/signup') {
        const body = await request.json().catch(() => ({}));
        const email = String(body.email || '').trim().toLowerCase();
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const nameColor = sanitizeColor(body.name_color);
        const nameFont = sanitizeFont(body.name_font);

        if (env.SIGNUP_PASSCODE && String(body.passcode || '') !== String(env.SIGNUP_PASSCODE)) {
          return errorResponse('Invalid passcode.', 403);
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return errorResponse('Invalid email.');
        }
        if (username.length < 2 || username.length > 24 || !/^[a-zA-Z0-9_.\- ]+$/.test(username)) {
          return errorResponse('Username must be 2–24 characters.');
        }
        if (password.length < 6) {
          return errorResponse('Password must be at least 6 characters.');
        }

        const existing = await env.DB
          .prepare(`SELECT email, username FROM users WHERE email = ? OR username = ?`)
          .bind(email, username)
          .first();
        if (existing) {
          if (String(existing.email).toLowerCase() === email) {
            return errorResponse('Email already in use.', 409);
          }
          return errorResponse('Username already in use.', 409);
        }

        const passwordHash = await hashPassword(password);
        const nowIso = new Date().toISOString();
        const insert = await env.DB
          .prepare(
            `INSERT INTO users (email, username, password_hash, name_color, name_font, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(email, username, passwordHash, nameColor, nameFont, nowIso)
          .run();

        const userId = insert.meta?.last_row_id;
        const user = await env.DB
          .prepare(`SELECT id, email, username, name_color, name_font FROM users WHERE id = ?`)
          .bind(userId)
          .first();

        const cookie = await createSession(user.id, env.DB, isSecure);
        return jsonResponse({ user }, 201, { 'Set-Cookie': cookie });
      }

      // 5. Auth: Log In (accepts email OR username)
      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await request.json().catch(() => ({}));
        const identifier = String(body.identifier || body.email || body.username || '').trim();
        const password = String(body.password || '');
        if (!identifier || !password) {
          return errorResponse('Credentials required.');
        }

        const row = await env.DB
          .prepare(
            `SELECT id, email, username, password_hash, name_color, name_font
             FROM users
             WHERE email = ? OR username = ?`
          )
          .bind(identifier.toLowerCase(), identifier)
          .first();

        if (!row || !(await verifyPassword(password, row.password_hash))) {
          return errorResponse('Invalid credentials.', 401);
        }

        const cookie = await createSession(row.id, env.DB, isSecure);
        return jsonResponse(
          {
            user: {
              id: row.id,
              email: row.email,
              username: row.username,
              name_color: row.name_color,
              name_font: row.name_font
            }
          },
          200,
          { 'Set-Cookie': cookie }
        );
      }

      // 6. Auth: Log Out
      if (method === 'POST' && pathname === '/api/auth/logout') {
        const cookies = parseCookies(request.headers.get('Cookie'));
        if (cookies[SESSION_COOKIE]) {
          const tokenHash = await sha256Hex(cookies[SESSION_COOKIE]);
          await env.DB
            .prepare(`UPDATE users SET presence = 'offline' WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ?)`)
            .bind(tokenHash)
            .run();
          await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
        }
        return jsonResponse({ ok: true }, 200, {
          'Set-Cookie': makeSessionCookie('', 0, isSecure)
        });
      }

      // 7. Auth: Update Name Color & Custom Font
      if (method === 'PATCH' && pathname === '/api/auth/profile') {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);

        const body = await request.json().catch(() => ({}));
        const nameColor = sanitizeColor(body.name_color ?? user.name_color);
        const nameFont = sanitizeFont(body.name_font ?? user.name_font);
        const allowEmails = typeof body.allow_emails === 'boolean' ? (body.allow_emails ? 1 : 0) : (user.allow_emails ? 1 : 0);

        await env.DB
          .prepare(`UPDATE users SET name_color = ?, name_font = ?, allow_emails = ? WHERE id = ?`)
          .bind(nameColor, nameFont, allowEmails, user.id)
          .run();

        return jsonResponse({
          user: { ...user, name_color: nameColor, name_font: nameFont, allow_emails: allowEmails }
        });
      }

      // 8. Chat Messages
      if (pathname === '/api/messages') {
        if (method === 'GET') {
          const afterId = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
          const messages = await fetchMessages(env.DB, afterId, 150);
          return jsonResponse({ messages });
        }

        if (method === 'POST') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);

          const body = await request.json().catch(() => ({}));
          const text = String(body.body || '').trim();
          if (!text) return errorResponse('Empty message.');
          if (text.length > 2000) return errorResponse('Message exceeds 2000 characters.');

          const nowIso = new Date().toISOString();
          const res = await env.DB
            .prepare(`INSERT INTO messages (user_id, body, created_at) VALUES (?, ?, ?)`)
            .bind(user.id, text, nowIso)
            .run();

          const created = {
            id: res.meta?.last_row_id,
            body: text,
            created_at: nowIso,
            user_id: user.id,
            username: user.username,
            name_color: user.name_color,
            name_font: user.name_font
          };
          return jsonResponse({ message: created }, 201);
        }
      }

      // 8b. Delete your own group chat message
      const msgDeleteMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
      if (method === 'DELETE' && msgDeleteMatch) {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);
        const res = await env.DB
          .prepare(`DELETE FROM messages WHERE id = ? AND user_id = ?`)
          .bind(parseInt(msgDeleteMatch[1], 10), user.id)
          .run();
        if (!res.meta?.changes) return errorResponse('Message not found.', 404);
        // Bumps the poll state token so other clients reload the chat
        await env.DB
          .prepare(
            `INSERT INTO app_counters (name, value) VALUES ('messages_deleted', 1)
             ON CONFLICT(name) DO UPDATE SET value = value + 1`
          )
          .run();
        return jsonResponse({ ok: true });
      }

      // 8c. Delete your own direct message
      const dmDeleteMatch = pathname.match(/^\/api\/dm-messages\/(\d+)$/);
      if (method === 'DELETE' && dmDeleteMatch) {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);
        const res = await env.DB
          .prepare(`DELETE FROM direct_messages WHERE id = ? AND from_user_id = ?`)
          .bind(parseInt(dmDeleteMatch[1], 10), user.id)
          .run();
        if (!res.meta?.changes) return errorResponse('Message not found.', 404);
        return jsonResponse({ ok: true });
      }

      // 9. Resource Folders (Are.na Channels)
      if (pathname === '/api/folders') {
        if (method === 'GET') {
          const folders = await fetchFolders(env.DB);
          return jsonResponse({ folders });
        }

        if (method === 'POST') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);

          const body = await request.json().catch(() => ({}));
          let title = String(body.title || '').trim();
          const existingSlug = extractArenaSlug(body.existing_arena_slug);

          if (!title && !existingSlug) {
            return errorResponse('Folder title required.');
          }
          if (title.length > 100) {
            return errorResponse('Folder title exceeds 100 characters.');
          }

          let arenaId = null;
          let arenaSlug = null;
          let arenaStatus = env.ARENA_CHANNEL_STATUS || 'closed';
          let arenaWarning = null;

          if (existingSlug) {
            const channel = await getArenaChannel(existingSlug, env);
            arenaId = channel.id || null;
            arenaSlug = channel.slug || existingSlug;
            arenaStatus = channel.visibility || 'closed';
            if (!title) title = channel.title || existingSlug;
          } else if (arenaToken(env)) {
            try {
              const channel = await createArenaChannel(title, env);
              if (channel) {
                arenaId = channel.id || null;
                arenaSlug = channel.slug || null;
                arenaStatus = channel.visibility || arenaStatus;
              }
            } catch (err) {
              arenaWarning = err.message;
            }
          }

          const nowIso = new Date().toISOString();
          const ins = await env.DB
            .prepare(
              `INSERT INTO folders (title, arena_channel_id, arena_channel_slug, arena_status, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(title, arenaId, arenaSlug, arenaStatus, user.id, nowIso)
            .run();

          const folderId = ins.meta?.last_row_id;
          const folder = await env.DB
            .prepare(
              `SELECT f.*, u.username AS creator_username, u.name_color AS creator_color, u.name_font AS creator_font
               FROM folders f LEFT JOIN users u ON u.id = f.created_by
               WHERE f.id = ?`
            )
            .bind(folderId)
            .first();

          if (existingSlug && folder) {
            await syncFolderWithArena(folder, env.DB, env);
          }

          const folders = await fetchFolders(env.DB);
          const updatedFolder = folders.find((f) => f.id === folderId) || folder;
          return jsonResponse({ folder: updatedFolder, arenaWarning }, 201);
        }
      }

      // 10. Single Folder Details, Sync, Delete, & Adding Blocks
      const folderBlocksMatch = pathname.match(/^\/api\/folders\/(\d+)\/blocks$/);
      if (folderBlocksMatch) {
        const folderId = parseInt(folderBlocksMatch[1], 10);
        const folder = await env.DB
          .prepare(`SELECT * FROM folders WHERE id = ?`)
          .bind(folderId)
          .first();
        if (!folder) return errorResponse('Folder not found.', 404);

        if (method === 'POST') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);

          const contentType = request.headers.get('Content-Type') || '';
          const nowIso = new Date().toISOString();
          const createdBlocks = [];

          if (contentType.includes('multipart/form-data')) {
            const form = await request.formData();
            const customTitle = String(form.get('title') || '').trim() || null;
            const note = String(form.get('note') || '').trim().slice(0, 2000) || null;
            const files = form.getAll('file').filter((f) => f && typeof f.arrayBuffer === 'function');

            if (files.length === 0) {
              return errorResponse('No file received.');
            }

            for (const file of files) {
              const stored = await storeUploadedFile(file, user.id, env.DB, env);
              const fileUrl = `${url.origin}/api/files/${stored.fileId}/${encodeURIComponent(stored.filename)}`;
              const isImage = stored.mimeType.toLowerCase().startsWith('image/') && stored.mimeType !== 'image/svg+xml';
              const blockType = isImage ? 'image' : 'file';
              const blockTitle = customTitle || stored.filename;

              const arenaBlock = await pushBlockToArena(
                {
                  slug: folder.arena_channel_slug,
                  sourceUrl: fileUrl,
                  title: blockTitle,
                  note,
                  username: user.username
                },
                env
              );

              const ins = await env.DB
                .prepare(
                  `INSERT INTO blocks (
                     folder_id, arena_block_id, block_type, title, content,
                     source_url, image_url, file_name, mime_type, file_size,
                     created_by, created_at, note
                   ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  folder.id,
                  arenaBlock?.id || null,
                  blockType,
                  blockTitle,
                  fileUrl,
                  isImage ? fileUrl : arenaImage(arenaBlock),
                  stored.filename,
                  stored.mimeType,
                  stored.sizeBytes,
                  user.id,
                  nowIso,
                  note
                )
                .run();

              createdBlocks.push(ins.meta?.last_row_id);
            }
          } else {
            const body = await request.json().catch(() => ({}));
            const rawInput = String(body.input ?? body.content ?? body.source ?? '').trim();
            const customTitle = String(body.title || '').trim() || null;
            const note = String(body.note || '').trim().slice(0, 2000) || null;

            if (!rawInput) {
              return errorResponse('Content required.');
            }

            const isUrl = looksLikeUrl(rawInput);
            let blockType = isUrl ? 'link' : 'text';
            if (isUrl && /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(rawInput)) {
              blockType = 'image';
            }

            const arenaBlock = await pushBlockToArena(
              {
                slug: folder.arena_channel_slug,
                sourceUrl: isUrl ? rawInput : null,
                content: isUrl ? null : rawInput,
                title: customTitle,
                note,
                username: user.username
              },
              env
            );

            const resolvedTitle =
              customTitle ||
              arenaBlock?.title ||
              (isUrl ? rawInput : null);
            const resolvedImage =
              arenaImage(arenaBlock) ||
              (blockType === 'image' ? rawInput : null);

            await env.DB
              .prepare(
                `INSERT INTO blocks (
                   folder_id, arena_block_id, block_type, title, content,
                   source_url, image_url, created_by, created_at, note
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(
                folder.id,
                arenaBlock?.id || null,
                blockType,
                resolvedTitle,
                isUrl ? null : rawInput,
                isUrl ? rawInput : null,
                resolvedImage,
                user.id,
                nowIso,
                note
              )
              .run();
          }

          const blocks = await fetchFolderBlocks(env.DB, folder.id);
          const folders = await fetchFolders(env.DB);
          return jsonResponse({ blocks, folders, createdCount: createdBlocks.length || 1 }, 201);
        }
      }

      const folderMatch = pathname.match(/^\/api\/folders\/(\d+)$/);
      if (folderMatch) {
        const folderId = parseInt(folderMatch[1], 10);
        const folder = await env.DB
          .prepare(
            `SELECT f.*, u.username AS creator_username, u.name_color AS creator_color, u.name_font AS creator_font
             FROM folders f LEFT JOIN users u ON u.id = f.created_by
             WHERE f.id = ?`
          )
          .bind(folderId)
          .first();

        if (!folder) return errorResponse('Folder not found.', 404);

        if (method === 'GET') {
          if (url.searchParams.get('sync') === '1' && folder.arena_channel_slug) {
            await syncFolderWithArena(folder, env.DB, env);
          }
          const blocks = await fetchFolderBlocks(env.DB, folderId);
          return jsonResponse({ folder, blocks });
        }

        if (method === 'DELETE') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);
          if (folder.created_by && folder.created_by !== user.id) {
            return errorResponse('Not authorized.', 403);
          }
          await env.DB.prepare(`DELETE FROM folders WHERE id = ?`).bind(folderId).run();
          const folders = await fetchFolders(env.DB);
          return jsonResponse({ folders });
        }
      }

      // 11. Delete Individual Block
      const blockMatch = pathname.match(/^\/api\/blocks\/(\d+)$/);
      if (blockMatch && method === 'DELETE') {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);

        const blockId = parseInt(blockMatch[1], 10);
        const block = await env.DB
          .prepare(
            `SELECT b.*, f.arena_channel_slug, f.created_by AS folder_creator
             FROM blocks b
             JOIN folders f ON f.id = b.folder_id
             WHERE b.id = ?`
          )
          .bind(blockId)
          .first();

        if (!block) return errorResponse('Block not found.', 404);
        if (block.created_by && block.created_by !== user.id && block.folder_creator !== user.id) {
          return errorResponse('Not authorized.', 403);
        }

        if (arenaToken(env) && block.arena_channel_slug && block.arena_block_id) {
          await removeBlockFromArena(block.arena_channel_slug, block.arena_block_id, env).catch(() => {});
        }

        await env.DB.prepare(`DELETE FROM blocks WHERE id = ?`).bind(blockId).run();
        const [blocks, folders] = await Promise.all([
          fetchFolderBlocks(env.DB, block.folder_id),
          fetchFolders(env.DB)
        ]);
        return jsonResponse({ blocks, folders });
      }

      // 12. Calendar Events & RSVPs
      if (pathname === '/api/events') {
        if (method === 'GET') {
          const events = await fetchEvents(env.DB);
          return jsonResponse({ events, nextEvent: computeNextEvent(events) });
        }

        if (method === 'POST') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);

          const body = await request.json().catch(() => ({}));
          const title = String(body.title || '').trim();
          const startsAtRaw = String(body.starts_at || '').trim();
          const duration = Math.min(720, Math.max(10, parseInt(body.duration_minutes || '60', 10) || 60));
          const location = String(body.location || 'FaceTime').trim().slice(0, 300) || 'FaceTime';
          const notes = String(body.notes || '').trim().slice(0, 1000);

          if (!title || title.length > 120) {
            return errorResponse('Title required (max 120 characters).');
          }
          const parsedMs = Date.parse(startsAtRaw);
          if (Number.isNaN(parsedMs)) {
            return errorResponse('Invalid date or time.');
          }

          const startsAtIso = new Date(parsedMs).toISOString();
          const nowIso = new Date().toISOString();

          const ins = await env.DB
            .prepare(
              `INSERT INTO events (title, starts_at, duration_minutes, location, notes, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(title, startsAtIso, duration, location, notes, user.id, nowIso)
            .run();

          const eventId = ins.meta?.last_row_id;
          if (eventId) {
            await env.DB
              .prepare(`INSERT OR IGNORE INTO event_rsvps (event_id, user_id, created_at) VALUES (?, ?, ?)`)
              .bind(eventId, user.id, nowIso)
              .run();
          }

          const events = await fetchEvents(env.DB);
          return jsonResponse({ events, nextEvent: computeNextEvent(events) }, 201);
        }
      }

      const eventRsvpMatch = pathname.match(/^\/api\/events\/(\d+)\/rsvp$/);
      if (eventRsvpMatch && method === 'POST') {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);

        const eventId = parseInt(eventRsvpMatch[1], 10);
        const existing = await env.DB
          .prepare(`SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?`)
          .bind(eventId, user.id)
          .first();

        if (existing) {
          await env.DB
            .prepare(`DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?`)
            .bind(eventId, user.id)
            .run();
        } else {
          await env.DB
            .prepare(`INSERT INTO event_rsvps (event_id, user_id, created_at) VALUES (?, ?, ?)`)
            .bind(eventId, user.id, new Date().toISOString())
            .run();
        }

        const events = await fetchEvents(env.DB);
        return jsonResponse({ events, nextEvent: computeNextEvent(events) });
      }

      const eventDeleteMatch = pathname.match(/^\/api\/events\/(\d+)$/);
      if (eventDeleteMatch && method === 'DELETE') {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);

        const eventId = parseInt(eventDeleteMatch[1], 10);
        const ev = await env.DB
          .prepare(`SELECT id, created_by FROM events WHERE id = ?`)
          .bind(eventId)
          .first();
        if (!ev) return errorResponse('Event not found.', 404);
        if (ev.created_by && ev.created_by !== user.id) {
          return errorResponse('Not authorized.', 403);
        }

        await env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId).run();
        const events = await fetchEvents(env.DB);
        return jsonResponse({ events, nextEvent: computeNextEvent(events) });
      }

      // 12a. Shared session timer: GET state; POST { action: play|pause|stop|dismiss, minutes }
      if (pathname === '/api/timer') {
        if (method === 'GET') {
          return jsonResponse({ timer: await fetchTimer(env.DB) });
        }
        if (method === 'POST') {
          const user = await getCurrentUser(request, env.DB);
          if (!user) return errorResponse('Authentication required.', 401);
          const body = await request.json().catch(() => ({}));
          try {
            const timer = await updateTimer(env.DB, String(body.action || ''), body.minutes, user.id);
            return jsonResponse({ timer });
          } catch (err) {
            return errorResponse(err.message);
          }
        }
      }

      // 12b. Presence heartbeat: { status: 'online' | 'away' | 'offline' } → current directory
      if (method === 'POST' && pathname === '/api/presence') {
        const user = await getCurrentUser(request, env.DB);
        if (user) {
          const body = await request.json().catch(() => ({}));
          const status = ['online', 'away', 'offline'].includes(body.status) ? body.status : 'online';
          await env.DB
            .prepare(`UPDATE users SET presence = ?, last_seen_at = ? WHERE id = ?`)
            .bind(status, new Date().toISOString(), user.id)
            .run();
        }
        const users = await fetchUsers(env.DB, user);
        return jsonResponse({ users });
      }

      // 13. User Directory
      if (method === 'GET' && pathname === '/api/users') {
        const viewer = await getCurrentUser(request, env.DB);
        const users = await fetchUsers(env.DB, viewer);
        return jsonResponse({ users });
      }

      // 14. Direct Messages
      const dmMatch = pathname.match(/^\/api\/dm\/(\d+)$/);
      if (dmMatch) {
        const user = await getCurrentUser(request, env.DB);
        if (!user) return errorResponse('Authentication required.', 401);
        const otherUserId = parseInt(dmMatch[1], 10);

        if (method === 'GET') {
          const messages = await fetchDMs(env.DB, user.id, otherUserId);
          return jsonResponse({ messages });
        }

        if (method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const text = String(body.body || '').trim();
          if (!text) return errorResponse('Empty message.');
          if (text.length > 2000) return errorResponse('Message exceeds 2000 characters.');

          const nowIso = new Date().toISOString();
          const res = await env.DB
            .prepare(`INSERT INTO direct_messages (from_user_id, to_user_id, body, created_at) VALUES (?, ?, ?, ?)`)
            .bind(user.id, otherUserId, text, nowIso)
            .run();

          const created = {
            id: res.meta?.last_row_id,
            body: text,
            created_at: nowIso,
            from_user_id: user.id,
            to_user_id: otherUserId,
            username: user.username,
            name_color: user.name_color,
            name_font: user.name_font
          };
          return jsonResponse({ message: created }, 201);
        }
      }

      return errorResponse('API endpoint not found.', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse(err?.message || 'Internal server error.', 500);
    }
  }
};

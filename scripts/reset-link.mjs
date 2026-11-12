#!/usr/bin/env node
// Admin: make a one-time password reset link for a user.
//
//   node scripts/reset-link.mjs <username>            # live site
//   node scripts/reset-link.mjs <username> --local    # local `wrangler dev` database
//
// Prints a link to send the person. It works once, expires after 24 hours, and
// signs them out everywhere when used. Only the token's hash is stored in D1.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const DB_NAME = 'coworking-db';
const SITE = 'https://coworking.jakewel.ch';
const LOCAL_SITE = 'http://localhost:8787';
const TTL_HOURS = 24;

const args = process.argv.slice(2);
const local = args.includes('--local');
const username = args.find((a) => !a.startsWith('--'));

if (!username) {
  console.error('Usage: node scripts/reset-link.mjs <username> [--local]');
  process.exit(1);
}
// Same characters signup allows; keeps the value safe to put in SQL
if (!/^[a-zA-Z0-9_.\- ]{2,24}$/.test(username)) {
  console.error(`"${username}" isn't a valid username.`);
  process.exit(1);
}

function d1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, local ? '--local' : '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const parsed = JSON.parse(out);
  if (parsed.error) throw new Error(parsed.error.text || JSON.stringify(parsed.error));
  return parsed.flatMap((r) => r.results || []);
}

const name = username.replace(/'/g, "''");
const [user] = d1(`SELECT id, username FROM users WHERE lower(username) = lower('${name}')`);
if (!user) {
  console.error(`No user named "${username}".`);
  process.exit(1);
}

const token = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = Date.now();
const expires = now + TTL_HOURS * 60 * 60 * 1000;

d1(
  `CREATE TABLE IF NOT EXISTS password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL,
     used_at TEXT,
     created_at INTEGER NOT NULL
   );
   DELETE FROM password_resets WHERE user_id = ${Number(user.id)};
   INSERT INTO password_resets (token_hash, user_id, expires_at, created_at)
   VALUES ('${tokenHash}', ${Number(user.id)}, ${expires}, ${now});`
);

console.log(`\nReset link for ${user.username} (works once, expires in ${TTL_HOURS} hours):\n`);
console.log(`${local ? LOCAL_SITE : SITE}/reset.html?token=${token}\n`);

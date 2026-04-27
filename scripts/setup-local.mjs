#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const token = process.env.TOKEN?.trim();
if (!token) {
  console.error('Missing TOKEN. Run: TOKEN=your-private-token npm run setup:local');
  process.exit(1);
}

function run(command, args) {
  const printable = [command, ...args].join(' ');
  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureDevVars() {
  const file = '.dev.vars';
  const line = `SESSION_SECRET=${process.env.SESSION_SECRET?.trim() || randomBytes(32).toString('hex')}`;
  if (!existsSync(file)) {
    writeFileSync(file, `${line}\n`, { mode: 0o600 });
    console.log('Created .dev.vars with SESSION_SECRET.');
    return;
  }

  const current = readFileSync(file, 'utf8');
  if (/^SESSION_SECRET=/m.test(current)) return;
  appendFileSync(file, `${current.endsWith('\n') ? '' : '\n'}${line}\n`);
  console.log('Added SESSION_SECRET to .dev.vars.');
}

ensureDevVars();
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'rill', '--local']);

const tokenHash = createHash('sha256').update(token).digest('hex');
const now = Date.now();
const sql = `INSERT OR REPLACE INTO users (id, handle, token_hash, created_at, updated_at) VALUES ('user-1', 'samay', '${tokenHash}', ${now}, ${now})`;
run('npx', ['wrangler', 'd1', 'execute', 'rill', '--local', '--command', sql]);

console.log('Local Rill database is ready. Start the app with: npx wrangler dev');

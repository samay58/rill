import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist', import.meta.url).pathname;
const blocked = [
  /fonts\.googleapis\.com/i,
  /googletagmanager/i,
  /\banalytics\b/i,
  /\bsegment\b/i,
  /\bmixpanel\b/i,
  /<script\b[^>]*\bsrc=["']https?:\/\//i,
  /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']https?:\/\//i,
  /@import\s+url\(["']?https?:\/\//i
];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

let failed = false;
for (const path of await files(root)) {
  if (!/\.(html|js|css|json|webmanifest|svg)$/i.test(path)) continue;
  const text = await readFile(path, 'utf8');
  for (const pattern of blocked) {
    if (pattern.test(text)) {
      console.error(`privacy lint failed: ${path} matched ${pattern}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('privacy lint passed');

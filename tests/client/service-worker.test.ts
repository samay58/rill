import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('service worker freshness policy', () => {
  it('uses a new cache name and network-first navigations', () => {
    const source = readFileSync('public/sw.js', 'utf8');

    expect(source).toContain("const CACHE_NAME = 'rill-app-shell-v3'");
    expect(source).toContain("'/icons/rill-icon-512.png'");
    expect(source).toContain('async function networkFirstNavigation(request)');
    expect(source).toContain('event.respondWith(networkFirstNavigation(event.request))');
    expect(source).not.toContain("caches.match('/index.html').then((cached) => cached || fetch(event.request))");
  });
});

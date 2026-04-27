import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractRemoteImages, sanitizeFeedHtml } from '../../src/shared/feed/sanitize';

describe('sanitizeFeedHtml', () => {
  const unsafe = readFileSync(join(process.cwd(), 'tests/fixtures/unsafe.html'), 'utf8');

  it('strips active and dangerous html', () => {
    const clean = sanitizeFeedHtml(unsafe);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<form');
    expect(clean).toContain('https://safe.example/path');
  });

  it('extracts remote image urls before images are hidden by the reader', () => {
    expect(extractRemoteImages(unsafe)).toEqual(['https://images.example/pixel.png']);
  });
});

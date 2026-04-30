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

  it('removes relative media sources that would request same-origin paths', () => {
    const clean = sanitizeFeedHtml(`
      <p>Article copy.</p>
      <picture>
        <source srcset="/photo.webp">
        <img src="/why-everyone-you-know-is-playing-padel" alt="">
      </picture>
      <video poster="/poster.jpg" src="/clip.mp4"></video>
      <audio src="/clip.mp3"></audio>
    `);

    expect(clean).toContain('Article copy.');
    expect(clean).not.toContain('/why-everyone-you-know-is-playing-padel');
    expect(clean).not.toContain('/photo.webp');
    expect(clean).not.toContain('/poster.jpg');
    expect(clean).not.toContain('/clip.mp4');
    expect(clean).not.toContain('/clip.mp3');
    expect(clean).not.toContain('<source');
    expect(clean).not.toContain('<video');
    expect(clean).not.toContain('<audio');
  });

  it('resolves relative article links when a publisher base URL is provided', () => {
    const clean = sanitizeFeedHtml('<p><a href="/membership/">Join</a></p><a href="http://localhost:3000/serve-brings-out-the-boys">Story</a><a href="javascript:alert(1)">bad</a>', {
      baseUrl: 'https://aquariumdrunkard.com/reviews/post'
    });

    expect(clean).toContain('href="https://aquariumdrunkard.com/membership/"');
    expect(clean).toContain('href="https://aquariumdrunkard.com/serve-brings-out-the-boys"');
    expect(clean).not.toContain('localhost');
    expect(clean).not.toContain('javascript:');
  });
});

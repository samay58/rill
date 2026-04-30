import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractPublicArticle, isPublicHttpUrl } from '../../src/worker/articleExtract';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

describe('article extraction', () => {
  it('extracts and sanitizes readable public article content', async () => {
    const fetcher = vi.fn(async () => new Response(fixture('readable-article.html'), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    }));

    const result = await extractPublicArticle('https://example.com/robots', { fetcher, timeoutMs: 1000, maxBytes: 200_000 });

    expect(result.title).toBe('The Robots Make the Predictions');
    expect(result.content_text).toContain('first full paragraph');
    expect(result.content_html_sanitized).toContain('<p>This is the first full paragraph');
    expect(result.content_html_sanitized).not.toContain('<script');
    expect(result.has_remote_images).toBe(1);
    expect(fetcher).toHaveBeenCalledWith('https://example.com/robots', expect.objectContaining({
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal)
    }));
  });

  it('rejects private and malformed urls before fetch', () => {
    expect(isPublicHttpUrl('https://example.com/post')).toBe(true);
    expect(isPublicHttpUrl('http://localhost/post')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.4/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.2/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:7f00:1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:10.0.0.4]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:c0a8:102]/post')).toBe(false);
    expect(isPublicHttpUrl('file:///tmp/post')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });

  it('rejects redirects to private urls after fetch', async () => {
    const response = new Response(fixture('readable-article.html'), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    Object.defineProperty(response, 'url', { value: 'http://127.0.0.1/robots' });
    const fetcher = vi.fn(async () => response);

    await expect(extractPublicArticle('https://example.com/robots', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'invalid_article_url' });
  });

  it('reports upstream fetch failures without extracted content', async () => {
    const fetcher = vi.fn(async () => new Response('blocked', { status: 403 }));

    await expect(extractPublicArticle('https://example.com/blocked', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'article_fetch_failed' });
  });

  it('reports pages with no readable content', async () => {
    const fetcher = vi.fn(async () => new Response('<html><body><p>tiny</p></body></html>', {
      headers: { 'content-type': 'text/html' }
    }));

    await expect(extractPublicArticle('https://example.com/tiny', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'article_not_readable' });
  });
});

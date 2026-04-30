import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractPublicArticle, isPublicHttpUrl } from '../../src/worker/articleExtract';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

describe('article extraction', () => {
  it('extracts and sanitizes readable public article content', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(fixture('readable-article.html'), {
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
      redirect: 'manual',
      signal: expect.any(AbortSignal)
    }));
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
  });

  it('rejects private and malformed urls before fetch', () => {
    expect(isPublicHttpUrl('https://example.com/post')).toBe(true);
    expect(isPublicHttpUrl('http://1.1.1.1/post')).toBe(true);
    expect(isPublicHttpUrl('http://[2606:4700:4700::1111]/post')).toBe(true);
    expect(isPublicHttpUrl('http://localhost/post')).toBe(false);
    expect(isPublicHttpUrl('http://0.0.0.0/post')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.4/post')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.1.2/post')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://172.31.255.255/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.0.2.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.88.99.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.2/post')).toBe(false);
    expect(isPublicHttpUrl('http://100.64.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://100.127.255.255/post')).toBe(false);
    expect(isPublicHttpUrl('http://198.18.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://198.19.255.255/post')).toBe(false);
    expect(isPublicHttpUrl('http://198.51.100.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://203.0.113.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://224.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://240.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://255.255.255.255/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[100::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[2001::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[2001:db8::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[2002::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[3fff::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[5f00::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[fc00::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[fd00::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[fe80::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[fe81::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[ff00::1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:7f00:1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:10.0.0.4]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:c0a8:102]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:6440:1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:192.0.2.1]/post')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:cb00:7101]/post')).toBe(false);
    expect(isPublicHttpUrl('file:///tmp/post')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });

  it('follows validated public redirects manually', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url) === 'https://example.com/robots') {
        return new Response(null, { status: 302, headers: { location: '/article/robots' } });
      }
      return new Response(fixture('readable-article.html'), {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    });

    const result = await extractPublicArticle('https://example.com/robots', { fetcher, timeoutMs: 1000, maxBytes: 200_000 });

    expect(result.title).toBe('The Robots Make the Predictions');
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://example.com/robots',
      'https://example.com/article/robots'
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
  });

  it('rejects redirects to private urls before fetching them', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/robots' }
    }));

    await expect(extractPublicArticle('https://example.com/robots', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'invalid_article_url' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://example.com/robots', expect.objectContaining({ redirect: 'manual' }));
  });

  it('rejects redirect chains that exceed the hop limit', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      const hop = Number(parsed.searchParams.get('hop') ?? '0');
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/robots?hop=${hop + 1}` }
      });
    });

    await expect(extractPublicArticle('https://example.com/robots?hop=0', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'invalid_article_url' });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('rejects redirected private response urls', async () => {
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

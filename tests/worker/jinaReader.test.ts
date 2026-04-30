import { describe, expect, it, vi } from 'vitest';
import { extractWithJinaReader } from '../../src/worker/jinaReader';

describe('Jina Reader fallback', () => {
  it('converts Reader API markdown into sanitized article content', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(String(_input)).toBe('https://r.jina.ai/');
      expect(init?.method).toBe('POST');
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('x-respond-with')).toBe('markdown');
      expect(headers.has('cookie')).toBe(false);
      expect(String(init?.body)).toContain('url=https%3A%2F%2Fexample.com%2Farticle%3Fa%3D1');
      return new Response(JSON.stringify({
        code: 200,
        data: {
          title: 'Reader Article',
          url: 'https://example.com/article?a=1',
          content: `# Reader Article\n\n${'Full markdown body from the resolver. '.repeat(30)}\n\n<script>alert('nope')</script>`
        }
      }), { headers: { 'content-type': 'application/json' } });
    });

    const result = await extractWithJinaReader('https://example.com/article?a=1', { fetcher, timeoutMs: 1000 });

    expect(result.title).toBe('Reader Article');
    expect(result.content_text).toContain('Full markdown body from the resolver.');
    expect(result.content_html_sanitized).toContain('<p>Reader Article</p>');
    expect(result.content_html_sanitized).not.toContain('<script');
    expect(result.has_remote_images).toBe(0);
  });

  it('rejects non-public target urls before calling the Reader API', async () => {
    const fetcher = vi.fn();

    await expect(extractWithJinaReader('http://127.0.0.1/article', { fetcher }))
      .rejects.toMatchObject({ code: 'article_url_not_public' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'dclid', 'mc_cid', 'mc_eid']);

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function resolveUrl(input: string | null | undefined, baseUrl: string): string | null {
  if (!input) return null;
  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return null;
  }
}

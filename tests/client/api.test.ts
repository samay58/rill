import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBootstrap } from '../../src/client/api';

describe('client API errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the HTTP status when bootstrap returns a non-JSON auth failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })));

    await expect(fetchBootstrap()).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized'
    });
  });
});

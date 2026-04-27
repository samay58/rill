import { describe, expect, it } from 'vitest';
import { constantTimeEqual, createExpiredSessionCookie, createSessionCookie, hashToken, readSignedSessionId, verifyToken } from '../../src/worker/auth';

describe('auth helpers', () => {
  it('hashes and verifies the private token without keeping the raw token', async () => {
    const hash = await hashToken('correct horse battery staple');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('correct');
    await expect(verifyToken('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyToken('wrong token', hash)).resolves.toBe(false);
  });

  it('compares strings in constant-time shape', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('creates and verifies httpOnly signed session cookies', async () => {
    const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-27T00:00:00Z'));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    const request = new Request('https://rill.local/', { headers: { cookie } });
    await expect(readSignedSessionId(request, 'secret')).resolves.toBe('session-1');
    await expect(readSignedSessionId(request, 'wrong-secret')).resolves.toBeNull();
  });

  it('clears the session cookie on logout', () => {
    const cookie = createExpiredSessionCookie();
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(cookie).toContain('HttpOnly');
  });
});

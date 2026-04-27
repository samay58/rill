import { getSession, getUserByHandle, getUserById, createSession } from './db';
import type { Env } from './env';
import type { Clock } from '../shared/time';
import { secondsFromNow, systemClock } from '../shared/time';
import type { User } from '../shared/types';

const SESSION_COOKIE = 'rill_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

export function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  return constantTimeEqual(await hashToken(token), storedHash);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signSessionId(sessionId: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(sessionId));
  return bytesToBase64Url(signature);
}

export async function verifySessionSignature(sessionId: string, signature: string, secret: string): Promise<boolean> {
  const signatureBytes = base64UrlToArrayBuffer(signature);
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signatureBytes, new TextEncoder().encode(sessionId));
}

export async function createSessionCookie(sessionId: string, secret: string, expiresAt: number): Promise<string> {
  const signature = await signSessionId(sessionId, secret);
  return `${SESSION_COOKIE}=${sessionId}.${signature}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Lax`;
}

export function createExpiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, rawValue.join('='));
  }
  return cookies;
}

export async function readSignedSessionId(request: Request, secret: string): Promise<string | null> {
  const cookie = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  if (!cookie) return null;
  const [sessionId, signature] = cookie.split('.');
  if (!sessionId || !signature) return null;
  if (!(await verifySessionSignature(sessionId, signature, secret))) return null;
  return sessionId;
}

export async function createUserSession(env: Env, userId: string, clock: Clock = systemClock): Promise<{ sessionId: string; cookie: string }> {
  const now = clock();
  const sessionId = crypto.randomUUID();
  const expiresAt = secondsFromNow(clock, SESSION_TTL_SECONDS);
  const secret = env.SESSION_SECRET ?? 'dev-session-secret';
  await createSession(env.DB, {
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt,
    created_at: now,
    last_seen_at: now
  });
  return { sessionId, cookie: await createSessionCookie(sessionId, secret, expiresAt) };
}

export async function requireUser(request: Request, env: Env, clock: Clock = systemClock): Promise<User> {
  const secret = env.SESSION_SECRET ?? 'dev-session-secret';
  const sessionId = await readSignedSessionId(request, secret);
  if (!sessionId) throw new Response('Unauthorized', { status: 401 });
  const session = await getSession(env.DB, sessionId, clock());
  if (!session) throw new Response('Unauthorized', { status: 401 });
  const user = await getUserById(env.DB, session.user_id);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  return user;
}

export async function unlockWithToken(env: Env, token: string, clock: Clock = systemClock): Promise<{ user: User; cookie: string }> {
  const user = await getUserByHandle(env.DB, 'samay');
  if (!user) throw new Response('Unlock is not configured', { status: 503 });
  if (!(await verifyToken(token, user.token_hash))) throw new Response('Invalid token', { status: 401 });
  const { cookie } = await createUserSession(env, user.id, clock);
  return {
    user: { id: user.id, handle: user.handle, created_at: user.created_at, updated_at: user.updated_at },
    cookie
  };
}

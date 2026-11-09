// The password on a workspace's requests. Shared by api.mts (which hides the requests
// without it) and lock.mts (which sets it and checks it).
//
// The password itself is never stored. What is stored is a PBKDF2 hash of it and the salt
// that made the hash, and neither ever leaves the server. Proof of the password is a token
// in a cookie, signed with the hash, so changing the password makes old tokens useless.

const ITERATIONS = 120000;
const TOKEN_HOURS = 12;

export type Lock = { salt: string; hash: string };

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Same time to compare whatever the inputs, so a wrong guess gives nothing away.
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeLock(password: string, salt?: Uint8Array): Promise<Lock> {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: s, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return { salt: toB64(s), hash: toB64(new Uint8Array(bits)) };
}

export async function passwordMatches(lock: Lock, password: string) {
  const got = await makeLock(password, fromB64(lock.salt));
  return same(got.hash, lock.hash);
}

async function sign(lock: Lock, slug: string, exp: number) {
  const key = await crypto.subtle.importKey("raw", fromB64(lock.hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${slug}.${exp}`));
  return toB64(new Uint8Array(mac));
}

export async function makeToken(lock: Lock, slug: string) {
  const exp = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return `${exp}.${await sign(lock, slug, exp)}`;
}

export async function tokenValid(lock: Lock | undefined, slug: string, token: string | null) {
  if (!lock || !token) return false;
  const cut = token.indexOf(".");
  if (cut < 1) return false;
  const exp = Number(token.slice(0, cut));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  try { return same(token.slice(cut + 1), await sign(lock, slug, exp)); } catch { return false; }
}

export const cookieName = (slug: string) => `aa_${slug.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;

export function cookieFrom(req: Request, slug: string) {
  const name = cookieName(slug);
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setCookie(token: string, slug: string) {
  return `${cookieName(slug)}=${encodeURIComponent(token)}; Path=/; Max-Age=${TOKEN_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = (slug: string) => `${cookieName(slug)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Someone guessing passwords is stopped for a while after a run of wrong ones.
const TRIES = 8;
const COOLOFF = 15 * 60 * 1000;
type Tries = { n: number; at: number };

export function blockedFor(t: Tries | null) {
  if (!t || t.n < TRIES) return 0;
  return Math.max(0, t.at + COOLOFF - Date.now());
}

export function countWrong(t: Tries | null): Tries {
  if (t && Date.now() - t.at < COOLOFF) return { n: t.n + 1, at: Date.now() };
  return { n: 1, at: Date.now() };
}

import { sql } from "./db.ts";
import { env } from "./config.ts";

export type User = {
  id: number;
  email: string;
  role: "farmer" | "government" | "hotel" | "buyer" | "admin";
  status: "pending" | "approved" | "suspended" | "rejected" | "deleted";
  full_name: string;
  organisation: string | null;
  buyer_type: string | null;
  parish: string | null;
  phone: string | null;
  notify_channel: "sms" | "whatsapp" | "email" | "none";
};

const COOKIE = "fx_session";
const SESSION_DAYS = 14;

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => Bun.password.hash(pw); // argon2id
export const verifyPassword = (pw: string, hash: string) => Bun.password.verify(pw, hash);

export function passwordProblem(pw: string, email: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters for your password.";
  if (pw.length > 200) return "That password is too long.";
  if (pw.toLowerCase() === email.toLowerCase()) return "Your password cannot be your email address.";
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|123456789|qwertyui)/i.test(pw)) return "Choose a password that is harder to guess.";
  return null;
}

// ---------- cookies ----------
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${env.production ? "; Secure" : ""}`;
}

// ---------- sessions ----------
export async function createSession(userId: number): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, ${expires})`;
  return cookieHeader(COOKIE, token, SESSION_DAYS * 86400);
}

export async function destroySession(req: Request): Promise<string> {
  const token = readCookie(req, COOKIE);
  if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
  return cookieHeader(COOKIE, "", 0);
}

export async function destroyAllSessions(userId: number) {
  await sql`delete from sessions where user_id = ${userId}`;
}

export async function currentUser(req: Request): Promise<User | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const rows = await sql`
    select u.id, u.email, u.role, u.status, u.full_name, u.organisation, u.buyer_type, u.parish, u.phone, u.notify_channel
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now() and u.status <> 'deleted'`;
  return (rows[0] as User | undefined) ?? null;
}

// ---------- login rate limit ----------
// In memory, per process. Good enough for one server; use a shared store if you run several.
const attempts = new Map<string, { n: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function rateLimited(key: string, max = MAX_ATTEMPTS): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt < now) return false;
  return a.n >= max;
}
export function recordFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt < now) attempts.set(key, { n: 1, resetAt: now + WINDOW_MS });
  else a.n++;
}
export function clearFailures(key: string) {
  attempts.delete(key);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}, WINDOW_MS).unref();

export function clientIp(req: Request, server: { requestIP(r: Request): { address: string } | null }): string {
  // Only trust X-Forwarded-For when running behind a known proxy (production hosts set it).
  const fwd = env.production ? req.headers.get("x-forwarded-for") : null;
  return fwd?.split(",")[0]?.trim() || server.requestIP(req)?.address || "unknown";
}

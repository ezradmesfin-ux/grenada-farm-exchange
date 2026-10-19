import { sql } from "./db.ts";
import { env } from "./config.ts";
import { cookieHeader, readCookie, type User } from "./auth.ts";
import { layout, pendingNotice, type Flash } from "./views.ts";
import { html, type Raw } from "./util.ts";

export type Ctx = {
  req: Request;
  url: URL;
  user: User | null;
  params: Record<string, string>;
  ip: string;
};

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

const FLASH = "fx_flash";

export function flashCookie(f: Flash): string {
  return cookieHeader(FLASH, JSON.stringify(f), 30);
}

function readFlash(req: Request): Flash | null {
  const v = readCookie(req, FLASH);
  if (!v) return null;
  try {
    const f = JSON.parse(v);
    if (f && typeof f.text === "string" && ["ok", "error", "warn"].includes(f.type)) return { type: f.type, text: f.text.slice(0, 300) };
  } catch { /* ignore */ }
  return null;
}

/** Only allows paths on this site. */
export function safeNext(v: string | null | undefined, fallback = "/board"): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.includes("\n") || v.includes("\r")) return fallback;
  return v;
}

export function redirect(to: string, f?: Flash, cookies: string[] = []): Response {
  const h = new Headers({ Location: to });
  for (const c of cookies) h.append("Set-Cookie", c);
  if (f) h.append("Set-Cookie", flashCookie(f));
  return new Response(null, { status: 303, headers: h });
}

export function textResponse(body: string, status = 200, type = "text/plain; charset=utf-8", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": type, ...headers } });
}

export async function page(
  ctx: Ctx,
  o: { title: string; body: Raw; status?: number; sub?: { href: string; label: string }[]; description?: string; flash?: Flash | null },
): Promise<Response> {
  const user = ctx.user;
  const flash = o.flash ?? readFlash(ctx.req);
  let matchBadge = 0;
  let pendingUsers = 0;
  if (user?.status === "approved") {
    const [{ n }] = await sql`
      select count(*)::int as n from matches m
      join listings l on l.id = m.listing_id join needs nd on nd.id = m.need_id
      where m.status = 'suggested'
        and ((l.farmer_id = ${user.id} and not m.farmer_ok) or (nd.buyer_id = ${user.id} and not m.buyer_ok))`;
    matchBadge = n;
    if (user.role === "admin") {
      const [{ p }] = await sql`select count(*)::int as p from users where status = 'pending'`;
      pendingUsers = p;
    }
  }
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  if (readCookie(ctx.req, FLASH)) headers.append("Set-Cookie", cookieHeader(FLASH, "", 0));
  const body = layout({ title: o.title, user, path: ctx.url.pathname, body: o.body, flash, matchBadge, pendingUsers, sub: o.sub, description: o.description });
  return new Response(body, { status: o.status ?? 200, headers });
}

export async function errorPage(ctx: Ctx, status: number, title: string, message: string): Promise<Response> {
  return page(ctx, { title, status, body: html`<h1>${title}</h1><p class="lede">${message}</p><p><a href="${ctx.user?.status === "approved" ? "/board" : "/"}">Back to the start</a></p>` });
}

/**
 * Checks the sign-in and role. Returns the user to carry on, or a Response to send back.
 * Pass `{ allowUnapproved: true }` for pages that pending people may use (like their account).
 */
export async function guard(ctx: Ctx, roles?: User["role"][], opts: { allowUnapproved?: boolean } = {}): Promise<User | Response> {
  const user = ctx.user;
  if (!user) return redirect(`/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
  if (user.status !== "approved" && !opts.allowUnapproved) return redirect("/pending");
  if (roles && !roles.includes(user.role)) return errorPage(ctx, 403, "Not available", "Your account type cannot use this page.");
  return user;
}

export { pendingNotice, env };

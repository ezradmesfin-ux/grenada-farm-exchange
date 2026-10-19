import { migrate, sql } from "./db.ts";
import { env } from "./config.ts";
import { clientIp, currentUser } from "./auth.ts";
import { errorPage, textResponse, type Ctx, type Handler } from "./http.ts";
import { runMatching } from "./engine.ts";
import { bootstrapAdmin } from "./bootstrap.ts";
import * as pub from "./routes_public.ts";
import * as app from "./routes_app.ts";
import * as adm from "./routes_admin.ts";

type Route = { method: string; re: RegExp; handler: Handler };
const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  const pattern = path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? `(?<${seg.slice(1).replace(/\..*/, "")}>[^/.]+)${seg.includes(".") ? seg.slice(seg.indexOf(".")).replace(/\./g, "\\.") : ""}` : seg.replace(/\./g, "\\.")))
    .join("/");
  routes.push({ method, re: new RegExp(`^${pattern}$`), handler });
}
const get = (p: string, h: Handler) => route("GET", p, h);
const post = (p: string, h: Handler) => route("POST", p, h);
const withParam = (extra: Record<string, string>, h: Handler): Handler => (ctx) => h({ ...ctx, params: { ...ctx.params, ...extra } });

// public
get("/", pub.home);
get("/pending", pub.pending);
get("/terms", pub.terms);
get("/privacy", pub.privacy);
get("/signup", pub.signupGet);
post("/signup", pub.signupPost);
get("/login", pub.loginGet);
post("/login", pub.loginPost);
post("/logout", pub.logoutPost);
get("/health", async () => {
  await sql`select 1`;
  return textResponse("ok");
});

// signed in
get("/board", app.board);
get("/listings", app.listingsGet);
post("/listings", app.listingsPost);
post("/listings/:id/withdraw", app.listingWithdraw);
get("/needs", app.needsGet);
post("/needs", app.needsPost);
post("/needs/:id/close", app.needClose);
get("/matches", app.matchesGet);
post("/matches/:id/:action", app.matchAction);
get("/account", app.accountGet);
post("/account", app.accountPost);
post("/account/password", app.passwordPost);
get("/account/export", app.accountExport);
post("/account/delete", app.accountDelete);

// admin
get("/admin", adm.adminHome);
post("/admin/run-matching", adm.runMatchingNow);
get("/admin/users", adm.adminUsers);
post("/admin/users/:id/:action", adm.adminUserAction);
get("/admin/listings", adm.adminListings);
get("/admin/needs", adm.adminNeeds);
post("/admin/listings/:id/remove", withParam({ kind: "listings" }, adm.adminRemove));
post("/admin/needs/:id/remove", withParam({ kind: "needs" }, adm.adminRemove));
get("/admin/matches", adm.adminMatches);
post("/admin/matches/:id/:action", adm.adminMatchAction);
get("/admin/notifications", adm.adminNotifications);
get("/admin/audit", adm.adminAudit);
get("/admin/export/:name.csv", adm.adminExport);

// ---------- helpers ----------
const CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

function secure(res: Response): Response {
  const h = res.headers;
  h.set("Content-Security-Policy", CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (env.production) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

/** Rejects form posts that did not come from this site. */
function sameSite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.origin === new URL(env.baseUrl).origin || o.host === req.headers.get("host");
  } catch {
    return false;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i]! ^ y[i]!;
  return d === 0;
}

// ---------- server ----------
await migrate();
await bootstrapAdmin();

const server = Bun.serve({
  port: env.port,
  maxRequestBodySize: 200_000,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;

    try {
      if (req.method === "GET" && path === "/style.css") {
        return secure(new Response(Bun.file(new URL("../public/style.css", import.meta.url)), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" } }));
      }
      if (path === "/favicon.ico") return secure(new Response(null, { status: 204 }));

      // Scheduled matching from an outside timer. Uses a secret, not cookies.
      if (req.method === "POST" && path === "/internal/run-matching") {
        const auth = req.headers.get("authorization") ?? "";
        if (!env.cronSecret || !timingSafeEqual(auth, `Bearer ${env.cronSecret}`)) return secure(textResponse("Forbidden", 403));
        const r = await runMatching();
        return secure(textResponse(JSON.stringify(r), 200, "application/json"));
      }

      const ip = clientIp(req, srv);
      const user = await currentUser(req);
      const ctx: Ctx = { req, url, user, params: {}, ip };

      if (req.method !== "GET" && req.method !== "HEAD" && !sameSite(req)) {
        return secure(await errorPage(ctx, 403, "Request blocked", "That form did not come from this site. Go back, reload the page and try again."));
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(path);
        if (!m) continue;
        return secure(await r.handler({ ...ctx, params: { ...(m.groups ?? {}) } }));
      }
      return secure(await errorPage(ctx, 404, "Page not found", "That page does not exist."));
    } catch (err) {
      console.error(`[error] ${req.method} ${path}`, err);
      try {
        return secure(await errorPage({ req, url, user: null, params: {}, ip: "" }, 500, "Something went wrong", "We could not finish that. Please try again in a moment."));
      } catch {
        return secure(textResponse("Something went wrong.", 500));
      }
    }
  },
});

// Matching also runs on a timer so expired listings and deadlines are picked up.
setInterval(() => { runMatching().catch((e) => console.error("scheduled matching failed", e)); }, 15 * 60_000);
setInterval(() => { sql`delete from sessions where expires_at < now()`.catch(() => {}); }, 6 * 3600_000);

console.log(`Grenada Farm Exchange listening on ${server.url}`);

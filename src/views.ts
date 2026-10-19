import { html, raw, esc, type Raw } from "./util.ts";
import { env, ROLE_LABEL } from "./config.ts";
import type { User } from "./auth.ts";

export type Flash = { type: "ok" | "error" | "warn"; text: string };

type NavItem = { href: string; label: string; badge?: number };

function navFor(user: User | null, matchBadge: number, pendingUsers: number): NavItem[] {
  if (!user) return [{ href: "/", label: "Home" }, { href: "/login", label: "Sign in" }, { href: "/signup", label: "Register" }];
  if (user.status !== "approved") return [{ href: "/pending", label: "Account status" }];
  const items: NavItem[] = [{ href: "/board", label: "Board" }];
  if (user.role === "farmer") {
    items.push({ href: "/listings", label: "My surplus" }, { href: "/needs", label: "Buyer needs" });
  } else if (user.role === "admin") {
    items.push({ href: "/listings", label: "Surplus" }, { href: "/needs", label: "Needs" });
  } else {
    items.push({ href: "/needs", label: "My needs" }, { href: "/listings", label: "Farmer surplus" });
  }
  items.push({ href: "/matches", label: "Matches", badge: matchBadge });
  if (user.role === "admin") items.push({ href: "/admin", label: "Admin", badge: pendingUsers });
  items.push({ href: "/account", label: "Account" });
  return items;
}

export function layout(o: {
  title: string;
  user: User | null;
  path: string;
  body: Raw;
  flash?: Flash | null;
  matchBadge?: number;
  pendingUsers?: number;
  sub?: { href: string; label: string }[];
  description?: string;
}): string {
  const nav = navFor(o.user, o.matchBadge ?? 0, o.pendingUsers ?? 0);
  const current = (href: string) => (href === "/" ? o.path === "/" : o.path === href || o.path.startsWith(href + "/"));
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title === "Grenada Farm Exchange" ? o.title : `${o.title} | Grenada Farm Exchange`}</title>
<meta name="description" content="${o.description ?? "Farmers list surplus produce. Government, hotels and other buyers list what they need. Matches are found automatically."}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="flag"></div>
<div class="wrap">
  <header class="top">
    <div class="bar">
      <a class="brand" href="${o.user?.status === "approved" ? "/board" : "/"}">Grenada Farm Exchange</a>
      ${o.user && html`<div class="who-am-i">${o.user.full_name} · ${ROLE_LABEL[o.user.role]}
        <form class="inline" method="post" action="/logout"><button class="linkbtn" type="submit">Sign out</button></form></div>`}
    </div>
    <nav class="main" aria-label="Main">
      ${nav.map((n) => html`<a href="${n.href}" ${current(n.href) ? raw('aria-current="page"') : ""}>${n.label}${n.badge ? html`<span class="count">${n.badge}</span>` : ""}</a>`)}
    </nav>
    ${o.sub && html`<nav class="sub" aria-label="Section">${o.sub.map((s) => html`<a href="${s.href}" ${o.path === s.href ? raw('aria-current="page"') : ""}>${s.label}</a>`)}</nav>`}
  </header>
  <main id="main">
    ${o.flash && html`<div class="flash ${o.flash.type === "ok" ? "" : o.flash.type}" role="${o.flash.type === "error" ? "alert" : "status"}">${o.flash.text}</div>`}
    ${o.body}
  </main>
  <footer>
    <a href="/terms">Terms of use</a><a href="/privacy">Privacy</a><a href="/">About</a>
    <span>Questions: ${env.contactEmail}</span>
  </footer>
</div>
</body>
</html>`;
  return page.value;
}

export const options = (list: readonly string[], selected?: string | null) =>
  list.map((v) => html`<option value="${v}" ${v === selected ? raw("selected") : ""}>${v}</option>`);

export const pill = (status: string) => html`<span class="pill ${status}">${status}</span>`;

export const empty = (head: string, text: string) => html`<div class="empty"><b>${head}</b> ${text}</div>`;

/** The page shown to people whose account is not yet approved. */
export function pendingNotice(user: User): Raw {
  const text: Record<string, string> = {
    pending: "Your account is waiting for approval. An administrator checks every new account before it can post or see matches. You will get a message when it is approved.",
    rejected: "We could not approve this account. If you think this is a mistake, contact us.",
    suspended: "This account is suspended. Contact us if you need it restored.",
  };
  return html`<h1>Account status</h1>
    <p class="lede">${text[user.status] ?? "This account cannot be used right now."}</p>
    <p class="muted small">Signed in as ${user.email}. Contact: ${env.contactEmail}</p>`;
}

export { esc };

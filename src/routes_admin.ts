import { sql, audit } from "./db.ts";
import { ROLE_LABEL } from "./config.ts";
import { destroyAllSessions, hashPassword } from "./auth.ts";
import { actOnMatch, cancelLiveMatches, notifyAccountDecision, runMatching, type MatchAction } from "./engine.ts";
import { guard, page, redirect, textResponse, errorPage, type Ctx } from "./http.ts";
import { fmtDate, fmtKg, fmtMoney, html, toCsv } from "./util.ts";
import { empty, pill } from "./views.ts";

const SUB = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "People" },
  { href: "/admin/listings", label: "Surplus" },
  { href: "/admin/needs", label: "Needs" },
  { href: "/admin/matches", label: "Matches" },
  { href: "/admin/notifications", label: "Messages sent" },
  { href: "/admin/audit", label: "Activity log" },
];

const adminOnly = (ctx: Ctx) => guard(ctx, ["admin"]);
const dt = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 16).replace("T", " ") : "-");

// ---------- overview ----------
export async function adminHome(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const [c] = await sql`
    select (select count(*)::int from users where status = 'pending') as pending,
           (select count(*)::int from users where status = 'approved') as people,
           (select count(*)::int from listings where status = 'active') as listings,
           (select count(*)::int from needs where status = 'open') as needs,
           (select count(*)::int from matches where status = 'suggested') as suggested,
           (select count(*)::int from matches where status = 'agreed') as agreed,
           (select coalesce(sum(qty_kg), 0) from matches where status = 'completed') as delivered,
           (select count(*)::int from notifications where status = 'failed' and created_at > now() - interval '7 days') as failed`;
  const pending = await sql`select id, email, role, full_name, organisation, buyer_type, parish, phone, verification_note, created_at from users where status = 'pending' order by created_at`;

  return page(ctx, {
    title: "Admin",
    sub: SUB,
    body: html`<h1>Administration</h1>
      <div class="figures">
        <div><b>${c.people}</b><span>Approved people</span></div>
        <div><b>${c.listings}</b><span>Active listings</span></div>
        <div><b>${c.needs}</b><span>Open needs</span></div>
        <div><b>${c.suggested} / ${c.agreed}</b><span>Suggested / agreed</span></div>
        <div><b>${fmtKg(c.delivered)}</b><span>Delivered</span></div>
      </div>
      ${c.failed ? html`<div class="flash warn">${c.failed} message${c.failed === 1 ? "" : "s"} failed to send in the last 7 days. See Messages sent.</div>` : ""}

      <section><h2>Waiting for approval (${pending.length})</h2>
      <p class="lede">Check the proof each person gave before you approve. Approving sends them a message.</p>
      ${pending.length ? html`<div class="scroll"><table>
        <tr><th>Name</th><th>Type</th><th>Organisation</th><th>Parish</th><th>Contact</th><th>How to check</th><th>Applied</th><th></th></tr>
        ${pending.map((u) => html`<tr><td>${u.full_name}</td><td>${ROLE_LABEL[u.role]}${u.buyer_type ? ` · ${u.buyer_type}` : ""}</td><td>${u.organisation ?? "-"}</td><td>${u.parish ?? "-"}</td>
          <td>${u.email}<br>${u.phone ?? ""}</td><td>${u.verification_note}</td><td>${fmtDate(u.created_at)}</td>
          <td><span class="rowform">
            <form class="inline" method="post" action="/admin/users/${u.id}/approve"><button class="btn small" type="submit">Approve</button></form>
            <form class="inline" method="post" action="/admin/users/${u.id}/reject"><button class="btn del" type="submit">Reject</button></form></span></td></tr>`)}
      </table></div>` : empty("Nobody is waiting.", "New registrations appear here.")}</section>

      <section class="block"><h2>Tools</h2>
      <form class="inline" method="post" action="/admin/run-matching"><button class="btn small" type="submit">Run matching now</button></form>
      <p class="lede" style="margin-top:12px">Matching also runs by itself after every post, and every 15 minutes.</p>
      <h3 style="margin-top:18px">Download</h3>
      <p><a href="/admin/export/summary.csv">Trade summary by product</a> (no personal details) · <a href="/admin/export/users.csv">People</a> · <a href="/admin/export/listings.csv">Listings</a> · <a href="/admin/export/needs.csv">Needs</a> · <a href="/admin/export/matches.csv">Matches</a></p></section>`,
  });
}

export async function runMatchingNow(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const r = await runMatching();
  await audit(user.id, "admin.run_matching", r);
  return redirect("/admin", { type: "ok", text: r.skipped ? "Matching is already running. Try again in a moment." : `Matching finished. ${r.created} new match${r.created === 1 ? "" : "es"}.` });
}

// ---------- people ----------
export async function adminUsers(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const status = ctx.url.searchParams.get("status") ?? "";
  const valid = ["pending", "approved", "suspended", "rejected", "deleted"];
  const rows = valid.includes(status)
    ? await sql`select * from users where status = ${status} order by created_at desc limit 500`
    : await sql`select * from users order by created_at desc limit 500`;
  const act = (u: any, action: string, label: string, cls = "btn small") =>
    html`<form class="inline" method="post" action="/admin/users/${u.id}/${action}"><button class="${cls}" type="submit">${label}</button></form>`;
  return page(ctx, {
    title: "People",
    sub: SUB,
    body: html`<h1>People</h1>
      <p class="lede">Show: <a href="/admin/users">all</a> · ${valid.map((s) => html`<a href="/admin/users?status=${s}">${s}</a> `)}</p>
      <div class="scroll"><table>
        <tr><th>Name</th><th>Type</th><th>Organisation</th><th>Parish</th><th>Email</th><th>Phone</th><th>Notify</th><th>Status</th><th>Joined</th><th></th></tr>
        ${rows.map((u) => html`<tr><td>${u.full_name}</td><td>${ROLE_LABEL[u.role]}</td><td>${u.organisation ?? "-"}</td><td>${u.parish ?? "-"}</td><td>${u.email}</td><td>${u.phone ?? "-"}</td><td>${u.notify_channel}</td><td>${pill(u.status)}</td><td>${fmtDate(u.created_at)}</td>
          <td>${u.role === "admin" || u.status === "deleted" ? "" : html`<span class="rowform">
            ${u.status === "pending" ? html`${act(u, "approve", "Approve")}${act(u, "reject", "Reject", "btn del")}` : ""}
            ${u.status === "approved" ? act(u, "suspend", "Suspend", "btn del") : ""}
            ${u.status === "suspended" || u.status === "rejected" ? act(u, "reactivate", "Approve") : ""}
            ${act(u, "reset-password", "Reset password")}</span>`}</td></tr>`)}
      </table></div>`,
  });
}

export async function adminUserAction(ctx: Ctx) {
  const admin = await adminOnly(ctx);
  if (admin instanceof Response) return admin;
  const id = Number(ctx.params.id);
  const action = ctx.params.action!;
  const [u] = await sql`select id, email, phone, notify_channel, role, status, full_name from users where id = ${id}`;
  if (!u || u.status === "deleted") return redirect("/admin/users", { type: "error", text: "That person was not found." });
  if (u.role === "admin" || u.id === admin.id) return redirect("/admin/users", { type: "error", text: "Administrator accounts cannot be changed here." });
  const back = ctx.req.headers.get("referer")?.includes("/admin/users") ? "/admin/users" : "/admin";

  if (action === "approve" || action === "reactivate") {
    await sql`update users set status = 'approved', approved_at = now(), approved_by = ${admin.id} where id = ${id}`;
    await audit(admin.id, "user.approve", { id });
    void notifyAccountDecision(u, true);
    void runMatching().catch(console.error);
    return redirect(back, { type: "ok", text: `${u.full_name} is approved.` });
  }
  if (action === "reject") {
    await sql`update users set status = 'rejected' where id = ${id}`;
    await destroyAllSessions(id);
    await audit(admin.id, "user.reject", { id });
    void notifyAccountDecision(u, false);
    return redirect(back, { type: "ok", text: `${u.full_name} is rejected.` });
  }
  if (action === "suspend") {
    await sql`update users set status = 'suspended' where id = ${id}`;
    await destroyAllSessions(id);
    await audit(admin.id, "user.suspend", { id });
    await cancelLiveMatches({ userId: id }, admin.id);
    return redirect(back, { type: "ok", text: `${u.full_name} is suspended and their open matches are cancelled.` });
  }
  if (action === "reset-password") {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const temp = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("");
    await sql`update users set password_hash = ${await hashPassword(temp)} where id = ${id}`;
    await destroyAllSessions(id);
    await audit(admin.id, "user.reset_password", { id });
    return redirect(back, { type: "warn", text: `Temporary password for ${u.email}: ${temp}. Give it to them directly. They should change it on the Account page.` });
  }
  return errorPage(ctx, 404, "Not found", "That action does not exist.");
}

// ---------- listings and needs ----------
export async function adminListings(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`select l.*, u.full_name, u.organisation, u.email from listings l join users u on u.id = l.farmer_id order by l.created_at desc limit 500`;
  return page(ctx, {
    title: "Surplus listings", sub: SUB,
    body: html`<h1>Surplus listings</h1>
      ${rows.length ? html`<div class="scroll"><table><tr><th>Product</th><th>kg</th><th>Price</th><th>Parish</th><th>Farmer</th><th>Until</th><th>Status</th><th>Posted</th><th></th></tr>
        ${rows.map((l) => html`<tr><td>${l.product}</td><td class="n">${fmtKg(l.qty_kg)}</td><td class="n">${fmtMoney(l.price_ec)}</td><td>${l.parish ?? "-"}</td><td>${l.full_name}${l.organisation ? ` · ${l.organisation}` : ""}</td><td>${fmtDate(l.available_until)}</td><td>${pill(l.status)}</td><td>${fmtDate(l.created_at)}</td>
          <td>${l.status === "active" ? html`<form class="inline" method="post" action="/admin/listings/${l.id}/remove"><button class="btn del" type="submit">Remove</button></form>` : ""}</td></tr>`)}</table></div>` : empty("No listings.", "")}`,
  });
}

export async function adminNeeds(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`select n.*, u.full_name, u.organisation, u.role from needs n join users u on u.id = n.buyer_id order by n.created_at desc limit 500`;
  return page(ctx, {
    title: "Needs", sub: SUB,
    body: html`<h1>Needs</h1>
      ${rows.length ? html`<div class="scroll"><table><tr><th>Product</th><th>kg</th><th>Max price</th><th>Needed by</th><th>Buyer</th><th>Note</th><th>Status</th><th></th></tr>
        ${rows.map((n) => html`<tr><td>${n.product}</td><td class="n">${fmtKg(n.qty_kg)}</td><td class="n">${fmtMoney(n.max_price_ec)}</td><td>${fmtDate(n.needed_by)}</td><td>${ROLE_LABEL[n.role]} · ${n.organisation ?? n.full_name}</td><td>${n.note ?? ""}</td><td>${pill(n.status)}</td>
          <td>${n.status === "open" ? html`<form class="inline" method="post" action="/admin/needs/${n.id}/remove"><button class="btn del" type="submit">Remove</button></form>` : ""}</td></tr>`)}</table></div>` : empty("No needs.", "")}`,
  });
}

export async function adminRemove(ctx: Ctx) {
  const admin = await adminOnly(ctx);
  if (admin instanceof Response) return admin;
  const id = Number(ctx.params.id);
  const kind = ctx.params.kind; // "listings" or "needs"
  if (kind === "listings") {
    const rows = await sql`update listings set status = 'removed' where id = ${id} and status = 'active' returning id`;
    if (rows.length) { await audit(admin.id, "listing.remove", { id }); await cancelLiveMatches({ listingId: id }, admin.id); }
    return redirect("/admin/listings", { type: "ok", text: "Listing removed." });
  }
  const rows = await sql`update needs set status = 'removed' where id = ${id} and status = 'open' returning id`;
  if (rows.length) { await audit(admin.id, "need.remove", { id }); await cancelLiveMatches({ needId: id }, admin.id); }
  return redirect("/admin/needs", { type: "ok", text: "Need removed." });
}

// ---------- matches ----------
export async function adminMatches(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`
    select m.id, m.status, m.qty_kg, m.farmer_ok, m.buyer_ok, m.created_at, n.product,
           f.full_name as f_name, f.organisation as f_org, b.full_name as b_name, b.organisation as b_org
    from matches m join needs n on n.id = m.need_id join listings l on l.id = m.listing_id
    join users f on f.id = l.farmer_id join users b on b.id = n.buyer_id
    order by m.created_at desc limit 500`;
  const act = (m: any, a: string, label: string, cls: string) => html`<form class="inline" method="post" action="/admin/matches/${m.id}/${a}"><button class="${cls}" type="submit">${label}</button></form>`;
  return page(ctx, {
    title: "All matches", sub: SUB,
    body: html`<h1>All matches</h1>
      ${rows.length ? html`<div class="scroll"><table><tr><th>Product</th><th>kg</th><th>Farmer</th><th>Buyer</th><th>Confirmed by</th><th>Status</th><th>Created</th><th></th></tr>
        ${rows.map((m) => html`<tr><td>${m.product}</td><td class="n">${fmtKg(m.qty_kg)}</td><td>${m.f_org ?? m.f_name}</td><td>${m.b_org ?? m.b_name}</td><td>${[m.farmer_ok ? "farmer" : "", m.buyer_ok ? "buyer" : ""].filter(Boolean).join(", ") || "-"}</td><td>${pill(m.status)}</td><td>${fmtDate(m.created_at)}</td>
          <td><span class="rowform">${m.status === "agreed" ? act(m, "complete", "Mark delivered", "btn small") : ""}${m.status === "suggested" || m.status === "agreed" ? act(m, "cancel", "Cancel", "btn del") : ""}</span></td></tr>`)}</table></div>` : empty("No matches yet.", "")}`,
  });
}

export async function adminMatchAction(ctx: Ctx) {
  const admin = await adminOnly(ctx);
  if (admin instanceof Response) return admin;
  const action = ctx.params.action as MatchAction;
  if (action !== "complete" && action !== "cancel") return errorPage(ctx, 404, "Not found", "That action does not exist.");
  const r = await actOnMatch(admin, Number(ctx.params.id), action);
  return redirect("/admin/matches", { type: r.ok ? "ok" : "error", text: r.message });
}

// ---------- logs ----------
export async function adminNotifications(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`select n.*, u.email from notifications n join users u on u.id = n.user_id order by n.id desc limit 200`;
  return page(ctx, {
    title: "Messages sent", sub: SUB,
    body: html`<h1>Messages sent</h1>
      <p class="lede">"logged" means no sending service is set up yet, so the message was only recorded. See the README to connect Twilio and email.</p>
      ${rows.length ? html`<div class="scroll"><table><tr><th>When</th><th>To</th><th>Via</th><th>Status</th><th>Message</th><th>Problem</th></tr>
        ${rows.map((n) => html`<tr><td>${dt(n.created_at)}</td><td>${n.email}</td><td>${n.channel}</td><td>${pill(n.status === "sent" ? "approved" : n.status === "failed" ? "cancelled" : "pending")} ${n.status}</td><td>${n.body}</td><td>${n.error ?? ""}</td></tr>`)}</table></div>` : empty("Nothing sent yet.", "")}`,
  });
}

export async function adminAudit(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`select a.*, u.email from audit_log a left join users u on u.id = a.actor_id order by a.id desc limit 300`;
  return page(ctx, {
    title: "Activity log", sub: SUB,
    body: html`<h1>Activity log</h1>
      ${rows.length ? html`<div class="scroll"><table><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr>
        ${rows.map((a) => html`<tr><td>${dt(a.created_at)}</td><td>${a.email ?? "system"}</td><td>${a.action}</td><td>${typeof a.detail === "string" ? a.detail : JSON.stringify(a.detail)}</td></tr>`)}</table></div>` : empty("No activity yet.", "")}`,
  });
}

// ---------- CSV export ----------
export async function adminExport(ctx: Ctx) {
  const user = await adminOnly(ctx);
  if (user instanceof Response) return user;
  const name = ctx.params.name;
  let rows: Record<string, unknown>[];
  let cols: string[];
  if (name === "users") {
    rows = await sql`select id, email, role, status, full_name, organisation, buyer_type, parish, phone, notify_channel, verification_note, consent_terms_version, consent_at, created_at, approved_at from users order by id`;
    cols = ["id", "email", "role", "status", "full_name", "organisation", "buyer_type", "parish", "phone", "notify_channel", "verification_note", "consent_terms_version", "consent_at", "created_at", "approved_at"];
  } else if (name === "listings") {
    rows = await sql`select l.id, l.farmer_id, l.product, l.qty_kg, l.price_ec, l.parish, l.available_until, l.notes, l.status, l.created_at from listings l order by l.id`;
    cols = ["id", "farmer_id", "product", "qty_kg", "price_ec", "parish", "available_until", "notes", "status", "created_at"];
  } else if (name === "needs") {
    rows = await sql`select n.id, n.buyer_id, n.product, n.qty_kg, n.max_price_ec, n.needed_by, n.note, n.status, n.created_at from needs n order by n.id`;
    cols = ["id", "buyer_id", "product", "qty_kg", "max_price_ec", "needed_by", "note", "status", "created_at"];
  } else if (name === "matches") {
    rows = await sql`select m.id, m.need_id, m.listing_id, n.product, m.qty_kg, m.status, m.farmer_ok, m.buyer_ok, m.created_at, m.updated_at from matches m join needs n on n.id = m.need_id order by m.id`;
    cols = ["id", "need_id", "listing_id", "product", "qty_kg", "status", "farmer_ok", "buyer_ok", "created_at", "updated_at"];
  } else if (name === "summary") {
    rows = await sql`
      with p as (select product from listings union select product from needs)
      select p.product,
        coalesce((select sum(qty_kg) from listings l where l.product = p.product and l.status <> 'removed'), 0) as surplus_posted_kg,
        coalesce((select sum(qty_kg) from needs n where n.product = p.product and n.status <> 'removed'), 0) as need_posted_kg,
        coalesce((select sum(m.qty_kg) from matches m join needs n on n.id = m.need_id where n.product = p.product and m.status in ('suggested','agreed')), 0) as matched_pending_kg,
        coalesce((select sum(m.qty_kg) from matches m join needs n on n.id = m.need_id where n.product = p.product and m.status = 'completed'), 0) as delivered_kg
      from p order by p.product`;
    cols = ["product", "surplus_posted_kg", "need_posted_kg", "matched_pending_kg", "delivered_kg"];
  } else {
    return errorPage(ctx, 404, "Not found", "That download does not exist.");
  }
  await audit(user.id, "admin.export", { name });
  return textResponse(toCsv(rows, cols), 200, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" });
}

import { sql, audit } from "./db.ts";
import { BUYER_ROLES, CHANNELS, MARKETS, PARISHES, PRODUCTS } from "./config.ts";
import { destroyAllSessions, destroySession, hashPassword, passwordProblem, verifyPassword, type User } from "./auth.ts";
import { actOnMatch, cancelLiveMatches, runMatching, type MatchAction } from "./engine.ts";
import { errorPage, guard, page, redirect, textResponse, type Ctx } from "./http.ts";
import {
  clean, fmtDate, fmtKg, fmtMoney, html, normalisePhone, parseDate, parseOptionalMoney, parsePositive, raw, todayIso, type Raw,
} from "./util.ts";
import { empty, options, pill } from "./views.ts";

type Row = Record<string, any>;

const isBuyerRole = (u: User) => (BUYER_ROLES as readonly string[]).includes(u.role);

/** What other signed-in people may see about a poster: no phone, no email. */
const buyerLabel = (r: Row) =>
  r.b_role === "government" ? `Government${r.b_org ? ` · ${r.b_org}` : ""}`
  : r.b_role === "hotel" ? `Hotel · ${r.b_org ?? ""}`
  : `${r.b_type ?? "Buyer"} · ${r.b_org ?? ""}`;
const farmerLabel = (org: string | null, parish: string | null) => (org ? org : "Farmer") + (parish ? `, ${parish}` : "");

// ---------- board ----------
export async function board(ctx: Ctx) {
  const user = await guard(ctx);
  if (user instanceof Response) return user;
  const today = todayIso();

  const needs = await sql`
    select n.id, n.product, n.qty_kg, n.max_price_ec, n.needed_by, n.note,
           u.role as b_role, u.organisation as b_org, u.buyer_type as b_type,
           coalesce((select sum(m.qty_kg) from matches m where m.need_id = n.id and m.status in ('suggested','agreed','completed')), 0) as matched
    from needs n join users u on u.id = n.buyer_id
    where n.status = 'open' and u.status = 'approved'
    order by n.needed_by nulls last, n.created_at`;

  const listings = await sql`
    select l.id, l.product, l.qty_kg, l.price_ec, l.parish, l.available_until, u.organisation as org,
           l.qty_kg - coalesce((select sum(m.qty_kg) from matches m where m.listing_id = l.id and m.status in ('suggested','agreed','completed')), 0) as remaining
    from listings l join users u on u.id = l.farmer_id
    where l.status = 'active' and u.status = 'approved' and (l.available_until is null or l.available_until >= ${today})
    order by l.product, l.price_ec nulls last`;

  const live = needs.filter((n) => !(n.needed_by && fmtDate(n.needed_by) < today));
  const filled = live.reduce((a, n) => a + Math.min(Number(n.matched), Number(n.qty_kg)), 0);
  const gap = live.reduce((a, n) => a + Math.max(0, Number(n.qty_kg) - Number(n.matched)), 0);
  const unsold = listings.filter((l) => Number(l.remaining) > 0);
  const surplus = unsold.reduce((a, l) => a + Number(l.remaining), 0);

  const needRow = (n: Row) => {
    const qty = Number(n.qty_kg), matched = Math.min(Number(n.matched), qty), short = Math.max(0, qty - matched);
    const overdue = !!n.needed_by && fmtDate(n.needed_by) < today;
    const pct = Math.round((matched / qty) * 100);
    const meta = [n.needed_by ? `needed by ${fmtDate(n.needed_by)}` : "", n.max_price_ec != null ? `max ${fmtMoney(n.max_price_ec)}/kg` : "", n.note ?? ""].filter(Boolean).join(" · ");
    const request = `Sourcing request: ${buyerLabel(n)} seeks ${fmtKg(short)} of ${n.product}${n.needed_by ? " by " + fmtDate(n.needed_by) : ""}${n.max_price_ec != null ? `, max EC$${Number(n.max_price_ec).toFixed(2)}/kg` : ""}. Please reply with price, quantity and delivery time.`;
    return html`<div class="need">
      <div><div class="who">${buyerLabel(n)}</div><h3>${n.product}, ${fmtKg(qty)} <small>${meta}</small></h3></div>
      <span class="state ${overdue ? "warn" : short > 0 ? "short" : "met"}">${overdue ? "Past deadline" : short > 0 ? `${fmtKg(short)} short` : "Fully matched"}</span>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <div class="detail"><div><strong>${fmtKg(matched)}</strong> matched with local farmers</div></div>
      ${short > 0 && !overdue ? html`<details class="regional"><summary>Look to other markets: ${MARKETS.join(", ")}</summary>
        <label for="rfq-${n.id}" style="margin-top:8px">Sourcing request to copy</label><textarea id="rfq-${n.id}" readonly rows="3">${request}</textarea></details>` : ""}
    </div>`;
  };

  return page(ctx, {
    title: "Board",
    body: html`
      <h1>Supply and demand</h1>
      <p class="lede">Every open need and every unsold listing in Grenada, with who is matched and what is still short.</p>
      <div class="figures">
        <div><b>${live.length}</b><span>Open needs</span></div>
        <div><b>${fmtKg(filled)}</b><span>Matched locally</span></div>
        <div><b>${fmtKg(gap)}</b><span>Short, to import</span></div>
        <div><b>${fmtKg(surplus)}</b><span>Unsold, to export</span></div>
      </div>
      <section class="block" style="margin-top:0">
        <h2>Needs and how they are filled</h2>
        <p class="lede">The earliest deadline is served first. Each need takes the cheapest surplus within its price limit.</p>
        ${needs.length ? html`<div>${needs.map(needRow)}</div>` : empty("No open needs yet.", "Government, hotels and other buyers add theirs on the Needs page. Each one appears here with how much of it is filled.")}
      </section>
      <section class="block">
        <h2>Surplus with no buyer yet</h2>
        <p class="lede">These listings are candidates for export to CARICOM and OECS markets.</p>
        ${unsold.length ? html`<div class="scroll"><table><tr><th>Product</th><th>Unsold</th><th>Price</th><th>Farmer</th><th>Available until</th></tr>
          ${unsold.map((l) => html`<tr><td>${l.product}</td><td class="n">${fmtKg(l.remaining)}</td><td class="n">${fmtMoney(l.price_ec)}</td><td>${farmerLabel(l.org, l.parish)}</td><td>${fmtDate(l.available_until)}</td></tr>`)}</table></div>`
          : empty("Nothing unsold.", "Surplus that no local need can take is listed here.")}
      </section>`,
  });
}

// ---------- listings (farmers post, everyone browses) ----------
export async function listingsGet(ctx: Ctx) {
  const user = await guard(ctx);
  if (user instanceof Response) return user;
  const isFarmer = user.role === "farmer";
  const today = todayIso();

  const rows = isFarmer
    ? await sql`
        select l.*, l.qty_kg - coalesce((select sum(m.qty_kg) from matches m where m.listing_id = l.id and m.status in ('suggested','agreed','completed')), 0) as remaining
        from listings l where l.farmer_id = ${user.id} and l.status <> 'removed' order by l.created_at desc`
    : await sql`
        select l.id, l.product, l.qty_kg, l.price_ec, l.parish, l.available_until, u.organisation as org, l.status,
               l.qty_kg - coalesce((select sum(m.qty_kg) from matches m where m.listing_id = l.id and m.status in ('suggested','agreed','completed')), 0) as remaining
        from listings l join users u on u.id = l.farmer_id
        where l.status = 'active' and u.status = 'approved' and (l.available_until is null or l.available_until >= ${today})
        order by l.product, l.price_ec nulls last`;

  const form = isFarmer ? html`
    <section><h2>Post surplus produce</h2>
    <p class="lede">List what you can sell now. Buyers see the product, kilograms, price and parish. Your phone number is shared only when a match is suggested.</p>
    <form class="formbox wide" method="post" action="/listings">
      <div class="fields">
        <div><label for="product">Product</label><select id="product" name="product" required>${options(PRODUCTS)}</select></div>
        <div><label for="qty_kg">Quantity (kg)</label><input id="qty_kg" name="qty_kg" type="number" min="1" step="0.01" required></div>
        <div><label for="price_ec">Asking price (EC$ per kg)</label><input id="price_ec" name="price_ec" type="number" min="0" step="0.01"></div>
        <div><label for="parish">Parish</label><select id="parish" name="parish">${options(PARISHES, user.parish)}</select></div>
        <div><label for="available_until">Available until</label><input id="available_until" name="available_until" type="date" min="${today}"></div>
        <div><label for="notes">Notes</label><input id="notes" name="notes" maxlength="300" placeholder="Grade, packing, pick-up"></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Post surplus</button></div>
    </form></section>` : "";

  const table = rows.length
    ? html`<div class="scroll"><table>
        <tr><th>Product</th><th>Total</th><th>Unmatched</th><th>Price</th><th>Parish</th>${isFarmer ? html`<th>Until</th><th>Status</th><th></th>` : html`<th>Farmer</th><th>Until</th>`}</tr>
        ${rows.map((l) => html`<tr><td>${l.product}</td><td class="n">${fmtKg(l.qty_kg)}</td><td class="n">${fmtKg(Math.max(0, Number(l.remaining)))}</td><td class="n">${fmtMoney(l.price_ec)}</td><td>${l.parish ?? "-"}</td>
          ${isFarmer
            ? html`<td>${fmtDate(l.available_until)}</td><td>${pill(l.status)}</td><td>${l.status === "active" ? html`<form class="inline" method="post" action="/listings/${l.id}/withdraw"><button class="btn del" type="submit">Withdraw</button></form>` : ""}</td>`
            : html`<td>${l.org ?? "Farmer"}</td><td>${fmtDate(l.available_until)}</td>`}</tr>`)}
      </table></div>`
    : isFarmer ? empty("No listings yet.", "Use the form above. Your surplus appears here and on the Board, and buyers with matching needs are told.")
               : empty("No surplus listed right now.", "Farmers' listings appear here once they post them.");

  return page(ctx, {
    title: isFarmer ? "My surplus" : "Surplus",
    body: html`<h1>${isFarmer ? "My surplus" : "Farmer surplus"}</h1>${form}<section class="block" style="${isFarmer ? "" : "margin-top:0"}"><h2>${isFarmer ? "My listings" : "Available now"}</h2>${table}</section>`,
  });
}

export async function listingsPost(ctx: Ctx) {
  const user = await guard(ctx, ["farmer"]);
  if (user instanceof Response) return user;
  const f = await ctx.req.formData();
  const product = clean(f.get("product"));
  const qty = parsePositive(clean(f.get("qty_kg")));
  const price = parseOptionalMoney(clean(f.get("price_ec")));
  const parish = clean(f.get("parish"));
  const until = parseDate(clean(f.get("available_until")));
  const notes = clean(f.get("notes"), 300);

  const bad = (text: string) => redirect("/listings", { type: "error", text });
  if (!(PRODUCTS as readonly string[]).includes(product)) return bad("Choose a product from the list.");
  if (qty == null) return bad("Enter a quantity in kilograms.");
  if (price === "bad") return bad("Enter the price as a number, or leave it empty.");
  if (parish && !(PARISHES as readonly string[]).includes(parish)) return bad("Choose a parish from the list.");
  if (until === "bad") return bad("Enter the date as year-month-day.");
  if (until && until < todayIso()) return bad("The available-until date has already passed.");

  const [row] = await sql`insert into listings (farmer_id, product, qty_kg, price_ec, parish, available_until, notes)
    values (${user.id}, ${product}, ${qty}, ${price}, ${parish || null}, ${until}, ${notes || null}) returning id`;
  await audit(user.id, "listing.create", { id: row.id, product, qty });
  const res = await runMatching();
  return redirect("/listings", { type: "ok", text: res.created ? `Posted. ${res.created} new match${res.created === 1 ? "" : "es"} found. See the Matches page.` : "Posted." });
}

export async function listingWithdraw(ctx: Ctx) {
  const user = await guard(ctx, ["farmer"]);
  if (user instanceof Response) return user;
  const id = Number(ctx.params.id);
  const rows = await sql`update listings set status = 'withdrawn' where id = ${id} and farmer_id = ${user.id} and status = 'active' returning id`;
  if (!rows.length) return redirect("/listings", { type: "error", text: "That listing was not found." });
  await audit(user.id, "listing.withdraw", { id });
  await cancelLiveMatches({ listingId: id }, user.id);
  return redirect("/listings", { type: "ok", text: "Listing withdrawn." });
}

// ---------- needs (buyers post, everyone browses) ----------
export async function needsGet(ctx: Ctx) {
  const user = await guard(ctx);
  if (user instanceof Response) return user;
  const mine = isBuyerRole(user);
  const today = todayIso();

  const rows = mine
    ? await sql`
        select n.*, coalesce((select sum(m.qty_kg) from matches m where m.need_id = n.id and m.status in ('suggested','agreed','completed')), 0) as matched
        from needs n where n.buyer_id = ${user.id} and n.status <> 'removed' order by n.created_at desc`
    : await sql`
        select n.id, n.product, n.qty_kg, n.max_price_ec, n.needed_by, n.note, n.status, u.role as b_role, u.organisation as b_org, u.buyer_type as b_type,
               coalesce((select sum(m.qty_kg) from matches m where m.need_id = n.id and m.status in ('suggested','agreed','completed')), 0) as matched
        from needs n join users u on u.id = n.buyer_id
        where n.status = 'open' and u.status = 'approved' order by n.needed_by nulls last, n.created_at`;

  const form = mine ? html`
    <section><h2>Post a need</h2>
    <p class="lede">${user.role === "government" ? "Only approved government accounts can post national needs." : "Say what you want to buy locally. Farmers with matching produce are told, and you see their contact details once a match is suggested."}</p>
    <form class="formbox wide" method="post" action="/needs">
      <div class="fields">
        <div><label for="product">Product</label><select id="product" name="product" required>${options(PRODUCTS)}</select></div>
        <div><label for="qty_kg">Quantity needed (kg)</label><input id="qty_kg" name="qty_kg" type="number" min="1" step="0.01" required></div>
        <div><label for="needed_by">Needed by</label><input id="needed_by" name="needed_by" type="date" min="${today}"></div>
        <div><label for="max_price_ec">Max price (EC$ per kg)</label><input id="max_price_ec" name="max_price_ec" type="number" min="0" step="0.01"></div>
        <div class="full"><label for="note">Purpose, grade or delivery</label><input id="note" name="note" maxlength="300" placeholder="School feeding, ripe, delivered Tuesdays"></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Post need</button></div>
    </form></section>` : "";

  const table = rows.length
    ? html`<div class="scroll"><table>
        <tr>${mine ? "" : html`<th>Buyer</th>`}<th>Product</th><th>Quantity</th><th>Matched</th><th>Needed by</th><th>Max price</th><th>Note</th>${mine ? html`<th>Status</th><th></th>` : ""}</tr>
        ${rows.map((n) => html`<tr>${mine ? "" : html`<td>${buyerLabel(n)}</td>`}<td>${n.product}</td><td class="n">${fmtKg(n.qty_kg)}</td><td class="n">${fmtKg(n.matched)}</td><td>${fmtDate(n.needed_by)}</td><td class="n">${fmtMoney(n.max_price_ec)}</td><td>${n.note ?? ""}</td>
          ${mine ? html`<td>${pill(n.status)}</td><td>${n.status === "open" ? html`<form class="inline" method="post" action="/needs/${n.id}/close"><button class="btn del" type="submit">Close</button></form>` : ""}</td>` : ""}</tr>`)}
      </table></div>`
    : mine ? empty("No needs yet.", "Use the form above. Your need appears here and on the Board, and farmers with matching produce are told.")
           : empty("No open needs right now.", "Needs from government, hotels and other buyers appear here.");

  return page(ctx, {
    title: mine ? "My needs" : "Needs",
    body: html`<h1>${mine ? "My needs" : "Buyer needs"}</h1>${form}<section class="block" style="${mine ? "" : "margin-top:0"}"><h2>${mine ? "My posted needs" : "Open needs"}</h2>${table}</section>`,
  });
}

export async function needsPost(ctx: Ctx) {
  const user = await guard(ctx, [...BUYER_ROLES]);
  if (user instanceof Response) return user;
  const f = await ctx.req.formData();
  const product = clean(f.get("product"));
  const qty = parsePositive(clean(f.get("qty_kg")));
  const maxPrice = parseOptionalMoney(clean(f.get("max_price_ec")));
  const by = parseDate(clean(f.get("needed_by")));
  const note = clean(f.get("note"), 300);

  const bad = (text: string) => redirect("/needs", { type: "error", text });
  if (!(PRODUCTS as readonly string[]).includes(product)) return bad("Choose a product from the list.");
  if (qty == null) return bad("Enter a quantity in kilograms.");
  if (maxPrice === "bad") return bad("Enter the price as a number, or leave it empty.");
  if (by === "bad") return bad("Enter the date as year-month-day.");
  if (by && by < todayIso()) return bad("The needed-by date has already passed.");

  const [row] = await sql`insert into needs (buyer_id, product, qty_kg, max_price_ec, needed_by, note)
    values (${user.id}, ${product}, ${qty}, ${maxPrice}, ${by}, ${note || null}) returning id`;
  await audit(user.id, "need.create", { id: row.id, product, qty });
  const res = await runMatching();
  return redirect("/needs", { type: "ok", text: res.created ? `Posted. ${res.created} new match${res.created === 1 ? "" : "es"} found. See the Matches page.` : "Posted." });
}

export async function needClose(ctx: Ctx) {
  const user = await guard(ctx, [...BUYER_ROLES]);
  if (user instanceof Response) return user;
  const id = Number(ctx.params.id);
  const rows = await sql`update needs set status = 'closed' where id = ${id} and buyer_id = ${user.id} and status = 'open' returning id`;
  if (!rows.length) return redirect("/needs", { type: "error", text: "That need was not found." });
  await audit(user.id, "need.close", { id });
  await cancelLiveMatches({ needId: id }, user.id);
  return redirect("/needs", { type: "ok", text: "Need closed." });
}

// ---------- matches ----------
export async function matchesGet(ctx: Ctx) {
  const user = await guard(ctx);
  if (user instanceof Response) return user;
  const rows = await sql`
    select m.id, m.status, m.qty_kg, m.farmer_ok, m.buyer_ok, m.created_at,
           n.product, n.max_price_ec, n.needed_by, n.note, l.price_ec, l.parish as l_parish, l.available_until,
           f.id as f_id, f.full_name as f_name, f.organisation as f_org, f.phone as f_phone, f.email as f_email,
           b.id as b_id, b.full_name as b_name, b.organisation as b_org, b.role as b_role, b.buyer_type as b_type, b.phone as b_phone, b.email as b_email
    from matches m
    join needs n on n.id = m.need_id
    join listings l on l.id = m.listing_id
    join users f on f.id = l.farmer_id
    join users b on b.id = n.buyer_id
    where f.id = ${user.id} or b.id = ${user.id}
    order by case m.status when 'suggested' then 0 when 'agreed' then 1 when 'completed' then 2 else 3 end, m.created_at desc`;

  const card = (m: Row) => {
    const iAmFarmer = m.f_id === user.id;
    const myOk = iAmFarmer ? m.farmer_ok : m.buyer_ok;
    const theirOk = iAmFarmer ? m.buyer_ok : m.farmer_ok;
    const other = iAmFarmer
      ? { who: buyerLabel(m), name: m.b_name, org: m.b_org, phone: m.b_phone, email: m.b_email }
      : { who: farmerLabel(m.f_org, m.l_parish), name: m.f_name, org: m.f_org, phone: m.f_phone, email: m.f_email };
    const price = iAmFarmer ? (m.max_price_ec != null ? `buyer's limit ${fmtMoney(m.max_price_ec)}/kg` : "no price limit") : (m.price_ec != null ? `asking ${fmtMoney(m.price_ec)}/kg` : "price to agree");
    const act = (action: MatchAction, label: string, cls = "btn small") => html`<form class="inline" method="post" action="/matches/${m.id}/${action}"><button class="${cls}" type="submit">${label}</button></form>`;
    return html`<div class="need">
      <div><div class="who">${iAmFarmer ? "Buyer" : "Farmer"} · ${other.who}</div><h3>${m.product}, ${fmtKg(m.qty_kg)} <small>${price}${m.needed_by ? ` · needed by ${fmtDate(m.needed_by)}` : ""}${m.note ? ` · ${m.note}` : ""}</small></h3></div>
      <span>${pill(m.status)}</span>
      ${m.status !== "cancelled" ? html`<div class="contact"><b>${other.name}</b>${other.org ? ` · ${other.org}` : ""}<br>Phone: ${other.phone ?? "not given"} · Email: ${other.email}</div>` : ""}
      <div class="actions" style="grid-column:1/-1;margin-top:0">
        ${m.status === "suggested" && !myOk ? act("confirm", "Confirm this match", "btn") : ""}
        ${m.status === "suggested" && myOk ? html`<span class="muted small">You confirmed. Waiting for the ${iAmFarmer ? "buyer" : "farmer"}${theirOk ? "" : "."}</span>` : ""}
        ${m.status === "agreed" ? html`<span class="muted small">Both confirmed. Arrange delivery and payment directly.</span>${act("complete", "Mark as delivered", "btn")}` : ""}
        ${m.status === "suggested" || m.status === "agreed" ? act("cancel", "Cancel", "btn del") : ""}
      </div>
    </div>`;
  };

  return page(ctx, {
    title: "Matches",
    body: html`<h1>Matches</h1>
      <p class="lede">A match pairs a farmer's produce with a buyer's need. Confirm if you want to go ahead. When both sides confirm, arrange delivery and payment directly with each other.</p>
      ${rows.length ? html`<div>${rows.map(card)}</div>` : empty("No matches yet.", user.role === "farmer" ? "When a buyer's need fits one of your listings it appears here and we send you a message." : "When a farmer's surplus fits one of your needs it appears here and we send you a message.")}`,
  });
}

export async function matchAction(ctx: Ctx) {
  const user = await guard(ctx);
  if (user instanceof Response) return user;
  const action = ctx.params.action as MatchAction;
  if (!["confirm", "complete", "cancel"].includes(action)) return errorPage(ctx, 404, "Not found", "That page does not exist.");
  const r = await actOnMatch(user, Number(ctx.params.id), action);
  return redirect("/matches", { type: r.ok ? "ok" : "error", text: r.message });
}

// ---------- account ----------
export async function accountGet(ctx: Ctx) {
  const user = await guard(ctx, undefined, { allowUnapproved: true });
  if (user instanceof Response) return user;
  return page(ctx, {
    title: "Account",
    body: html`<h1>Account</h1>
      <p class="lede">Signed in as ${user.email}. Status: ${pill(user.status)}</p>

      <section><h2>Contact details</h2>
      <form class="formbox wide" method="post" action="/account">
        <div class="fields">
          <div><label for="full_name">Your name</label><input id="full_name" name="full_name" value="${user.full_name}" required maxlength="120"></div>
          <div><label for="organisation">Organisation</label><input id="organisation" name="organisation" value="${user.organisation}" maxlength="120"></div>
          <div><label for="parish">Parish</label><select id="parish" name="parish"><option value="">Choose</option>${options(PARISHES, user.parish)}</select></div>
          <div><label for="phone">Phone or WhatsApp number</label><input id="phone" name="phone" value="${user.phone}" inputmode="tel" maxlength="30"></div>
          <div><label for="notify_channel">Tell me about matches by</label>
            <select id="notify_channel" name="notify_channel">${CHANNELS.map((c) => html`<option value="${c}" ${user.notify_channel === c ? raw("selected") : ""}>${{ sms: "Text message", whatsapp: "WhatsApp", email: "Email", none: "Nothing, I will check the site" }[c]}</option>`)}</select></div>
        </div>
        <div class="actions"><button class="btn" type="submit">Save</button></div>
      </form></section>

      <section class="block"><h2>Change password</h2>
      <form class="formbox" method="post" action="/account/password">
        <div class="fields">
          <div class="full"><label for="current">Current password</label><input id="current" name="current" type="password" autocomplete="current-password" required></div>
          <div class="full"><label for="next">New password</label><input id="next" name="next" type="password" autocomplete="new-password" required minlength="8"></div>
        </div>
        <div class="actions"><button class="btn" type="submit">Change password</button></div>
      </form></section>

      <section class="block"><h2>Your data</h2>
      <p class="lede">Download everything we hold about you, or delete your account. Deleting removes your name, email address, phone number and other personal details. Your open listings and needs are closed.</p>
      <p><a class="btn small" href="/account/export">Download my data</a></p>
      ${user.role === "admin" ? html`<p class="muted small">Administrator accounts cannot be deleted here.</p>` : html`
      <form class="formbox" method="post" action="/account/delete">
        <div class="fields">
          <div class="full"><label for="del_password">Your password</label><input id="del_password" name="password" type="password" autocomplete="current-password" required></div>
          <div class="full"><label class="check" for="del_confirm"><input id="del_confirm" name="confirm" type="checkbox" value="yes" required><span>I understand this cannot be undone.</span></label></div>
        </div>
        <div class="actions"><button class="btn del" type="submit">Delete my account</button></div>
      </form>`}</section>`,
  });
}

export async function accountPost(ctx: Ctx) {
  const user = await guard(ctx, undefined, { allowUnapproved: true });
  if (user instanceof Response) return user;
  const f = await ctx.req.formData();
  const name = clean(f.get("full_name"), 120);
  const org = clean(f.get("organisation"), 120);
  const parish = clean(f.get("parish"));
  const channel = clean(f.get("notify_channel"));
  const phoneRaw = clean(f.get("phone"), 30);
  const bad = (text: string) => redirect("/account", { type: "error", text });

  if (name.length < 2) return bad("Enter your name.");
  if (user.role !== "farmer" && user.role !== "admin" && org.length < 2) return bad("Enter the name of your organisation.");
  if (parish && !(PARISHES as readonly string[]).includes(parish)) return bad("Choose a parish from the list.");
  if (!(CHANNELS as readonly string[]).includes(channel)) return bad("Choose how we should contact you.");
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalisePhone(phoneRaw);
    if (!phone) return bad("That phone number does not look right.");
  }
  if ((channel === "sms" || channel === "whatsapp") && !phone) return bad("Enter a phone number, or choose email.");

  await sql`update users set full_name = ${name}, organisation = ${org || null}, parish = ${parish || null}, phone = ${phone}, notify_channel = ${channel} where id = ${user.id}`;
  await audit(user.id, "account.update");
  return redirect("/account", { type: "ok", text: "Saved." });
}

export async function passwordPost(ctx: Ctx) {
  const user = await guard(ctx, undefined, { allowUnapproved: true });
  if (user instanceof Response) return user;
  const f = await ctx.req.formData();
  const current = typeof f.get("current") === "string" ? (f.get("current") as string) : "";
  const next = typeof f.get("next") === "string" ? (f.get("next") as string) : "";
  const [row] = await sql`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(current, row.password_hash))) return redirect("/account", { type: "error", text: "Your current password is not right." });
  const problem = passwordProblem(next, user.email);
  if (problem) return redirect("/account", { type: "error", text: problem });
  await sql`update users set password_hash = ${await hashPassword(next)} where id = ${user.id}`;
  await audit(user.id, "account.password");
  return redirect("/account", { type: "ok", text: "Password changed." });
}

export async function accountExport(ctx: Ctx) {
  const user = await guard(ctx, undefined, { allowUnapproved: true });
  if (user instanceof Response) return user;
  const [account] = await sql`select id, email, role, status, full_name, organisation, buyer_type, parish, phone, notify_channel, verification_note, consent_terms_version, consent_at, created_at, approved_at from users where id = ${user.id}`;
  const listings = await sql`select * from listings where farmer_id = ${user.id} order by id`;
  const needs = await sql`select * from needs where buyer_id = ${user.id} order by id`;
  const matches = await sql`
    select m.* from matches m join listings l on l.id = m.listing_id join needs n on n.id = m.need_id
    where l.farmer_id = ${user.id} or n.buyer_id = ${user.id} order by m.id`;
  const notifications = await sql`select id, match_id, channel, to_address, body, status, created_at from notifications where user_id = ${user.id} order by id`;
  const body = JSON.stringify({ exported_at: new Date().toISOString(), account, listings, needs, matches, notifications }, null, 2);
  return textResponse(body, 200, "application/json; charset=utf-8", { "Content-Disposition": 'attachment; filename="my-farm-exchange-data.json"', "Cache-Control": "no-store" });
}

export async function accountDelete(ctx: Ctx) {
  const user = await guard(ctx, undefined, { allowUnapproved: true });
  if (user instanceof Response) return user;
  if (user.role === "admin") return redirect("/account", { type: "error", text: "Administrator accounts cannot be deleted here." });
  const f = await ctx.req.formData();
  if (f.get("confirm") !== "yes") return redirect("/account", { type: "error", text: "Tick the box to confirm." });
  const [row] = await sql`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(typeof f.get("password") === "string" ? (f.get("password") as string) : "", row.password_hash))) return redirect("/account", { type: "error", text: "Your password is not right." });

  await cancelLiveMatches({ userId: user.id }, user.id);
  await sql`update listings set status = 'withdrawn' where farmer_id = ${user.id} and status = 'active'`;
  await sql`update needs set status = 'closed' where buyer_id = ${user.id} and status = 'open'`;
  await sql`update users set status = 'deleted', email = ${"deleted-" + user.id + "@deleted.invalid"}, full_name = 'Deleted user', organisation = null, buyer_type = null,
            parish = null, phone = null, verification_note = null, notify_channel = 'none', password_hash = '!' where id = ${user.id}`;
  await sql`update notifications set to_address = null, body = '[removed]' where user_id = ${user.id}`;
  const clearCookie = await destroySession(ctx.req);
  await destroyAllSessions(user.id);
  await audit(user.id, "account.delete");
  return redirect("/", { type: "ok", text: "Your account has been deleted." }, [clearCookie]);
}

// Turns the pure matching rules into stored matches, sends notifications, and handles
// what people do with a match (confirm, complete, cancel).

import { sql, audit } from "./db.ts";
import { env } from "./config.ts";
import { computeMatches, pairKey, type ListingIn, type NeedIn } from "./matching.ts";
import { notifyUser } from "./notify.ts";
import { todayIso, fmtKg } from "./util.ts";
import type { User } from "./auth.ts";

type NewMatch = { id: number; need_id: number; listing_id: number; qty_kg: string };

/**
 * Recomputes suggested matches for everything that is open.
 *  - Matches that someone has confirmed, agreed or completed are never touched.
 *  - Plain suggestions are updated, removed or added so they follow the current rules.
 * Returns the number of new suggestions. Notifications go out after the database work is done.
 */
export async function runMatching(): Promise<{ created: number; skipped: boolean }> {
  const today = todayIso();

  const created: NewMatch[] | null = await sql.begin(async (tx) => {
    const [{ ok }] = await tx`select pg_try_advisory_xact_lock(7301) as ok`;
    if (!ok) return null;

    const needRows = await tx`
      select n.id, n.product, n.qty_kg, n.max_price_ec, n.needed_by, n.created_at
      from needs n join users u on u.id = n.buyer_id
      where n.status = 'open' and u.status = 'approved'`;
    const listingRows = await tx`
      select l.id, l.product, l.qty_kg, l.price_ec, l.available_until
      from listings l join users u on u.id = l.farmer_id
      where l.status = 'active' and u.status = 'approved'`;

    // Matches that hold stock: agreed, completed, or suggestions someone has already confirmed.
    const held = await tx`
      select need_id, listing_id, qty_kg from matches
      where status in ('agreed','completed') or (status = 'suggested' and (farmer_ok or buyer_ok))`;
    const heldByNeed = new Map<number, number>();
    const heldByListing = new Map<number, number>();
    for (const m of held) {
      heldByNeed.set(m.need_id, (heldByNeed.get(m.need_id) ?? 0) + Number(m.qty_kg));
      heldByListing.set(m.listing_id, (heldByListing.get(m.listing_id) ?? 0) + Number(m.qty_kg));
    }
    const blocked = new Set<string>((await tx`select need_id, listing_id from matches where status = 'cancelled'`).map((m) => pairKey(m.need_id, m.listing_id)));
    // Pairs already held must not be suggested a second time.
    for (const m of held) blocked.add(pairKey(m.need_id, m.listing_id));

    const needs: NeedIn[] = needRows.map((n) => ({
      id: n.id, product: n.product,
      qty: Math.max(0, Number(n.qty_kg) - (heldByNeed.get(n.id) ?? 0)),
      maxPrice: n.max_price_ec == null ? null : Number(n.max_price_ec),
      neededBy: n.needed_by ? new Date(n.needed_by).toISOString().slice(0, 10) : null,
      createdAt: new Date(n.created_at).getTime(),
    }));
    const listings: ListingIn[] = listingRows.map((l) => ({
      id: l.id, product: l.product,
      qty: Math.max(0, Number(l.qty_kg) - (heldByListing.get(l.id) ?? 0)),
      price: l.price_ec == null ? null : Number(l.price_ec),
      availableUntil: l.available_until ? new Date(l.available_until).toISOString().slice(0, 10) : null,
    }));

    const { allocs } = computeMatches(needs, listings, today, blocked);
    const desired = new Map(allocs.map((a) => [pairKey(a.needId, a.listingId), a]));

    const plain = await tx`select id, need_id, listing_id, qty_kg from matches where status = 'suggested' and not farmer_ok and not buyer_ok`;
    for (const m of plain) {
      const key = pairKey(m.need_id, m.listing_id);
      const want = desired.get(key);
      if (!want) {
        await tx`delete from matches where id = ${m.id}`;
      } else {
        if (Number(m.qty_kg) !== want.qty) await tx`update matches set qty_kg = ${want.qty}, updated_at = now() where id = ${m.id}`;
        desired.delete(key);
      }
    }

    const fresh: NewMatch[] = [];
    for (const a of desired.values()) {
      const [row] = await tx`insert into matches (need_id, listing_id, qty_kg) values (${a.needId}, ${a.listingId}, ${a.qty})
                             returning id, need_id, listing_id, qty_kg`;
      fresh.push(row as NewMatch);
    }
    return fresh;
  });

  if (created === null) return { created: 0, skipped: true };
  if (created.length) void notifyNewMatches(created).catch((e) => console.error("notifyNewMatches failed", e));
  return { created: created.length, skipped: false };
}

/** One message per person per run, not one per match. */
async function notifyNewMatches(created: NewMatch[]) {
  const ids = created.map((m) => m.id);
  const idArray = `{${ids.join(",")}}`; // ids come from our own database, always integers
  const rows = await sql`
    select m.id as match_id, m.qty_kg, n.product,
           f.id as f_id, f.email as f_email, f.phone as f_phone, f.notify_channel as f_channel,
           b.id as b_id, b.email as b_email, b.phone as b_phone, b.notify_channel as b_channel
    from matches m
    join needs n on n.id = m.need_id
    join listings l on l.id = m.listing_id
    join users f on f.id = l.farmer_id
    join users b on b.id = n.buyer_id
    where m.id = any(${idArray}::int[]) and m.notified_at is null`;

  type Group = { target: { id: number; email: string; phone: string | null; notify_channel: any }; count: number; first: string; matchId: number; side: "farmer" | "buyer" };
  const groups = new Map<string, Group>();
  const add = (key: string, g: Omit<Group, "count">) => {
    const cur = groups.get(key);
    if (cur) cur.count++;
    else groups.set(key, { ...g, count: 1 });
  };
  for (const r of rows) {
    const what = `${fmtKg(r.qty_kg)} of ${r.product}`;
    add(`f${r.f_id}`, { target: { id: r.f_id, email: r.f_email, phone: r.f_phone, notify_channel: r.f_channel }, first: what, matchId: r.match_id, side: "farmer" });
    add(`b${r.b_id}`, { target: { id: r.b_id, email: r.b_email, phone: r.b_phone, notify_channel: r.b_channel }, first: what, matchId: r.match_id, side: "buyer" });
  }
  for (const g of groups.values()) {
    const body = g.side === "farmer"
      ? `Grenada Farm Exchange: ${g.count === 1 ? "a buyer wants" : `${g.count} buyers want`} your produce, for example ${g.first}. Sign in to see contact details: ${env.baseUrl}/matches`
      : `Grenada Farm Exchange: ${g.count === 1 ? "a farmer can supply" : `${g.count} farmers can supply`} your need, for example ${g.first}. Sign in to see contact details: ${env.baseUrl}/matches`;
    await notifyUser(g.target, "New match on Grenada Farm Exchange", body, g.matchId);
  }
  await sql`update matches set notified_at = now() where id = any(${idArray}::int[])`;
}

export async function notifyAccountDecision(u: { id: number; email: string; phone: string | null; notify_channel: any }, approved: boolean) {
  const body = approved
    ? `Grenada Farm Exchange: your account is approved. Sign in to post and see matches: ${env.baseUrl}/login`
    : `Grenada Farm Exchange: we could not approve your account. Reply to ${env.contactEmail} if you think this is a mistake.`;
  await notifyUser(u, approved ? "Your account is approved" : "About your account", body);
}

// ---------- match actions ----------

export type MatchAction = "confirm" | "complete" | "cancel";

/** Applies an action if this person is allowed to. Returns a short message for the page. */
export async function actOnMatch(user: User, matchId: number, action: MatchAction): Promise<{ ok: boolean; message: string }> {
  const [m] = await sql`
    select m.id, m.status, l.farmer_id, n.buyer_id
    from matches m join listings l on l.id = m.listing_id join needs n on n.id = m.need_id
    where m.id = ${matchId}`;
  if (!m) return { ok: false, message: "That match was not found." };

  const isFarmer = m.farmer_id === user.id;
  const isBuyer = m.buyer_id === user.id;
  const isAdmin = user.role === "admin";
  if (!isFarmer && !isBuyer && !isAdmin) return { ok: false, message: "That match was not found." };

  if (action === "confirm") {
    if (!isFarmer && !isBuyer) return { ok: false, message: "Only the farmer or the buyer can confirm." };
    if (m.status !== "suggested") return { ok: false, message: "This match can no longer be confirmed." };
    const rows = isFarmer
      ? await sql`update matches set farmer_ok = true, updated_at = now() where id = ${matchId} and status = 'suggested' returning farmer_ok, buyer_ok`
      : await sql`update matches set buyer_ok = true, updated_at = now() where id = ${matchId} and status = 'suggested' returning farmer_ok, buyer_ok`;
    const r = rows[0];
    if (r?.farmer_ok && r?.buyer_ok) {
      await sql`update matches set status = 'agreed', updated_at = now() where id = ${matchId} and status = 'suggested'`;
      await audit(user.id, "match.agreed", { matchId });
      return { ok: true, message: "Both sides have confirmed. Arrange delivery and payment directly." };
    }
    await audit(user.id, "match.confirm", { matchId });
    return { ok: true, message: "Confirmed. We will mark it agreed when the other side confirms too." };
  }

  if (action === "complete") {
    if (m.status !== "agreed") return { ok: false, message: "Only an agreed match can be marked as delivered." };
    await sql`update matches set status = 'completed', updated_at = now() where id = ${matchId} and status = 'agreed'`;
    await audit(user.id, "match.completed", { matchId });
    void runMatching().catch(console.error);
    return { ok: true, message: "Marked as delivered." };
  }

  // cancel
  if (m.status !== "suggested" && m.status !== "agreed") return { ok: false, message: "This match can no longer be cancelled." };
  await sql`update matches set status = 'cancelled', updated_at = now() where id = ${matchId} and status in ('suggested','agreed')`;
  await audit(user.id, "match.cancelled", { matchId });
  void runMatching().catch(console.error);
  return { ok: true, message: "Match cancelled. The goods are free to be matched again." };
}

/**
 * Cancels suggested and agreed matches that involve a listing, a need or a person.
 * Everyone in those matches except the person who caused it is told. Then matching runs again.
 */
export async function cancelLiveMatches(filter: { listingId?: number; needId?: number; userId?: number }, initiatorId: number) {
  const { listingId = null, needId = null, userId = null } = filter;
  if (listingId === null && needId === null && userId === null) return;
  const rows = await sql`
    select m.id, m.qty_kg, n.product,
           f.id as f_id, f.email as f_email, f.phone as f_phone, f.notify_channel as f_ch,
           b.id as b_id, b.email as b_email, b.phone as b_phone, b.notify_channel as b_ch
    from matches m
    join needs n on n.id = m.need_id
    join listings l on l.id = m.listing_id
    join users f on f.id = l.farmer_id
    join users b on b.id = n.buyer_id
    where m.status in ('suggested','agreed')
      and (${listingId}::int is null or m.listing_id = ${listingId})
      and (${needId}::int is null or m.need_id = ${needId})
      and (${userId}::int is null or l.farmer_id = ${userId} or n.buyer_id = ${userId})`;
  if (!rows.length) return;
  const idArray = `{${rows.map((r) => r.id).join(",")}}`;
  await sql`update matches set status = 'cancelled', updated_at = now() where id = any(${idArray}::int[])`;
  for (const r of rows) {
    const body = `Grenada Farm Exchange: a match for ${fmtKg(r.qty_kg)} of ${r.product} was cancelled. We will look for another. ${env.baseUrl}/matches`;
    if (r.f_id !== initiatorId) await notifyUser({ id: r.f_id, email: r.f_email, phone: r.f_phone, notify_channel: r.f_ch }, "A match was cancelled", body, r.id);
    if (r.b_id !== initiatorId) await notifyUser({ id: r.b_id, email: r.b_email, phone: r.b_phone, notify_channel: r.b_ch }, "A match was cancelled", body, r.id);
  }
  void runMatching().catch(console.error);
}

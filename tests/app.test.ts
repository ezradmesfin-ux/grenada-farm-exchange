// End-to-end tests. They start the real server against a throwaway Postgres database.
// Needs a Postgres server. Set TEST_ADMIN_URL to a URL that can create databases
// (default: postgres://postgres@127.0.0.1:5433/postgres).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
const DB_NAME = "farmx_test";
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB_NAME}`);
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const CRON = "test-cron-secret";

let proc: ReturnType<typeof Bun.spawn>;
let db: SQL;

class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, form?: Record<string, string>, opts: { origin?: boolean; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.origin !== false) headers.Origin = BASE;
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i), value = pair!.slice(i + 1);
      if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
  /** Sends the request and follows redirects, returning the final page text. */
  async go(method: string, path: string, form?: Record<string, string>) {
    let res = await this.req(method, path, form);
    let hops = 0;
    while (res.status === 303 && hops++ < 4) res = await this.req("GET", res.headers.get("location")!);
    return { status: res.status, text: await res.text(), res };
  }
}

const farmerForm = (o: Record<string, string> = {}) => ({
  role: "farmer", full_name: "Joseph Charles", organisation: "Charles Farm", parish: "St. Andrew",
  email: "joseph@example.com", phone: "4735551001", notify_channel: "sms", verification_note: "Farmer reg 1234",
  password: "correct-horse-1", consent: "yes", ...o,
});
const hotelForm = (o: Record<string, string> = {}) => ({
  role: "hotel", full_name: "Maria Hotel", organisation: "Bay Resort", parish: "St. George",
  email: "maria@example.com", phone: "+14735552002", notify_channel: "whatsapp", verification_note: "Licence H-77",
  password: "correct-horse-2", consent: "yes", ...o,
});
const govForm = (o: Record<string, string> = {}) => ({
  role: "government", full_name: "Gov Officer", organisation: "Ministry of Agriculture", parish: "St. George",
  email: "officer@gov.example", phone: "", notify_channel: "email", verification_note: "Staff ID 55",
  password: "correct-horse-3", consent: "yes", ...o,
});

async function approve(email: string) {
  await db`update users set status = 'approved', approved_at = now() where email = ${email}`;
}
const listingForm = (o: Record<string, string> = {}) => ({ product: "Tomatoes", qty_kg: "100", price_ec: "2.50", parish: "St. Andrew", available_until: "", notes: "", ...o });
const needForm = (o: Record<string, string> = {}) => ({ product: "Tomatoes", qty_kg: "150", max_price_ec: "3.00", needed_by: "", note: "", ...o });

beforeAll(async () => {
  const root = new SQL(ADMIN_URL);
  await root.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await root.unsafe(`create database ${DB_NAME}`);
  await root.close();
  db = new SQL(DB_URL);
  proc = Bun.spawn(["bun", "src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DATABASE_URL: DB_URL, CRON_SECRET: CRON, NODE_ENV: "test" },
    stdout: "ignore",
    stderr: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/health")).ok) return; } catch { /* not up yet */ }
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
});

afterAll(async () => {
  proc?.kill();
  await db?.close();
  const root = new SQL(ADMIN_URL);
  await Bun.sleep(200);
  await root.unsafe(`drop database if exists ${DB_NAME} with (force)`).catch(() => {});
  await root.close();
});

const farmer = new Client(), hotel = new Client(), gov = new Client(), admin = new Client(), stranger = new Client();

describe("security basics", () => {
  test("public pages load and send security headers", async () => {
    const res = await fetch(BASE + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("posting without an Origin header is blocked", async () => {
    const c = new Client();
    const res = await c.req("POST", "/login", { email: "a@b.com", password: "x" }, { origin: false });
    expect(res.status).toBe(403);
  });

  test("signed-out visitors are sent to sign in", async () => {
    const res = await new Client().req("GET", "/board");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toStartWith("/login");
  });

  test("scheduled matching needs the secret", async () => {
    const no = await fetch(BASE + "/internal/run-matching", { method: "POST" });
    expect(no.status).toBe(403);
    const bad = await fetch(BASE + "/internal/run-matching", { method: "POST", headers: { Authorization: "Bearer nope" } });
    expect(bad.status).toBe(403);
    const ok = await fetch(BASE + "/internal/run-matching", { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
    expect(ok.status).toBe(200);
  });
});

describe("registration", () => {
  test("rejects weak passwords, missing consent and bad phones", async () => {
    const c = new Client();
    expect((await c.go("POST", "/signup", farmerForm({ password: "short" }))).text).toContain("at least 8 characters");
    const noConsent = farmerForm(); delete (noConsent as any).consent;
    expect((await c.go("POST", "/signup", noConsent)).text).toContain("accept the terms");
    expect((await c.go("POST", "/signup", farmerForm({ phone: "12" }))).text).toContain("phone number does not look right");
    expect((await c.go("POST", "/signup", farmerForm({ verification_note: "" }))).text).toContain("how we can check");
    expect((await c.go("POST", "/signup", hotelForm({ organisation: "" }))).text).toContain("name of your hotel");
    const [{ n }] = await db`select count(*)::int as n from users`;
    expect(n).toBe(0);
  });

  test("a robot that fills the hidden field creates nothing", async () => {
    const c = new Client();
    await c.go("POST", "/signup", { ...farmerForm({ email: "bot@example.com" }), website: "http://spam" });
    const rows = await db`select 1 from users where email = 'bot@example.com'`;
    expect(rows.length).toBe(0);
  });

  test("a valid farmer registers, is pending, and cannot use the app", async () => {
    const r = await farmer.go("POST", "/signup", farmerForm());
    expect(r.text).toContain("waiting for approval");
    const [u] = await db`select status, phone, consent_terms_version, password_hash from users where email = 'joseph@example.com'`;
    expect(u.status).toBe("pending");
    expect(u.phone).toBe("+14735551001"); // 7-digit-style local number gets +1
    expect(u.consent_terms_version).toBeTruthy();
    expect(u.password_hash).not.toContain("correct-horse");
    const res = await farmer.req("GET", "/listings");
    expect(res.headers.get("location")).toBe("/pending");
    const post = await farmer.req("POST", "/listings", listingForm());
    expect(post.headers.get("location")).toBe("/pending");
    expect((await db`select 1 from listings`).length).toBe(0);
  });

  test("duplicate emails are refused", async () => {
    const r = await new Client().go("POST", "/signup", farmerForm({ full_name: "Someone Else" }));
    expect(r.text).toContain("already exists");
  });

  test("names are escaped wherever they appear", async () => {
    await new Client().go("POST", "/signup", hotelForm({ email: "xss@example.com", organisation: `<script>alert(1)</script>"x`, full_name: "=HYPERLINK(\"http://evil\",\"x\")" }));
    await db`update users set status = 'pending' where email = 'xss@example.com'`;
  });
});

describe("sign in", () => {
  test("wrong password fails, and repeated failures are limited", async () => {
    const c = new Client();
    const wrong = await c.go("POST", "/login", { email: "joseph@example.com", password: "nope-nope-nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain("do not match");
    const unknown = await c.go("POST", "/login", { email: "ghost@example.com", password: "nope-nope-nope" });
    expect(unknown.text).toContain("do not match"); // same message for unknown emails
    for (let i = 0; i < 9; i++) await c.req("POST", "/login", { email: "limit-test@example.com", password: "nope-nope-nope" });
    const limited = await c.go("POST", "/login", { email: "limit-test@example.com", password: "nope-nope-nope" });
    expect(limited.status).toBe(429);
  });

  test("open redirects are ignored", async () => {
    const c = new Client();
    const res = await c.req("POST", "/login", { email: "joseph@example.com", password: "correct-horse-1", next: "//evil.example" });
    expect(res.headers.get("location")).toBe("/pending");
  });
});

describe("approval and roles", () => {
  test("create an admin and approve people", async () => {
    const hash = await Bun.password.hash("admin-password-9");
    await db`insert into users (email, password_hash, role, status, full_name, notify_channel, verification_note, consent_terms_version, consent_at)
             values ('admin@example.com', ${hash}, 'admin', 'approved', 'Admin', 'none', 'seed', 'x', now())`;
    const r = await admin.go("POST", "/login", { email: "admin@example.com", password: "admin-password-9" });
    expect(r.text).toContain("Supply and demand");

    await hotel.go("POST", "/signup", hotelForm());
    await gov.go("POST", "/signup", govForm());
    const page = await admin.go("GET", "/admin");
    expect(/Waiting for approval \((\d+)\)/.exec(page.text)?.[1]).toBe("4");
    expect(page.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page.text).not.toContain("<script>alert(1)");

    const [f] = await db`select id from users where email = 'joseph@example.com'`;
    const res = await admin.go("POST", `/admin/users/${f.id}/approve`);
    expect(res.text).toContain("Joseph Charles is approved");
    await approve("maria@example.com");
    await approve("officer@gov.example");
    await db`update users set status = 'rejected' where email = 'xss@example.com'`;
  });

  test("non-admins cannot reach the admin area, farmers cannot post needs", async () => {
    const res = await farmer.req("GET", "/admin");
    expect(res.status).toBe(403);
  });
});

describe("posting and matching", () => {
  test("farmer sessions work (session from signup)", async () => {
    const r = await farmer.go("GET", "/listings");
    expect(r.text).toContain("Post surplus produce");
    const admin403 = await farmer.req("GET", "/admin");
    expect(admin403.status).toBe(403);
    const needs403 = await farmer.req("POST", "/needs", needForm());
    expect(needs403.status).toBe(403);
  });

  test("buyers cannot post listings", async () => {
    await hotel.go("GET", "/board");
    const res = await hotel.req("POST", "/listings", listingForm());
    expect(res.status).toBe(403);
  });

  test("validation errors are explained", async () => {
    expect((await farmer.go("POST", "/listings", listingForm({ qty_kg: "-5" }))).text).toContain("Enter a quantity");
    expect((await farmer.go("POST", "/listings", listingForm({ product: "Gold bars" }))).text).toContain("Choose a product");
    expect((await farmer.go("POST", "/listings", listingForm({ available_until: "2001-01-01" }))).text).toContain("already passed");
    expect((await db`select 1 from listings`).length).toBe(0);
  });

  test("a need is matched to the cheapest surplus and both sides are notified once", async () => {
    await farmer.go("POST", "/listings", listingForm({ qty_kg: "80", price_ec: "3.00" }));
    await farmer.go("POST", "/listings", listingForm({ qty_kg: "100", price_ec: "2.50" }));
    const r = await hotel.go("POST", "/needs", needForm());
    expect(r.text).toContain("new match");
    const ms = await db`select m.qty_kg, l.price_ec from matches m join listings l on l.id = m.listing_id order by l.price_ec`;
    expect(ms.map((m) => [Number(m.qty_kg), Number(m.price_ec)])).toEqual([[100, 2.5], [50, 3]]);
    await Bun.sleep(300);
    const notes = await db`select u.email, n.status, n.channel, n.body from notifications n join users u on u.id = n.user_id where n.match_id is not null order by n.id`;
    const byUser = Object.fromEntries(notes.map((n) => [n.email, n]));
    expect(notes.length).toBe(2); // one grouped message each, not one per match
    expect(byUser["joseph@example.com"]!.channel).toBe("sms");
    expect(byUser["maria@example.com"]!.channel).toBe("whatsapp");
    expect(byUser["joseph@example.com"]!.status).toBe("logged"); // no Twilio keys in tests
    expect(byUser["joseph@example.com"]!.body).not.toContain("+1473555"); // no phone numbers in messages
  });

  test("running matching again changes nothing and sends nothing new", async () => {
    await fetch(BASE + "/internal/run-matching", { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
    expect((await db`select 1 from matches`).length).toBe(2);
    await Bun.sleep(200);
    expect((await db`select 1 from notifications where match_id is not null`).length).toBe(2);
  });

  test("contact details are hidden on browse pages and shown only inside a match", async () => {
    const browse = await hotel.go("GET", "/listings");
    expect(browse.text).toContain("Charles Farm");
    expect(browse.text).not.toContain("4735551001");
    expect(browse.text).not.toContain("joseph@example.com");
    const matches = await hotel.go("GET", "/matches");
    expect(matches.text).toContain("+14735551001");
    expect(matches.text).toContain("joseph@example.com");
    const farmerView = await farmer.go("GET", "/matches");
    expect(farmerView.text).toContain("Bay Resort");
    expect(farmerView.text).toContain("+14735552002");
  });

  test("a stranger cannot see or touch someone else's match", async () => {
    await stranger.go("POST", "/signup", farmerForm({ email: "stranger@example.com", full_name: "Stranger" }));
    await approve("stranger@example.com");
    const view = await stranger.go("GET", "/matches");
    expect(view.text).toContain("No matches yet");
    expect(view.text).not.toContain("4735551001");
    const [m] = await db`select id from matches order by id limit 1`;
    const act = await stranger.go("POST", `/matches/${m.id}/confirm`);
    expect(act.text).toContain("not found");
    const [after] = await db`select farmer_ok, buyer_ok, status from matches where id = ${m.id}`;
    expect(after.farmer_ok || after.buyer_ok).toBe(false);
  });

  test("earlier deadline goes first; confirmed matches are not reshuffled", async () => {
    // Government needs 60 kg by an early date. Plain suggestions are rebuilt, giving gov the cheapest stock.
    const soon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    await db`update needs set needed_by = ${later} where true`;
    await gov.go("POST", "/login", { email: "officer@gov.example", password: "correct-horse-3" });
    await gov.go("POST", "/needs", needForm({ qty_kg: "60", needed_by: soon, max_price_ec: "" }));
    const rows = await db`select n.needed_by::text as by, m.qty_kg, l.price_ec from matches m join needs n on n.id = m.need_id join listings l on l.id = m.listing_id where m.status = 'suggested' order by n.needed_by, l.price_ec`;
    const govRows = rows.filter((r) => r.by === soon);
    expect(govRows.reduce((a, r) => a + Number(r.qty_kg), 0)).toBe(60);
    expect(Number(govRows[0]!.price_ec)).toBe(2.5);
    const hotelTotal = rows.filter((r) => r.by === later).reduce((a, r) => a + Number(r.qty_kg), 0);
    expect(hotelTotal).toBe(120); // 180 kg of tomatoes in total, 60 to government, the rest to the hotel
  });

  test("both sides confirm, then delivery is recorded", async () => {
    const [m] = await db`select m.id from matches m join needs n on n.id = m.need_id join users u on u.id = n.buyer_id where u.email = 'maria@example.com' order by m.id limit 1`;
    const a = await farmer.go("POST", `/matches/${m.id}/confirm`);
    expect(a.text).toContain("Confirmed");
    const b = await hotel.go("POST", `/matches/${m.id}/confirm`);
    expect(b.text).toContain("Both sides have confirmed");
    const [row] = await db`select status from matches where id = ${m.id}`;
    expect(row.status).toBe("agreed");
    const early = await farmer.go("POST", `/matches/${m.id}/confirm`);
    expect(early.text).toContain("can no longer be confirmed");
    const done = await hotel.go("POST", `/matches/${m.id}/complete`);
    expect(done.text).toContain("Marked as delivered");
    expect((await db`select status from matches where id = ${m.id}`)[0]!.status).toBe("completed");
  });

  test("the board shows totals without personal contact details", async () => {
    const r = await hotel.go("GET", "/board");
    expect(r.text).toContain("Supply and demand");
    expect(r.text).not.toContain("4735551001");
    expect(r.text).not.toContain("joseph@example.com");
  });

  test("withdrawing a listing cancels its open matches and tells the buyer", async () => {
    const [l] = await db`select id from listings order by price_ec desc limit 1`;
    const before = (await db`select 1 from notifications`).length;
    const r = await farmer.go("POST", `/listings/${l.id}/withdraw`);
    expect(r.text).toContain("Listing withdrawn");
    await Bun.sleep(300);
    const live = await db`select 1 from matches where listing_id = ${l.id} and status in ('suggested','agreed')`;
    expect(live.length).toBe(0);
    expect((await db`select 1 from notifications`).length).toBeGreaterThan(before);
  });

  test("a cancelled pair is not suggested again", async () => {
    await farmer.go("POST", "/listings", listingForm({ product: "Cabbage", qty_kg: "50", price_ec: "1.00" }));
    await hotel.go("POST", "/needs", needForm({ product: "Cabbage", qty_kg: "40", max_price_ec: "" }));
    const [m] = await db`select m.id, m.need_id, m.listing_id from matches m join needs n on n.id = m.need_id where n.product = 'Cabbage' and m.status = 'suggested'`;
    expect(m).toBeTruthy();
    const r = await hotel.go("POST", `/matches/${m.id}/cancel`);
    expect(r.text).toContain("Match cancelled");
    await fetch(BASE + "/internal/run-matching", { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
    const again = await db`select 1 from matches where need_id = ${m.need_id} and listing_id = ${m.listing_id} and status <> 'cancelled'`;
    expect(again.length).toBe(0);
  });
});

describe("admin tools", () => {
  test("people list, exports and formula protection", async () => {
    const csv = await admin.req("GET", "/admin/export/users.csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("joseph@example.com");
    expect(text).not.toContain("password");
    // A cell that starts with = would run as a formula in a spreadsheet.
    await db`update users set full_name = '=1+1' where email = 'stranger@example.com'`;
    expect(await (await admin.req("GET", "/admin/export/users.csv")).text()).toContain(`"'=1+1"`);
    const summary = await (await admin.req("GET", "/admin/export/summary.csv")).text();
    expect(summary).toContain("Tomatoes");
    expect(summary).not.toContain("@");
  });

  test("suspending someone signs them out and blocks posting", async () => {
    const [s] = await db`select id from users where email = 'stranger@example.com'`;
    await admin.go("POST", `/admin/users/${s.id}/suspend`);
    const res = await stranger.req("GET", "/listings");
    expect(res.headers.get("location")).toStartWith("/login");
  });

  test("password reset gives a temporary password that works", async () => {
    const [u] = await db`select id from users where email = 'officer@gov.example'`;
    const r = await admin.go("POST", `/admin/users/${u.id}/reset-password`);
    const temp = /Temporary password for officer@gov.example: (\w+)\./.exec(r.text)?.[1];
    expect(temp).toBeTruthy();
    const c = new Client();
    const login = await c.go("POST", "/login", { email: "officer@gov.example", password: temp! });
    expect(login.text).toContain("Supply and demand");
  });

  test("the activity log records what happened", async () => {
    const r = await admin.go("GET", "/admin/audit");
    expect(r.text).toContain("user.approve");
    expect(r.text).toContain("match.agreed");
  });
});

describe("your data", () => {
  test("export contains your data but no password hash", async () => {
    const res = await hotel.req("GET", "/account/export");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.account.email).toBe("maria@example.com");
    expect(text).not.toContain("password_hash");
    expect(data.needs.length).toBeGreaterThan(0);
  });

  test("deleting an account removes personal details and closes open posts", async () => {
    expect((await hotel.go("POST", "/account/delete", { password: "wrong-pass", confirm: "yes" })).text).toContain("not right");
    const r = await hotel.go("POST", "/account/delete", { password: "correct-horse-2", confirm: "yes" });
    expect(r.text).toContain("has been deleted");
    const [u] = await db`select id, email, full_name, phone, organisation, status from users where full_name = 'Deleted user'`;
    expect(u.status).toBe("deleted");
    expect(u.email).toEndWith("@deleted.invalid");
    expect(u.full_name).toBe("Deleted user");
    expect(u.phone).toBeNull();
    expect(u.organisation).toBeNull();
    expect((await db`select 1 from needs where status = 'open' and buyer_id = ${u.id}`).length).toBe(0);
    const after = await hotel.req("GET", "/board");
    expect(after.headers.get("location")).toStartWith("/login");
    const relogin = await new Client().go("POST", "/login", { email: "maria@example.com", password: "correct-horse-2" });
    expect(relogin.status).toBe(401);
  });

  test("admins cannot delete themselves from the account page", async () => {
    const r = await admin.go("POST", "/account/delete", { password: "admin-password-9", confirm: "yes" });
    expect(r.text).toContain("cannot be deleted");
  });
});

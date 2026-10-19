import { sql, audit } from "./db.ts";
import { BUYER_TYPES, CHANNELS, PARISHES, ROLE_LABEL, SIGNUP_ROLES, TERMS_VERSION } from "./config.ts";
import {
  clearFailures, createSession, destroySession, hashPassword, passwordProblem, rateLimited, recordFailure, verifyPassword,
} from "./auth.ts";
import { errorPage, guard, page, redirect, safeNext, type Ctx } from "./http.ts";
import { clean, EMAIL_RE, fmtKg, html, normalisePhone, raw } from "./util.ts";
import { empty, options, pendingNotice } from "./views.ts";
import { privacyPage, termsPage } from "./legal.ts";

const DUMMY_HASH = await hashPassword("not-a-real-password");

// ---------- home ----------
export async function home(ctx: Ctx) {
  if (ctx.user?.status === "approved") return redirect("/board");
  const [s] = await sql`
    select
      (select count(*)::int from listings l join users u on u.id = l.farmer_id where l.status = 'active' and u.status = 'approved') as listings,
      (select count(*)::int from needs n join users u on u.id = n.buyer_id where n.status = 'open' and u.status = 'approved') as needs,
      (select coalesce(sum(qty_kg), 0) from matches where status = 'completed') as traded`;
  const any = s.listings > 0 || s.needs > 0 || Number(s.traded) > 0;
  return page(ctx, {
    title: "Grenada Farm Exchange",
    body: html`
      <h1>Surplus finds a buyer. Shortfalls find a supplier.</h1>
      <p class="lede big">Farmers list produce they have extra. Government, hotels and other buyers list what they need. The exchange matches them and shows what is left to import or export.</p>
      <p class="actions" style="margin-top:0">
        ${ctx.user ? html`<a class="btn" href="/pending">Check account status</a>` : html`<a class="btn" href="/signup">Register</a><a href="/login">Sign in</a>`}
      </p>

      ${any ? html`<div class="figures" style="margin-top:36px">
        <div><b>${s.listings}</b><span>Surplus listings</span></div>
        <div><b>${s.needs}</b><span>Open needs</span></div>
        <div><b>${fmtKg(s.traded)}</b><span>Delivered through the exchange</span></div>
      </div>` : ""}

      <section class="block">
        <h2>How it works</h2>
        <ol class="steps" style="margin-top:14px">
          <li><b>Register</b>Say who you are. An administrator checks every account before it goes live.</li>
          <li><b>Post</b>Farmers list product, kilograms, price and parish. Buyers list what they need and by when.</li>
          <li><b>Get matched</b>The earliest deadline is served first, and each need takes the cheapest produce within its price limit.</li>
          <li><b>Agree directly</b>Both sides confirm, see each other's contact details and arrange delivery and payment themselves.</li>
        </ol>
      </section>

      <section class="block">
        <h2>Who can join</h2>
        <p class="lede">${SIGNUP_ROLES.map((r) => ROLE_LABEL[r]).join(", ")}. Contact details are shown only to the other side of a match.</p>
      </section>`,
  });
}

export const pending = async (ctx: Ctx) => {
  if (!ctx.user) return redirect("/login");
  if (ctx.user.status === "approved") return redirect("/board");
  return page(ctx, { title: "Account status", body: pendingNotice(ctx.user) });
};

export const terms = (ctx: Ctx) => page(ctx, { title: "Terms of use", body: termsPage() });
export const privacy = (ctx: Ctx) => page(ctx, { title: "Privacy", body: privacyPage() });

// ---------- sign up ----------
type SignupValues = Record<string, string>;

function signupForm(v: SignupValues = {}) {
  return html`<form class="formbox wide" method="post" action="/signup">
    <div class="fields">
      <div><label for="role">I am a</label>
        <select id="role" name="role" required>${SIGNUP_ROLES.map((r) => html`<option value="${r}" ${v.role === r ? raw("selected") : ""}>${ROLE_LABEL[r]}</option>`)}</select></div>
      <div><label for="full_name">Your name</label><input id="full_name" name="full_name" value="${v.full_name}" autocomplete="name" required maxlength="120"></div>
      <div><label for="organisation">Farm, hotel, agency or business name</label><input id="organisation" name="organisation" value="${v.organisation}" maxlength="120">
        <div class="hint">Required for everyone except farmers.</div></div>
      <div><label for="buyer_type">Type of buyer</label>
        <select id="buyer_type" name="buyer_type"><option value="">Not an "other buyer"</option>${options(BUYER_TYPES, v.buyer_type)}</select></div>
      <div><label for="parish">Parish</label>
        <select id="parish" name="parish"><option value="">Choose</option>${options(PARISHES, v.parish)}</select></div>
      <div><label for="email">Email</label><input id="email" name="email" type="email" value="${v.email}" autocomplete="email" required maxlength="200"></div>
      <div><label for="phone">Phone or WhatsApp number</label><input id="phone" name="phone" value="${v.phone}" autocomplete="tel" inputmode="tel" maxlength="30">
        <div class="hint">Local 7-digit numbers are fine. We add +1 473.</div></div>
      <div><label for="notify_channel">Tell me about matches by</label>
        <select id="notify_channel" name="notify_channel">${CHANNELS.map((c) => html`<option value="${c}" ${(v.notify_channel ?? "sms") === c ? raw("selected") : ""}>${{ sms: "Text message", whatsapp: "WhatsApp", email: "Email", none: "Nothing, I will check the site" }[c]}</option>`)}</select></div>
      <div class="full"><label for="verification_note">How can we check who you are?</label>
        <textarea id="verification_note" name="verification_note" required maxlength="400">${v.verification_note}</textarea>
        <div class="hint">For example your farmer registration number, business licence number, or staff ID and ministry.</div></div>
      <div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
        <div class="hint">At least 8 characters.</div></div>
      <div class="full" style="position:absolute;left:-9999px" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="full"><label class="check" for="consent"><input id="consent" name="consent" type="checkbox" value="yes" required>
        <span>I have read the <a href="/terms">terms of use</a> and the <a href="/privacy">privacy notice</a> and I agree to them. I understand that the other side of a match will see my contact details.</span></label></div>
    </div>
    <div class="actions"><button class="btn" type="submit">Create account</button><a href="/login">I already have an account</a></div>
  </form>`;
}

export async function signupGet(ctx: Ctx) {
  if (ctx.user) return redirect(ctx.user.status === "approved" ? "/board" : "/pending");
  return page(ctx, { title: "Register", body: html`<h1>Register</h1><p class="lede">New accounts are checked by an administrator before they can post or see matches.</p>${signupForm()}` });
}

export async function signupPost(ctx: Ctx) {
  const f = await ctx.req.formData();
  const v: SignupValues = {};
  for (const k of ["role", "full_name", "organisation", "buyer_type", "parish", "email", "phone", "notify_channel", "verification_note"]) v[k] = clean(f.get(k), k === "verification_note" ? 400 : 200);
  v.email = v.email!.toLowerCase();
  const password = typeof f.get("password") === "string" ? (f.get("password") as string) : "";

  // Bots fill every field. Pretend it worked.
  if (clean(f.get("website"))) return redirect("/pending");

  const key = `signup:${ctx.ip}`;
  if (rateLimited(key, 20)) return errorPage(ctx, 429, "Too many attempts", "Please wait a few minutes and try again.");
  recordFailure(key);

  const fail = (text: string) => page(ctx, { title: "Register", status: 400, flash: { type: "error", text }, body: html`<h1>Register</h1>${signupForm(v)}` });

  if (!(SIGNUP_ROLES as readonly string[]).includes(v.role!)) return fail("Choose who you are.");
  if (v.full_name!.length < 2) return fail("Enter your name.");
  if (!EMAIL_RE.test(v.email)) return fail("Enter a valid email address.");
  if (v.role !== "farmer" && v.organisation!.length < 2) return fail("Enter the name of your hotel, agency or business.");
  if (v.role === "buyer" && !(BUYER_TYPES as readonly string[]).includes(v.buyer_type!)) return fail("Choose your type of buyer.");
  if (v.parish && !(PARISHES as readonly string[]).includes(v.parish)) return fail("Choose a parish from the list.");
  if (!(CHANNELS as readonly string[]).includes(v.notify_channel!)) v.notify_channel = "sms";
  let phone: string | null = null;
  if (v.phone) {
    phone = normalisePhone(v.phone);
    if (!phone) return fail("That phone number does not look right. Use 7 digits, or start with + and the country code.");
  }
  if ((v.notify_channel === "sms" || v.notify_channel === "whatsapp") && !phone) return fail("Enter a phone number, or choose email.");
  if (v.verification_note!.length < 4) return fail("Tell us how we can check who you are.");
  const pw = passwordProblem(password, v.email);
  if (pw) return fail(pw);
  if (f.get("consent") !== "yes") return fail("You need to accept the terms and privacy notice.");

  const hash = await hashPassword(password);
  let id: number;
  try {
    const [row] = await sql`
      insert into users (email, password_hash, role, full_name, organisation, buyer_type, parish, phone, notify_channel, verification_note, consent_terms_version, consent_at)
      values (${v.email}, ${hash}, ${v.role}, ${v.full_name}, ${v.organisation || null}, ${v.role === "buyer" ? v.buyer_type : null}, ${v.parish || null}, ${phone}, ${v.notify_channel}, ${v.verification_note}, ${TERMS_VERSION}, now())
      returning id`;
    id = row.id;
  } catch (e) {
    if (String((e as Error).message).includes("users_email_key") || (e as { code?: string }).code === "23505") return fail("An account with that email already exists. Try signing in.");
    throw e;
  }
  await audit(id, "user.signup", { role: v.role });
  const cookie = await createSession(id);
  return redirect("/pending", { type: "ok", text: "Account created. An administrator will check it and you will be told when it is approved." }, [cookie]);
}

// ---------- sign in ----------
function loginForm(next: string, email = "") {
  return html`<form class="formbox" method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <div class="fields">
      <div class="full"><label for="email">Email</label><input id="email" name="email" type="email" value="${email}" autocomplete="username" required></div>
      <div class="full"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    </div>
    <div class="actions"><button class="btn" type="submit">Sign in</button><a href="/signup">Register</a></div>
  </form>`;
}

export async function loginGet(ctx: Ctx) {
  if (ctx.user) return redirect(ctx.user.status === "approved" ? "/board" : "/pending");
  return page(ctx, { title: "Sign in", body: html`<h1>Sign in</h1>${loginForm(safeNext(ctx.url.searchParams.get("next"), ""))}
    <p class="muted small" style="margin-top:14px">Forgotten your password? Email the administrator and they will reset it for you.</p>` });
}

export async function loginPost(ctx: Ctx) {
  const f = await ctx.req.formData();
  const email = clean(f.get("email")).toLowerCase();
  const password = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  const next = safeNext(clean(f.get("next"), 300), "");
  const key = `login:${ctx.ip}:${email}`;

  if (rateLimited(key)) return errorPage(ctx, 429, "Too many attempts", "Too many wrong passwords. Wait 15 minutes and try again.");

  const [u] = await sql`select id, password_hash, status from users where email = ${email}`;
  // Always run one hash check so a missing account takes as long as a wrong password.
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok || u.status === "deleted") {
    recordFailure(key);
    return page(ctx, { title: "Sign in", status: 401, flash: { type: "error", text: "That email and password do not match." }, body: html`<h1>Sign in</h1>${loginForm(next, email)}` });
  }
  clearFailures(key);
  const cookie = await createSession(u.id);
  await audit(u.id, "user.login");
  return redirect(u.status === "approved" ? next || "/board" : "/pending", undefined, [cookie]);
}

export async function logoutPost(ctx: Ctx) {
  const cookie = await destroySession(ctx.req);
  return redirect("/", { type: "ok", text: "You are signed out." }, [cookie]);
}

export { empty, guard };

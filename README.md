# Grenada Farm Exchange

A website where farmers list surplus produce, and government, hotels and other buyers list what they need. The site matches them, tells both sides by text, WhatsApp or email, and shows what is still short (to import) or unsold (to export).

## What is included

| Piece | Where | What it does |
|---|---|---|
| Accounts and roles | `src/auth.ts`, `src/routes_public.ts` | Farmer, government, hotel, other buyer and administrator. Every new account waits for an administrator to approve it. Passwords are hashed with argon2id. Sign-in is rate limited. |
| Database | `src/schema.sql` | Postgres. Tables are created automatically on start. |
| Posting | `src/routes_app.ts` | Farmers post surplus. Buyers post needs. Everyone signed in can browse. Phone numbers and emails are never shown on browse pages. |
| Matching | `src/matching.ts`, `src/engine.ts` | Earliest deadline first, cheapest produce first, price limits respected. Runs after every post and every 15 minutes. Confirmed matches are never reshuffled. |
| Notifications | `src/notify.ts` | One message per person per run, by their chosen channel (text, WhatsApp, email). Falls back to email if text fails. |
| Match steps | `src/engine.ts` | Suggested, then both sides confirm (agreed), then marked delivered. Either side can cancel. |
| Admin area | `src/routes_admin.ts` | Approve or reject people, suspend, reset passwords, remove posts, manage matches, see messages sent and an activity log, download CSV files. |
| Legal pages | `src/legal.ts` | **Draft** terms of use and privacy notice. Needs a lawyer. |
| Your data | `src/routes_app.ts` | People can download their data and delete their account. |
| Tests | `tests/` | 41 tests, including end-to-end runs against a real Postgres database. |

There is no browser JavaScript at all. Every page is plain HTML, so it works on old phones and weak connections, and the security policy can block all scripts.

## Run it on your computer

You need [Bun](https://bun.sh) (1.2 or newer) and a Postgres database.

```bash
# 1. Create an empty database, for example:  createdb farmx
export DATABASE_URL=postgres://localhost/farmx
export BASE_URL=http://localhost:3000

# 2. Create your administrator account
bun scripts/create-admin.ts you@example.com "Your Name" "a-long-password"

# 3. Start the site
bun src/server.ts        # then open http://localhost:3000
```

Without Twilio or email keys, messages are recorded (see Admin, Messages sent) and printed to the console, and nothing is sent.

Run the tests (they create and delete a database called `farmx_test`):

```bash
TEST_ADMIN_URL=postgres://user@localhost:5432/postgres bun test
```

## Put it on the internet

Short version for Render: `render.yaml` sets up the app and database. `docs/DEPLOY-RENDER.md` is a step-by-step guide that includes connecting a GoDaddy domain.

You need three things: a place to run the app, a Postgres database, and a domain name.

1. **Database.** Use a managed Postgres service so backups are handled for you. Check that automatic daily backups are on, and practise restoring one.
2. **App.** The included `Dockerfile` works on most hosts (Railway, Render, Fly.io, a small server with Docker). Set the environment variables from `.env.example`. Set `NODE_ENV=production` and `BASE_URL` to your real https address. The host must give you HTTPS.
3. **Administrator.** Set `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` in your host's settings before the first start. The site creates that administrator once, only while none exists. Then delete `ADMIN_INITIAL_PASSWORD` from the settings. If your host has a shell you can run `bun scripts/create-admin.ts` instead. Make a second administrator so you are never locked out.
4. **Domain.** Point your domain at the host. Grenada's country domain is `.gd`. Check the current rules for registering one.
5. **Health check.** Ask your host to watch `/health`. It answers `ok` when the app and database are working.

Run one copy of the app. The sign-in limiter keeps its counts in memory, so with several copies each would count separately. For more than one copy, move that limiter into the database or a cache.

## Turn on text, WhatsApp and email

**Text messages and WhatsApp (Twilio).** Create a Twilio account and buy a number. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, and for WhatsApp `TWILIO_WHATSAPP_FROM`. Two things to check before you rely on this:
- Whether Twilio can deliver to Grenada numbers from your sender, and any registration it requires.
- WhatsApp only allows a business to start a conversation with pre-approved message templates. The messages in `src/engine.ts` will need to be registered as templates with Twilio and Meta, and the code adjusted to send them. Until then, WhatsApp works for testing in Twilio's sandbox but may not reach people in production.

**Email (Resend).** Create an account, verify your sending domain, and set `RESEND_API_KEY` and `MAIL_FROM`. Email is also the fallback when a text fails.

Check Admin, Messages sent after your first real match. "sent" means the provider accepted it. "failed" shows the reason.

## How matching works

- Needs are served in order of earliest deadline, then oldest first. Needs with no deadline go last.
- A need takes the cheapest listings first. Listings without a price come after priced ones.
- A listing priced above a need's maximum is skipped. Expired listings and needs past their deadline are ignored.
- Suggestions are rebuilt after every change. Once either side confirms, a match is held and is not moved.
- A cancelled pair is never suggested again.
- When local supply is short, the Board shows the gap and a ready-to-copy sourcing request for other CARICOM and OECS markets. The site does not contact those markets for you.

## Security notes

- Sessions use a random token stored only as a hash. The cookie is HttpOnly, SameSite and, in production, Secure.
- Every form post must come from this site (origin check).
- All database queries are parameterised. All page output is escaped by default.
- Pages send a strict Content Security Policy that blocks all scripts.
- Contact details are visible only to the two sides of a match and to administrators.
- CSV downloads neutralise spreadsheet formulas.
- Administrator actions are written to the activity log.

## Known limits

- **No email or phone verification at sign-up.** Administrators approve accounts by hand, using the proof people give. A fast way to add more assurance is to confirm by phone call before approving.
- **Password reset is manual.** An administrator issues a temporary password (People, Reset password) and gives it to the person directly.
- **No payments, delivery tracking or product quality checks.** The site only introduces buyers and sellers.
- **English only.**
- **Not yet checked by a lawyer or a security reviewer.** See `docs/LAUNCH-CHECKLIST.md`.
- **Pages have been checked as HTML but not looked at in a browser** during development, so check the layout on a real phone before launch.

## Files

```
src/server.ts        routes, security headers, scheduled matching
src/schema.sql       database tables
src/bootstrap.ts     creates the first administrator from settings
render.yaml          one-click setup for Render
src/matching.ts      the matching rules (pure code, fully tested)
src/engine.ts        stored matches, notifications, match steps
src/notify.ts        Twilio and Resend
src/routes_*.ts      pages
src/legal.ts         draft terms and privacy
public/style.css     the design
scripts/create-admin.ts
tests/               matching tests and end-to-end tests
docs/DEPLOY-RENDER.md
docs/LAUNCH-CHECKLIST.md
```

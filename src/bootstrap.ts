// Creates the first administrator from environment variables, so hosts without a shell still work.
// It only acts when there is no administrator yet, so the variables cannot be used later to take over.
// After the first start, delete ADMIN_INITIAL_PASSWORD from your host's settings.

import { sql, audit } from "./db.ts";
import { hashPassword, passwordProblem } from "./auth.ts";
import { TERMS_VERSION } from "./config.ts";

export async function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? "";
  if (!email || !password) return;

  const [{ n }] = await sql`select count(*)::int as n from users where role = 'admin'`;
  if (n > 0) return;

  const problem = passwordProblem(password, email);
  if (problem) {
    console.error(`ADMIN_INITIAL_PASSWORD was not used: ${problem}`);
    return;
  }
  const hash = await hashPassword(password);
  const name = (process.env.ADMIN_NAME ?? "Administrator").trim() || "Administrator";
  const [row] = await sql`
    insert into users (email, password_hash, role, status, full_name, notify_channel, verification_note, consent_terms_version, consent_at, approved_at)
    values (${email}, ${hash}, 'admin', 'approved', ${name}, 'email', 'Created from ADMIN_EMAIL at first start', ${TERMS_VERSION}, now(), now())
    on conflict (email) do update set role = 'admin', status = 'approved', password_hash = excluded.password_hash, approved_at = now()
    returning id`;
  await audit(row.id, "admin.bootstrap", { email });
  console.log(`Created the first administrator (${email}). Now remove ADMIN_INITIAL_PASSWORD from your settings.`);
}

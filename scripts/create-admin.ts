// Creates an administrator, or turns an existing account into one.
// Usage:  bun scripts/create-admin.ts you@example.com "Your Name" "a-long-password"

import { migrate, sql } from "../src/db.ts";
import { hashPassword, passwordProblem } from "../src/auth.ts";
import { TERMS_VERSION } from "../src/config.ts";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: bun scripts/create-admin.ts you@example.com "Your Name" "a-long-password"');
  process.exit(1);
}
const problem = passwordProblem(password, email);
if (problem) {
  console.error(problem);
  process.exit(1);
}

await migrate();
const hash = await hashPassword(password);
const lower = email.toLowerCase();
const [existing] = await sql`select id from users where email = ${lower}`;
if (existing) {
  await sql`update users set role = 'admin', status = 'approved', password_hash = ${hash}, approved_at = now() where id = ${existing.id}`;
  console.log(`Updated ${lower}: now an approved administrator.`);
} else {
  await sql`insert into users (email, password_hash, role, status, full_name, notify_channel, verification_note, consent_terms_version, consent_at, approved_at)
            values (${lower}, ${hash}, 'admin', 'approved', ${name}, 'email', 'Created by create-admin script', ${TERMS_VERSION}, now(), now())`;
  console.log(`Created administrator ${lower}.`);
}
await sql.close();

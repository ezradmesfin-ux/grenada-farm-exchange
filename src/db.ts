import { SQL } from "bun";
import { env } from "./config.ts";

const url = env.databaseUrl || (!env.production ? "postgres://postgres@127.0.0.1:5433/farmx" : "");
if (!url) throw new Error("DATABASE_URL is not set. See README.md.");

export const sql = new SQL(url);

/** Creates tables if they do not exist yet. Runs on every start. */
export async function migrate() {
  const text = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
  await sql.unsafe(text);
}

export async function audit(actorId: number | null, action: string, detail: Record<string, unknown> = {}) {
  await sql`insert into audit_log (actor_id, action, detail) values (${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb)`;
}

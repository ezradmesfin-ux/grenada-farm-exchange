// Sends text messages, WhatsApp messages and email.
// With no provider keys configured (local development) messages are only written to the
// notifications table and the console, so nothing is sent by accident.

import { sql } from "./db.ts";
import { env } from "./config.ts";

export type Target = {
  id: number;
  email: string;
  phone: string | null;
  notify_channel: "sms" | "whatsapp" | "email" | "none";
};

const smsReady = () => !!(env.twilio.sid && env.twilio.token && env.twilio.smsFrom);
const waReady = () => !!(env.twilio.sid && env.twilio.token && env.twilio.whatsappFrom);
const mailReady = () => !!(env.resend.key && env.resend.from);

async function twilio(to: string, from: string, body: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilio.sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.twilio.sid}:${env.twilio.token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function resend(to: string, subject: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resend.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.resend.from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function record(userId: number, matchId: number | null, channel: string, to: string | null, body: string, status: "logged" | "sent" | "failed", error?: string) {
  await sql`insert into notifications (user_id, match_id, channel, to_address, body, status, error)
            values (${userId}, ${matchId}, ${channel}, ${to}, ${body}, ${status}, ${error ?? null})`;
}

/**
 * Sends one message to one person on the channel they chose.
 * If a text or WhatsApp message fails and email is configured, it falls back to email.
 * Never throws: failures are written to the notifications table.
 */
export async function notifyUser(u: Target, subject: string, body: string, matchId: number | null = null): Promise<void> {
  try {
    const ch = u.notify_channel;
    if (ch === "none") return;

    const text = body.length > 600 ? body.slice(0, 597) + "..." : body;

    const attempt = async (channel: "sms" | "whatsapp" | "email") => {
      if (channel === "email") {
        if (!mailReady()) { await record(u.id, matchId, "email", u.email, text, "logged"); console.log(`[notify:email:dev] ${u.email}: ${subject} | ${text}`); return; }
        await resend(u.email, subject, text);
        await record(u.id, matchId, "email", u.email, text, "sent");
        return;
      }
      if (!u.phone) throw new Error("No phone number on file");
      if (channel === "sms") {
        if (!smsReady()) { await record(u.id, matchId, "sms", u.phone, text, "logged"); console.log(`[notify:sms:dev] ${u.phone}: ${text}`); return; }
        await twilio(u.phone, env.twilio.smsFrom, text);
        await record(u.id, matchId, "sms", u.phone, text, "sent");
        return;
      }
      if (!waReady()) { await record(u.id, matchId, "whatsapp", u.phone, text, "logged"); console.log(`[notify:whatsapp:dev] ${u.phone}: ${text}`); return; }
      await twilio(`whatsapp:${u.phone}`, `whatsapp:${env.twilio.whatsappFrom.replace(/^whatsapp:/, "")}`, text);
      await record(u.id, matchId, "whatsapp", u.phone, text, "sent");
    };

    try {
      await attempt(ch);
    } catch (err) {
      await record(u.id, matchId, ch, ch === "email" ? u.email : u.phone, text, "failed", String((err as Error).message));
      if (ch !== "email" && mailReady()) {
        try { await attempt("email"); } catch (e2) {
          await record(u.id, matchId, "email", u.email, text, "failed", String((e2 as Error).message));
        }
      }
    }
  } catch (err) {
    console.error("notifyUser failed", err);
  }
}

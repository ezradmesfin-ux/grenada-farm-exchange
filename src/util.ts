// Small helpers: safe HTML templating, CSV, validation.

/** Marks a string as already-safe HTML. Only used for output of `html` and a few constants. */
export class Raw {
  constructor(public value: string) {}
  toString() { return this.value; }
}
export const raw = (s: string) => new Raw(s);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/**
 * Tagged template that escapes every interpolated value unless it came from another `html` call.
 * Arrays are joined. null, undefined and false render as nothing.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}
function render(v: unknown): string {
  if (v == null || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
}

export const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
export const fmtKg = (v: unknown) => `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
export const fmtMoney = (v: unknown) => (v == null || v === "" ? "-" : `EC$${Number(v).toFixed(2)}`);
export const fmtDate = (v: unknown) => {
  if (!v) return "-";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
};
export const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------- CSV ----------
/** Quotes a cell and neutralises spreadsheet formulas (cells starting with = + - @). */
function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Phone numbers and plain numbers are safe as they are.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const head = columns.map(csvCell).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

// ---------- validation ----------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Accepts local Grenada numbers and international numbers, returns +E.164 or null.
 *  7 digits           -> +1473xxxxxxx
 *  10 digits (473...) -> +1473xxxxxxx
 *  11 digits (1473...)-> +1473xxxxxxx
 *  +<country><number> -> unchanged when 8 to 15 digits
 */
export function normalisePhone(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
  if (digits.length === 7) return "+1473" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

export function clean(v: FormDataEntryValue | null | undefined, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function parsePositive(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}
export function parseOptionalMoney(v: string): number | null | "bad" {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e6 ? Math.round(n * 100) / 100 : "bad";
}
export function parseDate(v: string): string | null | "bad" {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "bad";
}

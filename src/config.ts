// Shared constants and environment settings.

export const PRODUCTS = [
  "Nutmeg", "Mace", "Cocoa", "Bananas", "Plantains", "Tomatoes", "Sweet peppers", "Hot peppers",
  "Cabbage", "Carrots", "Cucumbers", "Callaloo", "Pumpkin", "Dasheen", "Sweet potato",
  "Breadfruit", "Mango", "Soursop", "Limes", "Pineapple", "Other",
] as const;

export const PARISHES = [
  "St. George", "St. John", "St. Mark", "St. Patrick", "St. Andrew", "St. David",
  "Carriacou", "Petite Martinique",
] as const;

// Countries named as possible sources or markets when local supply falls short.
export const MARKETS = [
  "Trinidad & Tobago", "Barbados", "St. Vincent & the Grenadines", "St. Lucia",
  "Dominica", "Antigua & Barbuda", "Guyana",
] as const;

export const BUYER_TYPES = [
  "Supermarket or shop", "Processor", "Exporter", "School or institution", "Co-operative", "Other",
] as const;

export const ROLE_LABEL: Record<string, string> = {
  farmer: "Farmer",
  government: "Government",
  hotel: "Hotel or restaurant",
  buyer: "Other buyer",
  admin: "Administrator",
};

// Roles a person may ask for when they sign up. Admin is never self-service.
export const SIGNUP_ROLES = ["farmer", "government", "hotel", "buyer"] as const;
export const BUYER_ROLES = ["government", "hotel", "buyer"] as const;

export const CHANNELS = ["sms", "whatsapp", "email", "none"] as const;

// Bump this whenever terms.ts or privacy.ts change in a way that needs fresh consent.
export const TERMS_VERSION = "2026-10-draft-1";

export const env = {
  production: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 3000),
  baseUrl: (process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID ?? "",
    token: process.env.TWILIO_AUTH_TOKEN ?? "",
    smsFrom: process.env.TWILIO_SMS_FROM ?? "",
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "",
  },
  resend: {
    key: process.env.RESEND_API_KEY ?? "",
    from: process.env.MAIL_FROM ?? "",
  },
  contactEmail: process.env.CONTACT_EMAIL ?? "contact@example.gd",
  operatorName: process.env.OPERATOR_NAME ?? "[Operator name]",
};

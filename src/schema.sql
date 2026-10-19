-- Grenada Farm Exchange database schema.
-- Safe to run more than once: every statement uses IF NOT EXISTS.
-- Access control lives in the application (src/server.ts and friends); the
-- database is never exposed directly to browsers.

create table if not exists users (
  id                    serial primary key,
  email                 text        not null unique,          -- always stored lower-case
  password_hash         text        not null,
  role                  text        not null check (role in ('farmer','government','hotel','buyer','admin')),
  status                text        not null default 'pending'
                          check (status in ('pending','approved','suspended','rejected','deleted')),
  full_name             text        not null,
  organisation          text,                                  -- farm, hotel, agency or business name
  buyer_type            text,                                  -- only for role 'buyer'
  parish                text,
  phone                 text,                                  -- international format, e.g. +14735551234
  notify_channel        text        not null default 'sms'
                          check (notify_channel in ('sms','whatsapp','email','none')),
  verification_note     text,                                  -- farmer ID, licence number or staff ID given at signup
  consent_terms_version text        not null,
  consent_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  approved_at           timestamptz,
  approved_by           integer references users(id)
);
create index if not exists users_status_idx on users (status, created_at);

create table if not exists sessions (
  token_hash text primary key,                                 -- SHA-256 of the cookie value
  user_id    integer      not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists listings (
  id              serial primary key,
  farmer_id       integer        not null references users(id),
  product         text          not null,
  qty_kg          numeric(12,2) not null check (qty_kg > 0),
  price_ec        numeric(10,2) check (price_ec is null or price_ec >= 0),   -- EC$ per kg, optional
  parish          text,
  available_until date,
  notes           text,
  status          text          not null default 'active' check (status in ('active','withdrawn','removed')),
  created_at      timestamptz   not null default now()
);
create index if not exists listings_open_idx on listings (product, status);

create table if not exists needs (
  id           serial primary key,
  buyer_id     integer        not null references users(id),
  product      text          not null,
  qty_kg       numeric(12,2) not null check (qty_kg > 0),
  max_price_ec numeric(10,2) check (max_price_ec is null or max_price_ec >= 0),
  needed_by    date,
  note         text,
  status       text          not null default 'open' check (status in ('open','closed','removed')),
  created_at   timestamptz   not null default now()
);
create index if not exists needs_open_idx on needs (product, status);

create table if not exists matches (
  id          serial primary key,
  need_id     integer        not null references needs(id),
  listing_id  integer        not null references listings(id),
  qty_kg      numeric(12,2) not null check (qty_kg > 0),
  status      text          not null default 'suggested'
                check (status in ('suggested','agreed','completed','cancelled')),
  farmer_ok   boolean       not null default false,
  buyer_ok    boolean       not null default false,
  notified_at timestamptz,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);
-- One live match per need and listing pair. Cancelled matches may repeat.
create unique index if not exists matches_live_pair_idx
  on matches (need_id, listing_id) where status <> 'cancelled';

create table if not exists notifications (
  id         serial primary key,
  user_id    integer      not null references users(id),
  match_id   integer      references matches(id) on delete set null,
  channel    text        not null,
  to_address text,
  body       text        not null,
  status     text        not null check (status in ('logged','sent','failed')),
  error      text,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id         serial primary key,
  actor_id   integer references users(id),
  action     text        not null,
  detail     jsonb       not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on audit_log (created_at desc);

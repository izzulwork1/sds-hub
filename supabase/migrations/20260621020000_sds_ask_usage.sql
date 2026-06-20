-- Rate-limit log for the public end-user Q&A endpoint (POST /v1/ask).
-- Each accepted question inserts one row keyed by a salted hash of the client IP.
-- Only the Edge Function service role touches this table; RLS denies all other
-- roles (the browser anon/auth roles have no access). The Q&A endpoint fails open
-- if this table is missing, so deploying it is safe in any order.

create table if not exists public.sds_ask_usage (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists sds_ask_usage_ip_created_idx
  on public.sds_ask_usage (ip_hash, created_at desc);

alter table public.sds_ask_usage enable row level security;

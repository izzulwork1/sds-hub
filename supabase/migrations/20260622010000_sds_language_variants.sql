-- SDS language-variant grouping (additive). Each existing sds_documents row becomes a language
-- variant; canonical product identity moves to sds_records. Existing rows, approved URLs, the public
-- catalog query, and RLS are preserved. sds_record_id stays NULL until EHS groups a document, so the
-- current catalog (status = 'Approved') keeps working unchanged.

create table if not exists public.sds_records (
  id uuid primary key default gen_random_uuid(),
  canonical_product_name text not null,
  normalized_product_name text not null,
  product_code text,
  supplier_or_manufacturer text,
  cas_summary text,
  current_group_status text not null default 'active'
    check (current_group_status in ('active', 'superseded', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_sds_records_normalized on public.sds_records (normalized_product_name);

create table if not exists public.sds_department_links (
  id uuid primary key default gen_random_uuid(),
  sds_record_id uuid not null references public.sds_records(id) on delete cascade,
  department text not null,
  created_at timestamptz not null default now(),
  unique (sds_record_id, department)
);
create index if not exists idx_sds_department_links_record on public.sds_department_links (sds_record_id);

-- Language + variant columns on the existing documents table (which now also serves as variants).
alter table public.sds_documents
  add column if not exists sds_record_id uuid references public.sds_records(id) on delete set null,
  add column if not exists document_language text
    check (document_language in ('en', 'ms', 'bilingual', 'unknown')) default 'unknown',
  add column if not exists language_confidence integer check (language_confidence between 0 and 100),
  add column if not exists language_detection_reason text,
  add column if not exists language_variant_of uuid references public.sds_documents(id) on delete set null,
  add column if not exists language_variant_status text
    check (language_variant_status in ('unlinked', 'suggested', 'linked', 'separate')) default 'unlinked',
  add column if not exists is_bilingual boolean not null default false,
  add column if not exists supersedes_document_id uuid references public.sds_documents(id) on delete set null,
  add column if not exists approved_for_employee_view boolean not null default false;

create index if not exists idx_sds_documents_record on public.sds_documents (sds_record_id);
create index if not exists idx_sds_documents_language on public.sds_documents (document_language);

alter table public.sds_records enable row level security;
alter table public.sds_department_links enable row level security;
revoke all on public.sds_records from anon, authenticated;
revoke all on public.sds_department_links from anon, authenticated;
grant all on public.sds_records to service_role;
grant all on public.sds_department_links to service_role;

-- Preserve the current public catalog: every already-approved, live document is employee-viewable.
update public.sds_documents
set approved_for_employee_view = true
where status = 'Approved' and deleted_at is null and archived_at is null and approved_for_employee_view = false;

-- 16-section completeness (DOSH Malaysia CLASS Regulations 2013). The Edge Function
-- scans the full PDF text for each mandatory section header in English and Bahasa
-- Malaysia and records which were found and which are missing. A non-empty
-- missing_sections marks the SDS incomplete and is raised during EHS review.

alter table public.sds_documents
  add column if not exists sections_found jsonb not null default '[]'::jsonb,
  add column if not exists missing_sections jsonb not null default '[]'::jsonb;

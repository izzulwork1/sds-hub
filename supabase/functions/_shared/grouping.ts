// SDS language-variant grouping logic (pure, DB-free, unit-testable).
// Decides how an incoming SDS relates to an existing one so EHS can group language
// variants of the SAME product/revision under one canonical record — without ever
// merging genuinely different products or hiding a different revision.

export type SdsRelationship = "exact_duplicate" | "language_variant" | "different_revision" | "unrelated";

export interface GroupingDoc {
  id?: string | null;
  product_name?: string | null;
  trade_name?: string | null;
  supplier?: string | null;
  manufacturer?: string | null;
  product_code?: string | null;
  document_language?: string | null; // 'en' | 'ms' | 'bilingual' | 'unknown'
  cas_numbers?: string[] | null;
  file_hash?: string | null;
  revision_date?: string | null;
  issue_date?: string | null;
  preparation_date?: string | null;
  effective_date?: string | null;
}

export interface RelationshipResult {
  relationship: SdsRelationship;
  confidence: number;
  reasons: string[];
  warnings: string[];
}

export interface GroupingSuggestion extends RelationshipResult {
  candidateId: string | null;
  candidateLanguage: string | null;
  candidateProductName: string | null;
}

// Canonical product identity for sds_records.normalized_product_name and matching.
export function normalizeProductName(value: unknown): string {
  return String(value ?? "").toLowerCase()
    .replace(/\b(?:m?sds|safety data sheet|material safety data sheet|helaian data keselamatan)\b/g, " ")
    .replace(/\.(?:pdf|docx?)$/i, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Normalise a company name so "UNASCO (M) Sdn. Bhd." and "Unasco M Sdn Bhd" match.
export function normalizeOrg(value: unknown): string {
  return String(value ?? "").toLowerCase()
    .replace(/\b(?:sdn|bhd|berhad|inc|ltd|llc|co|company|corp|corporation|gmbh|pte|plc|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function identityName(doc: GroupingDoc): string {
  return normalizeProductName(doc.product_name) || normalizeProductName(doc.trade_name);
}

function meaningfulTokens(normalized: string): string[] {
  return normalized.split(" ").filter((token) => token.length >= 3);
}

function casSet(doc: GroupingDoc): Set<string> {
  const values = Array.isArray(doc.cas_numbers) ? doc.cas_numbers : [];
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

// Effective revision date for "same SDS vs different revision": revision wins, then issue/prep/effective.
function effectiveDate(doc: GroupingDoc): string {
  return String(doc.revision_date || doc.effective_date || doc.issue_date || doc.preparation_date || "").trim();
}

function language(doc: GroupingDoc): string {
  const value = String(doc.document_language || "").toLowerCase();
  return ["en", "ms", "bilingual"].includes(value) ? value : "unknown";
}

// Same canonical product? Names align (equal / containment / shared meaningful token / shared code)
// or they share a CAS number. Returns a 0-1 strength used to scale confidence.
function productIdentityStrength(a: GroupingDoc, b: GroupingDoc): number {
  const na = identityName(a); const nb = identityName(b);
  let nameScore = 0;
  if (na && nb) {
    if (na === nb) nameScore = 1;
    else if (na.includes(nb) || nb.includes(na)) nameScore = 0.8;
    else {
      const tokensB = new Set(meaningfulTokens(nb));
      if (meaningfulTokens(na).some((token) => tokensB.has(token))) nameScore = 0.55;
    }
  }
  const codeA = String(a.product_code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const codeB = String(b.product_code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const codeMatch = codeA && codeB && codeA === codeB ? 1 : 0;
  const casA = casSet(a); const casB = casSet(b);
  const casOverlap = [...casA].some((value) => casB.has(value)) ? 0.5 : 0;
  return Math.min(1, Math.max(nameScore, codeMatch, nameScore ? nameScore + casOverlap : casOverlap));
}

function sameLanguage(a: string, b: string): boolean {
  // An unknown language can't be asserted as different, so don't propose a variant link
  // against a not-yet-classified document — fall through to the duplicate/revision check.
  if (a === "unknown" || b === "unknown") return true;
  return a === b;
}

// Classify how `incoming` relates to one `candidate`.
export function evaluateRelationship(incoming: GroupingDoc, candidate: GroupingDoc): RelationshipResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const identity = productIdentityStrength(incoming, candidate);
  if (identity < 0.5) {
    return { relationship: "unrelated", confidence: 0, reasons: ["Product identity does not match"], warnings: [] };
  }
  reasons.push(identity >= 1 ? "Same product name" : "Product identity matches (name/code/CAS)");

  const orgA = normalizeOrg(incoming.supplier) || normalizeOrg(incoming.manufacturer);
  const orgB = normalizeOrg(candidate.supplier) || normalizeOrg(candidate.manufacturer);
  let orgScore = 0;
  if (orgA && orgB) {
    if (orgA === orgB || orgA.includes(orgB) || orgB.includes(orgA)) { orgScore = 1; reasons.push("Same supplier/manufacturer"); }
    else { orgScore = -1; warnings.push("Supplier/manufacturer differs between the two documents"); }
  }

  const hashA = String(incoming.file_hash || "").trim();
  const hashB = String(candidate.file_hash || "").trim();
  if (hashA && hashB && hashA === hashB) {
    return { relationship: "exact_duplicate", confidence: 100, reasons: [...reasons, "Identical file content (same hash)"], warnings };
  }

  const langA = language(incoming); const langB = language(candidate);
  const dateA = effectiveDate(incoming); const dateB = effectiveDate(candidate);

  // Confidence from identity + org agreement.
  let confidence = Math.round(identity * 70) + (orgScore > 0 ? 20 : orgScore < 0 ? -25 : 5);
  confidence = Math.max(20, Math.min(99, confidence));

  if (sameLanguage(langA, langB)) {
    if (dateA && dateB && dateA !== dateB) {
      reasons.push(`Same language (${langA}) but different revision date (${dateA} vs ${dateB})`);
      return { relationship: "different_revision", confidence, reasons, warnings };
    }
    reasons.push(`Same language (${langA}) and same revision`);
    return { relationship: "exact_duplicate", confidence, reasons, warnings };
  }

  // Different languages -> language variant of the same SDS.
  reasons.push(`Different language (${langA} vs ${langB}) — likely a language variant of the same SDS`);
  if (dateA && dateB && dateA !== dateB) {
    warnings.push(`Language versions may not be based on the same revision (${langA}: ${dateA} vs ${langB}: ${dateB})`);
  }
  return { relationship: "language_variant", confidence, reasons, warnings };
}

const RELATIONSHIP_RANK: Record<SdsRelationship, number> = {
  exact_duplicate: 3, language_variant: 2, different_revision: 1, unrelated: 0
};

// Pick the strongest relationship across candidates (prefer duplicate > variant > revision, then confidence).
export function suggestGrouping(incoming: GroupingDoc, candidates: GroupingDoc[]): GroupingSuggestion {
  let best: GroupingSuggestion = {
    relationship: "unrelated", confidence: 0, reasons: [], warnings: [],
    candidateId: null, candidateLanguage: null, candidateProductName: null
  };
  for (const candidate of candidates || []) {
    if (candidate.id && incoming.id && candidate.id === incoming.id) continue;
    const result = evaluateRelationship(incoming, candidate);
    if (result.relationship === "unrelated") continue;
    const better = RELATIONSHIP_RANK[result.relationship] > RELATIONSHIP_RANK[best.relationship]
      || (RELATIONSHIP_RANK[result.relationship] === RELATIONSHIP_RANK[best.relationship] && result.confidence > best.confidence);
    if (better) {
      best = {
        ...result,
        candidateId: candidate.id ?? null,
        candidateLanguage: language(candidate),
        candidateProductName: candidate.product_name ?? candidate.trade_name ?? null
      };
    }
  }
  return best;
}

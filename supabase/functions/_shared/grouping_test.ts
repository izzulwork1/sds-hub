import { evaluateRelationship, normalizeOrg, normalizeProductName, suggestGrouping } from "./grouping.ts";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("normalizes product + org identity for matching", () => {
  equal(normalizeProductName("TAMCO SIGNAL RED (SDS).pdf"), "tamco signal red", "strip SDS/extension");
  equal(normalizeOrg("UNASCO (M) Sdn. Bhd."), "unasco m", "strip company suffixes");
});

Deno.test("same product, different language, same revision -> language variant", () => {
  const en = { product_name: "Tamco Signal Red", supplier: "Kansai Paint", document_language: "en", revision_date: "2023-01-10" };
  const ms = { product_name: "Tamco Signal Red", supplier: "Kansai Paint", document_language: "ms", revision_date: "2023-01-10" };
  const result = evaluateRelationship(en, ms);
  equal(result.relationship, "language_variant", "language variant");
  equal(result.warnings, [], "no version-mismatch warning when revisions match");
});

Deno.test("language variant with mismatched revisions warns EHS", () => {
  const en = { product_name: "Thinner 457", manufacturer: "KTH", document_language: "en", revision_date: "2023-05-01" };
  const ms = { product_name: "Thinner 457", manufacturer: "KTH", document_language: "ms", revision_date: "2021-02-01" };
  const result = evaluateRelationship(en, ms);
  equal(result.relationship, "language_variant", "still a variant");
  if (!result.warnings.some((w) => /may not be based on the same revision/i.test(w))) {
    throw new Error("expected a version-mismatch warning");
  }
});

Deno.test("same product + same language + different date -> different revision", () => {
  const a = { product_name: "Acetone", supplier: "ChemCo", document_language: "en", revision_date: "2024-01-01" };
  const b = { product_name: "Acetone", supplier: "ChemCo", document_language: "en", revision_date: "2020-01-01" };
  equal(evaluateRelationship(a, b).relationship, "different_revision", "different revision");
});

Deno.test("identical file hash -> exact duplicate at full confidence", () => {
  const a = { product_name: "Acetone", document_language: "en", file_hash: "abc123" };
  const b = { product_name: "Acetone", document_language: "ms", file_hash: "abc123" };
  const result = evaluateRelationship(a, b);
  equal(result.relationship, "exact_duplicate", "duplicate by hash");
  equal(result.confidence, 100, "full confidence");
});

Deno.test("different products are unrelated", () => {
  const a = { product_name: "Nitric Acid 68%", supplier: "ChemCo", document_language: "en" };
  const b = { product_name: "Tamco Signal Red", supplier: "Kansai", document_language: "ms" };
  equal(evaluateRelationship(a, b).relationship, "unrelated", "unrelated products");
});

Deno.test("suggestGrouping picks the best candidate and skips self", () => {
  const incoming = { id: "new", product_name: "Tamco Signal Red", supplier: "Kansai Paint", document_language: "ms", revision_date: "2023-01-10" };
  const candidates = [
    { id: "new", product_name: "Tamco Signal Red", document_language: "ms" }, // self, must be skipped
    { id: "other", product_name: "Acetone", document_language: "en" },
    { id: "en-variant", product_name: "Tamco Signal Red", supplier: "Kansai Paint", document_language: "en", revision_date: "2023-01-10" }
  ];
  const suggestion = suggestGrouping(incoming, candidates);
  equal(suggestion.relationship, "language_variant", "variant chosen");
  equal(suggestion.candidateId, "en-variant", "matched the EN variant, not self/other");
});

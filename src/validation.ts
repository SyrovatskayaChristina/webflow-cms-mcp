import type { WebflowCollection } from "./webflowClient.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a proposed fieldData payload against a collection's *live*
 * schema (fetched from Webflow, not a hardcoded copy) before writing.
 *
 * This mirrors a real lesson from a production content pipeline: letting
 * an LLM free-write field names drifts from the CMS schema over time
 * (fields get renamed, split, or merged). Checking against the live
 * schema on every write catches that drift before it reaches the CMS,
 * rather than silently dropping or mismapping fields.
 */
export function validateFieldData(
  collection: WebflowCollection,
  fieldData: Record<string, unknown>,
  options: { isUpdate?: boolean } = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const knownSlugs = new Set(collection.fields.map((f) => f.slug));

  // Unknown fields: likely a hallucinated or stale field name.
  for (const key of Object.keys(fieldData)) {
    if (key === "slug" || key === "name") continue; // Webflow's built-in fields
    if (!knownSlugs.has(key)) {
      errors.push(
        `Field "${key}" is not in the live schema for collection "${collection.displayName}". ` +
          `Known fields: ${[...knownSlugs].join(", ")}`
      );
    }
  }

  // Required fields: only enforced on create, since an update may be a
  // deliberate partial patch.
  if (!options.isUpdate) {
    for (const field of collection.fields) {
      if (field.isRequired && field.slug !== "slug" && field.slug !== "name") {
        if (!(field.slug in fieldData) || fieldData[field.slug] === undefined) {
          errors.push(
            `Missing required field "${field.slug}" (${field.displayName})`
          );
        }
      }
    }
    if (!("slug" in fieldData) && !("name" in fieldData)) {
      warnings.push(
        "Neither 'slug' nor 'name' was provided — Webflow requires both on create."
      );
    }
  }

  // Non-editable fields: writes to these are likely to be rejected by
  // Webflow anyway, so flag them early with a clearer message.
  for (const key of Object.keys(fieldData)) {
    const field = collection.fields.find((f) => f.slug === key);
    if (field && !field.isEditable) {
      warnings.push(`Field "${key}" is marked non-editable in the schema.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Builds a ready-to-fill fieldData skeleton from a collection's live schema:
 * every field slug as a key, with a placeholder hinting at its type and
 * whether it's required. Meant to be copy-pasted into create_item/update_item
 * and have the placeholders replaced with real values — so the caller (human
 * or agent) doesn't have to hand-build the object by cross-referencing
 * get_collection_schema's output themselves.
 */
export function buildFieldDataTemplate(
  collection: WebflowCollection
): Record<string, string> {
  const template: Record<string, string> = {};
  for (const field of collection.fields) {
    if (!field.isEditable) continue; // can't be written anyway, skip it
    const requiredTag = field.isRequired ? "required" : "optional";
    template[field.slug] = `<${field.type}, ${requiredTag}>`;
  }
  return template;
}

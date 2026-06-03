/**
 * Normalizes upstream media values (comma-separated strings or edge arrays)
 * into a flat list of URLs.
 */
export function parseMediaList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseMediaList(item));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

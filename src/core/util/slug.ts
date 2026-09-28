/**
 * Turn an arbitrary title into a filesystem-safe slug for the output folder. Titles with no
 * Latin letters or digits (Japanese, Russian, …) slug to nothing, so the caller supplies a
 * `fallback` that is unique per video; otherwise every such video would share one folder and
 * overwrite each other's documents.
 */
export function slugify(input: string, fallback: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

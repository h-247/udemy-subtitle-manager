import type { SitesDatabase } from "../../db";

export function normalizeCourseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError("Tags must be a list of up to 12 names.");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new TypeError("Each tag must be text.");
    const tag = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (Array.from(tag).length > 32 || /[,\p{Cc}]/u.test(tag)) throw new TypeError("Tags must be 1–32 characters, without commas or control characters.");
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); result.push(tag);
    if (result.length > 12) throw new TypeError("Use up to 12 tags per course.");
  }
  return result;
}

export async function saveCourseTags(database: SitesDatabase, userId: number, courseId: number, input: unknown) {
  const tags = normalizeCourseTags(input);
  const row = await database.prepare("UPDATE courses SET tags_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? RETURNING tags_json")
    .bind(JSON.stringify(tags), courseId, userId).first<{ tags_json: string }>();
  return row ? tags : null;
}

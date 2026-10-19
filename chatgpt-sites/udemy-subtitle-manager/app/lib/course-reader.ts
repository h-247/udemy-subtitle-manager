type Row = Record<string, any>;

export async function loadCourseRows(database: D1Database, ids: number[]) {
  if (!ids.length) return { sections: [], lectures: [], subtitles: [] };
  const placeholders = ids.map(() => "?").join(",");
  const [sections, lectures, subtitles] = await database.batch<Row>([
    database.prepare(`SELECT * FROM sections WHERE course_id IN (${placeholders}) ORDER BY position,id`).bind(...ids),
    database.prepare(`SELECT l.* FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id IN (${placeholders}) ORDER BY s.position,s.id,l.position,l.id`).bind(...ids),
    database.prepare(`SELECT sub.* FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id WHERE s.course_id IN (${placeholders}) ORDER BY sub.id`).bind(...ids),
  ]);
  return { sections: sections.results, lectures: lectures.results, subtitles: subtitles.results };
}

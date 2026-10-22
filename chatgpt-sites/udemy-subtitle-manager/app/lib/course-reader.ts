import type { SitesDatabase } from "../../db";

type Row = Record<string, any>;

export async function loadCourseRows(database: SitesDatabase, ids: number[]): Promise<{
  sections: Row[];
  lectures: Row[];
  subtitles: Row[];
}> {
  if (!ids.length) return { sections: [], lectures: [], subtitles: [] };
  const placeholders = ids.map(() => "?").join(",");
  const [sections, lectures, subtitles] = await database.batch<Row>([
    database.prepare(`SELECT * FROM sections WHERE course_id IN (${placeholders}) ORDER BY position,id`).bind(...ids),
    database.prepare(`SELECT l.id,l.section_id,l.lecture_id,l.title,l.url,l.lecture_type,l.duration,l.position,l.learning_status,l.chatgpt_url FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id IN (${placeholders}) ORDER BY s.position,s.id,l.position,l.id`).bind(...ids),
    database.prepare(`SELECT sub.* FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id WHERE s.course_id IN (${placeholders}) ORDER BY sub.id`).bind(...ids),
  ]);
  return { sections: sections.results, lectures: lectures.results, subtitles: subtitles.results };
}

// Dashboard cards need counts and one next lecture, never a course's full curriculum.
export async function loadCourseSummaries(database: SitesDatabase, ids: number[]): Promise<Map<number, Row>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await database.prepare(`SELECT c.id,
      (SELECT COUNT(*) FROM sections s WHERE s.course_id=c.id) AS total_sections,
      (SELECT COUNT(*) FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id) AS total_lectures,
      (SELECT COUNT(*) FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id AND l.learning_status='COMPLETED') AS completed_lectures,
      (SELECT COUNT(*) FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id AND l.lecture_type='video') AS subtitle_eligible_lectures,
      (SELECT COUNT(DISTINCT l.id) FROM lectures l JOIN sections s ON s.id=l.section_id JOIN subtitles sub ON sub.lecture_id=l.id WHERE s.course_id=c.id AND l.lecture_type='video' AND sub.status='COMPLETED') AS processed_subtitles,
      (SELECT COUNT(DISTINCT l.id) FROM lectures l JOIN sections s ON s.id=l.section_id JOIN subtitles sub ON sub.lecture_id=l.id WHERE s.course_id=c.id AND l.lecture_type='video' AND sub.status='FAILED' AND NOT EXISTS (SELECT 1 FROM subtitles done WHERE done.lecture_id=l.id AND done.status='COMPLETED')) AS failed_subtitles,
      (SELECT COUNT(*) FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id AND sub.drive_status='FAILED') AS drive_sync_failed,
      nl.id AS next_id,nl.section_id AS next_section_id,nl.lecture_id AS next_lecture_id,nl.title AS next_title,nl.url AS next_url,
      nl.lecture_type AS next_type,nl.duration AS next_duration,nl.position AS next_position,nl.learning_status AS next_learning_status,
      nl.chatgpt_url AS next_chatgpt_url,ns.title AS next_section_title,ns.position AS next_section_position
    FROM courses c
    LEFT JOIN lectures nl ON nl.id=(SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id AND l.learning_status IN ('IN_PROGRESS','NOT_STARTED') ORDER BY CASE l.learning_status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END,s.position,s.id,l.position,l.id LIMIT 1)
    LEFT JOIN sections ns ON ns.id=nl.section_id
    WHERE c.id IN (${placeholders})`).bind(...ids).all<Row>();
  const summaries = new Map<number, Row>();
  const nextIds: number[] = [];
  for (const row of rows.results) {
    const id = Number(row.id);
    summaries.set(id, {
      total_sections: Number(row.total_sections), total_lectures: Number(row.total_lectures),
      completed_lectures: Number(row.completed_lectures), subtitle_eligible_lectures: Number(row.subtitle_eligible_lectures),
      processed_subtitles: Number(row.processed_subtitles), failed_subtitles: Number(row.failed_subtitles),
      drive_sync_failed: Number(row.drive_sync_failed), next_lecture: null, next_lecture_section: null,
    });
    if (row.next_id != null) {
      const summary = summaries.get(id)!;
      summary.next_lecture = { id: Number(row.next_id), section_id: Number(row.next_section_id), lecture_id: String(row.next_lecture_id),
        title: row.next_title, url: row.next_url, lecture_type: row.next_type, duration: Number(row.next_duration || 0),
        position: Number(row.next_position), learning_status: row.next_learning_status, chatgpt_url: row.next_chatgpt_url ?? null, subtitles: [] };
      summary.next_lecture_section = { id: Number(row.next_section_id), title: row.next_section_title, position: Number(row.next_section_position) };
      nextIds.push(Number(row.next_id));
    }
  }
  if (nextIds.length) {
    const marks = nextIds.map(() => "?").join(",");
    const subtitles = await database.prepare(`SELECT * FROM subtitles WHERE lecture_id IN (${marks}) ORDER BY id`).bind(...nextIds).all<Row>();
    const byLecture = new Map<number, Row[]>();
    for (const subtitle of subtitles.results) {
      const list = byLecture.get(Number(subtitle.lecture_id)) ?? [];
      list.push(subtitle); byLecture.set(Number(subtitle.lecture_id), list);
    }
    for (const summary of summaries.values()) if (summary.next_lecture) summary.next_lecture.subtitles = byLecture.get(summary.next_lecture.id) ?? [];
  }
  return summaries;
}

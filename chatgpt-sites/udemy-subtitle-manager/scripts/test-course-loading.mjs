import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { loadCourseRows, loadCourseSummaries } from "../app/lib/course-reader.ts";
globalThis.__testZod = z;

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE sections (id INTEGER,course_id INTEGER,title TEXT,position INTEGER);
CREATE TABLE lectures (id INTEGER,section_id INTEGER,lecture_id TEXT,title TEXT,position INTEGER,learning_status TEXT);
CREATE TABLE subtitles (id INTEGER,lecture_id INTEGER,status TEXT);
CREATE TABLE courses (id INTEGER,user_id INTEGER,course_id TEXT,title TEXT,url TEXT,tags_json TEXT,instructor TEXT,thumbnail_url TEXT,last_synced_at TEXT,created_at TEXT);
INSERT INTO sections VALUES (1,1,'First',1),(2,1,'Second',2),(3,2,'Other course',1);
INSERT INTO lectures VALUES (1,1,'1','Done',1,'COMPLETED'),(2,1,'2','Next',2,'NOT_STARTED'),(3,2,'3','Current',1,'IN_PROGRESS'),(4,3,'4','Private',1,'NOT_STARTED');
INSERT INTO subtitles VALUES (1,1,'COMPLETED'),(2,3,'FAILED'),(3,4,'COMPLETED');`);
sqlite.exec("ALTER TABLE lectures ADD COLUMN lecture_type TEXT NOT NULL DEFAULT 'video'");
sqlite.exec("ALTER TABLE lectures ADD COLUMN url TEXT; ALTER TABLE lectures ADD COLUMN duration INTEGER; ALTER TABLE lectures ADD COLUMN chatgpt_url TEXT; ALTER TABLE lectures ADD COLUMN captions_json TEXT");
sqlite.exec("ALTER TABLE subtitles ADD COLUMN drive_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'; ALTER TABLE subtitles ADD COLUMN drive_error TEXT; ALTER TABLE subtitles ADD COLUMN caption_language TEXT; ALTER TABLE subtitles ADD COLUMN subtitle_type TEXT; ALTER TABLE subtitles ADD COLUMN storage_key TEXT; ALTER TABLE subtitles ADD COLUMN drive_file_id TEXT; ALTER TABLE subtitles ADD COLUMN drive_file_url TEXT; ALTER TABLE subtitles ADD COLUMN error_message TEXT; ALTER TABLE subtitles ADD COLUMN error_category TEXT; ALTER TABLE subtitles ADD COLUMN last_processed_at TEXT");
sqlite.exec("CREATE INDEX sections_course_position_idx ON sections(course_id,position,id); CREATE INDEX lectures_section_status_order_idx ON lectures(section_id,learning_status,position,id); CREATE INDEX lectures_section_type_idx ON lectures(section_id,lecture_type,learning_status); CREATE INDEX subtitles_lecture_status_idx ON subtitles(lecture_id,status,drive_status)");
sqlite.prepare("UPDATE lectures SET captions_json=?").run('x'.repeat(100000));
let statements = 0, batches = 0, returnedRows = 0, executedSql = [];
const database = {
  prepare(sql) { return { bind(...ids) { return {sql,ids}; } }; },
  async batch(queries) { batches++; statements += queries.length; return queries.map(({sql,ids}) => { executedSql.push(sql); const results=sqlite.prepare(sql).all(...ids); returnedRows+=results.length; return {results}; }); },
  async allQuery(query) { executedSql.push(query.sql); const results=sqlite.prepare(query.sql).all(...query.ids); returnedRows+=results.length; return {results}; },
};
database.prepare = (sql) => ({ bind(...ids) { return {sql,ids,async all(){executedSql.push(sql);const results=sqlite.prepare(sql).all(...ids);returnedRows+=results.length;return {results};}}; }, async all() { const results=sqlite.prepare(sql).all(); returnedRows+=results.length; executedSql.push(sql); return {results}; } });
const source = readFileSync(new URL("../app/lib/api-worker.ts",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"");
const js = ts.transpileModule("const z=globalThis.__testZod;\n"+source+"\nexport { courseRead };",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {courseRead} = await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const data = await loadCourseRows(database,[1]);
assert.equal(data.lectures.some(lecture=>"captions_json" in lecture),false,"UI queries must not transfer cached signed caption payloads");
const detail = await courseRead({id:1,course_id:'course-1',title:'Course'},true,data);
assert.equal(detail.total_sections,2);
assert.equal(detail.total_lectures,3);
assert.equal(detail.subtitle_eligible_lectures,3);
assert.equal(detail.next_lecture_section.id,2);
assert.equal(detail.completed_lectures,1);
assert.equal(detail.processed_subtitles,1);
assert.equal(detail.failed_subtitles,1);
assert.equal(detail.next_lecture.id,3);
assert.equal(detail.sections[0].lectures[0].subtitles[0].id,1);
assert.equal(data.lectures.some(row=>row.id===4),false);
assert.equal(statements,3); assert.equal(batches,1);
const overview = await courseRead({id:1},false,data);
assert.equal(overview.sections,undefined);
assert.equal(overview.total_lectures,3);
const all = await loadCourseRows(database,[1,2]);
assert.equal((await courseRead({id:2},true,all)).total_lectures,1);
assert.equal((await courseRead({id:1},true,all)).total_lectures,3);
const before = statements;
assert.deepEqual(await loadCourseRows(database,[]),{sections:[],lectures:[],subtitles:[]});
assert.equal(statements,before);
for(let i=5;i<1005;i++) sqlite.prepare("INSERT INTO lectures(id,section_id,lecture_id,title,position,learning_status) VALUES (?,?,?, ?,?,?)").run(i,1,String(i),'Extra',i,'NOT_STARTED');
statements=0; batches=0;
const large=await loadCourseRows(database,[1]);
assert.equal((await courseRead({id:1},true,large)).total_lectures,1003);
assert.equal(statements,3); assert.equal(batches,1);
sqlite.exec("INSERT INTO lectures(id,section_id,lecture_id,title,position,learning_status,lecture_type) VALUES (1005,1,'article','Article',1005,'NOT_STARTED','article'); INSERT INTO subtitles(id,lecture_id,status) VALUES (4,1,'COMPLETED'),(5,1005,'COMPLETED')");
const mixed = await courseRead({id:1},true,await loadCourseRows(database,[1]));
assert.equal(mixed.total_lectures,1004);
assert.equal(mixed.subtitle_eligible_lectures,1003);
assert.equal(mixed.processed_subtitles,1);
// Dashboard acceptance fixture: 100 courses x 500 lectures. Only one summary row
// and at most one next-lecture subtitle set per course may cross the DB boundary.
sqlite.exec("CREATE TABLE courses_fixture (id INTEGER);");
const insertCourse=sqlite.prepare("INSERT INTO courses(id,user_id,course_id,title,url,tags_json) VALUES(?,1,?,?,?,'[]')");
const insertSection=sqlite.prepare("INSERT INTO sections(id,course_id,title,position) VALUES(?,?,?,?)");
const insertLecture=sqlite.prepare("INSERT INTO lectures(id,section_id,lecture_id,title,position,learning_status,lecture_type) VALUES(?,?,?,?,?,?, 'video')");
const insertSubtitle=sqlite.prepare("INSERT INTO subtitles(id,lecture_id,status) VALUES(?,?,?)");
let lectureId=2000, sectionId=1000, subtitleId=100;
sqlite.exec("BEGIN");
for(let course=1;course<=100;course++){
  const cid=course+10; insertCourse.run(cid,`fixture-${course}`,`Fixture course ${course}`,`https://www.udemy.com/course/fixture-${course}/`);
  for(let section=1;section<=5;section++){
    const sid=sectionId++; insertSection.run(sid,cid,`Section ${section}`,section);
    for(let pos=1;pos<=100;pos++){
      const lid=lectureId++, status=section===1&&pos===1?"COMPLETED":section===1&&pos===2?"NOT_STARTED":"NOT_STARTED";
      insertLecture.run(lid,sid,`fixture-${lid}`,`Lecture ${pos}`,pos,status);
      if(section===1&&pos===1)insertSubtitle.run(subtitleId++,lid,"COMPLETED");
    }
  }
}
sqlite.exec("COMMIT");
returnedRows=0; executedSql=[];
const summaryStarted=performance.now();
const summaries=await loadCourseSummaries(database,Array.from({length:100},(_,index)=>index+11));
const summaryElapsedMs=performance.now()-summaryStarted;
assert.equal(summaries.size,100);
for(const summary of summaries.values()){
  assert.equal(summary.total_sections,5);
  assert.equal(summary.total_lectures,500);
  assert.equal(summary.completed_lectures,1);
  assert.equal(summary.subtitle_eligible_lectures,500);
  assert.equal(summary.processed_subtitles,1);
  assert.equal(summary.next_lecture.title,"Lecture 2");
}
assert.equal(returnedRows,100,"summary SQL returns exactly 100 aggregate card rows; next-lecture subtitle query is empty");
assert.equal(executedSql.some(sql=>/^\s*SELECT \* FROM (sections|lectures)/i.test(sql)),false,"dashboard summary never reads full curriculum tables");
const cardPayload=JSON.stringify({total:100,items:[...summaries.entries()].map(([id,summary])=>{
  const course=sqlite.prepare("SELECT * FROM courses WHERE id=?").get(id);
  return {id,course_id:course.course_id,title:course.title,url:course.url,tags:JSON.parse(course.tags_json||"[]"),
    instructor:course.instructor??null,thumbnail_url:course.thumbnail_url??null,...summary,
    last_synced_at:course.last_synced_at,created_at:course.created_at};
})});
assert.ok(Buffer.byteLength(cardPayload)<100_000,`100 dashboard cards stay below 100 KB (${Buffer.byteLength(cardPayload)} bytes)`);
assert.ok(summaryElapsedMs<5000,`100 courses x 500 lectures summaries complete in under 5 seconds (${summaryElapsedMs.toFixed(1)} ms)`);
const pageOne=sqlite.prepare("SELECT id,title FROM courses WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(1,20,0);
const pageTwo=sqlite.prepare("SELECT id,title FROM courses WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(1,20,20);
assert.equal(pageOne.length,20); assert.equal(pageTwo.length,20); assert.notEqual(pageOne[0].id,pageTwo[0].id);
const filtered=sqlite.prepare("SELECT id,title FROM courses WHERE user_id=? AND title LIKE ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(1,"%Fixture course 42%",20,0);
assert.equal(filtered.length,1); assert.match(filtered[0].title,/Fixture course 42/);
console.log("PASS: list/detail counts, next lecture priority, subtitles, course isolation, empty list, 1003 lectures in 3 SQL statements / 1 batch.");
console.log(`PASS: 100 courses x 500 lectures returns ${returnedRows} bounded summary rows in ${summaryElapsedMs.toFixed(1)} ms; ${Buffer.byteLength(cardPayload)}-byte dashboard payload; filter and 20-course pagination remain correct.`);
sqlite.close();

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {normalizeCourseTags} from '../app/lib/course-tags.ts';
const sql = new DatabaseSync(':memory:');
for (const name of ['0000_fearless_gateway','0001_dark_toxin']) sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
sql.exec(`INSERT INTO users(id,platform_user_id,email) VALUES(1,'owner','owner@example.com');
INSERT INTO courses(id,user_id,course_id,title,url) VALUES(1,1,'c','Course','https://www.udemy.com/course/test/');
INSERT INTO sections(id,course_id,title,position) VALUES(1,1,'Section',1);
INSERT INTO lectures(id,section_id,lecture_id,title,url,captions_json) VALUES(1,1,'l','Lecture','https://www.udemy.com/course/test/', '[{"locale_id":"en_US","url":"https://captions.example/caption.vtt"}]');
INSERT INTO subtitles(lecture_id,language,status,error_message) VALUES(1,'en','FAILED','old error');
INSERT INTO subtitles(lecture_id,language,status,storage_key,drive_file_id) VALUES(1,'en_US','COMPLETED','legacy','existing');`);
sql.exec(readFileSync(new URL('../drizzle/0002_reliable_jobs.sql',import.meta.url),'utf8'));
assert.equal(sql.prepare('SELECT count(*) n FROM subtitles').get().n,1);
assert.equal(sql.prepare('SELECT language FROM subtitles').get().language,'en');
assert.equal(sql.prepare('SELECT caption_language FROM subtitles').get().caption_language,'en_US');
assert.equal(sql.prepare('SELECT drive_status FROM subtitles').get().drive_status,'COMPLETED');
sql.exec('DELETE FROM subtitles');
const db = {prepare(query) {let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:result.changes,last_row_id:result.lastInsertRowid}};}};}};
db.batch = async (queries) => {
  sql.exec('BEGIN');
  try { const results=[]; for (const query of queries) results.push(await query.run()); sql.exec('COMMIT'); return results; }
  catch (error) { sql.exec('ROLLBACK'); throw error; }
};
globalThis.__normalizeCourseTags=normalizeCourseTags;
const objects=new Map();let downloads=0,uploads=0,gate,release;
const bucket={async put(key,value){objects.set(key,value);},async get(key){return objects.has(key)?{text:async()=>objects.get(key)}:null;}};
globalThis.__testEnv={DB:db,BUCKET:bucket};
globalThis.fetch=async(url)=>{
  if(String(url).includes('captions.example')) {downloads++;if(gate) await gate;return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello');}
  throw new Error('Unexpected network '+url);
};
const source=readFileSync(new URL('../app/lib/api-worker.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
async function load(){const js=ts.transpileModule('const env=globalThis.__testEnv; const normalizeCourseTags=globalThis.__normalizeCourseTags;\n'+source+'\nexport {courseRoutes};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#'+Math.random());}
let worker=await load();
sql.prepare("INSERT INTO processing_jobs(user_id,course_id,job_type,payload_json,total_items) VALUES(1,1,'SUBTITLE_BATCH',?,1)").run(JSON.stringify({lecture_ids:[1],language:'en',cursor:0}));
gate=new Promise(resolve=>release=resolve);
const first=worker.processPendingJob(1);await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(await worker.processPendingJob(1),false,'Overlapping dispatcher cannot claim user');release();await first;gate=null;
assert.equal(downloads,1);assert.equal(sql.prepare('SELECT status FROM processing_jobs').get().status,'COMPLETED');
sql.exec(`UPDATE processing_jobs SET status='PROCESSING',payload_json='{"lecture_ids":[1],"cursor":0}'; INSERT INTO job_leases VALUES(1,'crashed',unixepoch()-1)`);
worker=await load();await worker.processPendingJob(1);assert.equal(downloads,1);
sql.exec(`UPDATE users SET drive_credentials='{"access_token":"test","expires_at":9999999999999}'; UPDATE processing_jobs SET status='PENDING',payload_json='{"lecture_ids":[1],"cursor":0}',completed_items=0`);
await worker.processPendingJob(1);
assert.equal(sql.prepare('SELECT status FROM subtitles').get().status,'COMPLETED');
assert.equal(sql.prepare('SELECT drive_status FROM subtitles').get().drive_status,'FAILED');
assert.equal(JSON.parse(sql.prepare('SELECT payload_json FROM processing_jobs').get().payload_json).cursor,0);
assert.equal(sql.prepare('SELECT attempts FROM processing_jobs').get().attempts,1);
const files=new Map();
globalThis.fetch=async(url,init={})=>{url=String(url);if(url.includes('generateIds'))return Response.json({ids:['reserved-file']});if(url.includes('/files?')&&init.method!=='POST')return Response.json({files:[{id:'folder'}]});if(url.includes('/files/reserved-file'))return files.has('reserved-file')?Response.json({id:'reserved-file'}):new Response('',{status:404});if(url.includes('/upload/')){uploads++;files.set('reserved-file',true);return Response.json({id:'reserved-file'});}throw Error('Unexpected '+url);};
sql.exec('UPDATE processing_jobs SET retry_at=0');await worker.processPendingJob(1);
assert.equal(downloads,1);assert.equal(uploads,1);assert.equal(sql.prepare('SELECT drive_status FROM subtitles').get().drive_status,'COMPLETED');
sql.exec(`UPDATE subtitles SET drive_status='FAILED';UPDATE processing_jobs SET status='PENDING',payload_json='{"lecture_ids":[1],"cursor":0}'`);
await (await load()).processPendingJob(1);assert.equal(uploads,1,'Reserved Drive ID prevents duplicate upload after restart');
assert.equal(sql.prepare('SELECT drive_status FROM subtitles').get().drive_status,'COMPLETED');
console.log('PASS: migration reconciliation, exclusive claims, expired lease recovery, restart checkpoints, durable retry, stage-only Drive retry, upload crash recovery');

// New imports persist tags in the initial job and automatically enter subtitle processing.
const user={id:1}; const importUrl=new URL('https://site.example/api/courses/import');
const request=(tags)=>new Request(importUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.udemy.com/course/test/',tags})});
await assert.rejects(worker.courseRoutes(request(['x'.repeat(33)]),user,['import'],importUrl),/Tags/);
const imported=await (await worker.courseRoutes(request([' AI ','ai','English']),user,['import'],importUrl)).json();
let queued=sql.prepare('SELECT * FROM processing_jobs WHERE id=?').get(imported.id);
assert.deepEqual(JSON.parse(queued.payload_json).tags,['AI','English']);
assert.equal(JSON.parse(queued.payload_json).download_subtitles,true);
sql.prepare('UPDATE processing_jobs SET payload_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(queued.payload_json),stage:'write_complete',local_course_id:1,lecture_count:1,section_position:1}),imported.id);
sql.exec("INSERT INTO lectures(id,section_id,lecture_id,title,url,lecture_type) VALUES(2,1,'article','Article','https://example.com','article')");
const jobsBefore=sql.prepare('SELECT count(*) n FROM processing_jobs').get().n;
await worker.processPendingJob(1);
queued=sql.prepare('SELECT * FROM processing_jobs WHERE id=?').get(imported.id);
assert.equal(queued.job_type,'SUBTITLE_BATCH'); assert.equal(queued.status,'PENDING');
assert.equal(queued.total_items,1); assert.equal(queued.completed_items,0);
assert.deepEqual(JSON.parse(queued.payload_json).lecture_ids,[1]);
assert.deepEqual(JSON.parse(sql.prepare('SELECT tags_json FROM courses WHERE id=1').get().tags_json),['AI','English']);
assert.equal(sql.prepare('SELECT count(*) n FROM processing_jobs').get().n,jobsBefore,'Handoff reuses job; no duplicate batch');
await (await load()).processPendingJob(1);
assert.equal(sql.prepare('SELECT status FROM processing_jobs WHERE id=?').get(imported.id).status,'COMPLETED');
assert.equal(downloads,1); assert.equal(uploads,1);
// A failed handoff transaction retains both the import checkpoint and old tags.
const second=await (await worker.courseRoutes(request(['New']),user,['import'],importUrl)).json();
sql.prepare('UPDATE processing_jobs SET payload_json=? WHERE id=?').run(JSON.stringify({stage:'write_complete',local_course_id:1,download_subtitles:true,tags:['New']}),second.id);
const batch=db.batch; db.batch=async(queries)=>{sql.exec('BEGIN');try{await queries[0].run();throw Error('Simulated database interruption');}finally{sql.exec('ROLLBACK');}};
await worker.processPendingJob(1); db.batch=batch;
assert.equal(sql.prepare('SELECT job_type FROM processing_jobs WHERE id=?').get(second.id).job_type,'COURSE_IMPORT');
assert.deepEqual(JSON.parse(sql.prepare('SELECT tags_json FROM courses WHERE id=1').get().tags_json),['AI','English']);
sql.prepare('UPDATE processing_jobs SET retry_at=0 WHERE id=?').run(second.id);
await (await load()).processPendingJob(1);
assert.equal(sql.prepare('SELECT job_type FROM processing_jobs WHERE id=?').get(second.id).job_type,'SUBTITLE_BATCH');
assert.deepEqual(JSON.parse(sql.prepare('SELECT tags_json FROM courses WHERE id=1').get().tags_json),['New']);
console.log('PASS: import tag validation, atomic auto-download handoff, video-only selection, restart without duplicate job or upload, transaction failure recovery');

await worker.resumeUserJobs('missing-user');
assert.equal(sql.prepare('SELECT status FROM processing_jobs WHERE id=?').get(second.id).status,'PENDING');
await worker.resumeUserJobs('owner');
assert.equal(sql.prepare('SELECT status FROM processing_jobs WHERE id=?').get(second.id).status,'COMPLETED');
console.log('PASS: background resume drains persisted jobs for the trusted user without dashboard GET side effects');

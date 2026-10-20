import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const sql = new DatabaseSync(':memory:');
for (const name of ['0000_fearless_gateway','0001_dark_toxin','0002_reliable_jobs']) sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
sql.exec(`INSERT INTO users(id,platform_user_id,email) VALUES(1,'owner','owner@example.com');
INSERT INTO courses(id,user_id,course_id,title,url) VALUES(3,1,'999','Course','https://business.udemy.com/course/test/');
INSERT INTO sections(id,course_id,title,position) VALUES(1,3,'Section',1);
INSERT INTO lectures(id,section_id,lecture_id,title,url) VALUES(1,1,'11079904','Lecture','https://business.udemy.com/course/test/learn/lecture/11079904');`);
const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};}};
globalThis.__captionEnv={DB:db};
const source=readFileSync(new URL('../app/lib/api-worker.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const js=ts.transpileModule('const env=globalThis.__captionEnv;\n'+source+'\nexport {subtitleContent,ownedLecture};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {subtitleContent,ownedLecture}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const lecture=await ownedLecture(1,1);
assert.equal(lecture.course_id,3); assert.equal(lecture.udemy_course_id,'999');
await assert.rejects(ownedLecture(2,1),/Lecture not found/);
const cached=[{locale_id:'en_US',source:'manual',url:'https://vtt-c.udemycdn.com/stale.vtt'}];
const fresh=[{locale_id:'en_US',source:'manual',url:'https://vtt-c.udemycdn.com/fresh.vtt'}];
const cookies={jar:{access_token:'test-token',session:'test-session'},businessDomain:'business.udemy.com'};
const text='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n';
for(const status of [401,403,404]){
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));const headers=new Headers(options.headers);
    if(String(url).includes('/api-2.0/')){
      assert.match(String(url),/subscribed-courses\/999\/lectures\/11079904\//);
      assert.match(headers.get('Cookie'),/test-session/);
      return Response.json({asset:{captions:fresh}});
    }
    assert.equal(headers.has('Cookie'),false);assert.equal(headers.has('Authorization'),false);
    return String(url).includes('stale')?new Response('',{status}):new Response(text);
  };
  const result=await subtitleContent({...lecture,captions_json:JSON.stringify(cached)},'en',cookies);
  assert.equal(result.language,'en_US');assert.match(result.content,/Hello/);assert.equal(calls.length,3);
  assert.deepEqual(JSON.parse(sql.prepare('SELECT captions_json FROM lectures WHERE id=1').get().captions_json),fresh);
}
globalThis.fetch=async(url)=>String(url).includes('/api-2.0/')?new Response('',{status:403}):new Response('',{status:403});
await assert.rejects(subtitleContent({...lecture,captions_json:JSON.stringify(cached)},'en',cookies),/lecture refresh returned HTTP 403/);
await assert.rejects(subtitleContent({...lecture,captions_json:JSON.stringify(cached)},'en',null),/Reconnect/);
let count=0;
globalThis.fetch=async(url)=>{count++;return String(url).includes('/api-2.0/')?Response.json({asset:{captions:fresh}}):new Response('',{status:403});};
assert.match((await subtitleContent({...lecture,captions_json:JSON.stringify(cached)},'en',cookies)).error,/after refreshing/);
assert.equal(count,3,'Only one refresh attempt per subtitle processing step');
globalThis.fetch=async()=>new Response('<html>Sign in</html>');
assert.equal((await subtitleContent({...lecture,captions_json:JSON.stringify(cached)},'en',cookies)).category,'CAPTION_ERROR');
globalThis.fetch=async()=>Response.json({asset:{captions:[]}});
assert.equal((await subtitleContent({...lecture,captions_json:'[]'},'en',cookies)).category,'NO_SUBTITLES');
console.log('PASS: remote course ID, expired caption refresh on 401/403/404, no CDN credential leakage, bounded retries, access errors, invalid HTML and absent captions');

// Exercise the real Worker fetch wrapper with a controlled execution context.
const tasks=[];let resumes=0;
globalThis.__workerTest={handler:{fetch:async()=>Response.json({ok:true},{status:202})},runWithConnectorBinding:(_binding,fn)=>fn(),resumeUserJobs:async(identity)=>{assert.equal(identity,'trusted-user');resumes++;}};
const wrapper=readFileSync(new URL('../build/sites-worker.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.DEV','false');
const wrapperJs=ts.transpileModule('const {handler,runWithConnectorBinding,resumeUserJobs}=globalThis.__workerTest;\n'+wrapper,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const worker=(await import('data:text/javascript;base64,'+Buffer.from(wrapperJs).toString('base64'))).default;
const ctx={waitUntil(task){tasks.push(task);}};
for(const path of ['courses/import','courses/3/sync','subtitles/process','subtitles/lectures/1/process','jobs/run','jobs/10/retry']){
  const response=await worker.fetch(new Request('https://site.example/api/'+path,{method:'POST',headers:{'oai-authenticated-user-id':'trusted-user'}}),{},ctx);
  assert.equal(response.status,202);
}
await Promise.all(tasks);assert.equal(resumes,6);
await worker.fetch(new Request('https://site.example/api/jobs',{headers:{'oai-authenticated-user-id':'trusted-user'}}),{},ctx);
await worker.fetch(new Request('https://site.example/api/jobs/run',{method:'POST'}),{},ctx);
assert.equal(resumes,6,'GET reads and anonymous calls cannot start jobs');
console.log('PASS: immediate background dispatch after authenticated enqueue/resume POST, waitUntil ownership, read-only GET and anonymous isolation');

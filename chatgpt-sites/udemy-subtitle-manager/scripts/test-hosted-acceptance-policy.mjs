import assert from 'node:assert/strict';
import { hostedAcceptanceUserId, isHostedAcceptanceRequestAllowed } from '../app/lib/hosted-acceptance-policy.mjs';

for (const [method,path] of [
  ['POST','udemy/cookies'], ['GET','courses'], ['POST','courses/import'],
  ['GET','courses/12'], ['GET','jobs/17'], ['POST','subtitles/process'],
]) assert.equal(isHostedAcceptanceRequestAllowed(method,path),true,`${method} ${path} is in scope`);
for (const [method,path] of [
  ['DELETE','courses/12'], ['PATCH','courses/12'], ['GET','udemy/cookies'],
  ['POST','drive/disconnect'], ['POST','udemy/disconnect'], ['POST','jobs/17/retry'],
  ['GET','courses/not-a-number'], ['POST','subtitles/lectures/2/process'],
]) assert.equal(isHostedAcceptanceRequestAllowed(method,path),false,`${method} ${path} stays outside scope`);
assert.equal(hostedAcceptanceUserId({method:'POST',path:'courses/import',suppliedSecret:'right',expectedSecret:'right',userId:'fixed-user'}),'fixed-user');
assert.equal(hostedAcceptanceUserId({method:'POST',path:'courses/import',suppliedSecret:'wrong',expectedSecret:'right',userId:'fixed-user'}),null);
assert.equal(hostedAcceptanceUserId({method:'DELETE',path:'courses/12',suppliedSecret:'right',expectedSecret:'right',userId:'fixed-user'}),null);
assert.equal(hostedAcceptanceUserId({method:'POST',path:'courses/import',suppliedSecret:'right',expectedSecret:'right',userId:''}),null);
console.log('Hosted acceptance auth policy allows only the fixed-account operations needed for import, session recovery, and Drive retry.');

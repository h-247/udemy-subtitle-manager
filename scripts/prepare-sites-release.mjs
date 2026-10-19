// Run only after the exact authoritative commit passes GitHub release checks.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const root = execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if (git('status','--porcelain')) throw new Error('Commit intended changes before preparing a release');
const commit = git('rev-parse','HEAD');
const runs = JSON.parse(execFileSync('gh',['run','list','--commit',commit,'--workflow','ci.yml','--json','conclusion,status,event'],{cwd:root,encoding:'utf8'}));
if (!runs.some(run=>run.status==='completed'&&run.conclusion==='success'&&run.event==='push')) throw new Error('This commit has no successful push release-check run');
const source = 'chatgpt-sites/udemy-subtitle-manager/';
const checkout = path.join(root,'sites/udemy-subtitle-manager');
for (const name of git('ls-files',source).split('\n')) {
  const destination = path.join(checkout,name.slice(source.length));
  mkdirSync(path.dirname(destination),{recursive:true});
  cpSync(path.join(root,name),destination);
}
mkdirSync(path.join(checkout,'.openai'),{recursive:true});
writeFileSync(path.join(checkout,'.openai/release.json'),JSON.stringify({commit,repository:'https://github.com/h-247/udemy-subtitle-manager'},null,2)+'\n');
console.log(`Prepared tested release ${commit} in ${checkout}`);

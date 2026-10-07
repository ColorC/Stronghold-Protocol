#!/usr/bin/env node
// A small server release: only control HTML/JS, backend, shared modules and ws. Data has its own archive/role.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error(`missing ${k}`);return args[i+1];};
const output=option('--output');const canonical=option('--source-root');
if(!path.isAbsolute(output)||!path.isAbsolute(canonical))throw new Error('absolute source and output paths required');
if(existsSync(output))throw new Error('use a fresh release batch');
for(let current=path.resolve(output);current;current=path.dirname(current)){
 if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error(`linked output ancestor ${current}`);
 if(path.dirname(current)===current)break;
}
const git=(...a)=>execFileSync('git',['-C',canonical,...a],{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD');
const selected=['server','shared','public/independent.html','public/js/hostingBootstrap.js','public/js/hostingWait.js','LICENSE'];
if(git('status','--porcelain','--untracked-files=no','--',...selected,'data','package-lock.json'))throw new Error('selected release source must be committed');
mkdirSync(output,{recursive:true});
const codeArchive=path.join(output,'server-code.tar');const rulesArchive=path.join(output,'public-rules.tar');
execFileSync('git',['-C',canonical,'archive','--format=tar',`--output=${codeArchive}`,revision,...selected]);
execFileSync('git',['-C',canonical,'archive','--format=tar',`--output=${rulesArchive}`,revision,'data']);
const sourceLock=JSON.parse(git('show',`${revision}:package-lock.json`));
const ws=sourceLock.packages['node_modules/ws'];
const manifest={name:'stronghold-protocol-control-server',version:'1.0.0',private:true,type:'module',engines:{node:'>=22'},dependencies:{ws:ws.version}};
const pkgPath=path.join(output,'package.json'),lockPath=path.join(output,'package-lock.json');
writeFileSync(pkgPath,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(lockPath,JSON.stringify({name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,
 packages:{'':{name:manifest.name,version:manifest.version,dependencies:manifest.dependencies,engines:manifest.engines},'node_modules/ws':ws}},null,2)+'\n');
const receiptPath=path.join(output,'server-release.json');
const receipt={sourceRevision:revision,dependencyVersion:{ws:ws.version},roles:{code:'read-only release; no assets or runtime/input mount',rules:'public game definitions for separate canonical data directory',state:'not included'},
 artifacts:[{path:codeArchive,role:'backend and small control page/code archive'},{path:rulesArchive,role:'native Git public rule snapshot; no player state'},
 {path:pkgPath,role:'minimal server dependency manifest'},{path:lockPath,role:'ws version from existing native package lock'},{path:receiptPath,role:'release provenance and absolute artifact paths'}]};
writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));

#!/usr/bin/env node
// A small server release: only control HTML/JS, backend, shared modules and ws. Data has its own archive/role.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error(`missing ${k}`);return args[i+1];};
const output=option('--output');const canonical=option('--source-root');
if(!path.isAbsolute(output)||!path.isAbsolute(canonical))throw new Error('absolute source and output paths required');
let priorReceipt=null;
if(existsSync(output)){
 const outputStat=lstatSync(output);
 if(outputStat.isSymbolicLink()||!outputStat.isDirectory())throw new Error(`release output must be an ordinary directory: ${output}`);
 const existingEntries=readdirSync(output);
 if(existingEntries.length){
  if(!args.includes('--reuse'))throw new Error(`existing release batch requires --reuse: ${output}`);
  const receiptPath=path.join(output,'server-release.json');
  if(!existsSync(receiptPath))throw new Error(`release batch has no native receipt: ${receiptPath}`);
  priorReceipt=JSON.parse(readFileSync(receiptPath,'utf8'));
  const owned=new Set((priorReceipt.artifacts??[]).map(entry=>path.resolve(entry.path)));
  for(const name of existingEntries){
   const file=path.join(output,name),stat=lstatSync(file);
   if(!owned.has(path.resolve(file))||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error(`unowned, linked or unverified release artifact: ${file}`);
  }
 }
}
for(let current=path.resolve(output);current;current=path.dirname(current)){
 if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error(`linked output ancestor ${current}`);
 if(path.dirname(current)===current)break;
}
const git=(...a)=>execFileSync('git',['-C',canonical,...a],{encoding:'utf8'}).trim();
const revision=git('rev-parse',args.includes('--revision')?option('--revision'):'HEAD');
const reuseRules=args.includes('--code-only');
const rulesRevision=reuseRules?git('rev-parse',option('--rules-revision')):revision;
if(reuseRules&&git('diff','--name-only',rulesRevision,revision,'--','data'))throw new Error('code-only release requires unchanged public rules between the two native Git revisions');
const selected=['server','shared','public/independent.html','public/independent-replay.html','public/js/independent/replay.js','public/css/independent-recording.css','public/js/hostingBootstrap.js','public/js/hostingWait.js','public/js/ui/assetUrls.js','public/js/ui/fieldHost.js','public/js/ui/fallbackField.js','public/js/ui/hud.js','public/js/ui/shopBar.js','public/js/ui/bondStrip.js','public/js/screens/title.js','public/resonance.html','public/css/resonance.css','public/css/resonance-entry.css','public/css/resonance-detail.css','public/css/resonance-codex.css','public/css/resonance-panels.css','public/css/screens/draft.css','public/css/screens/title.css','public/css/screens/briefing.css','public/css/screens/lobby.css','public/js/net.js','public/js/resonance','public/js/render','LICENSE'];
if(args.includes('--resonance-capacity'))selected.push('tools/resonance/capacity.mjs','tools/resonance/archetype-balance.mjs','tools/resonance/balance-campaign.mjs');
const referencePaths=['docs/resonance/reference','docs/resonance/design.md','docs/resonance/content-contract.md','docs/resonance/catalog.md','docs/resonance/roster-worktable.json','docs/resonance/roster-worktable.md','docs/resonance/interface-contract.md','docs/resonance/prototype-season.json','docs/resonance/prototype-season.md','data/resonance-reference/tft-set13-14.23.json'];
// Local distribution only needs the committed reference archive; do not copy code, rules or dependencies.
if(args.includes('--references-only')){
 if(!args.includes('--resonance-references'))throw new Error('--references-only requires --resonance-references');
 if(git('status','--porcelain','--',...referencePaths))throw new Error('resonance reference archive source must be committed and clean');
 for(const sourcePath of referencePaths)git('cat-file','-e',`${revision}:${sourcePath}`);
 mkdirSync(output,{recursive:true});
 const archivePath=path.join(output,'resonance-references.zip');
 execFileSync('git',['-C',canonical,'archive','--format=zip',`--output=${archivePath}`,revision,...referencePaths]);
 const receiptPath=path.join(output,'server-release.json');
 const receipt={sourceRevision:revision,rulesRevision,distribution:'local-reference-only',roles:{references:'committed source documents and public versioned reference input; excludes player state, resources, runtime and credentials'},artifacts:[{path:archivePath,role:'current resonance design, full reference input and generated tables',nativeRevision:revision},{path:receiptPath,role:'native Git provenance and absolute artifact paths'}]};
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));
 process.exit(0);
}
if(git('status','--porcelain','--untracked-files=no','--',...selected,'data','package-lock.json'))throw new Error('selected release source must be committed');
if(args.includes('--resonance-references')){
 if(git('status','--porcelain','--',...referencePaths))throw new Error('resonance reference archive source must be committed and clean');
 for(const sourcePath of referencePaths)git('cat-file','-e',`${revision}:${sourcePath}`);
}
mkdirSync(output,{recursive:true});
const codeArchive=path.join(output,'server-code.tar');const rulesArchive=path.join(output,'public-rules.tar');
execFileSync('git',['-C',canonical,'archive','--format=tar',`--output=${codeArchive}`,revision,...selected]);
if(!reuseRules)execFileSync('git',['-C',canonical,'archive','--format=tar',`--output=${rulesArchive}`,revision,'data']);
const resonanceReferencesArchive=path.join(output,'resonance-references.zip');
if(args.includes('--resonance-references'))execFileSync('git',['-C',canonical,'archive','--format=zip',`--output=${resonanceReferencesArchive}`,revision,...referencePaths]);
const priorReferenceArtifact=(priorReceipt?.artifacts??[]).find(entry=>path.resolve(entry.path)===path.resolve(resonanceReferencesArchive));
const sourceLock=JSON.parse(git('show',`${revision}:package-lock.json`));
const ws=sourceLock.packages['node_modules/ws'];
const manifest={name:'stronghold-protocol-control-server',version:'1.0.0',private:true,type:'module',engines:{node:'>=22'},dependencies:{ws:ws.version}};
const pkgPath=path.join(output,'package.json'),lockPath=path.join(output,'package-lock.json');
writeFileSync(pkgPath,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(lockPath,JSON.stringify({name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,
 packages:{'':{name:manifest.name,version:manifest.version,dependencies:manifest.dependencies,engines:manifest.engines},'node_modules/ws':ws}},null,2)+'\n');
const receiptPath=path.join(output,'server-release.json');
const receipt={sourceRevision:revision,rulesRevision,reusesExistingRules:reuseRules,dependencyVersion:{ws:ws.version},roles:{code:'read-only release; no assets or runtime/input mount',rules:'public game definitions for separate canonical data directory',state:'not included'},
 artifacts:[{path:codeArchive,role:'backend and small control page/code archive'},...(!reuseRules?[{path:rulesArchive,role:'native Git public rule snapshot; no player state'}]:[]),
 ...(args.includes('--resonance-references')?[{path:resonanceReferencesArchive,role:'resonance reference documents; no raw inputs, assets, user data, runtime or credentials',nativeRevision:revision}]:priorReferenceArtifact?[priorReferenceArtifact]:[]),
 {path:pkgPath,role:'minimal server dependency manifest'},{path:lockPath,role:'ws version from existing native package lock'},{path:receiptPath,role:'release provenance and absolute artifact paths'}]};
writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));

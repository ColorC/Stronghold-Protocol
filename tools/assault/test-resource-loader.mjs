import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const reused=process.env.SP_REUSED_PUBLIC_DIR;
if(!reused||!path.isAbsolute(reused))throw new Error('SP_REUSED_PUBLIC_DIR must be an explicit absolute canonical public directory');
const own=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public');
const root=path.resolve(own,'..');
const i18nUrl=pathToFileURL(path.join(root,'tools','i18n.mjs')).href;
const prefix=path.join(own,'vendor')+path.sep;
const sourceBase=process.env.SP_ASSAULT_SOURCE_BASE;
let reuseBase=null;
if(sourceBase){
 if(!path.isAbsolute(sourceBase))throw new Error('SP_ASSAULT_SOURCE_BASE must be absolute');
 const base=path.resolve(sourceBase),manifest=JSON.parse(fs.readFileSync(path.join(base,'assault-release.json'),'utf8'));
 if(manifest.status!=='pass'||manifest.adoptionStatus!=='adopted'||path.resolve(manifest.roots.code)!==base)throw new Error('Source reuse requires the current registered native release');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}}).trim();
 if(path.resolve(git('rev-parse','--show-toplevel'))!==root)throw new Error('Source reuse worktree root mismatch');
 git('merge-base','--is-ancestor',manifest.source.nativeGitCommit,'HEAD');
 const changed=new Set([git('diff','--name-only',manifest.source.nativeGitCommit,'HEAD'),git('diff','--name-only','HEAD')].join('\n').split(/\r?\n/).filter(Boolean));
 const rows=new Map(manifest.files.filter(row=>row.adopted&&!row.metadata).map(row=>[path.resolve(row.targetPath).toLowerCase(),row]));
 reuseBase={base,changed,rows,verified:new Set()};
}
registerHooks({resolve(specifier,context,nextResolve){
  let parent=context.parentURL;
  if(parent){const parsed=new URL(parent);parsed.search='';parsed.hash='';parent=parsed.href;}
  if(specifier==='acorn'&&parent?.toLowerCase()===i18nUrl.toLowerCase()){
   const explicitParser=process.env.SP_ASSAULT_ACORN_PATH;
   let acorn;
   if(explicitParser){
    if(!path.isAbsolute(explicitParser))throw new Error('SP_ASSAULT_ACORN_PATH must be an explicit absolute parser path');
    acorn=path.resolve(explicitParser);
   }else{
    const dependencies=process.env.SP_ASSAULT_DEPS_DIR;
    if(!dependencies||!path.isAbsolute(dependencies))throw new Error('SP_ASSAULT_DEPS_DIR must be an explicit absolute dependency cache');
    acorn=path.resolve(dependencies,'node_modules','acorn','dist','acorn.mjs');
   }
   if(!fs.existsSync(acorn))throw new Error(`cached acorn is missing: ${acorn}`);
   return nextResolve(pathToFileURL(acorn).href,context);
  }
  let url;try{url=new URL(specifier,context.parentURL||pathToFileURL(process.cwd()+path.sep));}catch{return nextResolve(specifier,context);}
 if(url.protocol==='file:'){
  const actual=fileURLToPath(url);
  if(reuseBase){
   const inSource=actual.toLowerCase().startsWith((root+path.sep).toLowerCase());
   const inBase=actual.toLowerCase().startsWith((reuseBase.base+path.sep).toLowerCase());
   const relative=inSource?path.relative(root,actual):inBase?path.relative(reuseBase.base,actual):null;
   if(relative&&/^(?:(?:server|shared)[\\/]|public[\\/]js[\\/]).+\.m?js$/.test(relative)){
    const local=path.resolve(root,relative);
    if(fs.existsSync(local))return nextResolve(pathToFileURL(local).href,context);
    const gitPath=relative.replaceAll('\\','/');
    if(reuseBase.changed.has(gitPath))throw new Error('Changed source is absent from the sparse worktree: '+gitPath);
    const target=path.resolve(reuseBase.base,relative),key=target.toLowerCase(),row=reuseBase.rows.get(key);
    if(!row?.bytewiseVerified||!row.targetIdentity)throw new Error('Source dependency has no native release byte proof: '+gitPath);
    if(!reuseBase.verified.has(key)){
     const st=fs.lstatSync(target,{bigint:true}),id=row.targetIdentity;
     if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||String(st.dev)!==String(id.device)||String(st.ino)!==String(id.fileId)||String(st.mtimeNs)!==String(id.mtimeNs)||String(st.size)!==String(id.bytes))throw new Error('Native release dependency changed: '+gitPath);
     reuseBase.verified.add(key);
    }
    return nextResolve(pathToFileURL(target).href,context);
   }
  }
  if(actual.toLowerCase().startsWith(prefix.toLowerCase())){
   const relative=path.relative(path.join(own,'vendor'),actual);
   const canonical=path.resolve(reused,'vendor',relative),boundary=path.resolve(reused,'vendor')+path.sep;
   if(!canonical.toLowerCase().startsWith(boundary.toLowerCase()))throw new Error('vendor resource path escapes canonical directory');
   if(fs.existsSync(canonical))return nextResolve(pathToFileURL(canonical).href,context);
  }
 }
 return nextResolve(specifier,context);
}});

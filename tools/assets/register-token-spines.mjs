import { readFile, readdir, mkdir, writeFile, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo, normalizeAtlas } from './atlas.mjs';
import { pngSize } from './formats.mjs';
import { parseSkel } from './skel.mjs';
import { resolveRoles } from './anim-roles.mjs';

export const SUPPLEMENTAL_TOKEN_MODELS = ['token_10041_cathy_catsld','token_10004_otter_motter','token_10020_ling_soul3','token_10027_ironmn_pile2'];
const regular = async p => { const s = await lstat(p); if (!s.isFile() || s.isSymbolicLink()) throw new Error('not a regular model file: '+p); };
const dir = async p => { const s = await lstat(p); if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('not a plain model directory: '+p); };

export async function registerTokenSpines({ assetRoot, supplementalRoot, manifestPath, tokenPath, reportPath, write = false }) {
  for (const p of [assetRoot, supplementalRoot, manifestPath, tokenPath, reportPath]) if (!path.isAbsolute(p)) throw new Error('paths must be absolute: '+p);
  await dir(assetRoot); await dir(supplementalRoot);
  const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
  const tokens = JSON.parse(await readFile(tokenPath,'utf8'));
  const report = { added: [], filesCreated: [], missing: [], animations: {}, avatarFallbacks: [] };
  for (const tokenId of Object.keys(tokens).filter(id=>id.startsWith('token_')).sort()) {
    const avatar = manifest.tokens[tokenId]?.avatar;
    if (avatar?.startsWith('/assets/')) {
      try { await regular(path.join(assetRoot, avatar.slice('/assets/'.length))); }
      catch (e) { if (e.code !== 'ENOENT') throw e; delete manifest.tokens[tokenId].avatar; report.avatarFallbacks.push(tokenId); }
    }
    if (manifest.tokens[tokenId]?.spine) continue;
    let modelDir, relDir, pma = false;
    for (const rel of ['local/spine/token/'+tokenId, 'spine/token/'+tokenId]) {
      try { await dir(path.join(assetRoot,rel)); modelDir=path.join(assetRoot,rel);relDir=rel; pma=rel.startsWith('local/'); break; } catch {}
    }
    if (!modelDir && SUPPLEMENTAL_TOKEN_MODELS.includes(tokenId)) {
      const source=path.join(supplementalRoot,'summons',tokenId,'model'); await dir(source);
      relDir='spine/token/'+tokenId; modelDir=path.join(assetRoot,relDir);
      const files=(await readdir(source)).filter(name=>/\.(skel|atlas|png)$/.test(name));
      if (write) { await mkdir(modelDir,{recursive:true}); await dir(modelDir); }
      for (const name of files) {
        const from=path.join(source,name), to=path.join(modelDir,name); await regular(from);
        if (write) { try { await copyFile(from,to,1); report.filesCreated.push(to); } catch(e) { if(e.code!=='EEXIST')throw e; await regular(to); } }
      }
      if (!write) modelDir=source;
    }
    if (!modelDir) { report.missing.push({tokenId,name:tokens[tokenId].name,displayType:tokens[tokenId].displayType}); continue; }
    const names=await readdir(modelDir); const skel=names.filter(x=>x.endsWith('.skel')).sort()[0];
    if(!skel)throw new Error('model has no skeleton: '+modelDir);
    const atlas=skel.replace(/\.skel$/,'.atlas'); await regular(path.join(modelDir,skel)); await regular(path.join(modelDir,atlas));
    const text=await readFile(path.join(modelDir,atlas),'utf8'); const sizes=new Map();
    for(const page of atlasInfo(text).pages) { const p=path.join(modelDir,page);await regular(p); const size=pngSize(await readFile(p)); if(!size)throw new Error('invalid texture '+p);sizes.set(page,size); }
    const normalized=normalizeAtlas(text,{pageSize:p=>sizes.get(p),pma});
    if(normalized.missingSize.length)throw new Error('unresolved atlas pages '+modelDir);
    const info=atlasInfo(normalized.text); const parsed=parseSkel(await readFile(path.join(modelDir,skel)),info.regions);
    if(parsed.missingRegions.length || !parsed.animations.length) throw new Error('invalid skeleton attachments/animations '+tokenId);
    if(write && SUPPLEMENTAL_TOKEN_MODELS.includes(tokenId) && report.filesCreated.includes(path.join(modelDir,atlas))) await writeFile(path.join(modelDir,atlas),normalized.text);
    const url=filename=>'/assets/'+relDir+'/'+filename;
    const spine={skel:url(skel),atlas:url(atlas),textures:info.pages.map(url),pma,anims:resolveRoles(parsed.animations,{skillIndices:[0],durations:parsed.durations}),animations:parsed.durations,events:parsed.events,hits:parsed.hits,bounds:parsed.bounds};
    manifest.tokens[tokenId]={...(manifest.tokens[tokenId]||{}),spine}; report.added.push(tokenId);report.animations[tokenId]=parsed.animations;
    if(tokenId==='token_10057_svash2_eagle2') for(const sibling of ['token_10057_svash2_eagle1','token_10057_svash2_eagle3']) if(tokens[sibling]&&!manifest.tokens[sibling]?.spine) {manifest.tokens[sibling]={...(manifest.tokens[sibling]||{}),spine};report.added.push(sibling);report.animations[sibling]=parsed.animations;}
  }
  manifest.stats.tokensWithSpine=Object.values(manifest.tokens).filter(t=>t.spine).length;
  manifest.stats.spineModels=new Set([...Object.values(manifest.chars).flatMap(x=>Object.values(x.spine||{})),...Object.values(manifest.enemies).map(x=>x.spine),...Object.values(manifest.tokens).map(x=>x.spine)].filter(Boolean).map(x=>x.skel)).size;
  report.missing=report.missing.filter(item=>!manifest.tokens[item.tokenId]?.spine);
  if(write) await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const opts={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--write'){opts.write=true;continue;}const names={'--asset-root':'assetRoot','--supplemental-root':'supplementalRoot','--manifest':'manifestPath','--tokens':'tokenPath','--report':'reportPath'};if(!names[key])throw new Error('unknown option '+key);opts[names[key]]=process.argv[++i];}
  console.log(JSON.stringify(await registerTokenSpines(opts)));
}

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const revision='1db8e51023ae6abaec9370beb81a513d5c4d0b01';
const names=['theme.css','components.css','devices.css',...['game','game-shop','game-panels','title','lobby','briefing','draft','result','loadout','guide','room'].map(name=>`screens/${name}.css`)];
const git=args=>execFileSync('git',['-C',root,...args],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
git(['cat-file','-e',revision+'^{commit}']);
const files=[];
for(const name of names){const source='public/css/'+name,target='public/css/resonance-native/'+name,bytes=git(['show',revision+':'+source]);fs.mkdirSync(path.dirname(path.join(root,target)),{recursive:true});fs.writeFileSync(path.join(root,target),bytes);files.push({source,target,bytes:bytes.length});}
const manifest={upstream:'https://github.com/sganggs/Stronghold-Protocol',revision,files,components:['public/js/ui/components.js','public/js/ui/hud.js','public/js/ui/bondStrip.js','public/js/ui/shopBar.js','public/js/ui/assetUrls.js'],scope:'共鸣专用入口加载原生样式；商店、HUD及基础组件沿用上游组件，通过适配器提供共鸣状态。'};
const manifestPath=path.join(root,'docs/resonance/native-ui-source.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
process.stdout.write(JSON.stringify({status:'synced',root,manifestPath,revision,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)})+'\n');

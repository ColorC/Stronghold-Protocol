import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
export async function previewServer({publicRoot,installRoot,port=0}) {
  const roots={code:path.resolve(publicRoot),input:path.resolve(installRoot,'public')};
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.atlas':'text/plain','.png':'image/png','.skel':'application/octet-stream'};
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const input=pathname.startsWith('/assets/')||pathname.startsWith('/vendor/')||pathname.startsWith('/dev/diy-2b/model/');
      const root=input?roots.input:roots.code;
      const file=path.resolve(root,'.'+pathname);
      if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(bytes);
    } catch(error){res.writeHead(error.code==='ENOENT'?404:500).end(error.message);}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

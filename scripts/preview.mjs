import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../out/',import.meta.url));
const base='/auth-ui/preview/manager';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml'};
createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(path==='/'){res.writeHead(302,{Location:base+'/'}).end();return;}
 if(!path.startsWith(base+'/')){res.writeHead(404).end();return;}
 let file=resolve(root,path.slice(base.length+1));
 if(!file.startsWith(resolve(root)+sep)&&file!==resolve(root)){res.writeHead(403).end();return;}
 if((await stat(file)).isDirectory())file=resolve(file,'index.html');
 const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
}catch{res.writeHead(404).end();}}).listen(3185,'127.0.0.1',()=>console.log('http://127.0.0.1:3185'+base+'/'));

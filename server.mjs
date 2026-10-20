import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist');
http.createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/')&&path!==root){res.writeHead(403).end();return;}const file=path===root?resolve(root,'index.html'):path;const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end('Introuvable');}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));

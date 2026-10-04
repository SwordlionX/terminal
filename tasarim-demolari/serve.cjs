/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node demo server. */
// Local static previews only. No access to project files outside this demo directory.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=__dirname;const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]){res.writeHead(404);return res.end('Not found')}const contents=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});res.end(contents)}catch{res.writeHead(404);res.end('Not found')}}).listen(3002,'127.0.0.1',()=>console.log('Tasarım demoları: http://127.0.0.1:3002'));

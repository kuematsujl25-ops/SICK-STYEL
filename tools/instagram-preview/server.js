import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.IG_PREVIEW_PORT||4178);
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/model.js':['model.js','text/javascript'],'/sample.json':['sample.json','application/json']};
createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`||req.method!=='GET'||!files[req.url]){res.writeHead(404);res.end();return;}
 const [file,type]=files[req.url];
 try{res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(await readFile(new URL(file,import.meta.url)));}catch{res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Local preview: http://127.0.0.1:${port}`));

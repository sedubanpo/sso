const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),http=require('http'),assert=require('node:assert/strict');
(async()=>{
const root=process.cwd()+'/workspace';
const server=http.createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type','text/html');
if(path==='/auth/frame-presentation.mjs'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(root+path));}
if(path==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(fs.readFileSync(root+path));}
if(path==='/child'){return res.end('<button>private content</button><script>requestAnimationFrame(()=>parent.postMessage("booted","*"))</script>');}
res.end(`<link rel="stylesheet" href="/styles.css"><main><section class="app-stage"><div id="auth-gate">Connecting</div><div id="frame-host"></div></section></main><script type="module">
import {presentFrames} from '/auth/frame-presentation.mjs';
const host=document.querySelector('#frame-host'),f=document.createElement('iframe'); f.hidden=true;host.append(f);window.framesMap=new Map([['desk',f]]);window.present=(state,id='desk')=>presentFrames(framesMap,id,state,host);window.booted=false;addEventListener('message',e=>{if(e.data==='booted')window.booted=true});present('pending');f.src='/child';</script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{const p=await b.newPage();p.on('pageerror',e=>console.error(e.message));await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.booted,{},{timeout:3000});
assert.deepEqual(await p.evaluate(()=>{const f=document.querySelector('iframe'),r=f.getBoundingClientRect();return {hidden:f.hidden,inert:f.inert,aria:f.getAttribute('aria-hidden'),sized:r.height>100,covered:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest('#auth-gate')!==null}}),{hidden:false,inert:true,aria:'true',sized:true,covered:true});
await p.evaluate(()=>{present('ready');document.querySelector('#auth-gate').hidden=true});assert.deepEqual(await p.evaluate(()=>{const f=document.querySelector('iframe');return [f.hidden,f.inert,f.getAttribute('aria-hidden')]}),[false,false,null]);
await p.evaluate(()=>present('error'));assert.equal(await p.locator('iframe').isVisible(),false);
await p.evaluate(()=>present('pending','lms'));assert.equal(await p.locator('iframe').isVisible(),false);
console.log('PASS pending initialization, opaque coverage, interaction lock, ready, error, inactive frame');
}finally{await b.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1});

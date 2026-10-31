import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from '../workspace/auth/connection.mjs';
function harness(extra={}){
 const timers=[],states=[],listeners=new Map(),sent=[];
 const target={postMessage:d=>sent.push(d)};
 const win={document:{},addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 const deadline=(callback,ms,doc,focus)=>{const timer={callback,ms,cancelled:false,focus};timers.push(timer);return()=>timer.cancelled=true;};
 const c=createConnection({appId:'fees',entry:'https://apps.example/fees',target,brokerUrl:'https://broker.example',getIdToken:async()=> 'fixture',onState:(...s)=>states.push(s),windowObject:win,deadline,...extra});
 const nonce=new URL(c.url).searchParams.get('hub_nonce');
 const emit=(type,extra={})=>listeners.get('message')?.({source:target,origin:'https://apps.example',data:{channel:'sedu-hub-v1',appId:'fees',nonce,type,...extra}});
 return {c,timers,states,sent,win,emit};
}
test('deferred document has independent load budget; auth budget starts only at valid readiness',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({code:'x'.repeat(43)})});
 try{
  const h=harness({startupTimeoutMs:90000});assert.deepEqual(h.timers.map(t=>t.ms),[8000,90000]);
  assert.ok(h.timers.every(t=>t.focus===h.win));
  await h.emit('ready',{challenge:'bad'});assert.equal(h.timers.length,2);
  await h.emit('ready',{challenge:'c'.repeat(43)});
  assert.equal(h.timers[1].cancelled,true);assert.equal(h.timers[2].ms,60000);assert.equal(h.c.waitingForReady,false);
  await h.emit('ready',{challenge:'c'.repeat(43)});assert.equal(h.sent.length,1);
  await h.emit('authenticated');assert.equal(h.states.at(-1)[0],'ready');assert.equal(h.timers[2].cancelled,true);h.c.stop();
 }finally{globalThis.fetch=old;}
});
test('stalled bootstrap closes listener before recovery and rejects stale completion',async()=>{
 let recoveries=0;const h=harness({onStartupTimeout:()=>recoveries++});
 h.timers[1].callback();assert.equal(recoveries,1);await h.emit('authenticated');assert.equal(h.states.length,0);assert.equal(await h.c.logout(),false);
});
test('startup failure is explicit when no recovery handler exists',()=>{
 const h=harness();h.timers[1].callback();assert.equal(h.states.at(-1)[0],'error');assert.match(h.states.at(-1)[1],/앱 화면/);
});

import assert from 'node:assert/strict';
import {createConnection} from '../auth/connection.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const windowObject=new EventTarget();windowObject.document=new EventTarget();Object.assign(windowObject.document,{hidden:false,hasFocus:()=>true});
let tokens=0;const states=[],target={postMessage(){}};
const previousFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({code:'t'.repeat(43)})});
const conn=createConnection({appId:'desk',entry:'https://example.test/app',target,getIdToken:async()=>{tokens++;return 'mock';},brokerUrl:'https://example.test',onState:s=>states.push(s),timeoutMs:40,windowObject});
function message(origin,source,type='ready') {const event=new Event('message');Object.assign(event,{origin,source,data:{channel:'sedu-hub-v1',appId:'desk',nonce:new URL(conn.url).searchParams.get('hub_nonce'),challenge:'c'.repeat(43),type}});windowObject.dispatchEvent(event);}
await sleep(80);assert.deepEqual(states,[]);assert.equal(tokens,0);
message('https://wrong.test',target);message('https://example.test',{});await sleep(60);assert.equal(tokens,0);assert.deepEqual(states,[]);
message('https://example.test',target);message('https://example.test',target);await sleep(80);assert.equal(tokens,1);assert.deepEqual(states,['error']);conn.stop();globalThis.fetch=previousFetch;
console.log('PASS delayed bootstrap stays pending; wrong origin/source rejected; duplicate ready one ticket; started handshake still times out');

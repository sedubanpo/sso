import assert from 'node:assert/strict';
import {visibleDeadline} from '../auth/visible-deadline.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Visibility extends EventTarget { hidden=true; change(hidden){this.hidden=hidden;this.dispatchEvent(new Event('visibilitychange'));} }
const doc=new Visibility();let calls=0;
const cancel=visibleDeadline(()=>calls++,60,doc);
await sleep(100);assert.equal(calls,0,'hidden initial time must not expire');
doc.change(false);await sleep(20);doc.change(true);await sleep(100);assert.equal(calls,0,'hidden interval must not expire');
doc.change(false);await sleep(70);assert.equal(calls,1);doc.change(true);doc.change(false);await sleep(80);assert.equal(calls,1,'deadline once only');
let cancelled=0;const stop=visibleDeadline(()=>cancelled++,30,doc);stop();doc.change(true);doc.change(false);await sleep(50);assert.equal(cancelled,0);
console.log('PASS hidden start, pause/resume budget, single expiry, cleanup');

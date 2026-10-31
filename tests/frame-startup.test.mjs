import test from 'node:test';
import assert from 'node:assert/strict';
import {presentFrames} from '../workspace/auth/frame-presentation.mjs';

const frame=()=>({hidden:true,inert:true,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}});
test('every selected app can bootstrap behind the gate without interaction',()=>{
 for(const selected of ['timetable','teacher-portal','lms','desk','fees','synchro','intranet']){
  const chosen=frame(),other=frame(),frames=new Map([[selected,chosen],['other',other]]);
  let preparing=false;const host={classList:{toggle(_,value){preparing=value;}}};
  presentFrames(frames,selected,'pending',host);
  assert.equal(preparing,true);assert.equal(chosen.hidden,false);assert.equal(chosen.inert,true);assert.equal(chosen.attributes['aria-hidden'],'true');assert.equal(other.hidden,true);
  presentFrames(frames,selected,'ready',host);
  assert.equal(preparing,false);assert.equal(chosen.hidden,false);assert.equal(chosen.inert,false);assert.equal(chosen.attributes['aria-hidden'],undefined);
  presentFrames(frames,selected,'error',host);
  assert.equal(chosen.hidden,true);assert.equal(chosen.inert,true);
 }
});

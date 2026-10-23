const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('workspace/app.js','utf8');const code=source.slice(source.indexOf('const deskResume ='),source.indexOf('function connectApp('));let attempts=0;let waiting=true;let now=9000;const events={};
const context={performance:{now:()=>now},selected:'desk',actor:{},connections:new Map([['desk',{get waitingForReady(){return waiting;}}]]),connectApp:()=>attempts++,window:{addEventListener:(n,f)=>events[n]=f},document:{hidden:false,addEventListener:(n,f)=>events[n]=f}};
vm.createContext(context);vm.runInContext(code,context);events.focus();events.focus();events.visibilitychange();assert.equal(attempts,1,'once only');
vm.runInContext('deskResume.retried=false',context);waiting=false;events.focus();assert.equal(attempts,1,'no restart after readiness');
waiting=true;now=1000;events.focus();assert.equal(attempts,1,'no early restart');console.log('PASS bounded resume, no restart after ready, minimum stall age');

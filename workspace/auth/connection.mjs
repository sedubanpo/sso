import {visibleDeadline} from './visible-deadline.mjs?v=20261023-focus2';
export const randomNonce=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export function createConnection({appId,entry,target,getIdToken,brokerUrl,onState,timeoutMs=60000,windowObject=window}){
  const nonce=randomNonce(),url=new URL(entry);url.searchParams.set('hub_nonce',nonce);
  let closed=false,busy=false,completed=false,finishLogout=null;
  let timer=()=>{};
  const startDeadline=()=>{timer=visibleDeadline(()=>{onState('error','이 앱의 통합 로그인 연결을 확인하지 못했습니다. 앱별 연동 코드 적용 상태를 확인해 주세요.');stop();},timeoutMs,windowObject.document,['desk','intranet'].includes(appId)?windowObject:null);};
  const stop=()=>{closed=true;timer();slowTimer();windowObject.removeEventListener('message',receive);};
  async function receive(event){
    const d=event.data;
    if(closed||event.source!==target||event.origin!==url.origin||!d||d.channel!=='sedu-hub-v1'||d.appId!==appId||d.nonce!==nonce)return;
    if(d.type==='signed-out'&&finishLogout){finishLogout(true);return;}
    if(d.type==='ready'&&!busy&&!completed){
      if(!/^[A-Za-z0-9_-]{43}$/.test(d.challenge||''))return;
      if(['desk','intranet'].includes(appId))startDeadline();
      busy=true;
      try{
        const token=await getIdToken();
        if(closed)return;
        const response=await fetch(brokerUrl+'/ticket',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({appId,nonce,challenge:d.challenge}),signal:AbortSignal.timeout(15000)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'앱 연결에 실패했습니다.');
        if(!closed)target.postMessage({channel:'sedu-hub-v1',type:'ticket',appId,nonce,code:result.code},url.origin);
      }catch(error){if(!closed){onState('error',error.message);stop();}}
    }
    if(d.type==='authenticated'&&busy){completed=true;timer();slowTimer();onState('ready');}
    if(d.type==='error'){onState('error','앱에서 계정 또는 권한을 확인하지 못했습니다. 다시 연결해 주세요.');stop();}
  }
  windowObject.addEventListener('message',receive);
  const slowTimer=visibleDeadline(()=>{if(!closed&&!completed)onState('pending','연결이 지연되고 있습니다. 잠시 기다리거나 상단에서 새 탭으로 열 수 있습니다.');},8000,windowObject.document, ['desk','intranet'].includes(appId) ? windowObject : null);
  // Chrome may defer the iframe document while its window is in the background.
  // The authentication budget starts when that document actually announces readiness.
  if(!['desk','intranet'].includes(appId))startDeadline();
  return {url:url.href,get waitingForReady(){return !closed&&!busy&&!completed;},stop,setTarget(next){target=next;},logout(){
    if(closed)return Promise.resolve(false);
    timer();slowTimer();
    return new Promise(resolve=>{const timeout=setTimeout(()=>finishLogout(false),3000);finishLogout=ok=>{clearTimeout(timeout);stop();resolve(ok);};target.postMessage({channel:'sedu-hub-v1',type:'logout',appId,nonce},url.origin);});
  }};
}

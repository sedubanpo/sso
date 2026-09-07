export const randomNonce=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export function createConnection({appId,entry,target,getIdToken,brokerUrl,onState,timeoutMs=60000,windowObject=window}){
  const nonce=randomNonce(),url=new URL(entry);url.searchParams.set('hub_nonce',nonce);
  let closed=false,busy=false,completed=false,finishLogout=null;
  const stop=()=>{closed=true;clearTimeout(timer);windowObject.removeEventListener('message',receive);};
  async function receive(event){
    const d=event.data;
    if(closed||event.source!==target||event.origin!==url.origin||!d||d.channel!=='sedu-hub-v1'||d.appId!==appId||d.nonce!==nonce)return;
    if(d.type==='signed-out'&&finishLogout){finishLogout(true);return;}
    if(d.type==='ready'&&!busy&&!completed){
      if(!/^[A-Za-z0-9_-]{43}$/.test(d.challenge||''))return;
      busy=true;
      try{
        const token=await getIdToken();
        if(closed)return;
        const response=await fetch(brokerUrl+'/ticket',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({appId,nonce,challenge:d.challenge}),signal:AbortSignal.timeout(15000)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'앱 연결에 실패했습니다.');
        if(!closed)target.postMessage({channel:'sedu-hub-v1',type:'ticket',appId,nonce,code:result.code},url.origin);
      }catch(error){if(!closed){onState('error',error.message);stop();}}
    }
    if(d.type==='authenticated'&&busy){completed=true;clearTimeout(timer);onState('ready');}
    if(d.type==='error'){onState('error','앱에서 계정 또는 권한을 확인하지 못했습니다. 다시 연결해 주세요.');stop();}
  }
  windowObject.addEventListener('message',receive);
  const timer=setTimeout(()=>{onState('error','이 앱의 통합 로그인 연결을 확인하지 못했습니다. 앱별 연동 코드 적용 상태를 확인해 주세요.');stop();},timeoutMs);
  return {url:url.href,stop,setTarget(next){target=next;},logout(){
    if(closed)return Promise.resolve(false);
    clearTimeout(timer);
    return new Promise(resolve=>{const timeout=setTimeout(()=>finishLogout(false),3000);finishLogout=ok=>{clearTimeout(timeout);stop();resolve(ok);};target.postMessage({channel:'sedu-hub-v1',type:'logout',appId,nonce},url.origin);});
  }};
}

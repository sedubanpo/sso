const endpoint='https://firestore.googleapis.com/v1/projects/fir-lms-prod/databases/(default)/documents/dashboardSnapshots/GLOBAL_NOTICE';
export function createNoticeFeed({getToken,onChange,url=endpoint,fetcher=fetch}){
 let epoch=0,interval=null,active=false,busy=false,controller=null,last=null;
 const signedOut=()=>onChange({summary:'로그인 후 확인하세요',content:'로그인하면 S-LMS의 공지사항을 확인할 수 있습니다.'});
 async function refresh(){
  if(!active||busy)return;busy=true;const version=epoch;const requestController=new AbortController();controller=requestController;const timeout=setTimeout(()=>requestController.abort(),12000);
  try{
   onChange(last?{...last,status:'최신 공지 확인 중',loading:true}:{summary:'공지를 확인하고 있습니다',content:'S-LMS의 최신 공지를 불러오고 있습니다.',loading:true});
   const token=await getToken();if(version!==epoch)return;
   const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:requestController.signal});
   if(!r.ok&&r.status!==404)throw Error('notice unavailable');
   const fields=r.status===404?{}:(await r.json()).fields||{};if(version!==epoch)return;
   const content=String(fields.content?.stringValue||'').trim();
   const rawDate=fields.updatedAt?.stringValue||fields.updatedAt?.timestampValue;const date=rawDate?new Date(rawDate):null;
   const meta=[fields.updatedByName?.stringValue,date&&!Number.isNaN(date.valueOf())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):''].filter(Boolean).join(' · ');
   last={summary:content||'등록된 공지사항이 없습니다',content:content||'새 공지사항이 등록되면 이곳에 표시됩니다.',meta,status:'S-LMS와 연결됨 · 1분마다 갱신'};onChange(last);
  }catch{if(version===epoch)onChange({summary:'공지 연결을 확인해 주세요',content:'공지사항을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.',status:'연결 확인 필요'});}
  finally{clearTimeout(timeout);if(version===epoch)busy=false;}
 }
 function stop(){last=null;active=false;epoch++;busy=false;controller?.abort();clearInterval(interval);signedOut();}
 return {refresh,start(){stop();active=true;refresh();interval=setInterval(()=>{if(!document.hidden)refresh();},60000);},stop};
}

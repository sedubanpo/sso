const endpoint='https://firestore.googleapis.com/v1/projects/fir-lms-prod/databases/(default)/documents/dashboardSnapshots/GLOBAL_NOTICE';
export function readNotices(fields){
 const decode=field=>field?.stringValue??field?.timestampValue??'';
 const raw=fields.items?.arrayValue? (fields.items.arrayValue.values||[]).map(item=>item.mapValue?.fields||{}):[fields];
 return raw.filter(item=>item.active?.booleanValue!==false&&String(decode(item.content)).trim()).map((item,i)=>({id:decode(item.id)||String(i),content:String(decode(item.content)).trim(),updatedByName:decode(item.updatedByName),updatedAt:decode(item.updatedAt)}));
}
export function createNoticeFeed({getToken,onChange,url=endpoint,fetcher=fetch,shouldPause=()=>typeof document!=='undefined'&&document.hidden,timers={setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id)}}){
 let epoch=0,interval=null,rotation=null,active=false,busy=false,controller=null,items=[],index=0,paused=false;
 const signedOut=()=>onChange({summary:'로그인 후 확인하세요',content:'로그인하면 S-LMS의 공지사항을 확인할 수 있습니다.',count:0});
 function emit(extra={}){
  const item=items[index],content=item?.content||'',date=item?.updatedAt?new Date(item.updatedAt):null;
  const meta=[item?.updatedByName,date&&!Number.isNaN(date.valueOf())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):''].filter(Boolean).join(' · ');
  onChange({summary:content||'등록된 공지사항이 없습니다',content:content||'새 공지사항이 등록되면 이곳에 표시됩니다.',meta,count:items.length,index,paused,status:'S-LMS와 연결됨 · 1분마다 갱신',...extra});
 }
 function move(step){if(!active||items.length<2)return;index=(index+step+items.length)%items.length;emit();}
 async function refresh(){
  if(!active||busy)return;busy=true;const version=epoch;const requestController=new AbortController();controller=requestController;const timeout=setTimeout(()=>requestController.abort(),12000);
  try{
   if(items.length)emit({loading:true,status:'최신 공지 확인 중'});else onChange({summary:'공지를 확인하고 있습니다',content:'S-LMS의 최신 공지를 불러오고 있습니다.',count:0,loading:true});
   const token=await getToken();if(version!==epoch)return;
   const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:requestController.signal});
   if(!r.ok&&r.status!==404)throw Error('notice unavailable');
   const fields=r.status===404?{}:(await r.json()).fields||{};if(version!==epoch)return;
   const currentId=items[index]?.id;items=readNotices(fields);index=Math.max(0,items.findIndex(item=>item.id===currentId));emit();
  }catch{if(version===epoch){if(items.length)emit({status:'최신 공지를 확인하지 못했습니다. 다시 시도해 주세요.'});else onChange({summary:'공지 연결을 확인해 주세요',content:'공지사항을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.',count:0,status:'연결 확인 필요'});}}
  finally{clearTimeout(timeout);if(version===epoch)busy=false;}
 }
 function stop(){items=[];index=0;paused=false;active=false;epoch++;busy=false;controller?.abort();timers.clearInterval(interval);timers.clearInterval(rotation);signedOut();}
 return {refresh,next:()=>move(1),previous:()=>move(-1),togglePaused(){paused=!paused;emit();},start(){stop();active=true;refresh();interval=timers.setInterval(()=>{if(typeof document==='undefined'||!document.hidden)refresh();},60000);rotation=timers.setInterval(()=>{if(!busy&&!paused&&!shouldPause())move(1);},8000);},stop};
}

// Read-only inbox. Source APIs authenticate the selected Firebase identity.
export const activityKinds={
 'permission-granted':{label:'학생 권한 추가',app:'lms'},
 'permission-request':{label:'권한 요청',app:'lms',request:true,staff:true},'hours-issue':{label:'시수 오류 제보',app:'teacher-portal',request:true,staff:true},
 'desk-task':{label:'업무 처리',app:'desk',request:true},attendance:{label:'출퇴근',app:'desk'},
 'log-reaction':{label:'일지 반응',app:'lms'},'exam-request':{label:'성적 입력 요청',app:'lms',request:true},
 'consultation-request':{label:'상담일지 요청',app:'lms',request:true},'lesson-request':{label:'수업일지 요청',app:'lms',request:true},
 'consultation-reminder':{label:'상담 확인',app:'lms',request:true},'hours-consent':{label:'시수 동의',app:'teacher-portal',request:true}
};
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function normalizeActivity(rows,actor,sourceApp){
 const seen=new Set();
 return (Array.isArray(rows)?rows:[]).slice(0,300).flatMap(row=>{
  if(!row||row.recipientUid!==actor?.uid)return [];
  const kind=activityKinds[row.kind],id=text(row.id,200),title=text(row.title,120),at=Date.parse(row.createdAt);
  if(!kind||kind.app!==sourceApp||!actor.apps.includes(kind.app)||!id||!title||!Number.isFinite(at)||at>Date.now()+300000)return [];
  if(actor.role!=='staff'&&(kind.app==='desk'||kind.staff))return [];
  const key=sourceApp+':'+id;if(seen.has(key))return [];seen.add(key);
  return [{id:key,kind:row.kind,appId:kind.app,title,summary:text(row.summary,240),createdAt:new Date(at).toISOString(),request:!!kind.request&&row.resolved!==true,resolved:row.resolved===true,...(row.kind==='permission-request'&&typeof row.actionId==='string'&&row.actionId.length<=240&&!/[\/\x00-\x1f]/.test(row.actionId)?{actionId:row.actionId}:{})}];
 });
}
export function createActivityFeed({getActor,getToken,onChange,sources,inbox=null,fetcher=fetch,timers={setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id)},isHidden=()=>typeof document!=='undefined'&&document.hidden}){
 let epoch=0,active=false,busy=false,interval,controllers=[],items=[],statuses=[],read=new Set(),history=[],archived=[],nextCursor=null,pendingState=null;
 function emit(){onChange({items:items.map(item=>({...item,read:item.read===true||read.has(item.id+'@'+item.createdAt)})),sources:statuses,loading:busy,history,archived,nextCursor});}
 function stop(){active=false;epoch++;controllers.forEach(c=>c.abort());controllers=[];timers.clearInterval(interval);busy=false;items=[];statuses=[];history=[];archived=[];nextCursor=null;pendingState=null;read.clear();emit();}
 async function refresh(){
  const actor=getActor();if(!active||busy||!actor)return;
  busy=true;const version=epoch;const selected=sources.filter(s=>actor.apps.includes(s.appId)&&(s.appId!=='desk'||actor.role==='staff')&&(!s.staffOnly||actor.role==='staff'));statuses=selected.map(s=>({appId:s.appId,key:s.url,label:s.label,state:'loading'}));emit();
  let token;try{token=await getToken();}catch{if(version===epoch){items=[];statuses=selected.map(s=>({appId:s.appId,key:s.url,label:s.label,state:'error'}));busy=false;emit();}return;}
  if(version!==epoch||getActor()!==actor)return;
  const collected=[];
  await Promise.all(selected.map(async source=>{
   const controller=new AbortController();controllers.push(controller);const deadline=setTimeout(()=>controller.abort(),15000);
   let state='ready',pending=[];
   try{
    const response=await fetcher(source.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(source.callable?{data:{}}:{}),signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error('unavailable');const raw=await response.json(),payload=source.callable?raw.result:raw;
    if(!payload||payload.recipientUid!==actor.uid||!Array.isArray(payload.items))throw Error('invalid response');
    collected.push(...normalizeActivity(payload.items,actor,source.appId));
    pending=(payload.pendingKinds||[]).filter(k=>activityKinds[k]?.app===source.appId).map(k=>activityKinds[k].label);
    if(payload.partial===true||pending.length)state='partial';
   }catch{state='error';}finally{clearTimeout(deadline);controllers=controllers.filter(c=>c!==controller);}
   if(version!==epoch||getActor()!==actor)return;
   statuses=statuses.map(s=>s.key===source.url?{...s,state,pending}:s);
  }));
  if(version!==epoch||getActor()!==actor)return;
  items=[...new Map(collected.map(i=>[i.id,i])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);
  if(inbox){try{
   const saved=await inbox.call({action:'sync',items},token);
   if(version!==epoch||getActor()!==actor)return;
   const states=new Map(saved.states.map(row=>[row.id+'@'+row.createdAt,row]));
   items=items.map(item=>({...item,...Object.fromEntries(['key','state','read'].map(k=>[k,states.get(item.id+'@'+item.createdAt)?.[k]]))})).filter(item=>!item.state||item.state==='active');
   const grants=saved.active.filter(item=>(item.kind==='permission-granted'||item.restored===true)&&actor.apps.includes(item.appId));
   items=[...new Map([...items,...grants].map(i=>[i.id+'@'+i.createdAt,i])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   history=saved.history;archived=saved.archived||[];nextCursor=saved.nextCursor;
   statuses.push({key:'inbox',label:'알림 보관함',state:saved.partial?'partial':'ready'});
  }catch{if(version!==epoch||getActor()!==actor)return;statuses.push({key:'inbox',label:'알림 보관함',state:'error'});}}
  busy=false;emit();
 }
 return {start(){stop();active=true;refresh();interval=timers.setInterval(()=>{if(!isHidden())refresh();},300000);},stop,refresh,async setState(item,state){
   if(!inbox||!item.key)throw Error('알림 저장소 연결을 확인한 뒤 다시 시도해 주세요.');
   if(pendingState)throw Error('다른 알림을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.');
   const operation={};pendingState=operation;const selected=getActor(),version=++epoch;controllers.forEach(c=>c.abort());controllers=[];busy=false;
   try{
    const token=await getToken();if(selected!==getActor()||version!==epoch)return;
    await inbox.call({action:'state',key:item.key,state},token);if(selected!==getActor()||version!==epoch)return;
    const update=row=>row.key===item.key?{...row,state,read:true}:row;
    history=history.map(update);archived=archived.filter(row=>row.key!==item.key);if(state==='archived')archived.unshift({...item,state,read:true});
    items=items.filter(row=>row.key!==item.key);if(state==='active')items.unshift({...item,state,read:true});emit();await refresh();
   }finally{if(pendingState===operation)pendingState=null;}
  },async loadMore(){if(!inbox||!nextCursor)return;const selected=getActor(),version=epoch,token=await getToken();if(version!==epoch)return;const result=await inbox.call({action:'history',cursor:nextCursor},token);if(selected!==getActor()||version!==epoch)return;history=[...new Map([...history,...result.items].map(row=>[row.key,row])).values()];nextCursor=result.nextCursor;emit();},markRead(id){const item=items.find(i=>i.id===id);if(item)read.add(item.id+'@'+item.createdAt);emit();},markAllRead(){items.forEach(i=>read.add(i.id+'@'+i.createdAt));emit();}};
}

export async function decidePermission({getToken,id,status,url='https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubPermissionApi',fetcher=fetch}){
 if(!id||!['APPROVED','REJECTED'].includes(status))throw Error('권한 요청을 확인해 주세요.');
 const token=await getToken();const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({data:{action:'decide',id,status}}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok||data.error)throw Error(data.error?.message||'처리 결과를 확인하지 못했습니다. 새로고침해 현재 상태를 확인해 주세요.');
 if(data.result?.status!==status)throw Error('처리 결과를 확인하지 못했습니다. 새로고침해 주세요.');return data.result;
}

export function createInboxClient(url,fetcher=fetch){return {async call(input,token){
 const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'알림을 저장하지 못했습니다. 다시 시도해 주세요.');return result;
}};}

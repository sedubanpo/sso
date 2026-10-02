// Read-only inbox. Source APIs authenticate the selected Firebase identity.
export const activityKinds={
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
  if(actor.role!=='staff'&&kind.app==='desk')return [];
  const key=sourceApp+':'+id;if(seen.has(key))return [];seen.add(key);
  return [{id:key,kind:row.kind,appId:kind.app,title,summary:text(row.summary,240),createdAt:new Date(at).toISOString(),request:!!kind.request&&row.resolved!==true,resolved:row.resolved===true}];
 });
}
export function createActivityFeed({getActor,getToken,onChange,sources,fetcher=fetch,timers={setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id)},isHidden=()=>typeof document!=='undefined'&&document.hidden}){
 let epoch=0,active=false,busy=false,interval,controllers=[],items=[],statuses=[],read=new Set();
 function emit(){onChange({items:items.map(item=>({...item,read:read.has(item.id+'@'+item.createdAt)})),sources:statuses,loading:busy});}
 function stop(){active=false;epoch++;controllers.forEach(c=>c.abort());controllers=[];timers.clearInterval(interval);busy=false;items=[];statuses=[];read.clear();emit();}
 async function refresh(){
  const actor=getActor();if(!active||busy||!actor)return;
  busy=true;const version=epoch;const selected=sources.filter(s=>actor.apps.includes(s.appId)&&(s.appId!=='desk'||actor.role==='staff'));statuses=selected.map(s=>({appId:s.appId,label:s.label,state:'loading'}));emit();
  let token;try{token=await getToken();}catch{if(version===epoch){items=[];statuses=selected.map(s=>({appId:s.appId,label:s.label,state:'error'}));busy=false;emit();}return;}
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
   statuses=statuses.map(s=>s.appId===source.appId?{...s,state,pending}:s);
  }));
  if(version!==epoch||getActor()!==actor)return;
  items=[...new Map(collected.map(i=>[i.id,i])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);busy=false;emit();
 }
 return {start(){stop();active=true;refresh();interval=timers.setInterval(()=>{if(!isHidden())refresh();},300000);},stop,refresh,markRead(id){const item=items.find(i=>i.id===id);if(item)read.add(item.id+'@'+item.createdAt);emit();},markAllRead(){items.forEach(i=>read.add(i.id+'@'+i.createdAt));emit();}};
}

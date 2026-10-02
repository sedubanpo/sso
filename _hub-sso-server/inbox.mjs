import {createHash} from 'node:crypto';
import {HttpError} from './core.mjs';
const kinds={'desk-task':'desk',attendance:'desk','log-reaction':'lms','exam-request':'lms','consultation-request':'lms','lesson-request':'lms','consultation-reminder':'lms','permission-request':'lms','permission-granted':'lms','hours-consent':'teacher-portal','hours-issue':'teacher-portal'};
const staffKinds=new Set(['desk-task','attendance','permission-request','hours-issue']);
export const inboxKey=item=>createHash('sha256').update(item.id+'@'+item.createdAt).digest('hex');
export function sanitizeItem(item,actor){
 if(!item||typeof item.id!=='string'||item.id.length>200||!item.id||!kinds[item.kind]||kinds[item.kind]!==item.appId||!actor.apps.includes(item.appId)||(staffKinds.has(item.kind)&&actor.role!=='staff'))return null;
 if(typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||Date.parse(item.createdAt)>Date.now()+300000)return null;
 const row={id:item.id,kind:item.kind,appId:item.appId,title:String(item.title||'').slice(0,120),summary:String(item.summary||'').slice(0,240),createdAt:new Date(item.createdAt).toISOString(),request:item.request===true,resolved:item.resolved===true};
 if(!row.title)return null;return row;
}
export function createInboxStore(db){
 return async function handle(actor,input={}){
  const collection=db.collection('_hubInbox').doc(actor.uid).collection('items');
  const visible=docs=>docs.map(doc=>({...doc.data(),key:doc.id})).filter(row=>sanitizeItem(row,actor));
  if(input.action==='state'){
   if(!/^[a-f0-9]{64}$/.test(input.key||'')||!['active','archived','deleted'].includes(input.state))throw new HttpError(400,'알림과 처리 방식을 확인해 주세요.');
   await db.runTransaction(async tx=>{const ref=collection.doc(input.key),snap=await tx.get(ref);if(!snap.exists||!sanitizeItem(snap.data(),actor))throw new HttpError(404,'알림을 찾지 못했습니다.');tx.update(ref,{state:input.state,read:true,restored:input.state==='active',changedAt:new Date().toISOString()});});
   return {saved:true};
  }
  if(input.action==='history'){
   let query=collection.orderBy('createdAt','desc').orderBy('__name__','desc');
   if(input.cursor){if(!/^[a-f0-9]{64}$/.test(input.cursor.key||'')||typeof input.cursor.createdAt!=='string'||!Number.isFinite(Date.parse(input.cursor.createdAt)))throw new HttpError(400,'이력 페이지를 확인해 주세요.');query=query.startAfter(input.cursor.createdAt,input.cursor.key);}
   const result=await query.limit(51).get(),page=result.docs.slice(0,50),last=page.at(-1);
   return {items:visible(page),nextCursor:result.size>50?{key:last.id,createdAt:last.data().createdAt}:null};
  }
  if(input.action!=='sync'||!Array.isArray(input.items)||input.items.length>100)throw new HttpError(400,'알림 목록을 확인해 주세요.');
  const rows=input.items.map(item=>sanitizeItem(item,actor)).filter(Boolean),unique=[...new Map(rows.map(row=>[inboxKey(row),row])).entries()];
  const states=unique.length?await db.runTransaction(async tx=>{
   const refs=unique.map(([key])=>collection.doc(key)),snaps=await tx.getAll(...refs);
   return unique.map(([key,row],i)=>{if(snaps[i].exists)return {...snaps[i].data(),key};const saved={...row,state:'active',read:false,receivedAt:new Date().toISOString()};tx.create(refs[i],saved);return {...saved,key};});
  }):[];
  const [active,history,archived]=await Promise.all([collection.where('state','==','active').orderBy('createdAt','desc').limit(301).get(),collection.orderBy('createdAt','desc').orderBy('__name__','desc').limit(51).get(),collection.where('state','==','archived').orderBy('createdAt','desc').limit(301).get()]);
  const page=history.docs.slice(0,50),last=page.at(-1);
  return {states,archived:visible(archived.docs.slice(0,300)),active:visible(active.docs.slice(0,300)),history:visible(page),nextCursor:history.size>50?{key:last.id,createdAt:last.data().createdAt}:null,partial:active.size>300||archived.size>300};
 };
}

'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const lessonApi=require('./lesson-logs/api');
const DAY=86400000;
const requestKinds=['exam-request','consultation-request','lesson-request'];
const stamp=value=>value?.toDate?value.toDate().toISOString():typeof value==='string'?value:'';
function reactionItems(logs,who,revoked=[],now=Date.now()){
 const identities=new Set(who.identifiers||[who.uid]),items=[];
 for(const log of logs){
  if(!identities.has(String(log.createdById||''))||log.deletedAt||(!who.admin&&revoked.includes(log.studentId)))continue;
  const tags=Array.isArray(log.tags)?log.tags:String(log.tagsText||'').split(',');
  if(!tags.some(tag=>String(tag).includes('상담')))continue;
  let legacy=[];try{legacy=JSON.parse(log.reactionsJson||'[]');}catch{}
  const reactions=[...(Array.isArray(legacy)?legacy:[]),...(Array.isArray(log.reactions)?log.reactions:[]),...Object.values(log.reactionsByUser||{})];
  const unique=new Map();for(const reaction of reactions)if(reaction?.userId)unique.set(reaction.userId,reaction);
  for(const reaction of unique.values()){
   const at=Date.parse(stamp(reaction.reactedAt));
   if(identities.has(String(reaction.userId))||!Number.isFinite(at)||at<now-30*DAY||at>now+300000)continue;
   items.push({id:'reaction:'+log.id+':'+reaction.userId,recipientUid:who.uid,kind:'log-reaction',title:'내 상담일지에 새 반응이 있습니다',summary:String(reaction.userName||'근무자').slice(0,40)+' · '+String(reaction.reaction||'반응').slice(0,40),createdAt:new Date(at).toISOString()});
  }
 }
 return items;
}
function requestItems(rows,who,revoked=[],now=Date.now()){
 return rows.filter(row=>row.recipientUid===who.uid&&requestKinds.includes(row.kind)&&!row.deletedAt&&(!row.studentId||who.admin||!revoked.includes(row.studentId))&&Date.parse(stamp(row.createdAt))>=now-30*DAY&&Date.parse(stamp(row.createdAt))<=now+300000).map(row=>({id:'request:'+row.id,recipientUid:who.uid,kind:row.kind,title:String(row.title||'작성 요청을 확인해 주세요').slice(0,120),summary:String(row.summary||'').slice(0,240),createdAt:stamp(row.createdAt),resolved:['COMPLETED','CANCELLED'].includes(row.status)}));
}
async function query(db,collection,field,value){
 const snapshot=await db.collection(collection).where(field,'==',value).limit(2001).get();
 if(snapshot.size>2000)throw new HttpsError('resource-exhausted','알림 조회 한도를 초과했습니다. 앱에서 확인해 주세요.');
 return snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));
}
async function list(db,uid,now=new Date()){
 const who=await lessonApi.actor(db,uid);
 const ownIds=[...new Set(who.identifiers)].slice(0,16);
 const [logs,requests,source]=await Promise.all([
  Promise.all(ownIds.map(id=>query(db,'studentLogs','createdById',id))),
  query(db,'hubActivityRequests','recipientUid',uid),
  db.collection('hubActivitySources').doc('slms').get()
 ]);
 // Current account and revoked-student state are rechecked after data access.
 const [fresh,policy]=await Promise.all([lessonApi.actor(db,uid),db.collection('studentPermissionPolicyStates').doc(uid).get()]);
 const revoked=policy.data()?.revokedStudentIds||[];
 const items=[...reactionItems([...new Map(logs.flat().map(row=>[row.id,row])).values()],fresh,revoked,now.getTime()),...requestItems(requests,fresh,revoked,now.getTime())];
 const configured=source.data()?.requestKinds||[];
 return {recipientUid:uid,items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,60),pendingKinds:requestKinds.filter(kind=>!configured.includes(kind)),window:'최근 30일'};
}
module.exports={list,reactionItems,requestItems};

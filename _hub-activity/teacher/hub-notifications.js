const {PortalClassLogOverviewEngine:engine}=require('./class-log-overview-engine');
const SUPABASE_URL='https://wfgtqajdkwzuqkwygcft.supabase.co';
// Existing public publishable key, never a service-role key. Caller token preserves RPC scope.
const PUBLIC_KEY='sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
function summarize(result,uid,name,today){
 if(result.success!==true||result.fallbackRequired===true)throw Error('Incomplete source');
 const [year,month]=String(result.monthKey).split('-').map(Number);
 const overview=engine.build(result.attendanceRows||[],result.classLogRows||[],result.signatureRows||[],year,month,{compact:false,batches:[]});
 const items=[];
 for(const day of Object.values(overview.dayMap)){
  if(day.dateKey>=today)continue; // Do not request agreement while today's classes are still running.
  const row=day.teachers.find(r=>engine.teacherName(r.teacher)===engine.teacherName(name));
  if(!row?.hasClass)continue;
  // Same decision as getPortalTeacherHoursLiveFromSupabase_ in the portal.
  const agreed=row.hoursAgreementSource==='signature'||row.status==='제출 완료';
  if(agreed)continue;
  items.push({id:'hours:'+day.dateKey,recipientUid:uid,kind:'hours-consent',title:day.dateKey+' 시수 동의를 확인해 주세요',summary:'수업 '+row.taughtCount+'건 · '+row.taughtHours+'시간 · 아직 동의가 확인되지 않았습니다.',createdAt:day.dateKey+'T23:59:00+09:00'});
 }
 return items;
}
async function load({uid,name,token,now=new Date(),fetcher=fetch}){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const current=new Date(today+'T00:00:00Z'),previous=new Date(current);previous.setUTCMonth(previous.getUTCMonth()-1,1);
 const results=await Promise.allSettled([current,previous].map(async date=>{
  const response=await fetcher(SUPABASE_URL+'/rest/v1/rpc/portal_get_teacher_hours_live',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({payload:{year:date.getUTCFullYear(),month:date.getUTCMonth()+1,teacherName:name}}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Hours source unavailable');
  return summarize(await response.json(),uid,name,today);
 }));
 if(results.every(r=>r.status==='rejected'))throw Error('Hours source unavailable');
 return {recipientUid:uid,items:results.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,60),partial:results.some(r=>r.status==='rejected'),pendingKinds:[],window:'이번 달·지난달의 미동의 수업일',basis:'미동의 상태에서 계산한 알림이며 별도 발송 이력은 아닙니다.'};
}
module.exports={load,summarize};

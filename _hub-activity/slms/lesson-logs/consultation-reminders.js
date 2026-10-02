'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { validDate } = require('./core');
const DAY = 86400000;
const id = value => String(value || '').trim();
const unavailable = new Set(['INACTIVE','STOPPED','SUSPENDED','DISABLED','RETIRED','RESIGNED','TERMINATED','DELETED','비활성','LEAVE','ON_LEAVE','중지','휴원','퇴원','퇴직','퇴사','휴직']);
function active(row) {
  return !!row && row.active !== false && row.isActive !== false && !row.disabled && !row.deletedAt && !row.revokedAt && !row.retiredAt && !row.terminationDate && [row.status,row.studentStatus,row.state,row.accountStatus,row.employmentStatus,row.workStatus].every(value => !unavailable.has(id(value).toUpperCase()));
}
function dateKey(value) {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date) : '';
}
function time(value) { return value?.toMillis ? value.toMillis() : Number(value) || Date.parse(value || '') || 0; }
function identity(value) { const text=id(value); return /^(?:010[- ]?\d{4}[- ]?\d{4}|\d{8})$/.test(text) ? (text.replace(/\D/g,'').length===8?'010':'')+text.replace(/\D/g,'') : text; }
function identifiers(uid,user,profile) {
  return [...new Set([uid,...[user,profile].flatMap(row=>['userId','loginId','instructorId','teacherId','phone','phoneNumber','mobile','mobilePhone'].map(key=>id(row?.[key])))].filter(Boolean))];
}
function permissionRows(docs, actorIds) {
  const keys=new Set(actorIds.map(identity)), rows=[];
  for (const doc of docs) {
    const data=doc.data(); if(!data)continue;
    let ids=Array.isArray(data.instructorIds)?data.instructorIds:[];
    if(!ids.length && data.instructorIdsJson) { try { ids=JSON.parse(data.instructorIdsJson); } catch { ids=[]; } }
    if(!Array.isArray(ids))ids=[];
    if(!ids.length)ids=[data.instructorId || data.userId || data.teacherId || data.uid];
    if(ids.some(value=>keys.has(identity(value))))rows.push({...data,studentId:id(data.studentId || data.id),permission:id(data.permission || data.access || 'ALLOW').toUpperCase()});
  }
  return rows;
}
function buildCandidates({uid, actorIds, students, permissions, lessons, logs, now=new Date()}) {
  const today=dateKey(now), start=new Date(Date.parse(today+'T00:00:00Z')-20*DAY).toISOString().slice(0,10);
  const ownIds=new Set(actorIds.map(identity)), output=[];
  for (const student of students) {
    if(!active(student) || student.isRestricted || student.isAlias || student.mergedInto)continue;
    const studentId=id(student.canonicalStudentId || student.studentId);
    const aliases=new Set([studentId,student.studentId,...(student.studentIdAliases || [])].map(id).filter(Boolean));
    const current=permissions.filter(row=>aliases.has(row.studentId)).sort((a,b)=>time(b.updatedAtMs || b.updatedAt || b.createdAtMs || b.createdAt)-time(a.updatedAtMs || a.updatedAt || a.createdAtMs || a.createdAt))[0];
    if(!active(current) || current.permission!=='ALLOW')continue;
    const granted=dateKey(current.createdAtMs || current.grantedAtMs || current.assignedAtMs || current.createdAt || current.grantedAt || current.assignedAt);
    const recent=lessons.filter(row=>aliases.has(row.studentId) && row.teacherUid===uid && row.minutes>0 && !row.deletedAt && validDate(row.classDate) && row.classDate>=start && row.classDate<=today && (!granted || row.classDate>=granted) && (row.classDate<today || /^([01]\d|2[0-3]):[0-5]\d$/.test(row.end || '') && Date.parse(today+'T'+row.end+':00+09:00')<=new Date(now).getTime())).sort((a,b)=>a.classDate.localeCompare(b.classDate));
    if(!recent.length)continue;
    const own=logs.filter(row=>aliases.has(id(row.studentId)) && ownIds.has(identity(row.createdById)) && !row.deletedAt && row.content && (Array.isArray(row.tags)?row.tags:String(row.tagsText || '').split(',')).some(tag=>String(tag).includes('상담'))).map(row=>dateKey(row.createdAtMs || row.createdAt || row.timestamp)).filter(date=>date && date<=today).sort();
    const last=own.at(-1) || '', baseline=[last || recent[0].classDate,granted || ''].sort().at(-1);
    const days=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(baseline+'T00:00:00Z'))/DAY);
    if(days<14)continue;
    output.push({studentId,studentIdAliases:[...aliases],studentName:student.studentName || student.name || '',school:student.school || '',grade:student.grade || '',gender:['male','female'].includes(student.gender)?student.gender:'',days,lastConsultationDate:last,lastLessonDate:recent.at(-1).classDate,baselineDate:baseline,noConsultationRecord:!last,subjects:[...new Set(recent.map(row=>row.subject).filter(Boolean))]});
  }
  return {today,start,end:today,windowDays:21,thresholdDays:14,complete:true,rows:[...new Map(output.map(row=>[row.studentId,row])).values()].sort((a,b)=>b.days-a.days || a.studentName.localeCompare(b.studentName,'ko'))};
}
async function getDocuments(db,collection,ids) {
  const docs=[];
  for(let offset=0;offset<ids.length;offset+=100)docs.push(...await db.getAll(...ids.slice(offset,offset+100).map(key=>db.collection(collection).doc(key))));
  return docs;
}
async function queryStudentBatches(db,collection,ids) {
  const docs=[];
  for(let offset=0;offset<ids.length;offset+=10) {
    const snapshot=await db.collection(collection).where('studentId','in',ids.slice(offset,offset+10)).limit(5001).get();
    if(snapshot.size>5000)throw new HttpsError('resource-exhausted','상담 알림 조회 한도를 초과했습니다. 관리자에게 문의해 주세요.');
    docs.push(...snapshot.docs);
  }
  return docs;
}
async function load(db,who,sourceLessons,teacherAccounts,teacherDecisions,recheckActor,now=new Date()) {
  if(who.staff || !who.reminderEligible)throw new HttpsError('permission-denied','활성 강사 계정만 상담 알림을 확인할 수 있습니다.');
  const today=dateKey(now), start=new Date(Date.parse(today+'T00:00:00Z')-20*DAY).toISOString().slice(0,10);
  const {monthsBetween}=require('./core');
  const months=monthsBetween(start,today);
  const [accounts,decisions]=await Promise.all([teacherAccounts(db),teacherDecisions(db,months)]);
  const lessons=await sourceLessons(db,months,start,today,who.uid,accounts,decisions,null,false);
  const sourceIds=[...new Set(lessons.map(row=>row.studentId))];
  if(sourceIds.length>1000)throw new HttpsError('resource-exhausted','최근 수업 학생 조회 한도를 초과했습니다.');
  const first=await getDocuments(db,'students',sourceIds);
  const canonicalIds=[...new Set(first.map(doc=>id(doc.data()?.canonicalStudentId || doc.data()?.mergedInto || doc.id)).filter(Boolean))];
  const finalStudents=await getDocuments(db,'students',canonicalIds);
  const students=finalStudents.filter(doc=>doc.exists).map(doc=>({...doc.data(),studentId:doc.id,studentIdAliases:[...new Set([...(doc.data().studentIdAliases || []),...first.filter(item=>id(item.data()?.canonicalStudentId || item.data()?.mergedInto || item.id)===doc.id).map(item=>item.id)])]}));
  const aliases=[...new Set(students.flatMap(row=>[row.studentId,...row.studentIdAliases]))];
  const [permissionDocs,logDocs]=await Promise.all([queryStudentBatches(db,'studentPermissions',aliases),queryStudentBatches(db,'studentLogs',aliases)]);
  // Re-read the current grant, student status and actor after the history read.
  // Deleted grants cannot survive as historical/cached ALLOW rows.
  const [freshPermissions,freshStudents,freshActor]=await Promise.all([
    queryStudentBatches(db,'studentPermissions',aliases),
    getDocuments(db,'students',canonicalIds),recheckActor(db,who.uid)
  ]);
  if(freshActor.staff || !freshActor.reminderEligible)throw new HttpsError('permission-denied','강사 이용 권한을 확인해 주세요.');
  const currentStudents=students.map(student=>{const doc=freshStudents.find(item=>item.id===student.studentId);return doc?.exists?{...student,...doc.data(),studentId:student.studentId,studentIdAliases:student.studentIdAliases}:null;}).filter(Boolean);
  return buildCandidates({uid:who.uid,actorIds:freshActor.identifiers,students:currentStudents,permissions:permissionRows(freshPermissions,freshActor.identifiers),lessons,logs:logDocs.map(doc=>doc.data()),now});
}
module.exports={load,buildCandidates,identifiers,active,permissionRows,dateKey};

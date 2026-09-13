import {onRequest} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import nodemailer from 'nodemailer';
import {createRecovery,validateRecoveryInput} from './recovery.mjs';
const smtpPassword=defineSecret('HUB_RECOVERY_SMTP_PASSWORD');
const hash=s=>createHash('sha256').update(s).digest('hex');
export const hubRecoveryApi=onRequest({region:'asia-northeast3',maxInstances:3,timeoutSeconds:60,secrets:[smtpPassword],invoker:'public'},async(req,res)=>{
 const origin=req.headers.origin;
 if(origin!=='https://sedubanpo.github.io')return res.status(403).json({error:'허용되지 않은 요청입니다.'});
 res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');res.set('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.set('Access-Control-Allow-Methods','POST');res.set('Access-Control-Allow-Headers','Content-Type');return res.status(204).send('');}
 if(req.method!=='POST')return res.status(405).json({error:'POST 요청이 필요합니다.'});
 try{validateRecoveryInput(req.body);}catch{return res.status(400).json({error:'복구 이메일과 생년월일을 확인해 주세요.'});}
 const app=getApps()[0]||initializeApp({projectId:'fir-lms-prod'}),auth=getAuth(app),db=getFirestore(app);
 const sender=process.env.HUB_RECOVERY_SENDER;
 if(!sender)return res.status(503).json({error:'메일 발송 준비 중입니다. 관리자에게 문의해 주세요.'});
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:smtpPassword.value()},connectionTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true});
 const recovery=createRecovery({
  consumeQuota:async({requestKey,email})=>{
   const now=Date.now(),hour=Math.floor(now/3600000),day=Math.floor(now/86400000);
   const specs=[['ip-'+hash(requestKey)+'-'+day,20],['mail-'+hash(email)+'-'+hour,3],['global-'+day,100]];
   return db.runTransaction(async tx=>{const refs=specs.map(([id])=>db.collection('_hubRecoveryLimits').doc(id));const snaps=await tx.getAll(...refs);if(snaps.some((s,i)=>(s.data()?.count||0)>=specs[i][1]))return false;refs.forEach((ref,i)=>tx.set(ref,{count:(snaps[i].data()?.count||0)+1,deleteAfter:new Date(now+172800000)}));return true;});
  },
  // Current account-management schema has no normalized index. Bounded server-only scan supports case-insensitive email without exposing profile fields to clients.
  findProfiles:async()=>{const rows=await db.collection('userProfiles').select('contactEmail','birthDate').limit(1001).get();if(rows.size>1000)throw Error('Recovery profile index required');return rows.docs.map(d=>({uid:d.id,...d.data()}));},
  getUser:async uid=>{try{const [user,profile]=await Promise.all([auth.getUser(uid),db.collection('users').doc(uid).get()]);return {...user,disabled:user.disabled||!profile.exists||['INACTIVE','DISABLED','DELETED'].includes(String(profile.data()?.status||'').toUpperCase())};}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}},
  createResetLink:email=>auth.generatePasswordResetLink(email),
  sendMail:({to,link})=>transport.sendMail({from:{name:'에스에듀 허브',address:sender},to:{address:to},subject:'에스에듀 허브 비밀번호 재설정',text:`비밀번호 재설정을 요청하셨다면 아래 링크에서 새 비밀번호를 설정해 주세요.\n\n${link}\n\n요청한 적이 없다면 이 메일을 무시해 주세요. 링크를 다른 사람에게 전달하지 마세요.`})
 });
 try{return res.json(await recovery(req.body,req.ip||'unknown'));}catch{console.error('hub recovery delivery failed');return res.status(503).json({error:'메일 발송을 완료하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.'});}finally{transport.close();}
});

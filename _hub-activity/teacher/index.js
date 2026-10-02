const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
exports.teacherPortalNotifications = onRequest({region:'asia-northeast3',timeoutSeconds:30,memory:'256MiB',maxInstances:5,cors:['https://sedubanpo.github.io']},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(Object.keys(req.body||{}).length)return res.status(400).json({error:'수신 계정을 지정할 수 없습니다.'});
  try{
    const token=/^Bearer (\S+)$/.exec(String(req.headers.authorization||''))?.[1];
    if(!token)return res.status(401).json({error:'로그인이 필요합니다.'});
    const claims=await admin.auth().verifyIdToken(token,true),db=admin.firestore();
    async function account(){
      const docs=await Promise.all(['users','userProfiles','userAppAccess'].map(c=>db.collection(c).doc(claims.uid).get()));
      const [user,profile,access]=docs.map(d=>d.data()||{}),role=String(user.role||'').toUpperCase();
      const inactive=row=>row.active===false||row.isActive===false||row.disabled===true||row.deletedAt||['INACTIVE','DISABLED','SUSPENDED','DELETED','RETIRED'].includes(String(row.status||'').toUpperCase());
      if(!docs[0].exists||![user,profile,access].every(row=>!inactive(row))||!['ADMIN','SUPER_ADMIN','STAFF','DESK','COORDINATOR','INSTRUCTOR','TEACHER'].includes(role)||(!['ADMIN','SUPER_ADMIN'].includes(role)&&access.apps?.teacherPortal!==true))throw Object.assign(Error('Denied'),{code:'auth/denied'});
      return {role,name:String(user.name||profile.displayName||'').trim()};
    }
    const who=await account();
    if(!['INSTRUCTOR','TEACHER'].includes(who.role))return res.json({recipientUid:claims.uid,items:[],pendingKinds:[]});
    if(!who.name)throw Error('Missing teacher identity');
    const result=await require('./hub-notifications').load({uid:claims.uid,name:who.name,token});
    const fresh=await account();if(fresh.name!==who.name||fresh.role!==who.role)throw Object.assign(Error('Changed identity'),{code:'auth/denied'});
    return res.json(result);
  }catch(error){return res.status(String(error.code||'').startsWith('auth/')?403:503).json({error:'시수 동의 알림을 확인하지 못했습니다.'});}
});

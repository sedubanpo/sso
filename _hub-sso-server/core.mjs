import {createHash, randomBytes} from 'node:crypto';
import {APPS} from './registry.mjs';
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const hash=value=>createHash('sha256').update(value).digest('base64url');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
export function authorizeProfile(uid, user, profile={}, access={}, registry=APPS) {
  const role=String(user.role||'').toUpperCase();
  if(!['ADMIN','STAFF','COORDINATOR','INSTRUCTOR','TEACHER'].includes(role)||user.disabled===true||user.active===false||profile.active===false||['DISABLED','INACTIVE','SUSPENDED','DELETED'].includes(String(user.status||profile.status||'').toUpperCase()))throw new HttpError(403,'이 계정은 허브를 사용할 수 없습니다.');
  const staff=['ADMIN','STAFF','COORDINATOR'].includes(role);
  // Explicit hub-specific grants are optional restrictions; never accept grants supplied by the browser.
  const apps=Object.entries(registry).filter(([id,app])=>{
    if(!staff&&!app.teacher)return false;
    if(access.hubApps&&access.hubApps[id]!==true)return false;
    if(access.apps?.[app.key]===false)return false;
    return true;
  }).map(([id])=>id);
  return {uid,name:String(user.name||profile.displayName||'사용자'),role:staff?'staff':'teacher',apps};
}
export function createBroker({identity, store, registry=APPS, hubOrigins, now=Date.now, random=()=>randomBytes(32).toString('base64url')}) {
  async function session(bearer) {
    if(!bearer)throw new HttpError(401,'상단에서 로그인해 주세요.');
    let decoded;try{decoded=await identity.verify(bearer);}catch{throw new HttpError(401,'로그인이 만료되었습니다. 다시 로그인해 주세요.');}
    const docs=await identity.profile(decoded.uid);
    return {actor:authorizeProfile(decoded.uid,...docs,registry),decoded,docs};
  }
  return async function handle({path,method,origin,bearer,body={}}) {
    if(method!=='POST'&&!(method==='GET'&&['/health','/session'].includes(path)))throw new HttpError(405,'지원하지 않는 요청입니다.');
    if(path==='/exchange') {
      if(method!=='POST'||!Object.hasOwn(registry,body.appId)||!tokenPattern.test(body.code||'')||!tokenPattern.test(body.verifier||'')||!tokenPattern.test(body.nonce||''))throw new HttpError(400,'연결 요청을 확인해 주세요.');
      if(origin!==new URL(registry[body.appId].url).origin)throw new HttpError(403,'허용되지 않은 앱 주소입니다.');
      const ticket=await store.consume(hash(body.code), record=>record&&record.appId===body.appId&&record.nonce===body.nonce&&record.challenge===hash(body.verifier)&&record.origin===origin&&record.expiresAt>now());
      if(!ticket)throw new HttpError(401,'연결이 만료되었거나 이미 사용되었습니다. 앱을 다시 열어 주세요.');
      const user=await identity.user(ticket.uid);
      if(user.disabled||Date.parse(user.tokensValidAfterTime||'1970-01-01')>ticket.authTime*1000)throw new HttpError(401,'로그인이 해제되었습니다. 다시 로그인해 주세요.');
      const docs=await identity.profile(ticket.uid);
      if(!authorizeProfile(ticket.uid,...docs,registry).apps.includes(ticket.appId))throw new HttpError(403,'이 앱의 사용 권한이 없습니다.');
      return {customToken:await identity.mint(ticket.uid),uid:ticket.uid};
    }
    if(!hubOrigins.includes(origin))throw new HttpError(403,'허용되지 않은 허브 주소입니다.');
    if(path==='/health')return {ready:true};
    const {actor,decoded,docs}=await session(bearer);
    const present=actor=>({...actor,appEntries:Object.fromEntries(actor.apps.map(id=>[id,registry[id]]))});
    const maySwitch=async()=>String(docs[0]?.role).toUpperCase()==='ADMIN'&&!!identity.isOperator&&await identity.isOperator(decoded.uid);
    if(path==='/session')return {...present(actor),canSwitchWorker:await maySwitch()};
    if(path==='/workers'||path==='/switch-worker'){
      if(method!=='POST'||!await maySwitch())throw new HttpError(403,'이 계정은 근무자 계정을 선택할 수 없습니다.');
      if(path==='/workers'){
        const workers=[];
        const [candidates,icons]=await Promise.all([identity.workers(),identity.positionIcons?.().catch(()=>({}))||{}]);
        for(const candidate of candidates){
          try{const target=authorizeProfile(candidate.uid,...candidate.docs,registry);if(target.role==='staff'){const position=String(candidate.docs[0]?.staffPosition||candidate.docs[1]?.staffPosition||'').slice(0,40);const icon=icons[position];workers.push({uid:target.uid,name:target.name,position,iconUrl:typeof icon==='string'&&/^https:\/\//.test(icon)?icon:''});}}catch{}
        }
        return {workers,operator:{uid:actor.uid,name:actor.name}};
      }
      if(typeof body.uid!=='string'||!body.uid||body.uid.length>128)throw new HttpError(400,'근무자를 선택해 주세요.');
      const [targetUser,targetDocs]=await Promise.all([identity.user(body.uid),identity.profile(body.uid)]);
      const target=authorizeProfile(body.uid,...targetDocs,registry);
      if(targetUser.disabled||target.role!=='staff')throw new HttpError(403,'활성 근무자 계정만 선택할 수 있습니다.');
      await identity.auditSwitch({operatorUid:decoded.uid,targetUid:target.uid,at:now()});
      return {actor:present(target),customToken:await identity.mint(target.uid)};
    }
    if(path==='/ticket') {
      if(!actor.apps.includes(body.appId))throw new HttpError(403,'이 앱의 사용 권한이 없습니다.');
      if(!tokenPattern.test(body.challenge||'')||!tokenPattern.test(body.nonce||''))throw new HttpError(400,'연결 요청 형식이 올바르지 않습니다.');
      const code=random();
      await store.put(hash(code),{uid:actor.uid,appId:body.appId,origin:new URL(registry[body.appId].url).origin,nonce:body.nonce,challenge:body.challenge,authTime:decoded.auth_time,expiresAt:now()+60000});
      return {code,expiresIn:60};
    }
    throw new HttpError(404,'요청을 찾지 못했습니다.');
  };
}
export function memoryStore(){const records=new Map();return {async put(key,value){for(const [k,v] of records)if(v.expiresAt<Date.now())records.delete(k);records.set(key,value);},async consume(key,valid){const r=records.get(key);if(!valid(r))return null;records.delete(key);return r;}};}

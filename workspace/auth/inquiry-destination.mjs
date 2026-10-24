// A route hint, never an authorization grant. Only the server-provided app entry is used.
const UUID=/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const messages={INVALID_INQUIRY:'문의 링크가 올바르지 않습니다. 노션에서 등록 링크를 다시 열어 주세요.',INQUIRY_EXPIRED:'문의 링크의 대기 시간이 지났습니다. 노션에서 등록 링크를 다시 열어 주세요.',INQUIRY_FORBIDDEN:'이 계정으로 인트라넷에 접근할 수 없습니다. 등록 담당자의 권한을 확인해 주세요.',INQUIRY_ACTOR_CHANGED:'로그인 계정이 변경되었습니다. 노션에서 문의 링크를 다시 열어 주세요.'};
export function createInquiryDestination({href,now=Date.now,ttl=15*60*1000,allowedOrigins=['https://sedu-intranet-prod.web.app']}){
 const params=new URL(href).searchParams;let inquiry=null,invalid=false,actorUid=null,pending=false,actorEntry=null;
 const startedAt=now();
 if(params.has('inquiry')){
  const value=params.get('inquiry')||'';
  if(params.getAll('inquiry').length!==1||params.getAll('app').length!==1||params.get('app')!=='intranet'||!UUID.test(value))invalid=true;
  else {const id=value.replace(/-/g,'').toLowerCase();inquiry=`${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;pending=true;}
 }
 function clear(){inquiry=null;invalid=false;actorUid=null;actorEntry=null;pending=false;}
 function fail(code){clear();throw Object.assign(Error(messages[code]),{code});}
 function check(){if(invalid)fail('INVALID_INQUIRY');if(inquiry&&(now()<startedAt||now()-startedAt>=ttl))fail('INQUIRY_EXPIRED');}
 return {
  clear,
  resume(actor){check();if(!inquiry)return false;if(!actor?.uid||!actor.apps?.includes('intranet')||!actor.appEntries?.intranet?.url)fail('INQUIRY_FORBIDDEN');if(actorUid&&actorUid!==actor.uid)fail('INQUIRY_ACTOR_CHANGED');actorUid=actor.uid;actorEntry=new URL(actor.appEntries.intranet.url).href;return true;},
  entry(appId,entry,uid){if(appId!=='intranet')return entry;check();if(!inquiry)return entry;if(!actorUid||uid!==actorUid)fail('INQUIRY_ACTOR_CHANGED');const url=new URL(entry);if(!allowedOrigins.includes(url.origin)||url.username||url.password||entry!==new URL(actorEntry).href)fail('INQUIRY_FORBIDDEN');url.hash=`/accounts/intake?inquiry=${inquiry}`;return url.href;},
  connected(appId,uid){if(appId==='intranet'&&uid===actorUid)pending=false;},
  query(appId){const q=new URLSearchParams({app:appId});if(appId==='intranet'&&inquiry&&pending)q.set('inquiry',inquiry);return '?'+q;}
 };
}

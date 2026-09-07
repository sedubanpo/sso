import {createHubAuth} from './auth/hub-auth.mjs';
import {createConnection} from './auth/connection.mjs';
'use strict';
const apps = [
 {id:'timetable',name:'라이브 시간표',description:'당일 수업 현황과 반 배정 확인',url:'https://sedubanpo.github.io/timetable',icon:'calendar'},
 {id:'teacher-portal',name:'강사 포털',description:'출결, 수업 기록, 자료 업로드',url:'https://sedubanpo.github.io/t-portal/',icon:'book'},
 {id:'lms',name:'에스LMS',description:'티칭로그와 수업 자료 확인',url:'https://fir-lms-prod.web.app/',icon:'layers'},
 {id:'desk',name:'데스크 포털',description:'상담, 등록, 학생 관리',url:'https://sedubanpo.github.io/desk-portal/',icon:'desk',staff:true},
 {id:'fees',name:'수강료 계산기',description:'수강 유형별 수강료 계산',url:'https://sedubanpo.github.io/feecalc/',icon:'calculator',staff:true},
 {id:'synchro',name:'싱크로에스',description:'강사·학생 시간표 충돌 확인',url:'https://synchro-s.vercel.app/synchro-s',icon:'sync',staff:true},
 {id:'accounts',name:'계정 관리',description:'학생 상태와 강사 계정 관리',url:'https://sedubanpo.github.io/s-lms/account-management/',icon:'users',staff:true},
 {id:'intranet',name:'인트라넷',description:'일일 업무와 학원 내부 소통',url:'https://sedu-intranet-prod.web.app/?v=daily-workspace-20260906',icon:'building',staff:true,external:true}
];
const paths={calendar:'M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1m3 9h2m4 0h2m-8 3h2',book:'M12 5v15M12 6C9 3 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-2-9 1',layers:'m12 3 10 5-10 5L2 8l10-5m-10 9 10 5 10-5M2 17l10 5 10-5',desk:'M3 4h18v12H3zM8 21h8m-4-5v5',calculator:'M5 2h14v20H5zM8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1',sync:'M3 8h15l-4-4m4 4-4 4M21 16H6l4-4m-4 4 4 4',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',building:'M4 21V3h12v18M16 9h4v12M2 21h20M8 7h1m3 0h1M8 11h1m3 0h1M8 15h1m3 0h1M8 21v-3h4v3',panel:'M3 4h18v16H3zM9 4v16m4-11 3 3-3 3',menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M18 6 6 18',reload:'M20 7v5h-5M4 17v-5h5M5 8a7 7 0 0 1 12-3l3 4M4 15l3 4a7 7 0 0 0 12-3'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
const $=id=>document.getElementById(id);
let role='teacher',selected='',timer,tooltipTimer,actor=null,hubAuth=null,authBusy=false;
const connections=new Map(),frames=new Map(),connectionStates=new Map();
const brokerUrl=window.SEDU_HUB_CONFIG?.brokerUrl||'';
const mobile=matchMedia('(max-width:760px)');
$('expand').innerHTML=icon('panel');$('open-menu').innerHTML=icon('menu');$('close-menu').innerHTML=icon('close');$('reload').innerHTML=icon('reload');$('close-help').innerHTML=icon('close');
$('hub-login').addEventListener('submit',loginFromHeader);
function hideTip(){clearTimeout(tooltipTimer);$('tooltip').hidden=true;document.querySelectorAll('[aria-describedby="tooltip"]').forEach(el=>el.removeAttribute('aria-describedby'));}
$('tooltip').addEventListener('mouseenter',()=>clearTimeout(tooltipTimer));$('tooltip').addEventListener('mouseleave',hideTip);
function showTip(button,app){if(document.body.classList.contains('expanded')||mobile.matches)return;hideTip();$('tooltip').innerHTML=`<strong>${app.name}</strong><small>${app.description}</small>`;$('tooltip').hidden=false;$('tooltip').style.top=Math.min(button.getBoundingClientRect().top,innerHeight-$('tooltip').offsetHeight-12)+'px';button.setAttribute('aria-describedby','tooltip');}
function drawNavigation(){
 $('navigation').replaceChildren();if(!actor)return;
 for(const staff of [false,true]){if(staff&&role==='teacher')continue;const group=document.createElement('section');group.className='nav-group';group.setAttribute('aria-label',staff?'실무자 운영':'수업 운영');group.innerHTML=`<h2 class="group-label">${staff?'실무자 운영':'수업 운영'}</h2>`;
 for(const app of apps.filter(a=>!!a.staff===staff&&actor?.apps.includes(a.id))){const button=document.createElement('button');button.className='nav-item';button.dataset.app=app.id;button.setAttribute('aria-label',`${app.name}, ${app.description}`);button.innerHTML=icon(app.icon)+`<span class="nav-copy"><strong>${app.name}</strong><small>${app.description}</small></span>`;button.addEventListener('click',()=>{selectApp(app.id);if(mobile.matches)closeMenu();});button.addEventListener('mouseenter',()=>showTip(button,app));button.addEventListener('mouseleave',()=>{tooltipTimer=setTimeout(hideTip,150);});button.addEventListener('focus',()=>showTip(button,app));button.addEventListener('blur',hideTip);group.append(button);} $('navigation').append(group);}
}
function setGate(title,message,retry=false){$('auth-gate').hidden=false;$('gate-title').textContent=title;$('gate-message').textContent=message;$('retry-connection').hidden=!retry;}
function renderSelected(){
 const app=apps.find(a=>a.id===selected);if(!app)return;
 const state=connectionStates.get(selected);
 for(const [id,frame] of frames)frame.hidden=id!==selected||state?.state!=='ready';
 $('external-panel').hidden=true;
 if(state?.state==='ready'){
   if(actor.appEntries[selected].external){setGate('새 탭에서 연결되었습니다','열린 앱 탭에서 업무를 이어가세요.');}
   else $('auth-gate').hidden=true;
 }else if(state?.state==='error')setGate('앱에 연결하지 못했습니다',state.message,true);
 else setGate(actor.appEntries[selected].external?'새 탭에서 이용하는 앱입니다':'로그인을 연결하고 있습니다…',actor.appEntries[selected].external?'상단의 새 탭 열기로 같은 계정을 연결하세요.':'계정과 앱 사용 권한을 확인하고 있습니다.');
}
function connectApp(id,external=false){
 const app=apps.find(a=>a.id===id),entry=actor?.appEntries[id];if(!entry||!app)return;
 if(connections.has(id)){connections.get(id).stop();connections.delete(id);}
 if(frames.has(id)){frames.get(id).remove();frames.delete(id);}
 let target,frame;
 if(external){target=null;}
 else{frame=document.createElement('iframe');frame.title=app.name;frame.referrerPolicy='strict-origin-when-cross-origin';frame.hidden=true;$('frame-host').append(frame);frames.set(id,frame);target=frame.contentWindow;}
 connectionStates.set(id,{state:'pending'});
 const expectedActor=actor;
 const connection=createConnection({appId:id,entry:entry.url,target,brokerUrl,getIdToken:()=>{if(actor!==expectedActor)throw Error('로그인 계정이 변경되었습니다.');return hubAuth.getIdToken();},onState:(state,message)=>{
   if(actor!==expectedActor)return;connectionStates.set(id,{state,message});$('connection-state').textContent=state==='ready'?'인증 연결 완료':message||'인증 연결 중';if(selected===id)renderSelected();
 }});
 connections.set(id,connection);
 if(frame)frame.src=connection.url;else {target=window.open(connection.url,'_blank');if(!target){connection.stop();connections.delete(id);connectionStates.set(id,{state:'error',message:'팝업이 차단되었습니다. 브라우저에서 새 탭 열기를 허용해 주세요.'});}else connection.setTarget(target);}
 renderSelected();
}
function selectApp(id,updateUrl=true){
 if(!actor)return;
 const app=apps.find(a=>a.id===id&&actor.apps.includes(a.id))||apps.find(a=>actor.apps.includes(a.id));
 if(!app){setGate('사용할 수 있는 앱이 없습니다','관리자에게 앱 사용 권한을 확인해 주세요.');return;}
 $('external').hidden=false;selected=app.id;clearTimeout(timer);hideTip();closeHelp(false);
 document.querySelectorAll('.nav-item').forEach(b=>{if(b.dataset.app===selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 document.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest'});
 $('current-app').textContent=app.name;$('current-app').title=app.name+' · '+app.description;$('app-description').textContent=app.description;document.title=`${app.name} · 에스에듀 허브`;
 $('external').href=app.url;$('external-cta').href=app.url;$('reload').hidden=!!actor.appEntries[selected].external;
 if(!connections.has(selected)&&!actor.appEntries[selected].external)connectApp(selected);else renderSelected();
 if(updateUrl)history.replaceState(null,'',`?app=${selected}`);
 document.querySelector('.skip').href=`?app=${selected}#workspace`;
}
async function loginFromHeader(event){
 event.preventDefault();if(authBusy||event.isComposing)return;authBusy=true;
 const fields=$('hub-login').querySelector('fieldset'),password=$('login-password').value;fields.disabled=true;$('auth-state').textContent='로그인 중';
 try{
   const result=await hubAuth.login($('login-id').value,password);if(!result)return;
   actor=result;role=actor.role;$('hub-login').hidden=true;$('user-strip').hidden=false;$('user-name').textContent=actor.name;$('login-password').value='';
   drawNavigation();selectApp(new URLSearchParams(location.search).get('app'));$('current-app').focus();
 }catch(error){$('auth-state').textContent='로그인 실패';setGate('로그인하지 못했습니다',error.message||'로그인 정보를 확인해 주세요.');}
 finally{authBusy=false;fields.disabled=false;$('login-password').value='';}
}
async function logoutHub(){
 if(authBusy)return;authBusy=true;$('logout').disabled=true;actor=null;
 const logoutResults=await Promise.all([...connections.values()].map(connection=>connection.logout().catch(()=>false)));connections.clear();
 for(const frame of frames.values())frame.remove();frames.clear();connectionStates.clear();
 try{await hubAuth.logout();}finally{
  $('hub-login').hidden=false;$('user-strip').hidden=true;$('logout').disabled=false;$('auth-state').textContent='로그인';$('current-app').textContent='작업공간';$('external').hidden=true;$('reload').hidden=true;drawNavigation();setGate('로그아웃되었습니다',logoutResults.every(Boolean)?'상단에서 다시 로그인할 수 있습니다.':'허브 로그아웃은 완료했습니다. 연결이 끊긴 앱이나 별도로 연 탭의 로그아웃은 해당 앱에서 확인해 주세요.');authBusy=false;$('login-id').focus();
 }
}
$('logout').onclick=logoutHub;
$('external').onclick=event=>{if(actor){event.preventDefault();connectApp(selected,true);}};
$('retry-connection').onclick=()=>actor?connectApp(selected,!!actor.appEntries[selected]?.external):bootAuthentication();
function closeMenu(){document.body.classList.remove('menu-open');$('backdrop').hidden=true;$('open-menu').setAttribute('aria-expanded','false');$('topbar').inert=false;$('workspace').inert=false;$('sidebar').inert=mobile.matches;if(mobile.matches)$('open-menu').focus();}
$('open-menu').onclick=()=>{closeHelp(false);document.body.classList.add('menu-open');$('backdrop').hidden=false;$('open-menu').setAttribute('aria-expanded','true');$('sidebar').inert=false;$('topbar').inert=true;$('workspace').inert=true;$('close-menu').focus();};
$('close-menu').onclick=closeMenu;$('backdrop').onclick=closeMenu;
$('expand').onclick=()=>{hideTip();const expanded=document.body.classList.toggle('expanded');$('expand').setAttribute('aria-checked',String(expanded));$('expand').title=expanded?'메뉴 설명 접기':'메뉴 설명 펼치기';};
function closeHelp(restoreFocus=true){const wasOpen=!$('help-panel').hidden;$('help-panel').hidden=true;$('help').setAttribute('aria-expanded','false');if(wasOpen&&restoreFocus)$('help').focus();}
$('help').onclick=()=>{const open=$('help-panel').hidden;$('help-panel').hidden=!open;$('help').setAttribute('aria-expanded',String(open));};
$('close-help').onclick=()=>closeHelp();
document.addEventListener('pointerdown',event=>{if(!$('help-panel').contains(event.target)&&!$('help').contains(event.target))closeHelp(false);});
$('reload').onclick=()=>connectApp(selected);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideTip();closeHelp();if(document.body.classList.contains('menu-open'))closeMenu();}if(e.key==='Tab'&&document.body.classList.contains('menu-open')){const focusable=[$('close-menu'),...document.querySelectorAll('.nav-item')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
mobile.addEventListener('change',()=>{closeMenu();hideTip();});$('navigation').addEventListener('scroll',hideTip);window.addEventListener('resize',hideTip);
function tick(){const now=new Date();$('date').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(now);$('time').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);$('date').dateTime=now.toISOString();$('time').dateTime=now.toISOString();$('help-time').textContent=$('date').textContent+' · '+$('time').textContent+' (서울)';$('help-time').dateTime=now.toISOString();}tick();setInterval(tick,1000);
$('sidebar').inert=mobile.matches;$('external').hidden=true;$('reload').hidden=true;$('current-app').textContent='작업공간';
export async function bootAuthentication(sdkFactory){
 hubAuth=await createHubAuth({brokerUrl,...(sdkFactory?{sdkFactory}:{})});
 const ready=brokerUrl&&await hubAuth.available();
 $('hub-login').querySelector('fieldset').disabled=!ready;
 $('auth-state').textContent=ready?'로그인':'서버 연결 필요';
 if(!ready)setGate('통합 인증 서버 연결이 필요합니다','로그인 연동 코드는 준비되었지만 인증 서버와 앱별 수신 코드가 아직 운영 환경에 적용되지 않았습니다.',true);
}
if(document.querySelector('script[data-hub-start]'))bootAuthentication();

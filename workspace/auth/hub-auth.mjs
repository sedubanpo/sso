const FIREBASE_CONFIG={apiKey:'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',authDomain:'fir-lms-prod.firebaseapp.com',projectId:'fir-lms-prod'};
export function normalizeIdentifier(value){
  const text=value.trim();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return text;
  let digits=text.replace(/[\s()-]/g,'');if(/^\d{8}$/.test(digits))digits='010'+digits;
  if(!/^0\d{8,10}$/.test(digits))throw Error('이메일 또는 휴대전화 번호를 확인해 주세요.');
  return digits+'@sedu-auth.local';
}
async function loadFirebase(){
  const [{initializeApp},sdk]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js')]);
  // Memory-only: do not inspect or reuse credentials saved by other sessions/apps.
  const auth=sdk.initializeAuth(initializeApp(FIREBASE_CONFIG,'sedu-hub'),{persistence:sdk.inMemoryPersistence});
  return {login:async(id,password)=>{
    let email=id;
    if(id.endsWith('@sedu-auth.local')){
      const phone=id.split('@')[0],candidates=[phone,...(phone.startsWith('010')?[phone.slice(3)]:[])];
      for(const candidate of candidates){
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(candidate));
        const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        const r=await fetch('https://firestore.googleapis.com/v1/projects/fir-lms-prod/databases/(default)/documents/loginAliases/'+hash,{signal:AbortSignal.timeout(10000)});
        if(r.status===404)continue;
        if(!r.ok)throw Error('계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        const data=(await r.json()).fields||{};
        if(data.active?.booleanValue===false)throw Error('사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.');
        if(data.email?.stringValue){email=data.email.stringValue;break;}
      }
    }
    return sdk.signInWithEmailAndPassword(auth,email,password);
  },logout:()=>sdk.signOut(auth),get user(){return auth.currentUser;}};
}
export async function createHubAuth({brokerUrl,sdkFactory=loadFirebase}){
  let sdk=null,actor=null,generation=0;
  async function request(path,body){
    const user=sdk?.user;if(!user)throw Error('상단에서 로그인해 주세요.');
    const token=await user.getIdToken();
    const response=await fetch(brokerUrl+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'사용 권한을 확인하지 못했습니다.');return result;
  }
  return {
    async available(){try{const r=await fetch(brokerUrl+'/health',{signal:AbortSignal.timeout(5000)});return r.ok&&(await r.json()).ready===true;}catch{return false;}},
    async login(identifier,password){
      const id=normalizeIdentifier(identifier);if(!password)throw Error('비밀번호를 입력해 주세요.');
      const version=++generation;
      try{
        if(!sdk)sdk=await sdkFactory();
        if(version!==generation)return null;
        await sdk.login(id,password);
        if(version!==generation){await sdk.logout();return null;}
        const result=await request('/session');
        if(version!==generation){await sdk.logout();return null;}
        actor=result;return result;
      }catch(error){actor=null;await sdk?.logout();
        if(error.code==='auth/invalid-credential'||error.code==='auth/wrong-password'||error.code==='auth/user-not-found')throw Error('아이디 또는 비밀번호를 확인해 주세요.');
        if(error.code==='auth/too-many-requests')throw Error('로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
        throw error;
      }
    },
    async getIdToken(){if(!sdk?.user||!actor)throw Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');return sdk.user.getIdToken();},
    async logout(){generation++;actor=null;await sdk?.logout();}
  };
}

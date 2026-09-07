import {onRequest} from 'firebase-functions/v2/https';
import {firebaseBroker} from './firebase.mjs';
import {createHttpHandler} from './http.mjs';
import {APPS} from './registry.mjs';
let handler;
export const hubSsoApi=onRequest({region:'asia-northeast3',maxInstances:10,invoker:'public'},(req,res)=>{
  if(!handler){
    const hubOrigins=String(process.env.HUB_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!hubOrigins.length){res.status(503).json({error:'허브 주소 설정이 필요합니다.'});return;}
    const allowedOrigins=[...hubOrigins,...Object.values(APPS).map(a=>new URL(a.url).origin)];
    handler=createHttpHandler({broker:firebaseBroker(hubOrigins),allowedOrigins});
  }
  return handler(req,res);
});

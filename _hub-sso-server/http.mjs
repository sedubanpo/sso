import {HttpError} from './core.mjs';
export function createHttpHandler({broker,allowedOrigins,ready=true}) {
  return async (req,res)=>{
    const origin=req.headers.origin||(req.method==='GET'?allowedOrigins.find(value=>new URL(value).host===req.headers.host):undefined);
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Vary','Origin');
    if(!allowedOrigins.includes(origin)){res.statusCode=403;res.end(JSON.stringify({error:'허용되지 않은 연결 주소입니다.'}));return;}
    res.setHeader('Access-Control-Allow-Origin',origin);
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.statusCode=204;res.end();return;}
    if(!ready){res.statusCode=503;res.end(JSON.stringify({error:'통합 인증 서버가 아직 연결되지 않았습니다.'}));return;}
    try{
      if(req.method==='POST'&&!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'JSON 요청이 필요합니다.');
      let body=req.body;
      if(body===undefined){let raw='';for await(const part of req){raw+=part;if(raw.length>4096)throw new HttpError(413,'요청이 너무 큽니다.');}try{body=raw?JSON.parse(raw):{};}catch{throw new HttpError(400,'요청 형식이 올바르지 않습니다.');}}
      if(Buffer.byteLength(JSON.stringify(body??{}))>4096)throw new HttpError(413,'요청이 너무 큽니다.');
      if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'요청 형식이 올바르지 않습니다.');
      const path=new URL(req.url,'http://localhost').pathname.replace(/^\/api\/hub/,'');
      const result=await broker({path,method:req.method,origin,bearer:/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1],body});
      res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({error:error instanceof HttpError?error.message:'인증 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'}));}
  };
}

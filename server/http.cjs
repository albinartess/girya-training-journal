'use strict';
const http=require('node:http');
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const {readFile,stat}=require('node:fs/promises');
const path=require('node:path');
const {createAuth,ApiError,equal}=require('./auth.cjs');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
function createServer({db,config,mailer,clock,logger=console}) {
  const auth=createAuth(db,config,mailer,clock),staticRoot=path.resolve(__dirname,'../dist');
  const sessionName=config.production?'__Host-girya_session':'girya_dev_session',csrfName=config.production?'__Host-girya_csrf':'girya_dev_csrf';
  const sign=value=>createHmac('sha256',config.sessionSecret).update(value).digest('hex');
  const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production?'; Secure':''}`;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
  function requireSession(cookies){const current=auth.session(cookies[sessionName]);if(!current)throw new ApiError(401,'AUTH_REQUIRED','Войди в аккаунт.');return current}
  async function body(req){if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new ApiError(415,'JSON_REQUIRED','Нужен JSON.');let size=0,raw='';for await(const chunk of req){size+=chunk.length;if(size>4096)throw new ApiError(413,'BODY_TOO_LARGE','Слишком большой запрос.');raw+=chunk}try{const result=JSON.parse(raw);if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result}catch{throw new ApiError(400,'INVALID_JSON','Некорректный запрос.')}}
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Request-ID',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    let url;try{url=new URL(req.url,config.origin)}catch{return json(res,400,{error:{code:'INVALID_URL',message:'Некорректный адрес.'},request_id:requestId})}
    try {
      if(url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin, Cookie');
        const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>{const at=x.indexOf('=');return at<0?['','']:[x.slice(0,at).trim(),x.slice(at+1)]}));
        if(req.method!=='GET') {
          const csrf=cookies[csrfName]||'',parts=csrf.split('.');
          if(req.headers.origin!==config.origin||req.headers['sec-fetch-site']==='cross-site'||parts.length!==2||!equal(sign(parts[0]),parts[1])||!equal(csrf,req.headers['x-csrf-token']))throw new ApiError(403,'CSRF_REJECTED','Обнови страницу и повтори действие.');
        }
        const route=req.method+' '+url.pathname;
        if(route==='GET /api/v1/health/live')return json(res,200,{status:'ok'});
        if(route==='GET /api/v1/health/ready'){
          db.prepare('SELECT 1').get();
          const schema=db.prepare('SELECT max(version) v FROM schema_migrations').get().v;
          return json(res,config.smtpReady&&schema===1?200:503,{status:config.smtpReady&&schema===1?'ready':'not_ready',email:config.smtpReady?'configured':'unavailable'});
        }
        if(route==='GET /api/v1/auth/config')return json(res,200,{enabled:config.smtpReady,protocol_version:1});
        if(route==='GET /api/v1/auth/csrf'){
          const nonce=randomBytes(32).toString('base64url'),token=nonce+'.'+sign(nonce);
          res.setHeader('Set-Cookie',cookie(csrfName,token,3600));return json(res,200,{csrf_token:token});
        }
        const ip=config.trustProxy?(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress:req.socket.remoteAddress;
        if(route==='POST /api/v1/auth/code'){const input=await body(req);return json(res,200,await auth.code(input.email,ip))}
        if(route==='POST /api/v1/auth/login'){
          const input=await body(req),result=auth.login(input.challenge_id,input.code,ip);
          // Repeated login replaces this browser's session, not other devices.
          const prior=auth.session(cookies[sessionName]);if(prior)auth.revoke(prior);
          res.setHeader('Set-Cookie',cookie(sessionName,result.token,30*24*3600));return json(res,200,{user:result.user});
        }
        if(route==='GET /api/v1/me'){
          const current=requireSession(cookies),settings=db.prepare('SELECT name,timezone,version FROM user_settings WHERE user_id=?').get(current.user_id);
          return json(res,200,{user:{id:current.user_id,email:current.email},settings,server_time:new Date(clock?clock():Date.now()).toISOString(),protocol_version:1});
        }
        if(['POST /api/v1/auth/logout','POST /api/v1/auth/logout-all'].includes(route)){
          const current=requireSession(cookies);await body(req);auth.revoke(current,route.endsWith('logout-all'));res.setHeader('Set-Cookie',cookie(sessionName,'',0));return json(res,200,{ok:true});
        }
        throw new ApiError(404,'NOT_FOUND','Запрос недоступен.');
      }
      if(!['GET','HEAD'].includes(req.method))throw new ApiError(405,'METHOD_NOT_ALLOWED','Метод недоступен.');
      if(url.pathname==='/dist'||url.pathname==='/dist/') {res.writeHead(302,{Location:'/'});return res.end()}
      // Only allow files in the public shell. Never serve project root, database or secrets.
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(name.includes('/')||name.startsWith('.')||!MIME[path.extname(name)])throw new ApiError(404,'NOT_FOUND','Страница не найдена.');
      const filename=path.join(staticRoot,name);await stat(filename);
      res.setHeader('Content-Type',MIME[path.extname(name)]);res.setHeader('Cache-Control','no-cache');
      if(name==='sw.js')res.setHeader('Service-Worker-Allowed','/');
      res.writeHead(200);res.end(req.method==='HEAD'?undefined:await readFile(filename));
    } catch(e) {
      const known=e instanceof ApiError,status=known?e.status:e.code==='ENOENT'?404:500;
      if(e.retryAfter)res.setHeader('Retry-After',e.retryAfter);
      if(!known&&status!==404)logger.error(JSON.stringify({request_id:requestId,event:'request_failed',status}));
      json(res,status,{error:{code:known?e.code:status===404?'NOT_FOUND':'INTERNAL_ERROR',message:known?e.message:'Не удалось выполнить запрос.'},request_id:requestId});
    }
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  return server;
}
module.exports={createServer};

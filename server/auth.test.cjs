'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {openDatabase,migrate}=require('./database.cjs');
const {createAuth,emailAddress}=require('./auth.cjs');
const {config}=require('./config.cjs');
const {createServer}=require('./http.cjs');
function fixture(t,extra={}){
  const db=openDatabase(':memory:');migrate(db);migrate(db);t.after(()=>db.close());
  let now=Date.now(),fail=false;const messages=[];
  const cfg={production:false,origin:'http://localhost:3000',smtpReady:true,codeSecret:'c'.repeat(64),sessionSecret:'s'.repeat(64),from:'test@example.test',...extra};
  const mailer={async sendMail(message){if(fail)throw Error('SMTP failure with sensitive details');messages.push(message);return {accepted:[message.to],rejected:[]}}};
  const auth=createAuth(db,cfg,mailer,()=>now);
  return {db,cfg,mailer,messages,auth,advance(ms){now+=ms},setFail(value){fail=value},digits(){return messages.at(-1).text.match(/\d{6}/)[0]}};
}
test('email normalization retains plus and dots, rejects malformed addresses',()=>{
  assert.equal(emailAddress(' A.B+tag@EXAMPLE.com '),'a.b+tag@example.com');
  for(const value of ['a\n@example.com','x@@example.com','x@localhost','..a@example.com',{},''])assert.throws(()=>emailAddress(value));
});
test('successful login consumes code once, stores only hashes and creates settings',async t=>{
  const f=fixture(t),challenge=await f.auth.code('A@Example.com','127.0.0.1'),code=f.digits();
  assert(!JSON.stringify(challenge).includes(code));assert.notEqual(f.db.prepare('SELECT code_hmac FROM login_challenges').get().code_hmac,code);
  const result=f.auth.login(challenge.challenge_id,code,'127.0.0.1');
  assert.equal(result.user.email,'a@example.com');assert.equal(result.token.length,43);assert(f.auth.session(result.token));
  assert.notEqual(f.db.prepare('SELECT token_hash FROM auth_sessions').get().token_hash,result.token);
  assert.equal(f.db.prepare('SELECT count(*) n FROM user_settings').get().n,1);
  assert.throws(()=>f.auth.login(challenge.challenge_id,code,'127.0.0.1'),{code:'INVALID_CODE'});
});
test('five failed checks commit counters and block even correct code',async t=>{
  const f=fixture(t),c=await f.auth.code('a@example.com','ip'),correct=f.digits(),wrong=correct==='000000'?'999999':'000000';
  for(let i=0;i<5;i++)assert.throws(()=>f.auth.login(c.challenge_id,wrong,'ip'),{code:'INVALID_CODE'});
  assert.equal(f.db.prepare('SELECT attempts FROM login_challenges').get().attempts,5);
  assert.throws(()=>f.auth.login(c.challenge_id,correct,'ip'),{code:'INVALID_CODE'});
});
test('code expires exactly at ten minutes',async t=>{const f=fixture(t),c=await f.auth.code('a@example.com','ip');f.advance(600000);assert.throws(()=>f.auth.login(c.challenge_id,f.digits(),'ip'),{code:'INVALID_CODE'})});
test('resend cooldown survives restart and new delivery supersedes prior challenge',async t=>{
  const f=fixture(t),a=await f.auth.code('a@example.com','ip'),first=f.digits();
  const restarted=createAuth(f.db,f.cfg,f.mailer);
  await assert.rejects(restarted.code('A@example.com','other'),{status:429});
  f.advance(60001);const b=await f.auth.code('a@example.com','ip');
  assert.throws(()=>f.auth.login(a.challenge_id,first,'ip'),{code:'INVALID_CODE'});
  assert(f.auth.login(b.challenge_id,f.digits(),'ip').token);
});
test('SMTP failure is explicit, does not invalidate preceding delivered code',async t=>{
  const f=fixture(t),a=await f.auth.code('a@example.com','ip'),code=f.digits();f.advance(60001);f.setFail(true);
  await assert.rejects(f.auth.code('a@example.com','ip'),{code:'EMAIL_UNAVAILABLE'});
  assert(f.auth.login(a.challenge_id,code,'ip').token);
  assert.equal(f.db.prepare("SELECT code_hmac FROM login_challenges WHERE state='failed'").get().code_hmac,'');
});
test('email hourly send limit is five and IP limit thirty',async t=>{
  const f=fixture(t);for(let i=0;i<5;i++){await f.auth.code('a@example.com','ip');f.advance(60001)}
  await assert.rejects(f.auth.code('a@example.com','other'),{status:429});
  for(let i=0;i<25;i++)await f.auth.code(`b${i}@example.com`,'ip');
  await assert.rejects(f.auth.code('limit@example.com','ip'),{status:429});
});
test('session inactivity and absolute expiry, revoke all devices',async t=>{
  const f=fixture(t),c=await f.auth.code('a@example.com','ip'),a=f.auth.login(c.challenge_id,f.digits(),'ip');f.advance(60001);
  const d=await f.auth.code('a@example.com','ip'),b=f.auth.login(d.challenge_id,f.digits(),'ip');
  f.auth.revoke(f.auth.session(a.token),true);assert.equal(f.auth.session(a.token),null);assert.equal(f.auth.session(b.token),null);
  f.advance(60001);const e=await f.auth.code('a@example.com','ip'),s=f.auth.login(e.challenge_id,f.digits(),'ip');
  f.advance(14*86400000);assert.equal(f.auth.session(s.token),null);
});
test('absolute session expiry is not extended by activity',async t=>{
  const f=fixture(t),c=await f.auth.code('a@example.com','ip'),s=f.auth.login(c.challenge_id,f.digits(),'ip');
  for(let i=0;i<3;i++){f.advance(10*86400000);if(i<2)assert(f.auth.session(s.token));else assert.equal(f.auth.session(s.token),null)}
});
test('cleanup purges expired codes and rate events; no mail mode cannot issue codes',async t=>{
  const f=fixture(t);await f.auth.code('a@example.com','ip');f.advance(2*86400000);f.auth.cleanup(Date.now()+2*86400000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM login_challenges').get().n,0);
  const disabled=createAuth(f.db,{...f.cfg,smtpReady:false},f.mailer);await assert.rejects(disabled.code('a@example.com','ip'),{status:503});
});
test('schema foreign keys reject cross-owner references and migration persists after reopen',t=>{
  const tmp=mkdtempSync(path.join(os.tmpdir(),'girya-db-'));t.after(()=>rmSync(tmp,{recursive:true,force:true}));
  let db=openDatabase(path.join(tmp,'test.sqlite'));migrate(db);const a=randomUUID(),b=randomUUID();
  for(const [uid,email] of [[a,'a@example.com'],[b,'b@example.com']])db.prepare('INSERT INTO users VALUES(?,?,?,NULL)').run(uid,email,Date.now());
  const ex=randomUUID(),program=randomUUID();db.prepare('INSERT INTO exercises(user_id,id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(a,ex,'Swing',1,1);
  db.prepare('INSERT INTO programs(user_id,id,slot,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(b,program,'A','B',1,1);
  assert.throws(()=>db.prepare('INSERT INTO program_items VALUES(?,?,?,?,?)').run(b,randomUUID(),program,ex,0));
  db.close();db=openDatabase(path.join(tmp,'test.sqlite'));migrate(db);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);db.close();
});
test('production config rejects absent secrets, HTTP, relative DB and test SMTP',()=>{
  for(const env of [{},{LOGIN_CODE_SECRET:'x'.repeat(32),SESSION_SECRET:'y'.repeat(32),NODE_ENV:'production',APP_ORIGIN:'http://example.com'},{LOGIN_CODE_SECRET:'x'.repeat(32),SESSION_SECRET:'y'.repeat(32),NODE_ENV:'production',APP_ORIGIN:'https://example.com',DATABASE_PATH:'/data/db',SMTP_LOCAL_TEST:'true'}])assert.throws(()=>config(env));
});
test('HTTP authenticates with cookie + CSRF, isolates users, never exposes source or secrets',async t=>{
  const f=fixture(t);const server=createServer({db:f.db,config:f.cfg,mailer:f.mailer,logger:{error(){}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  let r=await fetch(base+'/api/v1/auth/csrf');const csrf=(await r.json()).csrf_token,csrfCookie=r.headers.get('set-cookie').split(';')[0];
  const post=(route,data,session='')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:f.cfg.origin,'X-CSRF-Token':csrf,Cookie:csrfCookie+(session?'; '+session:'')},body:JSON.stringify(data)});
  r=await fetch(base+'/api/v1/auth/code',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'});assert.equal(r.status,403);
  r=await post('/api/v1/auth/code',{email:'a@example.com'});assert.equal(r.status,200);const c=await r.json();
  r=await post('/api/v1/auth/login',{challenge_id:c.challenge_id,code:f.digits()});assert.equal(r.status,200);const session=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  const a=(await r.json()).user;
  r=await fetch(base+'/api/v1/me',{headers:{Cookie:session}});assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).user.id,a.id);
  r=await post('/api/v1/auth/code',{email:'b@example.com'});const bChallenge=await r.json();r=await post('/api/v1/auth/login',{challenge_id:bChallenge.challenge_id,code:f.digits()});const bSession=r.headers.get('set-cookie').split(';')[0];const b=(await r.json()).user;assert.notEqual(a.id,b.id);
  r=await fetch(base+'/api/v1/me?user_id='+a.id,{headers:{Cookie:bSession}});assert.equal((await r.json()).user.id,b.id);
  for(const route of ['/.env','/server/schema.sql','/data/girya.sqlite','/package.json','/api/v1/unknown']){r=await fetch(base+route);assert.equal(r.status,404,route)}
  r=await post('/api/v1/auth/logout',{},session);assert.equal(r.status,200);r=await fetch(base+'/api/v1/me',{headers:{Cookie:session}});assert.equal(r.status,401);
  r=await fetch(base+'/api/v1/me',{headers:{Cookie:bSession}});assert.equal(r.status,200);
});
test('secure production cookie and SMTP readiness response',async t=>{
  const f=fixture(t,{production:true,origin:'https://girya.example'}),server=createServer({db:f.db,config:f.cfg,mailer:f.mailer});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/auth/csrf');assert.match(r.headers.get('set-cookie'),/__Host-girya_csrf=.*; Secure/);assert.equal(r.headers.get('cache-control'),'no-store');
});

test('Nodemailer SMTP sends the six-digit code through a local synthetic SMTP server',async t=>{
  const net=require('node:net'),nodemailer=require('nodemailer');let delivered='';const sockets=new Set();
  const smtp=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 local.test ESMTP\r\n');let buffer='',dataMode=false;
    socket.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
      if(dataMode){if(line==='.'){dataMode=false;socket.write('250 queued\r\n')}else delivered+=line+'\n';continue}
      if(/^EHLO/.test(line))socket.write('250-local.test\r\n250 8BITMIME\r\n');
      else if(line==='DATA'){dataMode=true;socket.write('354 End with dot\r\n')}
      else if(line==='QUIT'){socket.end('221 Bye\r\n')}
      else socket.write('250 OK\r\n');
    }});
  });
  await new Promise(r=>smtp.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(r=>smtp.close(r))});
  const f=fixture(t),mailer=nodemailer.createTransport({host:'127.0.0.1',port:smtp.address().port,secure:false,ignoreTLS:true});t.after(()=>mailer.close());
  await mailer.verify();const auth=createAuth(f.db,f.cfg,mailer);const c=await auth.code('synthetic@example.test','ip');
  const content=/Content-Transfer-Encoding: base64/i.test(delivered)?Buffer.from(delivered.split('\n\n').slice(1).join('\n\n').replace(/\s/g,''),'base64').toString('utf8'):delivered;
  const digits=content.match(/\b\d{6}\b/)[0];assert(auth.login(c.challenge_id,digits,'ip').token);assert.match(delivered,/To: synthetic@example.test/);
});

test('SQLite online backup reopens with valid schema and accounts',async t=>{
  const {backup}=require('node:sqlite'),tmp=mkdtempSync(path.join(os.tmpdir(),'girya-backup-'));let restored;t.after(()=>{restored?.close();rmSync(tmp,{recursive:true,force:true})});
  const f=fixture(t),c=await f.auth.code('a@example.com','ip');f.auth.login(c.challenge_id,f.digits(),'ip');
  const target=path.join(tmp,'copy.sqlite');await backup(f.db,target);restored=openDatabase(target);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('SELECT email FROM users').get().email,'a@example.com');migrate(restored);
});

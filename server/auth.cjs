'use strict';
const {randomBytes,randomInt,randomUUID,createHmac,createHash,timingSafeEqual} = require('node:crypto');
const {domainToASCII} = require('node:url');
const {transaction} = require('./database.cjs');
const MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR;
class ApiError extends Error {constructor(status,code,message,retryAfter){super(message);Object.assign(this,{status,code,retryAfter})}}
function emailAddress(value) {
  if (typeof value!=='string') throw new ApiError(422,'INVALID_EMAIL','Проверь адрес электронной почты.');
  const raw=value.trim().toLowerCase(),split=raw.lastIndexOf('@'),local=raw.slice(0,split),domain=domainToASCII(raw.slice(split+1));
  if (split<1 || raw.length>254 || local.length>64 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new ApiError(422,'INVALID_EMAIL','Проверь адрес электронной почты.');
  return local+'@'+domain;
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
function createAuth(db,config,mailer,clock=Date.now) {
  const hmac=(value)=>createHmac('sha256',config.codeSecret).update(value).digest('hex');
  function limit(subject,kind,max,period,now) {
    const count=db.prepare('SELECT count(*) n, min(created_at) first FROM auth_rate_events WHERE subject=? AND kind=? AND created_at>?').get(subject,kind,now-period);
    if(count.n>=max)throw new ApiError(429,'RATE_LIMIT','Слишком много попыток. Попробуй позже.',Math.max(1,Math.ceil((count.first+period-now)/1000)));
  }
  function cleanup(now) {
    db.prepare('DELETE FROM login_challenges WHERE expires_at<?').run(now-DAY);
    db.prepare('DELETE FROM auth_rate_events WHERE created_at<?').run(now-DAY);
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<? OR revoked_at<?').run(now-DAY,now-DAY);
  }
  async function code(value,ip) {
    if(!config.smtpReady)throw new ApiError(503,'EMAIL_UNAVAILABLE','Отправка писем ещё не настроена. Дневник доступен без входа.');
    const email=emailAddress(value),now=clock(),id=randomUUID(),digits=String(randomInt(0,1000000)).padStart(6,'0');
    const emailKey=hmac('email:'+email),ipKey=hmac('ip:'+ip);
    transaction(db,()=>{
      cleanup(now);limit(emailKey,'send',1,MINUTE,now);limit(emailKey,'send',5,HOUR,now);limit(ipKey,'send',30,HOUR,now);
      for(const subject of [emailKey,ipKey])db.prepare('INSERT INTO auth_rate_events(subject,kind,created_at) VALUES(?,?,?)').run(subject,'send',now);
      db.prepare("INSERT INTO login_challenges(id,email,code_hmac,created_at,expires_at,state) VALUES(?,?,?,?,?,'pending')").run(id,email,hmac(id+':'+digits),now,now+10*MINUTE);
    });
    try {
      const sent=await mailer.sendMail({from:config.from,to:email,subject:'Код входа в ГИРЯ',text:`Код входа: ${digits}\n\nДействует 10 минут. Никому не сообщай код. Если ты не запрашивал вход, проигнорируй письмо.`});
      if(!sent.accepted?.length || sent.rejected?.length)throw Error('Recipient not accepted');
    } catch {
      db.prepare("UPDATE login_challenges SET state='failed',code_hmac='' WHERE id=?").run(id);
      throw new ApiError(503,'EMAIL_UNAVAILABLE','Письмо не удалось отправить. Попробуй через минуту.');
    }
    transaction(db,()=>{
      db.prepare("UPDATE login_challenges SET state='superseded',code_hmac='' WHERE email=? AND id<>? AND state='sent' AND used_at IS NULL").run(email,id);
      db.prepare("UPDATE login_challenges SET state='sent' WHERE id=?").run(id);
    });
    return {challenge_id:id,expires_in:600,retry_after:60,message:'Код отправлен на указанный адрес.'};
  }
  function login(id,digits,ip) {
    if(typeof id!=='string'||id.length>80||typeof digits!=='string'||!/^\d{6}$/.test(digits))throw new ApiError(422,'INVALID_REQUEST','Введи шестизначный код из письма.');
    const now=clock(),ipKey=hmac('verify:'+ip);
    // Return errors outside the transaction so failed-attempt counters are committed.
    const result=transaction(db,()=>{
      limit(ipKey,'verify',60,HOUR,now);
      db.prepare('INSERT INTO auth_rate_events(subject,kind,created_at) VALUES(?,?,?)').run(ipKey,'verify',now);
      const row=db.prepare('SELECT * FROM login_challenges WHERE id=?').get(id);
      const expected=row?.code_hmac || hmac('invalid');
      const matches=equal(expected,hmac(id+':'+digits));
      if(!row||row.state!=='sent'||row.used_at!==null||row.expires_at<=now||row.attempts>=5)return {error:true};
      if(!matches){db.prepare('UPDATE login_challenges SET attempts=attempts+1 WHERE id=?').run(id);return {error:true}}
      const old=db.prepare('SELECT * FROM users WHERE email=?').get(row.email);
      if(old?.deletion_requested_at)return {error:true};
      const uid=old?.id||randomUUID();
      if(!old){db.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?)').run(uid,row.email,now);db.prepare('INSERT INTO user_settings(user_id,updated_at) VALUES(?,?)').run(uid,now)}
      db.prepare("UPDATE login_challenges SET used_at=?,code_hmac='' WHERE id=?").run(now,id);
      const token=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),uid,hash(token),now,now+30*DAY,now);
      return {token,user:{id:uid,email:row.email}};
    });
    if(result.error)throw new ApiError(401,'INVALID_CODE','Код неверный или истёк. Запроси новый при необходимости.');
    return result;
  }
  function session(token) {
    if(typeof token!=='string'||token.length!==43)return null;
    const now=clock(),row=db.prepare('SELECT s.*,u.email,u.deletion_requested_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hash(token));
    if(!row||row.revoked_at!==null||row.expires_at<=now||row.last_seen_at+14*DAY<=now||row.deletion_requested_at)return null;
    db.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE id=?').run(now,row.id);
    return row;
  }
  function revoke(current,all=false) {db.prepare(all?'UPDATE auth_sessions SET revoked_at=? WHERE user_id=?':'UPDATE auth_sessions SET revoked_at=? WHERE id=?').run(clock(),all?current.user_id:current.id)}
  return {code,login,session,revoke,cleanup};
}
module.exports={createAuth,ApiError,emailAddress,equal,hash};

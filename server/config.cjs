'use strict';
const path = require('node:path');
function config(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:3000');
  if (origin.origin !== (env.APP_ORIGIN || 'http://localhost:3000') || origin.username || origin.password) throw Error('APP_ORIGIN must be an origin without path');
  if (production && origin.protocol !== 'https:') throw Error('Production requires HTTPS APP_ORIGIN');
  if (!production && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw Error('Development origin must be loopback');
  for (const key of ['LOGIN_CODE_SECRET', 'SESSION_SECRET']) if (!env[key] || env[key].length < 32) throw Error(key + ' must contain at least 32 characters');
  if (env.LOGIN_CODE_SECRET === env.SESSION_SECRET) throw Error('Use independent secrets');
  if (production && (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH))) throw Error('Production requires absolute DATABASE_PATH');
  const localMail = env.SMTP_LOCAL_TEST === 'true';
  if (production && localMail) throw Error('Local SMTP test mode is prohibited in production');
  const smtpReady = ['SMTP_HOST','SMTP_FROM'].every(k => env[k]) && (localMail || ['SMTP_USER','SMTP_PASS'].every(k => env[k]));
  if (localMail && !['localhost','127.0.0.1','::1'].includes(env.SMTP_HOST)) throw Error('Test SMTP must be loopback');
  const smtpPort = Number(env.SMTP_PORT || 587), port = Number(env.PORT || 3000);
  if (![smtpPort,port].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) throw Error('Invalid port');
  if (smtpReady && /[\r\n]/.test(env.SMTP_FROM)) throw Error('Invalid SMTP_FROM');
  return { production, origin: origin.origin, port, databasePath: path.resolve(env.DATABASE_PATH || './data/girya.sqlite'),
    codeSecret: env.LOGIN_CODE_SECRET, sessionSecret: env.SESSION_SECRET, trustProxy: env.TRUST_PROXY === '1', smtpReady: !!smtpReady,
    smtp: { host:env.SMTP_HOST, port:smtpPort, secure:env.SMTP_SECURE === 'true', requireTLS:!localMail,
      ...(localMail ? {} : {auth:{user:env.SMTP_USER,pass:env.SMTP_PASS}}), connectionTimeout:10000, greetingTimeout:10000, socketTimeout:15000 }, from:env.SMTP_FROM };
}
module.exports = {config};

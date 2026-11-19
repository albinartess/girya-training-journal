'use strict';
const {config}=require('./config.cjs');
const {openDatabase}=require('./database.cjs');
const {createServer}=require('./http.cjs');
const nodemailer=require('nodemailer');
const cfg=config(),db=openDatabase(cfg.databasePath);
const version=db.prepare('SELECT max(version) v FROM schema_migrations').get().v;
if(version!==1)throw Error('Run npm run migrate before start');
const mailer=cfg.smtpReady?nodemailer.createTransport(cfg.smtp):null;
if(cfg.production&&!cfg.smtpReady)throw Error('Production SMTP configuration is required');
async function start(){
  if(mailer)await mailer.verify();
  const server=createServer({db,config:cfg,mailer});
  server.listen(cfg.port,'0.0.0.0',()=>console.log('GIRYA server ready on port '+cfg.port));
  const cleanup=setInterval(()=>require('./auth.cjs').createAuth(db,cfg,mailer).cleanup(Date.now()),3600000);cleanup.unref();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(cleanup);server.close(()=>{mailer?.close();db.close();process.exit(0)})});
}
start().catch(()=>{console.error('Server startup failed: check SMTP connectivity and configuration.');db.close();process.exitCode=1});

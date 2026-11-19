(function(root){
  'use strict';
  const I=typeof module!=='undefined'&&module.exports?require('./identity.js'):root.GiryaIdentity;
  const canonical=v=>{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v)};
  class Storage {
    constructor(name='girya-local-v2',factory=root.indexedDB){this.name=name;this.factory=factory;this.revision=0;this.tail=Promise.resolve(true);this.failed=false;this.stale=false;this.pending=0;this.onstatus=()=>{};this.lastData=null;this.lastCanonical=null;this.migrationBackup=null;this.beforeRestore=null}
    status(state,error){this.onstatus({state,pending:this.pending,error,revision:this.revision})}
    async open(){
      if(!this.factory)throw Error('IndexedDB недоступна в этом браузере');
      this.database=await new Promise((resolve,reject)=>{const request=this.factory.open(this.name,1);request.onupgradeneeded=()=>{const d=request.result;d.createObjectStore('snapshots',{keyPath:'id'});const e=d.createObjectStore('entities',{keyPath:'key'});e.createIndex('kind','kind');d.createObjectStore('backups',{keyPath:'id'});d.createObjectStore('meta',{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Закрой другие вкладки приложения и повтори открытие'))});
      this.database.onversionchange=()=>{this.database.close();this.failed=true;this.stale=true;this.status('stale',Error('Версия хранилища изменилась. Обнови страницу.'))};
      const records=await this.read(['snapshots','backups'],tx=>Promise.all([this.request(tx.objectStore('snapshots').get('guest')),this.request(tx.objectStore('backups').get('migration-v1')),this.request(tx.objectStore('backups').get('before-restore'))]));
      const [snapshot,migration,previous]=records;
      this.revision=snapshot?.revision||0;this.initialData=snapshot?I.clone(snapshot.data):null;this.lastData=snapshot?I.clone(snapshot.data):null;this.lastCanonical=snapshot?canonical(snapshot.data):null;this.migrationBackup=migration?.raw||null;this.beforeRestore=previous?.raw||null;
      if(typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel(this.name);this.channel.onmessage=event=>{if(event.data.revision>this.revision){this.stale=true;this.failed=true;this.status('stale',Error('Данные изменены в другой вкладке. Сохрани копию своего ввода и обнови страницу.'))}}}
      this.status('ready');return this;
    }
    request(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
    async read(stores,fn){const tx=this.database.transaction(stores,'readonly');return fn(tx)}
    async getSnapshot(){return (await this.read(['snapshots'],tx=>this.request(tx.objectStore('snapshots').get('guest'))))||null}
    async migrate(raw,validator){if(this.initialData)return false;if(!raw)return false;let data=JSON.parse(raw);validator(data);data=I.ensure(I.clone(data));await this.commit(data,{migrationRaw:raw});this.initialData=I.clone(data);return true}
    async commit(data,{migrationRaw,restoreRaw}={}){
      if(this.stale)throw Error('Другая вкладка уже изменила историю. Обнови страницу после экспорта ввода.');
      const prior=this.lastData?I.entities(this.lastData):new Map(),next=I.entities(data),revision=this.revision+1;
      await new Promise((resolve,reject)=>{
        const tx=this.database.transaction(['snapshots','entities','meta','backups'],'readwrite');let failure;
        const snapshots=tx.objectStore('snapshots'),check=snapshots.get('guest');
        check.onsuccess=()=>{try{
          const current=check.result;if((current?.revision||0)!==this.revision){this.stale=true;failure=Error('Данные изменены другой вкладкой. Обнови страницу после экспорта ввода.');tx.abort();return}
          snapshots.put({id:'guest',revision,data});
          const entities=tx.objectStore('entities');for(const [key,row] of next)if(!prior.has(key)||canonical(prior.get(key))!==canonical(row))entities.put({key,...row,partition:'guest'});for(const key of prior.keys())if(!next.has(key))entities.delete(key);
          tx.objectStore('meta').put({id:'schema',version:2,updatedAt:new Date().toISOString()});
          if(migrationRaw!==undefined)tx.objectStore('backups').put({id:'migration-v1',raw:migrationRaw,createdAt:new Date().toISOString()});
          if(restoreRaw!==undefined)tx.objectStore('backups').put({id:'before-restore',raw:restoreRaw,createdAt:new Date().toISOString()});
        }catch(e){failure=e;tx.abort()}};
        tx.oncomplete=()=>resolve();tx.onerror=()=>{};tx.onabort=()=>reject(failure||tx.error||Error('Запись в хранилище прервана'));
      });
      this.revision=revision;this.lastData=I.clone(data);this.lastCanonical=canonical(data);if(migrationRaw!==undefined)this.migrationBackup=migrationRaw;if(restoreRaw!==undefined)this.beforeRestore=restoreRaw;this.channel?.postMessage({revision});
    }
    save(data,options={}){
      let snapshot;try{I.ensure(data);snapshot=I.clone(data)}catch(error){this.failed=true;this.status('error',error);return Promise.resolve(false)}this.latest=snapshot;this.pending++;this.status('saving');
      const task=this.tail.then(async()=>{if(this.failed){this.pending--;return false}try{if(canonical(snapshot)!==this.lastCanonical||options.restoreRaw!==undefined)await this.commit(snapshot,options);return true}catch(error){this.failed=true;this.status(this.stale?'stale':'error',error);return false}finally{this.pending--;if(!this.failed)this.status(this.pending?'saving':'saved')}});
      // A rejected predecessor never silently enables writes after a failure.
      this.tail=task;return task;
    }
    async flush(){await this.tail;return !this.failed}
    async retry(){if(this.stale)return false;this.failed=false;this.pending=0;return this.save(this.latest||this.lastData)}
    confirm(fn){this.tail.then(ok=>{if(ok&&!this.failed)fn()})}
    close(){this.channel?.close();this.database?.close()}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={Storage,canonical};else root.GiryaStorage={Storage,canonical};
})(typeof globalThis!=='undefined'?globalThis:this);

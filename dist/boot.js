(async()=>{
  const main=document.querySelector('main'),shell=document.createElement('div');shell.className='storage-bar';shell.setAttribute('role','status');shell.innerHTML='<span id="storage-status">Открываем локальный дневник…</span><button id="storage-retry" hidden>Повторить запись</button><button id="storage-reload" hidden>Обновить страницу</button><button id="storage-export" hidden>Скачать текущие данные</button><button id="migration-export" hidden>Копия до перехода</button>';
  document.querySelector('header').after(shell);document.body.classList.add('storage-loading');
  const message=document.getElementById('storage-status'),retry=document.getElementById('storage-retry'),reload=document.getElementById('storage-reload'),exportButton=document.getElementById('storage-export'),migration=document.getElementById('migration-export');
  function downloadRaw(raw,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  let legacyRaw;
  try{
    const store=window.GiryaStore=new GiryaStorage.Storage();
    store.onstatus=({state,error})=>{message.textContent=({ready:'Локальное хранилище готово',saving:'Сохраняется на устройстве…',saved:'● Сохранено на устройстве · IndexedDB',error:'Не удалось сохранить. Изменения пока только на экране.',stale:'Другая вкладка изменила дневник. Обнови страницу.'}[state])||state;if(error)message.title=error.message;shell.classList.toggle('storage-error',state==='error'||state==='stale');retry.hidden=state!=='error';reload.hidden=state!=='stale';exportButton.hidden=!['error','stale'].includes(state);document.body.classList.toggle('storage-stale',state==='stale')};
    await store.open();
    if(!store.initialData){legacyRaw=localStorage.getItem('girya-v1');await store.migrate(legacyRaw,GiryaBackup.normalize)}
    retry.onclick=()=>store.retry();reload.onclick=()=>location.reload();exportButton.onclick=()=>downloadRaw(JSON.stringify(store.latest||store.lastData,null,2),'girya-unsaved-recovery.json');
    migration.hidden=!store.migrationBackup;migration.onclick=()=>downloadRaw(store.migrationBackup,'girya-before-indexeddb.json');
    // Legacy copies remain untouched; all new diary writes use IndexedDB.
    if(!store.beforeRestore){const previous=localStorage.getItem('girya-before-restore');if(previous)store.beforeRestore=previous}
    for(const src of ['app.js','iron.js','training.js','identity-ui.js','pwa.js','backup-ui.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Не загрузился файл '+src));document.body.append(script)});
    await store.flush();document.body.classList.remove('storage-loading');
    addEventListener('beforeunload',event=>{if(store.pending||store.failed){event.preventDefault();event.returnValue=''}});
  }catch(error){message.textContent='Дневник не открыт: '+error.message;document.body.classList.add('storage-start-error');document.body.classList.remove('storage-loading');reload.hidden=false;reload.onclick=()=>location.reload();try{legacyRaw=legacyRaw||localStorage.getItem('girya-v1');if(legacyRaw){exportButton.hidden=false;exportButton.onclick=()=>downloadRaw(legacyRaw,'girya-legacy-recovery.json')}}catch{};document.getElementById('app').innerHTML='<div class="card"><h2>Записи не удалены</h2><p>Хранилище не удалось открыть. Проверь разрешение браузера на хранение данных и свободное место, затем обнови страницу. Приложение не будет незаметно заменять историю пустой копией.</p></div>'}
})();

(() => {
  let installPrompt=null,registration=null,reloading=false,offlineReady=false;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const bar=document.createElement('div');bar.className='app-tools';bar.innerHTML='<span id="offline-state" role="status">Подготовка офлайн-режима…</span><button class="text-btn" id="install-app">Установить приложение</button><button class="secondary" id="apply-update" hidden>Обновить приложение</button>';
  document.querySelector('header').after(bar);
  const state=document.getElementById('offline-state'),installButton=document.getElementById('install-app'),updateButton=document.getElementById('apply-update');
  function updateState(){state.textContent=offlineReady?(navigator.onLine?'● Готово к работе без интернета':'● Офлайн · записи сохраняются на устройстве'):(navigator.onLine?'Офлайн-режим подготавливается':'Нет сети · офлайн-копия ещё не готова');state.classList.toggle('offline',!navigator.onLine);installButton.hidden=standalone()}
  function showInstallHelp(){
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const help=document.createElement('dialog');help.className='install-help';help.innerHTML=`<button class="close" aria-label="Закрыть инструкцию">×</button><h2>ГИРЯ на твоём телефоне</h2><img src="icon-192.png" width="72" height="72" alt="Значок приложения ГИРЯ"><p>${ios?'В Safari нажми «Поделиться», затем «На экран Домой» и «Добавить».':'В меню браузера выбери «Установить приложение» или «Добавить на главный экран». На компьютере кнопка установки может быть в адресной строке.'}</p><p>После первого открытия с интернетом тренировки, программа и история доступны офлайн. Видео техники и первое подключение внешних ресурсов требуют сети.</p><p class="muted">Данные остаются в этом браузере на этом устройстве. Сохраняй резервные копии через «Экспорт данных».</p><button class="primary">Понятно</button>`;document.body.append(help);help.querySelector('.close').onclick=()=>help.close();help.querySelector('.primary').onclick=()=>help.close();help.onclose=()=>help.remove();help.showModal();
  }
  installButton.onclick=async()=>{if(!installPrompt)return showInstallHelp();const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==='accepted')toast('Приложение добавляется на устройство')}catch{showInstallHelp()}};
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.hidden=false});
  addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;toast('ГИРЯ установлена')});
  addEventListener('online',updateState);addEventListener('offline',updateState);
  updateButton.onclick=async()=>{if(!registration?.waiting)return;if(!await save()||!await GiryaStore.flush())return;applyingUpdate=true;updateButton.disabled=true;updateButton.textContent='Обновляется…';registration.waiting.postMessage({type:'APPLY_UPDATE'})};
  if(!('serviceWorker' in navigator)){state.textContent='Этот браузер не поддерживает офлайн-режим';installButton.onclick=showInstallHelp;return}
  let applyingUpdate=false;
  
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applyingUpdate&&!reloading){reloading=true;location.reload()}else{offlineReady=true;updateState()}});
  async function start(){try{
    registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    if(registration.waiting)updateButton.hidden=false;
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)updateButton.hidden=false;if(worker.state==='redundant'&&!offlineReady){state.textContent='Офлайн-копия не сохранена. Открой приложение с сетью ещё раз.'}})});
    await navigator.serviceWorker.ready;offlineReady=true;updateState();
  }catch(error){state.textContent='Офлайн-режим недоступен. Проверь сеть и открой приложение снова.';state.title=error.message}}
  if(document.readyState==='complete')start();else addEventListener('load',start,{once:true});
})();


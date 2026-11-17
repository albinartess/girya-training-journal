(() => {
  const api=GiryaBackup;
  const tools=document.createElement('div');tools.className='backup-tools';tools.innerHTML='<button class="text-btn" id="backup-download">↓ Резервная копия</button><button class="text-btn" id="backup-restore">↑ Восстановить историю</button><input type="file" id="backup-file" accept=".json,application/json" hidden><button class="text-btn" id="backup-previous">Копия до восстановления</button>';
  document.querySelector('.app-tools').after(tools);
  let installationId;
  function getId(){if(installationId)return installationId;installationId=localStorage.getItem('girya-installation-id');if(!installationId){installationId=crypto.randomUUID();localStorage.setItem('girya-installation-id',installationId)}return installationId}
  async function exportBackup(){try{const data=api.envelope(db,getId());data.integrity={algorithm:"SHA-256",digest:await api.checksum(data.data)};download(JSON.stringify(data,null,2),'girya-backup-'+today()+'.json','application/json')}catch{toast('Не удалось создать копию. Проверь доступ к хранилищу браузера.')}}
  $('#export').onclick=exportBackup;$('#backup-download').onclick=exportBackup;
  const previous=$('#backup-previous');function updatePrevious(){previous.hidden=!localStorage.getItem('girya-before-restore')}updatePrevious();
  previous.onclick=()=>{const raw=localStorage.getItem('girya-before-restore');if(raw)download(raw,'girya-before-restore.json','application/json')};
  const fileInput=$('#backup-file');$('#backup-restore').onclick=()=>{fileInput.value='';fileInput.click()};
  function openDialog(html){const dialog=document.createElement('dialog');dialog.className='backup-dialog';dialog.innerHTML='<button class="close" aria-label="Закрыть восстановление">×</button>'+html;document.body.append(dialog);dialog.querySelector('.close').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();return dialog}
  fileInput.onchange=async()=>{const file=fileInput.files[0];if(!file)return;let model;
    try{if(file.size>20*1024*1024)throw Error('Размер файла больше 20 МиБ');const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));await api.verifyIntegrity(raw);model=api.preview(db,raw)}catch(e){openDialog(`<h2>Копия не загружена</h2><p>${esc(e.message)}</p><p class="muted">Текущие записи не изменены. Выбери полный JSON, созданный через «Резервная копия» или прежний «Экспорт данных».</p>`);return}
    const base=api.canonical(api.normalize(db));const s=model.summary;
    const conflicts=model.entries.filter(e=>e.state==='conflict');
    const label=e=>e.type==='program'?'Программа '+({A:'А',B:'Б',C:'В'}[e.key]):e.type==='measurement'?'Замеры '+e.key:'Тренировка и черновик '+e.key;
    const detail=(e,row)=>e.type==='day'?api.describeDay(row):e.type==='program'?row.map(x=>x.name).join(', '):Object.entries(row).map(([k,v])=>`${k}: ${v}`).join(', ');
    const dialog=openDialog(`<h2>Восстановление истории</h2><p class="muted">Файл: ${esc(file.name)}. Восстановление только на этом устройстве, без отправки в облако.</p><div class="backup-summary"><span><b>${s.sessions}</b> тренировок</span><span><b>${s.drafts}</b> черновиков</span><span><b>${s.measurements}</b> замеров</span><span><b>${s.programs}</b> программ</span></div><p>Новых элементов: <b>${s.new}</b>. Совпадают: <b>${s.same}</b>. Расходятся: <b>${s.conflicts}</b>.</p>${conflicts.length?`<p>Для каждой коллизии выбери вариант. По умолчанию остаются текущие данные. Выбор тренировки заменяет весь день вместе с черновиком.</p><div class="backup-conflicts">${conflicts.map((e,i)=>`<section><h3>${esc(label(e))}</h3><p><b>На устройстве:</b> ${esc(detail(e,e.current))}</p><p><b>В копии:</b> ${esc(detail(e,e.incoming))}</p><label>Использовать<select data-choice="${i}" aria-label="Выбор для ${esc(label(e))}"><option value="keep">Текущие данные</option><option value="import">Данные из копии</option></select></label></section>`).join('')}</div>`:'<p>Совпадающие записи будут пропущены — дубли не появятся.</p>'}<p class="muted">Перед применением сохранится отдельная копия текущего состояния. Её можно скачать кнопкой «Копия до восстановления». Новый снимок заменит предыдущий такой снимок.</p><p class="backup-result" role="status"></p><div class="backup-actions"><button class="secondary" id="backup-cancel">Отмена</button><button class="primary" id="backup-confirm">Применить выбранное</button></div>`);
    dialog.querySelector('#backup-cancel').onclick=()=>dialog.close();
    dialog.querySelector('#backup-confirm').onclick=()=>{const result=dialog.querySelector('.backup-result');try{
      const persisted=localStorage.getItem('girya-v1');if(api.canonical(api.normalize(db))!==base||(persisted&&api.canonical(api.normalize(JSON.parse(persisted)))!==base))throw Error('Данные изменились после предпросмотра. Закрой окно и загрузи файл заново. Если изменения сделаны в другой вкладке — сначала обнови страницу.');
      const choices={};dialog.querySelectorAll('[data-choice]').forEach(input=>choices[conflicts[+input.dataset.choice].id]=input.value);const merged=api.merge(model,choices);if(!merged.changed){result.textContent='Изменений нет: текущие данные сохранены, дубли не добавлены.';return}
      // Validate the complete candidate before either persistent write.
      api.normalize(merged.data);
      const snapshot=JSON.stringify(api.envelope(db,getId()));localStorage.setItem('girya-before-restore',snapshot);
      const encoded=JSON.stringify(merged.data);localStorage.setItem('girya-v1',encoded);
      stopRest();db=merged.data;Object.defineProperty(db,'program',{configurable:true,enumerable:true,get(){return db.programs[db.activeProgram]},set(value){db.programs[db.activeProgram]=value}});editingSlot=db.activeProgram;
      dialog.close();render();updatePrevious();toast('История восстановлена. Изменено элементов: '+merged.changed);
    }catch(e){result.textContent=e.name==='QuotaExceededError'?'Недостаточно места. История не изменена. Скачай текущую копию и освободи место в браузере.':e.message;updatePrevious()}};
  };
})();


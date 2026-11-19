// Keep stable exercise references while labels remain editable snapshots.
captureProgram=function(){const f=new FormData(document.querySelector('#program-form'));const previous=db.program;const next=previous.map((e,i)=>({...e,name:String(f.get('name-'+i)).trim(),sets:+f.get('sets-'+i),weight:+f.get('weight-'+i),reps:+f.get('reps-'+i),bells:+f.get('bells-'+i)}));db.program=GiryaIdentity.preserveProgram(previous,next,db)};
const progressByName=progress;
valuesForExercise=function(session,id){return session.exercises.filter(e=>e.exerciseId===id).flatMap(e=>e.sets.filter(s=>s.done).map(s=>({...s,bells:s.bells||1})))};
progress=function(){
  const catalog=db.exerciseCatalog||[],existing=new Set([...Object.values(db.programs).flatMap(p=>p.map(e=>e.exerciseId)),...db.sessions.flatMap(s=>s.exercises.map(e=>e.exerciseId))]);
  const list=catalog.filter(e=>existing.has(e.id));if(!existing.has(graphExercise))graphExercise=list[0]?.id||'';
  const id=graphExercise,entry=catalog.find(e=>e.id===id),label=entry?.name||'Упражнение';
  // The existing view provides the chart/history layout; feed it IDs as option keys.
  const sourcePrograms=db.programs,sourceSessions=db.sessions;
  try{
    db.programs=Object.fromEntries(Object.entries(sourcePrograms).map(([k,items])=>[k,items.map(e=>({...e,name:e.exerciseId}))]));
    db.sessions=sourceSessions.map(s=>({...s,exercises:s.exercises.map(e=>({...e,name:e.exerciseId}))}));
    let html=progressByName();
    for(const ex of catalog)html=html.replaceAll('>'+esc(ex.id)+'</option>',' value="'+ex.id+'">'+esc(ex.name)+'</option>');
    html=html.replace('План и факт · '+esc(id),'План и факт · '+esc(label));
    return html;
  }finally{db.programs=sourcePrograms;db.sessions=sourceSessions;graphExercise=id}
};
const stableChartBase=chart;
chart=function(id=graphExercise){const match=db.exerciseCatalog?.find(e=>e.id===id);if(!match)return stableChartBase(id);const original=db.sessions;try{db.sessions=original.map(s=>({...s,exercises:s.exercises.map(e=>({...e,name:e.exerciseId}))}));return stableChartBase(id)}finally{db.sessions=original}};
// Export the committed IndexedDB snapshot in backups; never claim a failed write succeeded.
const stableSave=save;
const currentDraft=draft;
draft=function(){const result=currentDraft();GiryaIdentity.ensure(db);return result};
const originalBodyBind=bind;
bind=function(){originalBodyBind();if(page==='body'){
  const form=document.querySelector('#body-form');form.onsubmit=async event=>{event.preventDefault();const m=Object.fromEntries(new FormData(form));const index=db.measurements.findIndex(x=>x.date===m.date);if(index>=0)db.measurements[index]={...db.measurements[index],...m};else db.measurements.push(m);db.measurements.sort((a,b)=>a.date.localeCompare(b.date));if(await save()){render();toast('Замеры сохранены')}};
}};
render();

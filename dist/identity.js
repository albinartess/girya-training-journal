(function(root){
  'use strict';
  const uid=()=>crypto.randomUUID();
  const valid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function ensure(data){
    data.dataVersion=2;
    if(!valid(data.installationId))data.installationId=uid();
    data.exerciseCatalog=Array.isArray(data.exerciseCatalog)?data.exerciseCatalog:[];
    const catalog=new Map(data.exerciseCatalog.map(e=>[e.id,e]));
    const byName=new Map(data.exerciseCatalog.map(e=>[e.name,e.id]));
    const exercise=e=>{if(!valid(e.exerciseId)){e.exerciseId=byName.get(e.name)||uid()}if(!catalog.has(e.exerciseId)){const row={id:e.exerciseId,name:e.name};catalog.set(row.id,row);byName.set(row.name,row.id);data.exerciseCatalog.push(row)}return e.exerciseId};
    const programs=data.programs||{A:data.program||[]};
    data.programMeta=data.programMeta||{};
    for(const [slot,items] of Object.entries(programs)){
      if(!data.programMeta[slot]||!valid(data.programMeta[slot].id))data.programMeta[slot]={id:uid()};
      for(const item of items){if(!valid(item.id))item.id=uid();exercise(item);item.plannedSetIds=Array.isArray(item.plannedSetIds)?item.plannedSetIds:[];item.plannedSetIds=item.plannedSetIds.slice(0,item.sets);while(item.plannedSetIds.length<item.sets)item.plannedSetIds.push(uid());item.plannedSetIds=item.plannedSetIds.map(id=>valid(id)?id:uid())}
    }
    data.workoutMeta=data.workoutMeta||{};
    const sessions=data.sessions||[],drafts=data.drafts||{};
    const dates=new Set([...sessions.map(s=>s.date),...Object.keys(drafts)]);
    for(const date of dates){
      const session=sessions.find(s=>s.date===date);
      let meta=data.workoutMeta[date];
      if(!meta||!valid(meta.id))meta=data.workoutMeta[date]={id:valid(session?.id)?session.id:uid()};
      // Session and live draft are two views of the same workout, not two workouts.
      const draft=drafts[date];
      const assign=(items,peer)=>items.forEach((e,i)=>{
        const other=peer?.[i];
        if(!valid(e.id))e.id=other&&valid(other.id)&&other.name===e.name?other.id:uid();
        if(!valid(e.exerciseId)&&other?.id===e.id&&valid(other.exerciseId))e.exerciseId=other.exerciseId;
        exercise(e);
        e.sets.forEach((s,j)=>{if(!valid(s.id))s.id=other?.id===e.id&&valid(other.sets[j]?.id)?other.sets[j].id:uid()});
      });
      if(draft)assign(draft,session?.exercises);
      if(session){session.id=meta.id;assign(session.exercises,draft)}
    }
    for(const m of data.measurements||[])if(!valid(m.id))m.id=uid();
    validate(data);
    return data;
  }
  function validate(data){
    const seen=new Map(),claim=(kind,id,owner)=>{const key=kind+':'+id;if(seen.has(key)&&seen.get(key)!==owner)throw Error('Повторяющийся ID в данных: '+kind);seen.set(key,owner)};
    const unique=(items,label)=>{const ids=new Set();for(const item of items){if(ids.has(item.id))throw Error('Повторяющийся ID: '+label);ids.add(item.id)}};
    unique(data.exerciseCatalog,'упражнение');
    for(const [slot,items] of Object.entries(data.programs||{A:data.program||[]})){claim('program',data.programMeta[slot].id,slot);unique(items,'упражнение программы');for(const item of items)claim('programItem',item.id,slot)}
    for(const [date,meta] of Object.entries(data.workoutMeta))claim('workout',meta.id,date);
    const check=(date,items)=>{unique(items,'упражнение тренировки');for(const e of items){claim('workoutExercise',e.id,date);unique(e.sets,'подход');for(const s of e.sets)claim('set',s.id,date+':'+e.id)}};
    for(const session of data.sessions||[])check(session.date,session.exercises);for(const [date,items] of Object.entries(data.drafts||{}))check(date,items);
    unique(data.measurements||[],'замер');
  }
  function rename(data,id,name){const entry=data.exerciseCatalog?.find(e=>e.id===id);if(entry)entry.name=name;for(const items of Object.values(data.programs||{}))for(const item of items)if(item.exerciseId===id)item.name=name}
  function preserveProgram(previous,next,data){return next.map((e,i)=>{const old=previous[i];if(!old)return e;const result={...e,id:old.id,exerciseId:old.exerciseId,plannedSetIds:old.plannedSetIds};if(old.name!==e.name&&old.exerciseId)rename(data,old.exerciseId,e.name);return result})}
  function entities(data){
    const result=new Map(),put=(kind,id,value)=>result.set(kind+':'+id,{kind,id,data:clone(value)});
    for(const ex of data.exerciseCatalog||[])put('exercise',ex.id,ex);
    for(const [slot,items] of Object.entries(data.programs||{A:data.program||[]}))put('program',data.programMeta[slot].id,{slot,items});
    const dates=new Set([...(data.sessions||[]).map(s=>s.date),...Object.keys(data.drafts||{})]);
    for(const date of dates){const session=data.sessions.find(s=>s.date===date);const items=data.drafts[date]||session?.exercises||[];const workoutId=data.workoutMeta[date].id;put('workout',workoutId,{date,session:session||null,draft:items,programKey:data.draftPrograms?.[date]||session?.programKey||null});for(const [i,e] of items.entries())for(const [j,s] of e.sets.entries())put('set',s.id,{workoutId,exerciseId:e.exerciseId,workoutExerciseId:e.id,exerciseOrder:i,order:j,...s})}
    for(const m of data.measurements||[])put('measurement',m.id,m);
    return result;
  }
  const api={ensure,rename,preserveProgram,entities,valid,clone,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GiryaIdentity=api;
})(typeof globalThis!=='undefined'?globalThis:this);

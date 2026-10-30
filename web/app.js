/* No frontend framework required: all planning is behind /api. */
const $ = id => document.getElementById(id);
const colors=['#245bcb','#008678','#b36c24','#8754b5','#c04968','#527c29','#177d9f','#915b46','#7666c7','#537488','#9c7840','#b25496'];
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.round(n%60)).padStart(2,'0')}`;
const minutes = text => {const [h,m]=text.split(':').map(Number);return h*60+m;};
const duration = seconds => {const m=Math.ceil(Math.max(0,seconds)/60);return `${Math.floor(m/60)}h ${m%60}m`;};
const timePart = seconds => `${+(seconds/60).toFixed(1)} min`;
let comparisons=null;
let loadSummary=null,summaryVersion=0;
let state, result=null, baseline=null, selected='T01', dirty=true, busy=false, approved=null, map, layers;
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error?'error':'';}
function save(){try{localStorage.setItem('karaka-demo-v1',JSON.stringify({state,approved}));}catch{notice('Browser storage unavailable. Export your plan to save it.',true);}}
function invalidate(){comparisons=null;dirty=true;result=null;approved=null;baseline=null;loadSummary=null;save();render();notice('Plan changed. Calculate the manual plan or optimize to refresh distances and schedules.');refreshLoad();}
async function refreshLoad(){
  const version=++summaryVersion;
  try{const next=await api('/api/summary',state);if(version!==summaryVersion)return;loadSummary=next;renderLoad();}
  catch(error){if(version===summaryVersion)notice(error.message,true);}
}
function owner(id){return Object.keys(state.assignments).find(t=>state.assignments[t].includes(id))||'';}
function changeAssignment(id,truck){Object.values(state.assignments).forEach(ids=>{const i=ids.indexOf(id);if(i>=0)ids.splice(i,1);});if(truck)(state.assignments[truck]??=[]).push(id);invalidate();}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);document.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);if(!value)render();}
async function calculate(optimize=false){
  if(busy)return;
  comparisons=null;
  setBusy(true);$('status').textContent=optimize?'Finding a feasible plan…':'Calculating routes…';
  try{
    if(optimize&&!baseline){baseline=await api('/api/plan',state);}
    const next=await api(optimize?'/api/optimize':'/api/plan',state);
    result=next;state.assignments=next.assignments;dirty=false;approved=null;
    ++summaryVersion;loadSummary=next.load;
    if(!optimize)baseline=structuredClone(next);
    save();
    notice(`${optimize?'Optimization complete. Review before approving.':'Manual plan calculated.'} ${next.unassigned.length} unassigned. ${next.warnings.length} constraint warnings. ${next.warnings.join(' ')} ${next.unassigned.length?'Unassigned: '+next.unassigned.join(', ')+'. ':''}${next.provider==='offline'?'Offline simulation uses straight-line distances at 25 km/h, not street routes.':'Road routes use the configured truck profile; entrance and restriction data still need verification.'}`);
  }catch(error){notice(error.message,true);}finally{setBusy(false);}
}
function useMode(mode){
  state.settings.mode=mode;result=structuredClone(comparisons[mode]);state.assignments=structuredClone(result.assignments);
  ++summaryVersion;loadSummary=result.load;
  dirty=false;approved=null;save();render();
  notice(`${mode==='geographic'?'Geographic grouping':'Driving efficiency'} displayed. ${result.unassigned.length} unassigned; ${result.warnings.length} warnings. Review the plan before approval.`);
}
async function compareModes(){
  if(busy)return;setBusy(true);$('status').textContent='Comparing both modes…';
  try{if(!baseline)baseline=await api('/api/plan',state);comparisons=await api('/api/compare',state);useMode(state.settings.mode);}
  catch(error){notice(error.message,true);}finally{setBusy(false);}
}
function renderModes(){
  $('mode').value=state.settings.mode;
  $('mode-results').innerHTML=comparisons?['geographic','efficiency'].map(mode=>{
    const p=comparisons[mode],m=p.metrics;
    return `<article class="mode-card ${mode===state.settings.mode?'selected':''}"><h3>${mode==='geographic'?'Geographic grouping':'Driving efficiency'}</h3><p><b>${m.trucks} trucks</b> · ${m.km.toFixed(1)} km · ${m.drive_minutes} min driving</p><p>${m.assigned} assigned · ${p.unassigned.length} unassigned · ${p.warnings.length} warnings</p><p>${p.load.assigned} / ${p.load.used_capacity} pallet spaces · longest route ${duration(m.longest_route_minutes*60)}</p><p>${m.nearby_pairs_split} / ${m.nearby_pairs} nearby pairs split across trucks</p><button data-mode="${mode}" ${busy?'disabled':''}>${mode===state.settings.mode?'Displayed on map':'View this plan'}</button></article>`;
  }).join('')+'<p class="mode-footnote">Nearby means within 800 m straight-line distance; only pairs with both deliveries assigned are counted. Three-second search per mode; minimum fleet size is not guaranteed.</p>':'';
  $('mode-results').querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>useMode(b.dataset.mode));
}
function renderLoad(){
  const load=result?.load||loadSummary;
  $('load-state').textContent=dirty?'Draft · schedule not checked':'Calculated plan';
  $('load-demand').textContent=load?`${load.demand} pallets`:'—';
  $('load-assigned').textContent=load?`${load.assigned} assigned · ${load.unassigned} unassigned`:'Updating demand…';
  $('load-fleet').textContent=load?`${load.available_capacity} spaces`:'—';
  $('load-fleet-detail').textContent=load?`${load.available_trucks} available trucks. Up to ${load.permitted_capacity} spaces across the ${load.permitted_trucks}-truck limit.`:'Available trucks only';
  $('load-used').textContent=load?`${load.assigned} / ${load.used_capacity} pallets`:'—';
  $('load-fill').value=load?.used_capacity?Math.min(100,load.assigned/load.used_capacity*100):0;
  $('load-used-detail').textContent=load?`${load.used_trucks} trucks used · ${load.free_on_used} empty spaces${load.overload_on_used?` · ${load.overload_on_used} pallets over capacity`:''}${load.unavailable_used_trucks?` · ${load.unavailable_used_trucks} used trucks unavailable`:''}`:'Updating capacity…';
  $('load-used-detail').className=load&&(load.overload_on_used||load.unavailable_used_trucks)?'warning':'';
  const floor=load?.min_trucks_by_load;
  $('load-floor').textContent=load?(floor?`At least ${floor}`:'Insufficient space'):'—';
  $('load-floor-detail').textContent=floor?`Largest ${floor-1} trucks: ${load.capacity_before_min} spaces. Largest ${floor}: ${load.capacity_at_min} spaces.`:'Available capacity must cover the full delivery demand.';
  const notes=[];
  if(load){
    if(load.capacity_shortfall)notes.push(`The current truck limit leaves ${load.capacity_shortfall} pallets without space. Make more capacity available or raise the truck limit.`);
    else notes.push(`Load alone needs at least ${floor} trucks for ${load.demand} pallets.`);
    if(load.overload_on_used)notes.push('Empty spaces on other trucks do not cancel an overloaded truck.');
    if(load.unassigned)notes.push(`${load.unassigned} pallets are still unassigned.`);
    if(result&&!result.unassigned.length&&!result.warnings.length&&floor===load.used_trucks)notes.push('This plan reaches that capacity minimum.');
    if(result&&floor&&load.used_trucks>floor)notes.push(`This plan uses ${load.used_trucks-floor} more truck(s) than the load-only floor; this does not prove the smaller fleet is infeasible.`);
    notes.push('Stop sizes, delivery windows, travel and service time can require more trucks. Fewer trucks remain the preference.');
  }
  $('load-explanation').textContent=notes.join(' ');
  const longest=result?.routes.reduce((a,r)=>!a||r.timing.total_seconds>a.timing.total_seconds?r:a,null);
  $('longest-route').textContent=longest?duration(longest.timing.total_seconds):result?'No assigned routes':'Not calculated';
  $('route-time-status').textContent=longest?`${longest.truck_id} · ${duration(longest.timing.limit_seconds)} allowed · ${result.routes.length-result.metrics.over_time_routes}/${result.routes.length} routes within time limits`:`${duration(state.settings.max_route_minutes*60)} maximum per route; earlier shift end takes precedence.`;
  $('route-time-status').className=result?.metrics.over_time_routes?'warning':'';
}
function initMap(){
  if(!window.L){$('map').innerHTML='<p class="empty">Map library could not load. Check your internet connection; planning remains available.</p>';return;}
  map=L.map('map').setView([18.469,-69.932],13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  layers=L.layerGroup().addTo(map);
}
function drawMap(){
  if(!map)return;layers.clearLayers();
  const routes=result?.routes||[];
  for(const route of routes){const i=state.trucks.findIndex(t=>t.id===route.truck_id);L.polyline(route.geometry,{color:colors[i%colors.length],weight:route.truck_id===selected?5:3,opacity:route.truck_id===selected?.95:.35,dashArray:result.provider==='offline'?'7 7':null}).addTo(layers);}
  state.deliveries.forEach(d=>{const truck=owner(d.id), i=state.trucks.findIndex(t=>t.id===truck), sequence=truck?state.assignments[truck].indexOf(d.id)+1:'•';const marker=L.marker([d.lat,d.lon],{icon:L.divIcon({className:'map-pin',html:esc(sequence),iconSize:[24,24]})}).addTo(layers);marker.getElement().style.setProperty('--pin',i<0?'#758291':colors[i%colors.length]);marker.bindPopup(`<b>${esc(d.name)}</b><br>${esc(d.id)} · ${esc(truck||'Unassigned')}<br>${d.pallets} pallets · ${clock(d.window_start)}–${clock(d.window_end)}`);marker.on('click',()=>{if(truck){selected=truck;renderFleet();renderRoute();}});});
  L.marker([state.depot.lat,state.depot.lon],{icon:L.divIcon({className:'map-pin depot-pin',html:'D',iconSize:[28,28]})}).addTo(layers).bindPopup(esc(state.depot.name));
}
function renderFleet(){
  $('fleet').innerHTML=state.trucks.map((t,i)=>`<button class="fleet-item ${t.id===selected?'active':''}" data-truck="${esc(t.id)}" style="--route:${colors[i%colors.length]}"><span class="truck-symbol">${i+1}</span><span>${esc(t.name)}<small>${t.available?'Available':'Unavailable'} · ${t.capacity} pallets</small></span><span class="count">${(state.assignments[t.id]||[]).length}</span></button>`).join('');
  $('fleet').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.truck;renderFleet();renderRoute();drawMap();});
  $('fleet-count').textContent=`${state.trucks.length} trucks`;
}
function renderRoute(){
  const truck=state.trucks.find(t=>t.id===selected)||state.trucks[0];selected=truck.id;
  const ids=state.assignments[selected]||[], route=result?.routes.find(r=>r.truck_id===selected);
  $('route-title').textContent=truck.name;$('route-load').textContent=`${ids.reduce((n,id)=>n+state.deliveries.find(d=>d.id===id).pallets,0)} / ${truck.capacity} pallets`;
  $('available').checked=truck.available;$('capacity').value=truck.capacity;
  $('shift-start').value=clock(truck.shift_start);$('shift-end').value=clock(truck.shift_end);
  const timing=route?.timing;
  $('route-summary').innerHTML=route?`<b>${duration(timing.total_seconds)} full route / ${duration(timing.limit_seconds)} allowed</b><br>${timePart(timing.driving_seconds)} driving · ${timePart(timing.service_seconds)} service · ${timePart(timing.waiting_seconds)} waiting<br>${timing.remaining_seconds>=0?`${Math.floor(timing.remaining_seconds/60)} min remaining`:`${Math.ceil(-timing.remaining_seconds/60)} min over time limit`}<br>${route.km.toFixed(1)} km · return ${clock(route.end)}<br>Shift ${clock(truck.shift_start)}–${clock(truck.shift_end)} · return trip included${route.warnings.map(w=>`<div class="warning">${esc(w)}</div>`).join('')}`:'Calculate a plan to see the full route duration and schedule.';
  $('stops').innerHTML=ids.length?`<div class="stop"><span class="stop-number">D</span><div class="stop-info"><b>Depart depot</b><small>${clock(truck.shift_start)}</small></div></div>`+ids.map((id,i)=>{const d=state.deliveries.find(d=>d.id===id),s=route?.stops.find(s=>s.id===id);return `<div class="stop"><span class="stop-number">${i+1}</span><div class="stop-info"><b>${esc(d.name)}</b><small>${esc(id)} · ${d.pallets} pallets · ${d.service_minutes} min service</small><small>${s?`Arrive ${clock(s.arrival)} · depart ${clock(s.departure)}${s.wait_minutes?` · wait ${s.wait_minutes}m`:''}`:`Window ${clock(d.window_start)}–${clock(d.window_end)}`}</small><div class="stop-buttons"><button data-move="${i}" data-direction="-1" aria-label="Move ${esc(id)} earlier" ${i===0?'disabled':''}>↑</button><button data-move="${i}" data-direction="1" aria-label="Move ${esc(id)} later" ${i===ids.length-1?'disabled':''}>↓</button><button data-remove="${esc(id)}">Unassign</button><button data-edit="${esc(id)}">Edit</button></div></div></div>`;}).join('')+`<div class="stop"><span class="stop-number">D</span><div class="stop-info"><b>Return to depot</b><small>${route?clock(route.end):'Not calculated'}</small></div></div>`:'<p class="empty">No deliveries assigned.<br>Choose this truck on the delivery board or optimize the fleet.</p>';
  $('stops').querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const i=+b.dataset.move,j=i+(+b.dataset.direction);[ids[i],ids[j]]=[ids[j],ids[i]];invalidate();});
  $('stops').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>changeAssignment(b.dataset.remove,''));
  $('stops').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
  $('approve').disabled=busy||dirty||!result||result.warnings.length>0||result.unassigned.length>0;
  $('approval-note').textContent=approved?`Approved ${new Date(approved).toLocaleString()}. Saved only in this browser.`:result&&(result.warnings.length||result.unassigned.length)?'Resolve warnings and unassigned deliveries before approval.':'Approval is saved in this browser only.';
}
function renderDeliveries(){
  const query=$('search').value.toLowerCase();
  $('delivery-rows').innerHTML=state.deliveries.filter(d=>(d.id+' '+d.name).toLowerCase().includes(query)).map(d=>`<tr><td><b>${esc(d.name)}</b><small>${esc(d.id)}</small></td><td>${clock(d.window_start)}–${clock(d.window_end)}</td><td>${d.pallets}</td><td>${d.service_minutes} min</td><td><select aria-label="Assign ${esc(d.id)}" data-assign="${esc(d.id)}"><option value="">Unassigned</option>${state.trucks.map(t=>`<option value="${esc(t.id)}" ${owner(d.id)===t.id?'selected':''}>${esc(t.name)}${t.available?'':' (unavailable)'}</option>`).join('')}</select></td><td><button data-edit="${esc(d.id)}">Edit</button></td></tr>`).join('');
  $('delivery-rows').querySelectorAll('select').forEach(s=>s.onchange=()=>changeAssignment(s.dataset.assign,s.value));
  $('delivery-rows').querySelectorAll('button').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
}
function render(){
  if(!state)return;
  $('provider').value=state.settings.provider;$('factor').value=String(state.settings.time_factor);$('max-trucks').value=state.settings.max_trucks;$('max-trucks').max=state.trucks.length;
  $('max-route-hours').value=+(state.settings.max_route_minutes/60).toFixed(4);
  $('status').textContent=approved?'Approved locally':dirty?'Draft · calculation needed':'Draft · ready to review';
  const m=result?.metrics;$('assigned').textContent=`${m?m.assigned:Object.values(state.assignments).flat().length} / ${state.deliveries.length}`;
  $('used').textContent=`${m?m.trucks:Object.values(state.assignments).filter(x=>x.length).length} / ${state.trucks.filter(t=>t.available).length}`;
  $('distance').textContent=m?`${m.km.toFixed(1)} km`:'—';$('duration').textContent=m?`${Math.floor(m.drive_minutes/60)}h ${m.drive_minutes%60}m`:'—';
  $('distance-label').textContent=state.settings.provider==='offline'?'Straight-line distance (simulation)':'Planned road distance';
  $('geometry-label').textContent=dirty?'Calculate a plan to display its route':state.settings.provider==='offline'?'Dashed connectors are simulated, not roads':'Road geometry · no traffic feed';
  $('comparison').textContent=m&&baseline?`${(baseline.metrics.km-m.km).toFixed(1)} km less · ${baseline.metrics.drive_minutes-m.drive_minutes} min less`:'Calculate a baseline';
  renderLoad();renderModes();renderFleet();renderRoute();renderDeliveries();drawMap();
  if(busy)document.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);
}
function edit(id){const d=state.deliveries.find(d=>d.id===id),f=$('edit-form');for(const key of ['id','name','lat','lon','pallets','service_minutes'])f.elements[key].value=d[key];for(const key of ['window_start','window_end'])f.elements[key].value=clock(d[key]);$('editor').showModal();}
$('edit-form').onsubmit=event=>{event.preventDefault();const f=event.target,updated={...state.deliveries.find(d=>d.id===f.elements.id.value)};updated.name=f.elements.name.value;for(const key of ['lat','lon','pallets','service_minutes'])updated[key]=+f.elements[key].value;for(const key of ['window_start','window_end'])updated[key]=minutes(f.elements[key].value);if(updated.window_end<updated.window_start){f.elements.window_end.setCustomValidity('Closing time must follow opening time.');f.reportValidity();f.elements.window_end.setCustomValidity('');return;}Object.assign(state.deliveries.find(d=>d.id===updated.id),updated);$('editor').close();invalidate();};
$('cancel-edit').onclick=()=>$('editor').close();
$('calculate').onclick=()=>calculate(false);$('optimize').onclick=()=>calculate(true);
$('compare-modes').onclick=compareModes;
$('mode').onchange=e=>{const mode=e.target.value;if(comparisons){useMode(mode);}else{state.settings.mode=mode;invalidate();}};
$('provider').onchange=e=>{state.settings.provider=e.target.value;invalidate();};
$('factor').onchange=e=>{state.settings.time_factor=+e.target.value;invalidate();};
$('max-trucks').onchange=e=>{state.settings.max_trucks=+e.target.value;invalidate();};
$('max-route-hours').onchange=e=>{if(!e.target.value||!e.target.reportValidity())return;state.settings.max_route_minutes=+e.target.value*60;invalidate();};
for(const [id,key] of [['shift-start','shift_start'],['shift-end','shift_end']])$(id).onchange=e=>{
  if(!e.target.value||!e.target.reportValidity())return;
  const truck=state.trucks.find(t=>t.id===selected),value=minutes(e.target.value);
  if(key==='shift_start'?value>truck.shift_end:value<truck.shift_start){notice('Shift end must be at or after shift start.',true);renderRoute();return;}
  truck[key]=value;invalidate();
};
$('available').onchange=e=>{state.trucks.find(t=>t.id===selected).available=e.target.checked;invalidate();};
$('capacity').onchange=e=>{state.trucks.find(t=>t.id===selected).capacity=+e.target.value;invalidate();};
$('search').oninput=renderDeliveries;
$('fit').onclick=()=>{if(map)map.fitBounds(L.latLngBounds([state.depot,...state.deliveries].map(p=>[p.lat,p.lon])),{padding:[30,30]});};
$('approve').onclick=()=>{approved=new Date().toISOString();save();render();notice('Plan approved locally. Export the plan to share this reviewed version. No driver assignments were sent.');};
$('reset').onclick=async()=>{if(!confirm('Replace this browser’s current scenario with the sample?'))return;state=await api('/api/sample');selected=state.trucks[0].id;invalidate();await calculate();};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({schema_version:1,scenario:state,plan:dirty?null:result,approved_at:dirty?null:approved},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='karaka-dispatch-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>500000)throw Error('Scenario must be under 500 KB.');const raw=JSON.parse(await file.text());const incoming=await api('/api/validate',raw.scenario||raw);state=incoming;selected=state.trucks[0].id;invalidate();await calculate();}catch(error){notice(error.message,true);}finally{e.target.value='';}};
(async()=>{try{const saved=JSON.parse(localStorage.getItem('karaka-demo-v1')||'null');state=saved?await api('/api/validate',saved.state):await api('/api/sample');}catch{state=await api('/api/sample');}initMap();render();refreshLoad();$('fit').click();await calculate();})().catch(error=>notice(error.message,true));

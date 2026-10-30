/* No frontend framework required: all planning is behind /api. */
const $ = id => document.getElementById(id);
const colors=['#245bcb','#008678','#b36c24','#8754b5','#c04968','#527c29','#177d9f','#915b46','#7666c7','#537488','#9c7840','#b25496'];
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.round(n%60)).padStart(2,'0')}`;
const minutes = text => {const [h,m]=text.split(':').map(Number);return h*60+m;};
let state, result=null, baseline=null, selected='T01', dirty=true, busy=false, approved=null, map, layers;
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error?'error':'';}
function save(){try{localStorage.setItem('karaka-demo-v1',JSON.stringify({state,approved}));}catch{notice('Browser storage unavailable. Export your plan to save it.',true);}}
function invalidate(){dirty=true;result=null;approved=null;baseline=null;save();render();notice('Plan changed. Calculate the manual plan or optimize to refresh distances and schedules.');}
function owner(id){return Object.keys(state.assignments).find(t=>state.assignments[t].includes(id))||'';}
function changeAssignment(id,truck){Object.values(state.assignments).forEach(ids=>{const i=ids.indexOf(id);if(i>=0)ids.splice(i,1);});if(truck)(state.assignments[truck]??=[]).push(id);invalidate();}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);document.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);if(!value)render();}
async function calculate(optimize=false){
  if(busy)return;
  setBusy(true);$('status').textContent=optimize?'Finding a feasible plan…':'Calculating routes…';
  try{
    if(optimize&&!baseline){baseline=await api('/api/plan',state);}
    const next=await api(optimize?'/api/optimize':'/api/plan',state);
    result=next;state.assignments=next.assignments;dirty=false;approved=null;
    if(!optimize)baseline=structuredClone(next);
    save();
    notice(`${optimize?'Optimization complete. Review before approving.':'Manual plan calculated.'} ${next.unassigned.length} unassigned. ${next.warnings.length} constraint warnings. ${next.warnings.join(' ')} ${next.unassigned.length?'Unassigned: '+next.unassigned.join(', ')+'. ':''}${next.provider==='offline'?'Offline simulation uses straight-line distances at 25 km/h, not street routes.':'Road routes use the configured truck profile; entrance and restriction data still need verification.'}`);
  }catch(error){notice(error.message,true);}finally{setBusy(false);}
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
  $('route-summary').innerHTML=route?`${route.km.toFixed(1)} km · ${route.drive_minutes} min driving<br>Return ${clock(route.end)} · shift ${clock(truck.shift_start)}–${clock(truck.shift_end)}${route.warnings.map(w=>`<div class="warning">${esc(w)}</div>`).join('')}`:'Calculate a plan to see the schedule.';
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
  $('status').textContent=approved?'Approved locally':dirty?'Draft · calculation needed':'Draft · ready to review';
  const m=result?.metrics;$('assigned').textContent=`${m?m.assigned:Object.values(state.assignments).flat().length} / ${state.deliveries.length}`;
  $('used').textContent=`${m?m.trucks:Object.values(state.assignments).filter(x=>x.length).length} / ${state.trucks.filter(t=>t.available).length}`;
  $('distance').textContent=m?`${m.km.toFixed(1)} km`:'—';$('duration').textContent=m?`${Math.floor(m.drive_minutes/60)}h ${m.drive_minutes%60}m`:'—';
  $('distance-label').textContent=state.settings.provider==='offline'?'Straight-line distance (simulation)':'Planned road distance';
  $('geometry-label').textContent=dirty?'Calculate a plan to display its route':state.settings.provider==='offline'?'Dashed connectors are simulated, not roads':'Road geometry · no traffic feed';
  $('comparison').textContent=m&&baseline?`${(baseline.metrics.km-m.km).toFixed(1)} km less · ${baseline.metrics.drive_minutes-m.drive_minutes} min less`:'Calculate a baseline';
  renderFleet();renderRoute();renderDeliveries();drawMap();
}
function edit(id){const d=state.deliveries.find(d=>d.id===id),f=$('edit-form');for(const key of ['id','name','lat','lon','pallets','service_minutes'])f.elements[key].value=d[key];for(const key of ['window_start','window_end'])f.elements[key].value=clock(d[key]);$('editor').showModal();}
$('edit-form').onsubmit=event=>{event.preventDefault();const f=event.target,updated={...state.deliveries.find(d=>d.id===f.elements.id.value)};updated.name=f.elements.name.value;for(const key of ['lat','lon','pallets','service_minutes'])updated[key]=+f.elements[key].value;for(const key of ['window_start','window_end'])updated[key]=minutes(f.elements[key].value);if(updated.window_end<updated.window_start){f.elements.window_end.setCustomValidity('Closing time must follow opening time.');f.reportValidity();f.elements.window_end.setCustomValidity('');return;}Object.assign(state.deliveries.find(d=>d.id===updated.id),updated);$('editor').close();invalidate();};
$('cancel-edit').onclick=()=>$('editor').close();
$('calculate').onclick=()=>calculate(false);$('optimize').onclick=()=>calculate(true);
$('provider').onchange=e=>{state.settings.provider=e.target.value;invalidate();};
$('factor').onchange=e=>{state.settings.time_factor=+e.target.value;invalidate();};
$('max-trucks').onchange=e=>{state.settings.max_trucks=+e.target.value;invalidate();};
$('available').onchange=e=>{state.trucks.find(t=>t.id===selected).available=e.target.checked;invalidate();};
$('capacity').onchange=e=>{state.trucks.find(t=>t.id===selected).capacity=+e.target.value;invalidate();};
$('search').oninput=renderDeliveries;
$('fit').onclick=()=>{if(map)map.fitBounds(L.latLngBounds([state.depot,...state.deliveries].map(p=>[p.lat,p.lon])),{padding:[30,30]});};
$('approve').onclick=()=>{approved=new Date().toISOString();save();render();notice('Plan approved locally. Export the plan to share this reviewed version. No driver assignments were sent.');};
$('reset').onclick=async()=>{if(!confirm('Replace this browser’s current scenario with the sample?'))return;state=await api('/api/sample');selected=state.trucks[0].id;invalidate();await calculate();};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({schema_version:1,scenario:state,plan:dirty?null:result,approved_at:dirty?null:approved},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='karaka-dispatch-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>500000)throw Error('Scenario must be under 500 KB.');const raw=JSON.parse(await file.text());const incoming=await api('/api/validate',raw.scenario||raw);state=incoming;selected=state.trucks[0].id;invalidate();await calculate();}catch(error){notice(error.message,true);}finally{e.target.value='';}};
(async()=>{try{const saved=JSON.parse(localStorage.getItem('karaka-demo-v1')||'null');state=saved?await api('/api/validate',saved.state):await api('/api/sample');}catch{state=await api('/api/sample');}initMap();render();$('fit').click();await calculate();})().catch(error=>notice(error.message,true));

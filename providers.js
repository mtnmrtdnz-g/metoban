// ---------- Diğer harita sağlayıcıları (ayrı sekme) ----------
// Her sağlayıcı kendi haritası, kendi trafik katmanı ve kendi rotalarıyla gösterilir (Google içeriğiyle karıştırılmaz).
// Ana betikteki ortak yardımcıları kullanır: $, S, P, R, DEF, store, esc, fmtKm, fmtTL, myPos, proj, setOrigin, diff,
// tableToll, wpFor, navUrl, COLORS, startDrive.
(function(){
const LL_CSS='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',LL_JS='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
let llReady=null;
function loadLeaflet(){if(llReady)return llReady;
  llReady=new Promise((res,rej)=>{const l=document.createElement('link');l.rel='stylesheet';l.href=LL_CSS;document.head.appendChild(l);
    const s=document.createElement('script');s.src=LL_JS;s.onload=res;s.onerror=()=>{llReady=null;rej(new Error('Leaflet yüklenemedi'));};document.head.appendChild(s);});
  return llReady;}

// ---- günlük kullanım kilidi (ücretsiz planların günlük sınırının altında kalmak için) ----
const LIM={yandex:{api:500,tiles:1e9},tomtom:{api:2000,tiles:45000},here:{api:300,tiles:600},osm:{api:500,tiles:3000}};
const dayKey=()=>new Date().toISOString().slice(0,10);
let USE=null;
function use(){if(!USE||USE.d!==dayKey()){USE=store.get('puse',null);if(!USE||USE.d!==dayKey())USE={d:dayKey()};}return USE;}
let flushT=null;function flush(){clearTimeout(flushT);flushT=setTimeout(()=>store.set('puse',use()),1500);}
function pSpend(pv,kind,n){const u=use(),k=pv+'_'+kind,lim=LIM[pv][kind];if((u[k]||0)+n>lim)return false;u[k]=(u[k]||0)+n;flush();return true;}
function usedTxt(pv){const u=use();return `Bugün: rota ${u[pv+'_api']||0}/${LIM[pv].api}, harita döşemesi ${u[pv+'_tiles']||0}/${LIM[pv].tiles}`;}

// ---- HERE flexible polyline çözücü ----
function decodeFlex(s){const T='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let i=0;
  const uv=()=>{let res=0,sh=1,v;do{v=T.indexOf(s[i++]);if(v<0)throw new Error('polyline');res+=(v&31)*sh;sh*=32;}while(v&32);return res;};
  const sv=()=>{const u=uv();return u%2?-(u+1)/2:u/2;};
  uv();const hd=uv(),prec=hd&15,third=(hd>>4)&7,f=Math.pow(10,prec);let la=0,ln=0;const out=[];
  while(i<s.length){la+=sv();ln+=sv();if(third)sv();out.push([la/f,ln/f]);}return out;}
function hav(a,b){const r=Math.PI/180,dla=(b[0]-a[0])*r,dln=(b[1]-a[1])*r,s=Math.sin(dla/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dln/2)**2;return 12742000*Math.asin(Math.sqrt(s));}

// ---- sağlayıcılar ----
const PROV={
 yandex:{name:'Yandex',keyName:'ykey',traffic:true,custom:true,signup:'https://developer.tech.yandex.com/services'},
 tomtom:{name:'TomTom',keyName:'ttkey',traffic:true,signup:'https://developer.tomtom.com/user/register',
   base:k=>'https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key='+encodeURIComponent(k),
   flow:k=>'https://api.tomtom.com/traffic/map/4/tile/flow/relative0-dark/{z}/{x}/{y}.png?key='+encodeURIComponent(k),
   attr:'© TomTom',
   async route(a,b,k){
     const u=`https://api.tomtom.com/routing/1/calculateRoute/${a.lat.toFixed(6)},${a.lng.toFixed(6)}:${b.lat.toFixed(6)},${b.lng.toFixed(6)}/json`+
       `?key=${encodeURIComponent(k)}&traffic=true&maxAlternatives=2&routeType=fastest&travelMode=car&sectionType=toll&language=tr-TR`;
     const r=await fetch(u),j=await r.json().catch(()=>({}));
     if(!r.ok)throw new Error((j.error&&j.error.description)||(j.detailedError&&j.detailedError.message)||('HTTP '+r.status));
     return (j.routes||[]).map(rt=>{const pts=[];(rt.legs||[]).forEach(l=>(l.points||[]).forEach(p=>pts.push([p.latitude,p.longitude])));
       let tollM=0;(rt.sections||[]).filter(s=>s.sectionType==='TOLL_ROAD').forEach(s=>{for(let i=s.startPointIndex;i<s.endPointIndex&&i+1<pts.length;i++)tollM+=hav(pts[i],pts[i+1]);});
       const sm=rt.summary||{};
       return {pts,dur:sm.travelTimeInSeconds||0,dist:sm.lengthInMeters||0,delay:sm.trafficDelayInSeconds||0,tollM,price:null};});}},
 here:{name:'HERE',keyName:'herekey',traffic:true,signup:'https://platform.here.com/sign-up',
   base:k=>'https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=explore.night&size=256&apiKey='+encodeURIComponent(k),
   flow:k=>'https://traffic.maps.hereapi.com/v3/flow/mc/{z}/{x}/{y}/png8?size=256&apiKey='+encodeURIComponent(k),
   attr:'© HERE',
   async route(a,b,k){
     const u='https://router.hereapi.com/v8/routes?transportMode=car&alternatives=2&return=summary,polyline,tolls&lang=tr-TR&currency=TRY'+
       `&origin=${a.lat.toFixed(6)},${a.lng.toFixed(6)}&destination=${b.lat.toFixed(6)},${b.lng.toFixed(6)}&apiKey=${encodeURIComponent(k)}`;
     const r=await fetch(u),j=await r.json().catch(()=>({}));
     if(!r.ok)throw new Error(j.title||j.error_description||j.error||('HTTP '+r.status));
     return (j.routes||[]).map(rt=>{let pts=[],dur=0,base=0,dist=0,price=0,hasToll=false,unknown=false;
       for(const s of (rt.sections||[])){try{pts=pts.concat(decodeFlex(s.polyline));}catch(e){}
         const sm=s.summary||{};dur+=sm.duration||0;base+=sm.baseDuration||sm.duration||0;dist+=sm.length||0;
         for(const t of (s.tolls||[])){hasToll=true;const f=(t.fares||[])[0];const pr=f&&(f.convertedPrice||f.price);
           if(pr&&(pr.currency==='TRY'||f.convertedPrice))price+=+pr.value||0;else unknown=true;}}
       return {pts,dur,dist,delay:Math.max(0,dur-base),tollM:hasToll?1:0,price:hasToll&&!unknown?price:null};});}},
 osm:{name:'OSM',keyName:null,traffic:false,
   base:()=>'https://tile.openstreetmap.org/{z}/{x}/{y}.png',flow:null,
   attr:'© OpenStreetMap katkıcıları · OSRM',
   async route(a,b){
     const u=`https://router.project-osrm.org/route/v1/driving/${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}?overview=full&geometries=geojson&alternatives=true`;
     const r=await fetch(u),j=await r.json().catch(()=>({}));
     if(!r.ok||j.code!=='Ok')throw new Error(j.message||j.code||('HTTP '+r.status));
     return (j.routes||[]).map(rt=>({pts:rt.geometry.coordinates.map(c=>[c[1],c[0]]),dur:rt.duration,dist:rt.distance,delay:null,tollM:null,price:null}));}}
};

// ---- başlangıç/varış koordinatı: kendi koordinatı, yoksa OpenStreetMap (Photon) adres araması, o da yoksa Google rotasının ucu ----
const GEO=new Map();
async function coordOf(which){const p=P[which];if(!p)return null;
  if(p.lat!=null)return {lat:p.lat,lng:p.lng,src:p.me?'konumun':'seçilen nokta'};
  if(GEO.has(p.text))return GEO.get(p.text);
  const parts=p.text.split(',').map(s=>s.trim()).filter(Boolean),c=myPos||{lat:41.01,lng:28.97};
  for(const q of [...new Set([p.text,parts.slice(0,3).join(', '),parts.slice(0,2).join(', '),parts[0]])]){if(!q)continue;
    try{const r=await fetch('https://photon.komoot.io/api/?limit=1&lat='+c.lat.toFixed(3)+'&lon='+c.lng.toFixed(3)+'&q='+encodeURIComponent(q));
      const j=await r.json(),f=(j.features||[])[0];
      if(f){const o={lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],src:'OSM araması: '+q};GEO.set(p.text,o);return o;}}catch(e){}}
  if(R.length){const g=R[0].g.pts,e=which==='from'?g[0]:g[g.length-1];return {lat:e.lat,lng:e.lng,src:'Google rotasının ucu'};}
  return null;}

// ---- geometri (ana betikteki karşılaştırma fonksiyonlarıyla uyumlu) ----
function geomFrom(pts){const out=[];let prev=null,D=0;
  for(const [la,ln] of pts){const [x,y]=proj(la,ln);
    if(!prev){prev={x,y,lat:la,lng:ln,step:0,d:0,t:0};out.push(prev);continue;}
    const dx=x-prev.x,dy=y-prev.y,L=Math.hypot(dx,dy);if(L<0.5)continue;const n=Math.ceil(L/DENS),p0=prev;
    for(let k=1;k<=n;k++){const f=k/n;D+=L/n;out.push({x:p0.x+dx*f,y:p0.y+dy*f,lat:p0.lat+(la-p0.lat)*f,lng:p0.lng+(ln-p0.lng)*f,step:Math.floor(D/1000),d:D,t:D/13});}
    prev=out[out.length-1];}
  return {pts:out,segs:[],grid:null};}
// Google'ın bulduğu rotalardan hangisiyle aynı yol? (iki yönde de farklı kesimlerin toplamı)
function googleTwin(g){let best=null;
  for(const y of R){const own=diff(g,y.g).reduce((s,o)=>s+g.pts[o.b[1]].d-g.pts[o.b[0]].d,0),off=own+diff(y.g,g).reduce((s,o)=>s+y.g.pts[o.b[1]].d-y.g.pts[o.b[0]].d,0);
    if(!best||off<best.off)best={y,off,own};}
  return best;}

// ---- arayüz ----
let tab='google',lmap=null,base=null,flow=null,lines=[],marks=[],cache={},PR=[];
const pv=()=>PROV[tab];
function keyOf(p){return p.keyName?(store.get(p.keyName,'')||''):'-';}
function pmsg(t,err){const el=$('#pmsg');el.textContent=t||'';el.style.color=err?'var(--bad)':'var(--mut)';}

function showTab(t){tab=t;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  $('#tab-google').style.display=t==='google'?'':'none';$('#tab-prov').style.display=t==='google'?'none':'';
  try{localStorage.setItem('rk_tab',JSON.stringify(t));}catch(e){}
  if(t!=='google')openProv();}
document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-t]');if(b)showTab(b.dataset.t);});

function keyForm(p){const k=keyOf(p);
  $('#pkey').innerHTML=!p.keyName?'<div class="hint">Anahtar gerekmiyor. Trafik verisi yok; süreler trafiksiz tahmindir. Ortak demo sunucusu kullanılır, yoğun kullanımda yavaşlayabilir.</div>':
    (k?`<div class="hint">${esc(p.name)} anahtarı kayıtlı · <a href="#" id="pkeyedit" style="color:var(--acc)">değiştir</a> · ${esc(usedTxt(tab))}</div>`:
    `<div class="row"><input id="pkeyin" placeholder="${esc(p.name)} API anahtarı"><button id="pkeysave" class="pri">Kaydet</button></div>
     <div class="hint">Ücretsiz anahtar: <a href="${p.signup}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(p.signup.replace('https://',''))}</a>. Kart bilgisi ekleme: ücretsiz planda sınır aşılınca istek reddedilir, ücret çıkmaz. Uygulama ayrıca günlük sınırın altında kalır.</div>`);}
document.getElementById('pkey').addEventListener('click',e=>{const p=pv();
  if(e.target.id==='pkeysave'){const v=$('#pkeyin').value.trim();if(!v)return;store.set(p.keyName,v);cache={};
    if(p.custom&&yLoad){location.reload();return;}openProv();}
  if(e.target.id==='pkeyedit'){e.preventDefault();store.set(p.keyName,'');keyForm(p);}});
document.getElementById('prefresh').addEventListener('click',()=>{delete cache[tab];openProv(true);});

async function openProv(force){const p=pv();keyForm(p);
  $('#pmap').style.display=p.custom?'none':'';$('#ymap').style.display=p.custom?'':'none';
  if(p.keyName&&!keyOf(p)){$('#pcards').innerHTML='';pmsg('');return;}
  if(p.custom)return openYandex(force);
  try{await loadLeaflet();}catch(e){pmsg(e.message,1);return;}
  const k=keyOf(p);
  if(!lmap){lmap=L.map('pmap',{zoomControl:true,attributionControl:true}).setView([41.01,28.97],10);}
  setTimeout(()=>lmap.invalidateSize(),50);
  // katmanlar (döşeme sayacı ile)
  if(base)lmap.removeLayer(base);if(flow)lmap.removeLayer(flow);base=flow=null;
  const counted=(url,opt)=>{const l=L.tileLayer(url,opt);l.on('tileloadstart',()=>{if(!pSpend(tab,'tiles',1)){lmap.removeLayer(l);pmsg('Günlük harita döşemesi sınırı doldu; harita durduruldu.',1);}});return l;};
  base=counted(p.base(k),{maxZoom:19,attribution:p.attr}).addTo(lmap);
  if(p.flow)flow=counted(p.flow(k),{maxZoom:19,opacity:0.9}).addTo(lmap);
  if(!P.from||!P.to){pmsg('Nereden ve nereye gir.');$('#pcards').innerHTML='';return;}
  const ck=(P.from.text||'')+'|'+(P.to.text||'');
  const c=cache[tab];
  if(!force&&c&&c.ck===ck&&Date.now()-c.t<5*60000){PR=c.routes;drawProv(c.info);return;}
  pmsg(p.name+' rotaları hesaplanıyor…');$('#pcards').innerHTML='';
  const a=await coordOf('from'),b=await coordOf('to');
  if(!a||!b){pmsg('Adres koordinata çevrilemedi. Listeden bir öneri seç ya da Google sekmesinde bir kez arat.',1);return;}
  if(!R.length)setOrigin(a.lat,a.lng);
  if(!pSpend(tab,'api',1)){pmsg('Günlük rota sınırı doldu ('+usedTxt(tab)+').',1);return;}
  let rs;try{rs=await p.route(a,b,k);}catch(e){pmsg(p.name+' rota vermedi: '+String(e.message).slice(0,160),1);return;}
  if(!rs.length){pmsg(p.name+' bu iki nokta arasında rota bulamadı.',1);return;}
  rs.sort((x,y)=>x.dur-y.dur);
  PR=rs.map((x,i)=>Object.assign(x,{label:String.fromCharCode(65+i),color:COLORS[i%COLORS.length],g:geomFrom(x.pts),via:null,lock:null,tags:[p.name]}));
  const info=`Başlangıç: ${a.src} · Varış: ${b.src}`;
  cache[tab]={ck,t:Date.now(),routes:PR,info};drawProv(info);}

function drawProv(info){const p=pv();
  lines.forEach(l=>lmap.removeLayer(l));marks.forEach(m=>lmap.removeLayer(m));lines=[];marks=[];
  const all=[];PR.slice().reverse().forEach((x,ri)=>{const i=PR.length-1-ri;
    const l=L.polyline(x.pts,{color:x.color,weight:i===0?7:5,opacity:0.9}).addTo(lmap);lines.push(l);all.push(...x.pts);
    l.bindTooltip(`${x.label} · ${Math.round(x.dur/60)} dk`,{permanent:true,direction:'center',className:''});});
  if(all.length){marks.push(L.circleMarker(all[0],{radius:7,color:'#fff',fillColor:'#4285f4',fillOpacity:1}).addTo(lmap));
    const e=PR[0].pts[PR[0].pts.length-1];marks.push(L.marker(e).addTo(lmap).bindTooltip('Varış'));
    lmap.fitBounds(L.latLngBounds(all),{padding:[30,30]});}
  renderCards(info);}
function renderCards(info){const p=pv(),A=PR[0];
  $('#pcards').innerHTML=PR.map((x,i)=>{
    const tt=tableToll(x.g);let toll='';
    if(x.price!=null)toll=x.price>0?`<span class="tag bad">Ücretli ${fmtTL(x.price)} (${esc(p.name)})</span>`:'<span class="tag ok">Ücretsiz</span>';
    else if(x.tollM)toll=`<span class="tag bad">Ücretli yol ${p.name==='TomTom'?(x.tollM/1000).toFixed(1)+' km':''}</span>`+(tt.sum?`<span class="tag">köprü/tünel ${fmtTL(tt.sum)}</span>`:'');
    else if(x.tollM===0)toll='<span class="tag ok">Ücretsiz</span>';
    else if(tt.sum)toll=`<span class="tag bad">köprü/tünel ${fmtTL(tt.sum)}</span>`;
    const tw=R.length?googleTwin(x.g):null;
    const gl=!R.length?'Google sekmesinde aratırsan aynı yolu orada da gösteririm.':
      tw.off<500?`Google'da da var: <b style="color:${tw.y.color}">${tw.y.label}</b> rotası, Google ${Math.round(tw.y.eff/60)} dk · ${esc(p.name)} ${Math.round(x.dur/60)} dk (fark ${Math.round((x.dur-tw.y.eff)/60)>=0?'+':''}${Math.round((x.dur-tw.y.eff)/60)} dk)`:
      `Google'ın listesinde yok (${(tw.own/1000).toFixed(1)} km'si Google'ın en yakın rotası ${tw.y.label}'dan farklı)`;
    return `<div class="card" style="--c:${x.color}"><div class="h"><span class="lbl">${x.label}</span><span class="big">${(x.dur/60).toFixed(0)} dk</span><span>${fmtKm(x.dist)}</span>${toll}${i===0?'<span class="tag">en hızlı</span>':''}</div>
      ${i>0?`<div class="sub" style="font-size:15px;color:var(--tx)">A'ya göre +${((x.dur-A.dur)/60).toFixed(1)} dk, ${((x.dist-A.dist)/1000>=0?'+':'')}${((x.dist-A.dist)/1000).toFixed(1)} km</div>`:''}
      ${x.delay!=null?`<div class="sub">Trafik gecikmesi: ${x.delay>=60?'+'+Math.round(x.delay/60)+' dk':'yok'}</div>`:'<div class="sub">Trafiksiz tahmin</div>'}
      <div class="sub">${gl}</div>
      <div class="acts">${p.custom?`<button class="ysel" data-i="${i}">Haritada göster</button>`:''}<a class="btn pri pnav" data-i="${i}" href="${navUrl(x,i+1)}" target="_blank" rel="noopener">Google Maps ▶</a>
        <a class="btn pnav" data-i="${i}" href="${yandexUrl(x)}">Yandex ▶</a></div></div>`;}).join('');
  pmsg(`${PR.length} rota (${p.name}). ${info}`);}
document.getElementById('pcards').addEventListener('click',e=>{const ys=e.target.closest('.ysel');if(ys&&yMR){const want=+ys.dataset.i;let k=0;yMR.getRoutes().each(rt=>{if(k++===PR[want]._yi)yMR.setActiveRoute(rt);});return;}
  const n=e.target.closest('.pnav');if(!n)return;
  const x=PR[+n.dataset.i];try{store.set('pend',{ts:Date.now(),h:new Date().getHours(),pred:x.dur/60,s:samples(x.g),len:x.g.pts[x.g.pts.length-1].d,label:x.label,tags:pv().name});}catch(err){}});

// ---- Yandex: kendi JS API'si (harita + canlı trafik + trafiğe göre rota) ----
let yLoad=null,yMap=null,yMR=null,yTraffic=null;
function loadYandex(k){if(yLoad)return yLoad;
  yLoad=new Promise((res,rej)=>{const s=document.createElement('script');
    s.src='https://api-maps.yandex.ru/2.1/?lang=tr_TR&apikey='+encodeURIComponent(k);
    s.onload=()=>window.ymaps?ymaps.ready(res,e=>{yLoad=null;rej(new Error('Yandex API başlatılamadı: '+((e&&e.message)||'anahtar geçersiz olabilir')));}):(yLoad=null,rej(new Error('Yandex API açılmadı: anahtar geçersiz ya da bu siteye izinli değil')));
    s.onerror=()=>{yLoad=null;rej(new Error('Yandex API yüklenemedi (anahtar ya da ağ)'));};document.head.appendChild(s);});
  return yLoad;}
async function openYandex(force){const k=keyOf(PROV.yandex);
  pmsg('Yandex yükleniyor…');try{await loadYandex(k);}catch(e){pmsg(e.message,1);return;}
  if(!yMap){yMap=new ymaps.Map('ymap',{center:[41.01,28.97],zoom:10,controls:['zoomControl','trafficControl','geolocationControl']},{suppressMapOpenBlock:true});
    yTraffic=yMap.controls.get('trafficControl');try{yTraffic.state.set('trafficShown',true);}catch(e){}}
  setTimeout(()=>yMap.container.fitToViewport(),50);
  if(!P.from||!P.to){pmsg('Nereden ve nereye gir.');$('#pcards').innerHTML='';return;}
  const ck=(P.from.text||'')+'|'+(P.to.text||''),c=cache.yandex;
  if(!force&&c&&c.ck===ck&&Date.now()-c.t<5*60000){PR=c.routes;renderCards(c.info);return;}
  pmsg('Yandex rotaları hesaplanıyor…');$('#pcards').innerHTML='';
  const a=await coordOf('from'),b=await coordOf('to');
  if(!a||!b){pmsg('Adres koordinata çevrilemedi. Listeden bir öneri seç ya da Google sekmesinde bir kez arat.',1);return;}
  if(!R.length)setOrigin(a.lat,a.lng);
  if(!pSpend('yandex','api',1)){pmsg('Günlük Yandex rota sınırı doldu ('+usedTxt('yandex')+').',1);return;}
  if(yMR)yMap.geoObjects.remove(yMR);
  yMR=new ymaps.multiRouter.MultiRoute({referencePoints:[[a.lat,a.lng],[b.lat,b.lng]],params:{routingMode:'auto',avoidTrafficJams:true,results:3}},
    {boundsAutoApply:true,wayPointVisible:true,routeActiveStrokeWidth:7,routeStrokeWidth:4});
  yMap.geoObjects.add(yMR);
  let answered=false;
  const tmo=setTimeout(()=>{if(!answered)pmsg('Yandex 15 sn içinde rota vermedi. Yeni anahtar henüz etkinleşmemiş olabilir (birkaç dakika sürebilir) ya da anahtar bu siteye izinli değil.',1);},15000);
  yMR.model.events.add('requestfail',ev=>{answered=true;clearTimeout(tmo);let m='';try{const er=ev.get('error');m=(er&&(er.message||er.status||String(er)))||'';}catch(e){}
    pmsg('Yandex rota vermedi'+(m?': '+m:'')+'. Anahtarın "JavaScript API ve HTTP Geocoder" anahtarı olduğundan ve site izninde mtnmrtdnz-g.github.io bulunduğundan emin ol.',1);});
  yMR.model.events.add('requestsuccess',()=>{answered=true;clearTimeout(tmo);const out=[];let yi=0;
    yMR.getRoutes().each(rt=>{const pr=rt.properties.getAll(),pts=[];
      rt.getPaths().each(path=>{let cs=[];try{cs=path.geometry.getCoordinates();}catch(e){}
        if(!cs||!cs.length){try{path.getSegments().each(sg=>{sg.geometry.getCoordinates().forEach(q=>cs.push(q));});}catch(e){}}
        cs.forEach(q=>pts.push([q[0],q[1]]));});
      const v=o=>o&&o.value!=null?o.value:0;
      out.push({pts,dur:v(pr.durationInTraffic)||v(pr.duration),dist:v(pr.distance),delay:Math.max(0,v(pr.durationInTraffic)-v(pr.duration)),
        tollM:pr.hasTolls===true?1:(pr.hasTolls===false?0:null),price:null,_yi:yi++});});
    if(!out.length){pmsg('Yandex bu iki nokta arasında rota bulamadı.',1);return;}
    out.sort((x,y)=>x.dur-y.dur);
    PR=out.filter(x=>x.pts.length>1).map((x,i)=>Object.assign(x,{label:String.fromCharCode(65+i),color:COLORS[i%COLORS.length],g:geomFrom(x.pts),via:null,lock:null,tags:['Yandex']}));
    if(!PR.length){pmsg('Yandex rotasının çizgisi okunamadı.',1);return;}
    const info=`Başlangıç: ${a.src} · Varış: ${b.src}`;cache.yandex={ck,t:Date.now(),routes:PR,info};renderCards(info);});}

// açılışta son sekme
const last=(()=>{try{return JSON.parse(localStorage.getItem('rk_tab')||'"google"');}catch(e){return 'google';}})();
if(PROV[last])setTimeout(()=>showTab(last),0);
window.PROVTEST={decodeFlex,geomFrom,googleTwin,PROV};
})();

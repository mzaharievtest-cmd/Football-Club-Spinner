/* Football Spinner — TEAM / PLAYER
   PLAYER data source: data/players.json (only)
   PLAYER wheel: Image + Name on wheel; Jersey/Nationality/Club in modal
   TEAM wheel: Logo + Name + Stadium on wheel; League in modal (never on wheel)
   If >50 items selected → wedges only (hide all text/images)
   Player club chips & filtering come from players.json (no teams.json dependency)
*/

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

// Data stores
let TEAMS = [];             // Only used by TEAM mode (optional if you focus on PLAYER)
let PLAYERS = [];           // Normalized players
let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

/* ---------------- DOM ---------------- */
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');
const qpAll     = document.getElementById('qpAll');
const qpNone    = document.getElementById('qpNone');
const qpTop     = document.getElementById('qpTop'); // TEAM: Top 5, PLAYER: Top 6

// Show-on-wheel (mode-aware)
const optA = document.getElementById('optA');
const optB = document.getElementById('optB');
const optC = document.getElementById('optC');
const optD = document.getElementById('optD');
const lblA = document.getElementById('lblA');
const lblB = document.getElementById('lblB');
const lblC = document.getElementById('lblC');
const lblD = document.getElementById('lblD');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const perfTip = document.getElementById('perfTip');
const wheel   = document.getElementById('wheel');
const fx      = document.getElementById('fx');

const historyEl = document.getElementById('history');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

/* Modal */
const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead    = document.getElementById('mHead');
const mSub     = document.getElementById('mSub');     // TEAM: league; PLAYER: nationality
const mLogo    = document.getElementById('mLogo');    // TEAM: logo; PLAYER: image
const rowStadium = document.getElementById('rowStadium');
const mStadium = document.getElementById('mStadium');
const rowClub  = document.getElementById('rowClub');
const mClub    = document.getElementById('mClub');
const rowJersey= document.getElementById('rowJersey');
const mJersey  = document.getElementById('mJersey');
const rowNat   = document.getElementById('rowNat');
const mNat     = document.getElementById('mNat');

let modalReveal = { a:false,b:false,c:false,d:false };

/* ---------------- Utils ---------------- */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI/2) + TAU) % TAU;
const clamp = (a,x,b)=>Math.max(a,Math.min(b,x));
const mod = (x,m)=>((x%m)+m)%m;

const IMG_CACHE = new Map();
function getImage(url, onload){
  if (!url) return null;
  const c = IMG_CACHE.get(url);
  if (c) return c.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.loading = 'eager';
  img.src = url;
  img.onload = ()=> onload && onload();
  img.onerror = ()=> onload && onload();
  IMG_CACHE.set(url,{img});
  return img;
}
function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx=9, maxPx=24, weight=800 }){
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  if (ctx.measureText(text).width <= maxWidth) return {text, fontPx: px};
  while (px > minPx){
    px--;
    ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return {text, fontPx: px};
  }
  let s = String(text||'').trim();
  while (s && ctx.measureText(s+'…').width > maxWidth) s = s.slice(0,-1);
  return {text:(s||'')+'…', fontPx:minPx};
}

/* ---------------- Labels / presets ---------------- */
const TOP5 = ['EPL','SA','BUN','L1','LLA']; // TEAM quick pick (leagues)
const PL_TOP6_TEAM_IDS = ['18','9','14','8','19','6']; // Chelsea, City, United, Liverpool, Arsenal, Spurs

// Enough EPL IDs so the modal + filters show names (extend if you need more)
const EPL_ID_TO_NAME = {
  '9':'Manchester City','14':'Manchester United','18':'Chelsea','8':'Liverpool','19':'Arsenal','6':'Tottenham Hotspur',
  '15':'Aston Villa','20':'Newcastle United','78':'Brighton & Hove Albion','236':'Brentford','29':'Wolverhampton Wanderers',
  '52':'AFC Bournemouth','51':'Crystal Palace','11':'Fulham','13':'Everton','63':'Nottingham Forest'
};
function clubNameFromId(id){
  const k = String(id ?? '');
  return EPL_ID_TO_NAME[k] || (`Club #${k}`);
}

// TEAM league labels appear in modal only (wheel never shows league text)
const LEAGUE_LABELS = { EPL:'Premier League', SA:'Serie A', BUN:'Bundesliga', L1:'Ligue 1', LLA:'LaLiga' };
const leagueLabel = c => LEAGUE_LABELS[c] || c;

/* ---------------- Filters helpers ---------------- */
function makeChip(value, text, checked){
  const label = document.createElement('label');
  label.className='chip';
  label.innerHTML = `<input type="checkbox" value="${value}" ${checked?'checked':''}><span class="chip-text">${text}</span>`;
  return label;
}
function visibleCodesAll(){
  const out = [];
  chipsTop.querySelectorAll('input[type="checkbox"]').forEach(i => out.push(i.value));
  chipsMore.querySelectorAll('input[type="checkbox"]').forEach(i => out.push(i.value));
  return out;
}
function activeCodes(){
  const arr=[];
  chipsWrap.querySelectorAll('input[type="checkbox"]:checked').forEach(i => arr.push(i.value));
  return arr;
}

/* ---------------- Data selection ---------------- */
function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size === 0) return []; // strict: None = nothing

  if (MODE === 'player'){
    return PLAYERS.filter(p => active.has(String(p.club_id)));
  }
  // TEAM (leagues)
  return TEAMS.filter(t => active.has(t.league_code));
}

function updatePerfBanner(){
  const n = getCurrentData().length;
  perfTip.style.setProperty('--pct', Math.min(1, n/60));
  perfTip.textContent = `${n} ${MODE==='player' ? 'players' : 'teams'} selected`;
  const disabled = n===0;
  spinBtn.disabled = disabled;
  spinFab.disabled = disabled;
}

/* ---------------- Chips render (mode aware) ---------------- */
function renderChips(){
  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  if (MODE === 'player'){
    // Build club list directly from PLAYERS
    const byClub = new Map(); // club_id -> {id,name,count}
    for (const p of PLAYERS){
      const id = String(p.club_id);
      if (!id) continue;
      if (!byClub.has(id)) byClub.set(id, { id, name: clubNameFromId(id), count: 0 });
      byClub.get(id).count++;
    }
    const clubs = [...byClub.values()].sort((a,b)=> a.name.localeCompare(b.name));

    // Top 6 first (checked), rest unchecked
    const top6 = clubs.filter(c => PL_TOP6_TEAM_IDS.includes(c.id));
    const rest = clubs.filter(c => !PL_TOP6_TEAM_IDS.includes(c.id));

    top6.forEach(c => chipsTop.appendChild(makeChip(c.id, c.name, true)));
    rest.forEach(c => chipsMore.appendChild(makeChip(c.id, c.name, false)));

    toggleMore.textContent = 'Show more Premier League clubs';
    qpTop.textContent = 'Top 6';
  } else {
    // TEAM (leagues) — leave as-is if you use it
    const codes = [...new Set(TEAMS.map(t=>t.league_code))].sort();
    const top = TOP5.filter(c => codes.includes(c));
    const more = codes.filter(c => !top.includes(c));

    top.forEach(c => chipsTop.appendChild(makeChip(c, c, c==='EPL'))); // raw codes per your request
    more.forEach(c => chipsMore.appendChild(makeChip(c, c, false)));

    toggleMore.textContent = 'Show more leagues';
    qpTop.textContent = 'Top 5';
  }

  chipsMore.hidden = true;
  toggleMore.setAttribute('aria-expanded','false');
}

/* ---------------- Show-on-wheel (mode aware) ---------------- */
function applyModeShowControls(){
  if (MODE === 'player'){
    lblA.textContent='Image';         optA.checked = true;
    lblB.textContent='Name';          optB.checked = true;
    lblC.textContent='Jersey Number'; optC.checked = false;
    lblD.textContent='Nationality';   optD.checked = false;
  } else {
    lblA.textContent='Logo';    optA.checked = true;
    lblB.textContent='Name';    optB.checked = true;
    lblC.textContent='Stadium'; optC.checked = false;
    lblD.textContent='League';  optD.checked = true; // modal only
  }
}

/* ---------------- Wheel sizing ---------------- */
function sizeCanvas(){
  const rect = (wheel.parentElement||wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width||640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio||1);
  wheel.width  = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;
  wheel.style.width = cssSize+'px'; wheel.style.height = cssSize+'px';
  fx.style.width = cssSize+'px'; fx.style.height = cssSize+'px';
}

/* ---------------- Wheel drawing ---------------- */
const PERF = { hideTextThreshold: 50, minTextWidth: 44, minLogoBox: 26 };

function drawIdle(ctx,W,H){
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  const r = Math.min(W,H)*0.48;
  const g = ctx.createRadialGradient(0,0,r*0.1, 0,0,r);
  g.addColorStop(0,'#1A2C5A');
  g.addColorStop(0.35,'#21386F');
  g.addColorStop(0.65,'#0E2A57');
  g.addColorStop(1,'#0B1B38');
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fillStyle=g; ctx.fill();
  ctx.restore();
}

function drawWheel(){
  const data = getCurrentData();
  const N = data.length;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio||1);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const W = wheel.width / DPR, H = wheel.height / DPR;

  updatePerfBanner();

  if (N===0){ drawIdle(ctx,W,H); return; }

  const hideAll = N >= PERF.hideTextThreshold; // >50 → wedges only
  ctx.imageSmoothingEnabled = !hideAll;

  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  ctx.rotate(mod(currentAngle,TAU));

  const r = Math.min(W,H)*0.48;
  const slice = TAU/N;

  // wedges
  for (let i=0;i<N;i++){
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,i*slice,(i+1)*slice); ctx.closePath();
    ctx.fillStyle = data[i].primary_color || '#4f8cff';
    ctx.fill();
  }

  if (hideAll){ ctx.restore(); return; }

  // contents
  for (let i=0;i<N;i++){
    const t = data[i];
    const a0=i*slice, a1=(i+1)*slice, aMid=(a0+a1)/2;
    const arcLen = r*(a1-a0);

    const canLogo = (MODE==='team') ? (optA.checked && !!t.logo_url) : (optA.checked && !!t.image_url);
    const canName = optB.checked && !!t.team_name;

    ctx.save();
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r-1,a0,a1); ctx.closePath(); ctx.clip();

    ctx.rotate(aMid);
    const needFlip = Math.cos(aMid) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    const logoSize = clamp(PERF.minLogoBox, 0.38*arcLen, 62);
    const logoHalf = logoSize/2;
    const pad = 10;
    const xLogo = sign * (r*0.74);
    const xText = sign * (r*0.42);
    const logoInner = xLogo - sign*(logoHalf+pad);
    const maxWidth = Math.max(PERF.minTextWidth, Math.abs(logoInner - xText));

    const fg = textColorFor(t.primary_color);

    // NAME on wheel (both modes)
    if (canName && maxWidth>=PERF.minTextWidth){
      const fit = fitSingleLine(ctx, t.team_name, {maxWidth, targetPx:Math.min(22, 0.22*arcLen)});
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
      ctx.fillStyle=fg;
      const x = Math.min(xText, logoInner);
      ctx.strokeText(fit.text, x, 0);
      ctx.fillText(fit.text,   x, 0);
    }

    // LOGO / IMAGE on wheel
    if (canLogo){
      ctx.save(); ctx.translate(xLogo,0);
      ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();

      ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.clip();
      const url = MODE==='team' ? t.logo_url : t.image_url;
      const img = getImage(url, ()=> requestAnimationFrame(drawWheel));
      if (img && img.complete){
        const box = Math.max(4, 2*(logoHalf-1));
        const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
        const s = Math.min(box/iw, box/ih);
        ctx.drawImage(img,-iw*s/2,-ih*s/2, iw*s, ih*s);
      } else {
        ctx.fillStyle='rgba(255,255,255,.14)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
      }
      ctx.restore(); ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

/* ---------------- Spin ---------------- */
function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true;
  spinBtn.disabled = true; spinFab.disabled = true;

  const N = data.length;
  const slice = TAU/N;
  const targetAngle = TAU*(6+Math.floor(Math.random()*3)) + Math.random()*TAU;

  const start = performance.now(), dur=3200;
  const ease = x=>1-Math.pow(1-x,3);

  function step(now){
    const p = clamp(0,(now-start)/dur,1);
    currentAngle = targetAngle * ease(p);
    drawWheel();
    if (p<1) requestAnimationFrame(step);
    else {
      const theta = mod(currentAngle,TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;
      const center = idx*slice + slice/2;
      const delta = mod(center - offset, TAU);
      currentAngle = mod(currentAngle + delta, TAU);

      spinning=false;
      spinBtn.disabled=false; spinFab.disabled=false;
      selectedIdx = idx;
      drawWheel();
      showResult(idx);
    }
  }
  requestAnimationFrame(step);
}

function showResult(idx){
  const data = getCurrentData();
  const item = data[idx];
  if (!item) return;
  history.unshift(item);
  if (history.length>50) history = history.slice(0,50);
  localStorage.setItem('clubHistory', JSON.stringify(history));
  renderHistory();
  openModal(item);
}

/* ---------------- History ---------------- */
function renderHistory(){
  historyEl.innerHTML = '';
  if (!history.length){
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(h=>{
    const div=document.createElement('div'); div.className='item';
    const img=document.createElement('img');
    img.src = MODE==='player' ? (h.image_url||'') : (h.logo_url||'');
    img.alt = MODE==='player' ? `${h.team_name}` : `${h.team_name} logo`;
    const span=document.createElement('span');
    span.textContent = MODE==='player'
      ? `${h.team_name} (${clubNameFromId(h.club_id)})`
      : `${h.team_name} (${h.league_code})`;
    div.append(img,span); historyEl.append(div);
  });
}

/* ---------------- Modal + reveal ---------------- */
function ensureRevealStyles(){
  if (document.getElementById('reveal-style')) return;
  const s=document.createElement('style'); s.id='reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;margin-left:10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;position:relative;white-space:nowrap}
    .reveal-wrap{position:relative;display:inline-block}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none}
  `;
  document.head.appendChild(s);
}
function wrap(el){
  if (!el) return null;
  if (el.parentElement && el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const w=document.createElement('span'); w.className='reveal-wrap';
  el.parentElement.insertBefore(w, el); w.appendChild(el); return w;
}
function blurEl(el){ if(!el) return; el.style.filter='blur(14px)'; const w=wrap(el); if(w&&!w.querySelector('.reveal-overlay')){const o=document.createElement('span');o.className='reveal-overlay';w.appendChild(o);} }
function unblurEl(el){ if(!el) return; el.style.filter=''; const w=el.parentElement; const o=w && w.querySelector('.reveal-overlay'); if(o) o.remove(); }
function placeAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap')?el.parentElement:el; host?.insertAdjacentElement('afterend', btn); }

function addReveal(key, el, enabled, label){
  const id=`reveal-${key}`;
  document.getElementById(id)?.remove();
  if (enabled || modalReveal[key]){ unblurEl(el); return; }
  blurEl(el);
  const b=document.createElement('button'); b.id=id; b.type='button'; b.className='reveal-btn'; b.textContent=`Show ${label}`;
  b.onclick=()=>{ modalReveal[key]=true; unblurEl(el); b.remove(); };
  placeAfter(el,b);
}

function openModal(item){
  ensureRevealStyles();
  modalReveal = {a:false,b:false,c:false,d:false};

  if (MODE==='player'){
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = item.nationality || '';
    mLogo.src = item.image_url || '';
    rowStadium.style.display='none';
    rowClub.style.display='';
    rowJersey.style.display='';
    rowNat.style.display='';
    mClub.textContent  = clubNameFromId(item.club_id) || '—';
    mJersey.textContent= item.jersey ? `#${item.jersey}` : '—';
    mNat.textContent   = item.nationality || '—';

    addReveal('a', mLogo,   !!optA.checked, 'image');
    addReveal('b', mHead,   !!optB.checked, 'name');
    addReveal('c', mJersey, !!optC.checked, 'jersey number');
    addReveal('d', mSub,    !!optD.checked, 'nationality');
  } else {
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = leagueLabel(item.league_code) || '';
    mLogo.src = item.logo_url || '';
    rowStadium.style.display='';
    rowClub.style.display='none';
    rowJersey.style.display='none';
    rowNat.style.display='none';
    mStadium.textContent = item.stadium || '—';

    addReveal('a', mLogo,    !!optA.checked, 'logo');
    addReveal('b', mHead,    !!optB.checked, 'name');
    addReveal('c', mStadium, !!optC.checked, 'stadium');
    addReveal('d', mSub,     !!optD.checked, 'league');
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none', 150); }

/* ---------------- Mode switch ---------------- */
function setMode(next){
  if (next===MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
  modeTeamBtn.setAttribute('aria-pressed', MODE==='team' ? 'true':'false');
  modePlayerBtn.setAttribute('aria-pressed', MODE==='player' ? 'true':'false');

  applyModeShowControls();
  renderChips();
  selectedIdx=-1;
  updatePerfBanner();
  drawWheel();
}

/* ---------------- Loaders ---------------- */
// TEAM loader (kept for completeness; doesn’t affect PLAYER logic)
async function loadTeams(){
  try{
    const res = await fetch('./teams.json', {cache:'no-store'});
    if (!res.ok) return; // optional
    TEAMS = await res.json();
  }catch(_){}
}

async function loadPlayers(){
  const res = await fetch('data/players.json?'+Date.now(), {cache:'no-store'});
  if (!res.ok) throw new Error('data/players.json not found');
  const raw = await res.json();

  PLAYERS = (raw||[]).map(p=>{
    const name = p.name || p.player_name || 'Player';
    const clubId = String(p.club_id ?? p.team_id ?? '');
    const img = p.image_url || p.image || p.file || '';
    const nat = p.nationality || p.country || '';
    const jersey = p.jersey_number ?? p.jersey ?? p.number ?? '';
    // Use per-club themed color if you want; default a safe dark blue
    const color = '#163058';
    return {
      team_name: name,
      image_url: img,
      club_id: clubId,
      nationality: nat,
      jersey: jersey ? String(jersey).replace('#','') : '',
      primary_color: color
    };
  });
}

/* ---------------- Events ---------------- */
function wire(){
  modeTeamBtn?.addEventListener('click', ()=> setMode('team'));
  modePlayerBtn?.addEventListener('click', ()=> setMode('player'));

  chipsWrap.addEventListener('change', ()=>{
    if (spinning) return;
    selectedIdx=-1;
    updatePerfBanner();
    drawWheel();
  });

  toggleMore.addEventListener('click', ()=>{
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    toggleMore.textContent = hidden
      ? (MODE==='player' ? 'Show fewer clubs' : 'Show fewer leagues')
      : (MODE==='player' ? 'Show more Premier League clubs' : 'Show more leagues');
    toggleMore.setAttribute('aria-expanded', String(!hidden));
  });

  // Quick picks
  qpAll.onclick = () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = true; });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  };
  qpNone.onclick = () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  };
  qpTop.onclick = () => {
    if (MODE==='player'){
      const allow = new Set(PL_TOP6_TEAM_IDS);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
    } else {
      const allow = new Set(TOP5);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
    }
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  };

  const refresh = ()=>{ if (!spinning){ selectedIdx=-1; drawWheel(); } };
  optA.addEventListener('change', refresh);
  optB.addEventListener('change', refresh);
  optC.addEventListener('change', refresh);
  optD.addEventListener('change', refresh);

  spinBtn.onclick = spin;
  spinFab.onclick = spin;

  resetHistoryBtn.onclick = ()=>{ history=[]; localStorage.setItem('clubHistory', JSON.stringify(history)); renderHistory(); };

  mClose.onclick = ()=> !spinning && closeModal();
  backdrop.addEventListener('click', e=>{ if (!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !spinning) closeModal(); });

  let t; window.addEventListener('resize', ()=>{ clearTimeout(t); t=setTimeout(()=>{ sizeCanvas(); drawWheel(); },120); }, {passive:true});
}

/* ---------------- Boot ---------------- */
(async function init(){
  try {
    await loadTeams();   // optional for TEAM mode
    await loadPlayers(); // required: players from data/players.json
  } catch (e){
    console.error('Failed to load data:', e);
  }

  // reflect saved/default mode
  modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
  modeTeamBtn.setAttribute('aria-pressed', MODE==='team' ? 'true':'false');
  modePlayerBtn.setAttribute('aria-pressed', MODE==='player' ? 'true':'false');

  applyModeShowControls();
  renderChips();
  renderHistory();
  sizeCanvas();
  updatePerfBanner();
  drawWheel();
  wire();
})();

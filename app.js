/* Football Spinner — TEAM / PLAYER unified (defaults + PL sorting + no-image filter)
   - TEAM defaults: Premier League selected; Show on Wheel = Logo only.
   - PLAYER defaults: only Arsenal selected; Show on Wheel = Image only; “All Premier League teams” quick-pick.
   - PLAYER: exclude players without a usable image from the wheel (incl. placeholder.png).
   - Top 6 PL teams shown first and sorted alphabetically in chips.
   - History stores typed entries; list shows only the active mode.
   - Modal UI: aligned header/rows; modern “Show …” chips + frosted reveal zones (injected styles).
*/

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let TEAMS = [];
let TEAM_BY_ID = new Map();
let CLUB_BY_ID = new Map();

let PLAYERS = [];
let TOTAL_TEAMS = 0;
let TOTAL_PLAYERS = 0;

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;

// ---- typed history (fallback to old shape) ----
let historyRaw = JSON.parse(localStorage.getItem('clubHistory')) || [];
let history = historyRaw.map(h => (
  h && typeof h === 'object' && 'type' in h && 'item' in h
    ? h
    : { type: (h && (h.image_url || h.club_id)) ? 'player' : 'team', item: h }
));
const saveHistory = () => localStorage.setItem('clubHistory', JSON.stringify(history));

/* ---------- DOM ---------- */
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');

const qpAll     = document.getElementById('qpAll');
const qpNone    = document.getElementById('qpNone');
const qpTopBtn  = document.getElementById('qpTop');

const optA = document.getElementById('optA'); // Logo/Image
const optB = document.getElementById('optB'); // Name
const optC = document.getElementById('optC'); // Stadium (team) / Jersey (player)
const optD = document.getElementById('optD'); // League (team) / Nationality (player)
const optE = document.getElementById('optE'); // Team (player – modal extra)
const lblA = document.getElementById('lblA');
const lblB = document.getElementById('lblB');
const lblC = document.getElementById('lblC');
const lblD = document.getElementById('lblD');
const lblE = document.getElementById('lblE');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const perfTip = document.getElementById('perfTip');
const wheel   = document.getElementById('wheel');
const fx      = document.getElementById('fx');

const historyEl = document.getElementById('history');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

/* Modal */
const backdrop   = document.getElementById('backdrop');
const modalEl    = document.getElementById('modal');
const mClose     = document.getElementById('mClose');
const mHead      = document.getElementById('mHead');
const mSub       = document.getElementById('mSub');
const mLogo      = document.getElementById('mLogo');
const rowStadium = document.getElementById('rowStadium');
const mStadium   = document.getElementById('mStadium');
const rowClub    = document.getElementById('rowClub');
const mClub      = document.getElementById('mClub');
const rowJersey  = document.getElementById('rowJersey');
const mJersey    = document.getElementById('mJersey');
const rowNat     = document.getElementById('rowNat');
const mNat       = document.getElementById('mNat');

let modalReveal = { a:false,b:false,c:false,d:false,e:false };

/* ---------- Utils ---------- */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI/2)+TAU)%TAU;
const clamp = (a,x,b)=>Math.max(a,Math.min(b,x));
const mod   = (x,m)=>((x%m)+m)%m;

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

/* ---------- Header spacing (CSS var) ---------- */
function syncHeaderHeight() {
  const hEl = document.querySelector('header');
  const h = hEl ? hEl.offsetHeight : 72;
  document.documentElement.style.setProperty('--header-h', h + 'px');
}
window.addEventListener('load', syncHeaderHeight, { once: true });
window.addEventListener('resize', () => {
  clearTimeout(window.__hdrT);
  window.__hdrT = setTimeout(syncHeaderHeight, 120);
});

/* ---------- Labels & presets ---------- */
const LEAGUE_LABELS = {
  AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga",
  CRO:"SuperSport HNL", CZE:"Fortuna Liga", DEN:"Superliga",
  EPL:"Premier League", L1:"Ligue 1", BUN:"Bundesliga", GRE:"Super League 1",
  ISR:"Ligat ha'Al", SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien",
  POL:"PKO BP Ekstraklasa", POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga",
  SCO:"Scottish Premiership", SRB:"Super liga Srbije", LLA:"LaLiga",
  SWE:"Allsvenskan", SUI:"Super League", TUR:"Süper Lig", UKR:"Ukrainian Premier League"
};
const leagueLabel = c => LEAGUE_LABELS[c] || c;

const TOP5 = ['EPL','SA','BUN','L1','LLA'];

/* PL Big Six IDs in your data */
const PL_TOP6 = ['19','18','8','9','14','6']; // Arsenal, Chelsea, Liverpool, Man City, Man United, Spurs

/* ---------- Fallback team names (extendable) ---------- */
const FALLBACK_TEAMS = {
  '6':'Tottenham Hotspur','8':'Liverpool','9':'Manchester City','10':'Southampton',
  '11':'Fulham','13':'Everton','14':'Manchester United','15':'Aston Villa','18':'Chelsea',
  '19':'Arsenal','20':'Newcastle United','21':'West Ham United','26':'Leicester City',
  '27':'Burnley','29':'Wolverhampton Wanderers','51':'Crystal Palace','52':'AFC Bournemouth',
  '62':'Sheffield United','63':'Nottingham Forest','71':'Leeds United','78':'Brighton & Hove Albion',
  '236':'Brentford'
};

/* ---------- Selection helpers ---------- */
function activeCodes(){
  const arr=[];
  chipsWrap.querySelectorAll('input[type="checkbox"]:checked').forEach(i => arr.push(i.value));
  return arr;
}

/* ---------- Current dataset ---------- */
function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size === 0) return [];
  if (MODE === 'player'){
    // exclude players without image OR with placeholder
    return PLAYERS.filter(p =>
      active.has(String(p.club_id)) &&
      p.image_url &&
      String(p.image_url).trim().length > 4 &&
      !/placeholder\.png$/i.test(p.image_url)
    );
  }
  return TEAMS.filter(t => active.has(t.league_code));
}

/* ---------- Perf / meter ---------- */
function updatePerfBanner(){
  const n = getCurrentData().length;
  const total = (MODE==='player') ? (TOTAL_PLAYERS || 1) : (TOTAL_TEAMS || 1);
  const pct = Math.max(0, Math.min(1, n / total));
  perfTip.style.setProperty('--pct', pct);

  const noun = (MODE === 'player') ? 'players loaded' : 'teams ready to spin';
  perfTip.innerHTML = `<span class="meter-text">${n} ${noun}</span>`;

  const disabled = n===0;
  spinBtn.disabled = disabled;
  spinFab.disabled = disabled;
}

/* ---------- Chips ---------- */
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

function renderChips(){
  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  if (MODE === 'player'){
    // PL team list from players.json
    const ids = Array.from(new Set(PLAYERS.map(p => String(p.club_id))));
    const labelFor = id => CLUB_BY_ID.get(id) || FALLBACK_TEAMS[id] || `Team #${id}`;

    // Big Six first (alphabetical), then the rest (alphabetical)
    const top6 = PL_TOP6
      .filter(id => ids.includes(id))
      .sort((a,b)=> labelFor(a).localeCompare(labelFor(b), 'en', {sensitivity:'base'}));

    const rest = ids
      .filter(id => !PL_TOP6.includes(id))
      .sort((a,b)=> labelFor(a).localeCompare(labelFor(b), 'en', {sensitivity:'base'}));

    // DEFAULT: only Arsenal selected
    const defaultSelected = new Set(['19']); // Arsenal

    top6.forEach(id => chipsTop.appendChild(makeChip(id, labelFor(id), defaultSelected.has(id))));
    rest.forEach(id => chipsMore.appendChild(makeChip(id, labelFor(id), defaultSelected.has(id))));

    // Sidebar labels for PLAYER
    if (qpAll){
      qpAll.textContent = 'All Premier League teams';
      qpAll.title = 'Select all Premier League teams';
    }
    toggleMore.textContent = 'Show more Premier League teams';
    toggleMore.setAttribute('aria-expanded','false');
    chipsMore.hidden = true;

    if (qpTopBtn) {
      qpTopBtn.textContent = 'Top 6 Premier League Teams';
      qpTopBtn.title = 'Select the Big Six from the Premier League';
    }
  } else {
    // TEAM → all leagues; EPL checked by default
    const codes = [...new Set(TEAMS.map(t=>t.league_code))];
    const top = TOP5.filter(c => codes.includes(c));
    const more = codes.filter(c => !top.includes(c)).sort();

    top.forEach(c => chipsTop.appendChild(makeChip(c, leagueLabel(c), c==='EPL')));
    more.forEach(c => chipsMore.appendChild(makeChip(c, leagueLabel(c), false)));

    if (qpAll){
      qpAll.textContent = 'All Leagues';
      qpAll.title = 'Select all leagues';
    }
    toggleMore.textContent = 'Show more leagues';
    toggleMore.setAttribute('aria-expanded','false');
    chipsMore.hidden = true;

    if (qpTopBtn) {
      qpTopBtn.textContent = 'Top 5 Leagues';
      qpTopBtn.title = 'Select only the top 5 leagues';
    }
  }

  selectedIdx = -1;
  updatePerfBanner();
  drawWheel();
}

/* ---------- Show-on-wheel defaults ---------- */
function applyModeShowControls(){
  if (MODE==='player'){
    lblA.textContent='Image';         optA.checked = true;
    lblB.textContent='Name';          optB.checked = false; // image only by default
    if (lblC) { lblC.textContent='Jersey Number'; if (optC) optC.checked = false; }
    if (lblD) { lblD.textContent='Nationality';   if (optD) optD.checked = false; }
    if (lblE && optE){ lblE.textContent='Team';   optE.checked=false; }
  } else {
    lblA.textContent='Logo';    optA.checked = true;
    lblB.textContent='Name';    optB.checked = false; // logo only by default
    if (lblC) { lblC.textContent='Stadium'; if (optC) optC.checked = false; }
    if (lblD) { lblD.textContent='League';  if (optD) optD.checked = false; }
    if (lblE && optE){ lblE.textContent=''; optE.checked=false; }
  }
}

/* ---------- Canvas sizing ---------- */
function sizeCanvas(){
  const rect = (wheel.parentElement||wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width||640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio||1);
  wheel.width  = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;
  wheel.style.width = cssSize+'px'; wheel.style.height = cssSize+'px';
  fx.style.width = cssSize+'px'; fx.style.height = cssSize+'px';
  requestAnimationFrame(positionSpinFab);
}
function positionSpinFab(){
  const wrap = wheel.parentElement;
  const wr = wrap.getBoundingClientRect();
  const cr = wheel.getBoundingClientRect();
  const cx = (cr.left + cr.width  / 2) - wr.left;
  const cy = (cr.top  + cr.height / 2) - wr.top;
  spinFab.style.left = `${cx}px`;
  spinFab.style.top  = `${cy}px`;
}

/* ---------- Wheel drawing ---------- */
const PERF = { hideTextThreshold: 50, minTextWidth: 44, minLogoBox: 26 };

function drawIdle(ctx,W,H){
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  const r = Math.min(W,H)*0.48;
  const g = ctx.createRadialGradient(0,0,r*0.1, 0,0,r);
  g.addColorStop(0,'#1A2C5A'); g.addColorStop(0.35,'#21386F'); g.addColorStop(0.65,'#0E2A57'); g.addColorStop(1,'#0B1B38');
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fillStyle=g; ctx.fill();
  ctx.lineWidth=1;
  for(let i=1;i<=5;i++){
    ctx.beginPath(); ctx.arc(0,0,r*i/5,0,TAU);
    ctx.strokeStyle=`rgba(140,170,220,${0.08 + i*0.02})`;
    ctx.setLineDash([6,18]); ctx.lineDashOffset = (i*14 + currentAngle*40)%1000;
    ctx.stroke();
  }
  ctx.restore();
}
function drawTickRing(ctx, R, ticks=120){
  ctx.save();
  ctx.rotate(mod(currentAngle, TAU));
  const h = Math.max(6, R*0.02);
  for(let i=0;i<ticks;i++){
    const a = i * (TAU/ticks);
    const x = Math.cos(a) * (R-h/2);
    const y = Math.sin(a) * (R-h/2);
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(a);
    ctx.fillStyle = (i%5===0) ? 'rgba(200,220,255,.22)' : 'rgba(200,220,255,.12)';
    ctx.fillRect(-1, -h/2, 2, h);
    ctx.restore();
  }
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

  const hideAll = N >= PERF.hideTextThreshold;
  ctx.imageSmoothingEnabled = !hideAll;

  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  ctx.rotate(mod(currentAngle,TAU));

  const r = Math.min(W,H)*0.48;
  const slice = TAU/N;

  // wedges
  for (let i=0;i<N;i++){
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,i*slice,(i+1)*slice); ctx.closePath();
    ctx.fillStyle = data[i].primary_color || '#243e6b';
    ctx.fill();
  }

  if (hideAll){
    ctx.restore();
    const ctx2 = wheel.getContext('2d');
    ctx2.save(); ctx2.translate(W/2,H/2);
    drawTickRing(ctx2, r*0.98, Math.min(180, Math.max(100, Math.round(N/2))));
    ctx2.lineWidth=1;
    for(let i=1;i<=4;i++){
      ctx2.beginPath(); ctx2.arc(0,0,r*i/5,0,TAU);
      ctx2.strokeStyle=`rgba(140,170,220,${0.06 + i*0.02})`;
      ctx2.setLineDash([6,22]); ctx2.lineDashOffset = (i*10 + currentAngle*36)%1000;
      ctx2.stroke();
    }
    ctx2.restore();
    return;
  }

  // contents
  for (let i=0;i<N;i++){
    const t = data[i];
    const a0=i*slice, a1=(i+1)*slice, aMid=(a0+a1)/2;
    const arcLen = r*(a1-a0);

    const canLogoOrImg = (MODE==='team')
      ? (optA.checked && !!t.logo_url)
      : (optA.checked && !!t.image_url);

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

    if (canLogoOrImg){
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
        if (MODE==='team'){
          ctx.fillStyle='rgba(255,255,255,.14)';
          const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
        }
      }
      ctx.restore(); ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

/* ---------- Spin ---------- */
function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true;
  document.body.classList.add('ui-locked');
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
      document.body.classList.remove('ui-locked');
      spinBtn.disabled=false; spinFab.disabled=false;
      selectedIdx = idx;
      drawWheel();
      showResult(idx);
    }
  }
  requestAnimationFrame(step);
}

/* ---------- History ---------- */
function showResult(idx){
  const data = getCurrentData();
  const item = data[idx];
  if (!item) return;

  history.unshift({ type: MODE, item });
  if (history.length > 50) history.length = 50;
  saveHistory();

  renderHistory();
  openModal(item);
}

function renderHistory(){
  historyEl.innerHTML = '';
  const visible = history.filter(h => h.type === MODE);

  if (!visible.length){
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = 'Your journey starts with a spin!';
    historyEl.appendChild(empty);
    return;
  }

  visible.forEach(({ item }) => {
    const div = document.createElement('div');
    div.className = 'item';

    const img = document.createElement('img');
    if (MODE === 'player') {
      img.src = item.image_url || '';
      img.alt = item.team_name || 'Player';
    } else {
      img.src = item.logo_url || '';
      img.alt = `${item.team_name || 'Team'} logo`;
    }

    const span = document.createElement('span');
    span.textContent = MODE === 'player'
      ? item.team_name || 'Player'
      : item.team_name || 'Team';

    div.append(img, span);
    historyEl.appendChild(div);
  });
}

/* ---------- Reveal styles & helpers (modal) ---------- */
function ensureRevealStyles(){
  if (document.getElementById('reveal-style')) return;
  const s=document.createElement('style'); s.id='reveal-style';
  s.textContent = `
    /* Modal layout refinements + reveal chips */
    #modal { text-align:center; }
    #mHead { text-align:center !important; margin: 10px 0 2px; }
    #mSub  { text-align:center !important; margin: 0 0 10px; }

    #modal .m-body { gap: 14px; }

    #modal .m-row{
      width:100%;
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: center; /* keeps label/value aligned */
    }
    #modal .m-row .label{
      justify-self: end;
      font-weight: 800;
      font-size: 22px;
      color: #d9e6ff;
    }
    #modal .m-row .value-pill{
      justify-self: start;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      padding: 10px 18px;
      border-radius: 12px;
      background: rgba(17,28,48,.85);
      border: 1px solid rgba(90,161,255,.22);
      color: #d7e8ff;
      font-weight: 800;
    }

    /* Reveal wrappers -> frosted zones that keep the button centered and tidy */
    .reveal-wrap{
      position:relative;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border-radius: 12px;
      overflow: hidden;
    }

    /* when we wrap a value pill, mimic the pill container so the button sits on it */
    .reveal-wrap.reveal-for-pill{
      min-height:44px;
      padding:10px 18px;
      background: rgba(17,28,48,.6);
      border:1px solid rgba(90,161,255,.22);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.04);
    }

    .reveal-wrap.reveal-for-img{
      width: 220px; height: 220px; border-radius: 18px;
      background: radial-gradient(60% 60% at 50% 40%, rgba(255,255,255,.06), rgba(12,18,34,.7));
      border:1px solid rgba(90,161,255,.28);
      box-shadow: 0 12px 32px rgba(0,0,0,.35), inset 0 0 32px rgba(90,161,255,.10);
    }

    .reveal-overlay{
      position:absolute; inset:0; border-radius:inherit;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      background: linear-gradient(180deg, rgba(24,40,72,.25), rgba(14,24,48,.20));
      pointer-events:none;
    }

    .reveal-btn{
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      width:auto; padding:10px 16px;
      border-radius: 12px;
      border: 1px solid rgba(120,160,255,.45);
      background: linear-gradient(180deg, rgba(22,34,64,.96), rgba(12,18,34,.92));
      color:#f3f7ff; font-weight:900; letter-spacing:.03em;
      box-shadow: 0 10px 22px rgba(34,211,238,.14);
      text-transform: none;
      cursor: pointer;
    }
    .reveal-btn:hover{ transform:translate(-50%,-50%) scale(1.03); border-color:#22d3ee; }
  `;
  document.head.appendChild(s);
}
function wrap(el, kind='text'){
  if (!el) return null;
  if (el.parentElement && el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const w=document.createElement('span'); w.className='reveal-wrap';
  if (kind==='pill') w.classList.add('reveal-for-pill');
  if (kind==='img')  w.classList.add('reveal-for-img');
  el.parentElement.insertBefore(w, el); w.appendChild(el); return w;
}
function blurEl(el, kind){ if(!el) return; el.style.filter='blur(14px)'; const w=wrap(el, kind); if(w&&!w.querySelector('.reveal-overlay')){const o=document.createElement('span');o.className='reveal-overlay';w.appendChild(o);} }
function unblurEl(el){ if(!el) return; el.style.filter=''; const w=el.parentElement; const o=w && w.querySelector('.reveal-overlay'); if(o) o.remove(); const b=w && w.querySelector('.reveal-btn'); if(b) b.remove(); }

function addReveal(key, el, enabled, label){
  const kind = (el === mLogo) ? 'img' : (el.classList.contains('value-pill') ? 'pill' : 'text');
  const w = wrap(el, kind);
  const prior = w.querySelector('.reveal-btn'); if (prior) prior.remove();
  if (enabled || modalReveal[key]){ unblurEl(el); return; }
  blurEl(el, kind);
  const b=document.createElement('button'); b.type='button'; b.className='reveal-btn'; b.textContent=`Show ${label}`;
  b.onclick=()=>{ modalReveal[key]=true; unblurEl(el); };
  w.appendChild(b);
}

/* ---------- Modal ---------- */
function openModal(item){
  ensureRevealStyles();
  modalReveal = {a:false,b:false,c:false,d:false,e:false};

  if (MODE==='player'){
    mHead.textContent = item.team_name || '—';
    mLogo.src = item.image_url || '';
    mSub.textContent  = '';
    rowStadium.style.display='none';
    rowClub.style.display='';
    rowJersey.style.display='';
    rowNat.style.display='';

    mClub.textContent   = CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_TEAMS[String(item.club_id)] || '—';
    mJersey.textContent = item.jersey ? `#${item.jersey}` : '—';
    mNat.textContent    = item.nationality || '—';

    addReveal('a', mLogo,   !!optA.checked, 'image');
    addReveal('b', mHead,   !!optB.checked, 'name');
    if (optC) addReveal('c', mJersey, !!optC.checked, 'jersey number');
    if (optD) addReveal('d', mNat,    !!optD.checked, 'nationality');
    if (optE) addReveal('e', mClub,   !!optE.checked, 'team');
  } else {
    mHead.textContent = item.team_name || '—';
    mLogo.src = item.logo_url || '';
    mSub.textContent  = leagueLabel(item.league_code) || '';
    rowStadium.style.display='';
    rowClub.style.display='none';
    rowJersey.style.display='none';
    rowNat.style.display='none';
    mStadium.textContent = item.stadium || '—';

    addReveal('a', mLogo,    !!optA.checked, 'logo');
    addReveal('b', mHead,    !!optB.checked, 'name');
    if (optC) addReveal('c', mStadium, !!optC.checked, 'stadium');
    if (optD) addReveal('d', mSub,     !!optD.checked, 'league');
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none', 150); }

/* ---------- Mode switch ---------- */
function setMode(next){
  MODE = (next === 'player') ? 'player' : 'team';
  localStorage.setItem('fsMode', MODE);

  const filterTitleEl = document.getElementById('filter-title');
  if (MODE === 'player') {
    filterTitleEl && (filterTitleEl.textContent = 'Select Teams');
    if (qpAll){
      qpAll.textContent = 'All Premier League teams';
      qpAll.title = 'Select all Premier League teams';
    }
    if (qpTopBtn){
      qpTopBtn.textContent = 'Top 6 Premier League Teams';
      qpTopBtn.title = 'Select the Big Six from the Premier League';
    }
  } else {
    filterTitleEl && (filterTitleEl.textContent = 'Select Leagues');
    if (qpAll){
      qpAll.textContent = 'All Leagues';
      qpAll.title = 'Select all leagues';
    }
    if (qpTopBtn){
      qpTopBtn.textContent = 'Top 5 Leagues';
      qpTopBtn.title = 'Select only the top 5 leagues';
    }
  }

  applyModeShowControls();
  renderChips();
}

/* ---------- Loaders ---------- */
async function loadTeams(){
  const res = await fetch('./teams.json?v='+Date.now());
  if (!res.ok) throw new Error('teams.json not found');
  TEAMS = await res.json();
  TEAM_BY_ID.clear(); CLUB_BY_ID.clear();

  for (const t of (TEAMS||[])){
    const id = String(t.team_id);
    TEAM_BY_ID.set(id, t);
    CLUB_BY_ID.set(id, t.team_name);
  }
  // seed fallbacks so all ids resolve
  for (const [id,name] of Object.entries(FALLBACK_TEAMS)){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, name);
  }
  TOTAL_TEAMS = TEAMS.length;
}

async function loadPlayers(){
  const res = await fetch('/data/players.json', {cache:'no-store'});
  if (!res.ok) throw new Error('players.json not found');
  const raw = await res.json();

  PLAYERS = (raw||[]).map(p=>{
    const displayName = p.name || p.player_name || 'Player';
    const clubId = String(p.club_id ?? p.team_id ?? '');
    const clubNameFromPlayer = p.club_name || p.club || p.team || null;
    if (clubId && clubNameFromPlayer && !CLUB_BY_ID.has(clubId)) {
      CLUB_BY_ID.set(clubId, clubNameFromPlayer);
    }

    const team   = TEAM_BY_ID.get(clubId);
    const color  = team?.primary_color || '#163058';
    const img    = p.image_url || p.image || p.file || '';
    const nat    = p.nationality || p.country || '';
    const jersey = p.jersey_number ?? p.jersey ?? p.number ?? '';

    return {
      team_name: displayName,
      image_url: img,
      club_id: clubId,
      league_code: team?.league_code || 'EPL',
      nationality: nat,
      jersey: jersey ? String(jersey).replace('#','') : '',
      primary_color: color
    };
  });

  TOTAL_PLAYERS = PLAYERS.length;

  // Ensure name for every club_id appearing in players.json
  for (const id of new Set(PLAYERS.map(p=>String(p.club_id)))){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, FALLBACK_TEAMS[id] || `Team #${id}`);
  }
}

/* ---------- Events ---------- */
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
      ? (MODE==='player' ? 'Show fewer teams' : 'Show fewer leagues')
      : (MODE==='player' ? 'Show more Premier League teams' : 'Show more leagues');
    toggleMore.setAttribute('aria-expanded', String(!hidden));
  });

  // Quick picks
  qpAll && (qpAll.onclick = () => {
    const all = visibleCodesAll();
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = all.includes(i.value); });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  });
  qpNone && (qpNone.onclick = () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  });
  qpTopBtn && (qpTopBtn.onclick = () => {
    if (MODE==='player'){
      const allow = new Set(PL_TOP6);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
    } else {
      const allow = new Set(TOP5);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
    }
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  });

  const refresh = ()=>{ if (!spinning){ selectedIdx=-1; drawWheel(); } };
  optA.addEventListener('change', refresh);
  optB.addEventListener('change', refresh);
  optC?.addEventListener('change', refresh);
  optD?.addEventListener('change', refresh);
  optE?.addEventListener('change', refresh);

  spinBtn && (spinBtn.onclick = spin);
  spinFab && (spinFab.onclick = spin);

  resetHistoryBtn && (resetHistoryBtn.onclick = ()=>{
    history = [];
    saveHistory();
    renderHistory();
  });

  mClose && (mClose.onclick = ()=> !spinning && closeModal());
  backdrop && backdrop.addEventListener('click', e=>{ if (!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !spinning) closeModal(); });

  let t; 
  window.addEventListener('resize', ()=>{
    clearTimeout(t);
    t=setTimeout(()=>{ sizeCanvas(); positionSpinFab(); drawWheel(); },120);
  }, {passive:true});
}

/* ---------- Boot ---------- */
(async function init(){
  try{
    await loadTeams();
    await loadPlayers();
  } catch (e){
    console.error('Failed to load data:', e);
  }

  // Apply initial mode UI & defaults
  setMode(MODE);

  // History empty-state text on first load
  renderHistory();

  sizeCanvas();
  positionSpinFab();
  wire();
})();

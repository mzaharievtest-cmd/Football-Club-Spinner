/* Football Spinner — TEAM / PLAYER unified
   + Mode toolbar (Guess Team / Guess Stadium / Guess Player + Free Spin)
   + Variant bar that changes what appears on the wheel
   - Players from /data/players.json
*/

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

/** GAME state controls the toolbar + what we render on the wheel */
const GAME = {
  mode: localStorage.getItem('fsGameMode') || 'guess-team', // 'guess-team'|'guess-stadium'|'guess-player'|'free-spin'
  variant: localStorage.getItem('fsGameVariant') || 'logo'  // 'logo'|'stadium'|'name'|'photo'|'icons'
};

let TEAMS = [];
let TEAM_BY_ID = new Map();
let CLUB_BY_ID = new Map();

let PLAYERS = [];
let TOTAL_TEAMS = 0;
let TOTAL_PLAYERS = 0;

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

/* ---------- DOM ---------- */
/* Top toolbar */
const btnGuessTeam    = document.getElementById('btnGuessTeam');
const btnGuessStadium = document.getElementById('btnGuessStadium');
const btnGuessPlayer  = document.getElementById('btnGuessPlayer');
const btnFreeSpin     = document.getElementById('btnFreeSpin');
const variantBar      = document.getElementById('variantBar');

/* Legacy TEAM/PLAYER toggle kept for compatibility (not shown now) */
const modeTeamBtn   = {classList:{toggle(){}}, setAttribute(){}};
const modePlayerBtn = {classList:{toggle(){}}, setAttribute(){}};

const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');
const qpAll     = document.getElementById('qpAll');
const qpNone    = document.getElementById('qpNone');
const qpTop     = document.getElementById('qpTop');

const optA = document.getElementById('optA'); // Logo/Image
const optB = document.getElementById('optB'); // Name
const optC = document.getElementById('optC'); // Stadium (team) / Jersey (player)
const optD = document.getElementById('optD'); // League (team) / Nationality (player)
const optE = document.getElementById('optE'); // (optional) Club (player only, modal reveal)
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

/* ---------- Chips helpers ---------- */
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

/* ---------- Labels ---------- */
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
const PL_TOP6 = ['18','9','14','8','19','6'];

/* ---------- PL fallback ---------- */
const FALLBACK_CLUBS = {
  '6':'Tottenham Hotspur','8':'Liverpool','9':'Manchester City','10':'Southampton',
  '11':'Fulham','13':'Everton','14':'Manchester United','15':'Aston Villa','18':'Chelsea',
  '19':'Arsenal','20':'Newcastle United','21':'West Ham United','26':'Leicester City',
  '27':'Burnley','29':'Wolverhampton Wanderers','51':'Crystal Palace','52':'AFC Bournemouth',
  '62':'Sheffield United','63':'Nottingham Forest','71':'Leeds United','78':'Brighton & Hove Albion',
  '236':'Brentford'
};

/* ---------- Data selection ---------- */
function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size === 0) return [];

  if (MODE === 'player'){
    return PLAYERS.filter(p => active.has(String(p.club_id)));
  }
  return TEAMS.filter(t => active.has(t.league_code));
}

/* ---------- Banner ---------- */
function updatePerfBanner(){
  const n = getCurrentData().length;
  const total = (MODE==='player') ? (TOTAL_PLAYERS || 1) : (TOTAL_TEAMS || 1);
  const pct = Math.max(0, Math.min(1, n / total));
  perfTip.style.setProperty('--pct', pct);
  perfTip.innerHTML = `<span class="meter-text">${n} ${MODE==='player' ? 'players' : 'teams'} selected</span>`;
  const disabled = n===0;
  spinBtn.disabled = disabled;
  spinFab.disabled = disabled;
}

/* ---------- Chips render (mode aware) ---------- */
function renderChips(){
  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  if (MODE === 'player'){
    const ids = Array.from(new Set(PLAYERS.map(p => String(p.club_id))));
    const labelFor = id => CLUB_BY_ID.get(id) || FALLBACK_CLUBS[id] || `Club #${id}`;

    const top6 = ids.filter(id => PL_TOP6.includes(id));
    const rest = ids.filter(id => !PL_TOP6.includes(id))
                    .sort((a,b)=> labelFor(a).localeCompare(labelFor(b)));

    top6.forEach(id => chipsTop.appendChild(makeChip(id, labelFor(id), true)));
    rest.forEach(id => chipsMore.appendChild(makeChip(id, labelFor(id), true)));

    toggleMore.textContent = 'Show more Premier League clubs';
    qpTop.textContent = 'Top 6';
  } else {
    const codes = [...new Set(TEAMS.map(t=>t.league_code))];
    const top = TOP5.filter(c => codes.includes(c));
    const more = codes.filter(c => !top.includes(c)).sort();

    top.forEach(c => chipsTop.appendChild(makeChip(c, leagueLabel(c), c==='EPL')));
    more.forEach(c => chipsMore.appendChild(makeChip(c, leagueLabel(c), false)));

    toggleMore.textContent = 'Show more leagues';
    qpTop.textContent = 'Top 5';
  }

  chipsMore.hidden = true;
  toggleMore.setAttribute('aria-expanded','false');
}

/* ---------- Show-on-wheel labels ---------- */
function applyModeShowControls(){
  if (MODE==='player'){
    lblA.textContent='Image';         optA.checked = (GAME.variant === 'photo' || GAME.variant === 'icons');
    lblB.textContent='Name';          optB.checked = (GAME.variant !== 'icons');
    lblC.textContent='Jersey Number'; optC.checked = (GAME.variant === 'icons');
    lblD.textContent='Nationality';   optD.checked = false;
    lblE.textContent='Club';          optE.checked = (GAME.variant === 'icons');
  } else {
    lblA.textContent='Logo';          optA.checked = (GAME.variant === 'logo');
    lblB.textContent='Name';          optB.checked = (GAME.variant === 'name');
    lblC.textContent='Stadium';       optC.checked = (GAME.variant === 'stadium');
    lblD.textContent='League';        optD.checked = (GAME.variant === 'stadium'); // reveal with stadium game
    lblE.textContent='';              optE.checked = false;
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
  // soft rings
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
    ctx.save(); ctx.translate(x,y); ctx.rotate(a);
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
    // subtle concentric rings
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

    const render = (() => {
      if (MODE==='player'){
        return (GAME.variant==='icons') ? 'player-icons' : 'player-photo';
      } else {
        if (GAME.variant==='stadium') return 'team-stadium';
        if (GAME.variant==='name')    return 'team-name';
        return 'team-logo';
      }
    })();

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

    // TEXT (team name or stadium or player name)
    if (render==='team-name'){
      const fit = fitSingleLine(ctx, t.team_name, {maxWidth, targetPx:Math.min(22, 0.22*arcLen)});
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
      ctx.fillStyle=fg;
      ctx.strokeText(fit.text, xText, 0); ctx.fillText(fit.text, xText, 0);
    }
    if (render==='team-stadium'){
      const text = t.stadium || '—';
      const fit = fitSingleLine(ctx, text, {maxWidth, targetPx:Math.min(22, 0.22*arcLen)});
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
      ctx.fillStyle=fg;
      ctx.strokeText(fit.text, xText, 0); ctx.fillText(fit.text, xText, 0);
    }
    if (render==='player-photo'){
      // show image + (optional) name if there's room
      const showImg = !!t.image_url;
      if (showImg){
        ctx.save(); ctx.translate(xLogo,0);
        ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.clip();
        const img = getImage(t.image_url, ()=> requestAnimationFrame(drawWheel));
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
      const fit = fitSingleLine(ctx, t.team_name, {maxWidth, targetPx:Math.min(22, 0.22*arcLen)});
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
      ctx.fillStyle=fg; ctx.strokeText(fit.text, xText, 0); ctx.fillText(fit.text, xText, 0);
    }
    if (render==='player-icons'){
      // small crest + jersey number pill
      const crestTeam = TEAM_BY_ID.get(String(t.club_id));
      const crestUrl  = crestTeam?.logo_url;
      if (crestUrl){
        ctx.save(); ctx.translate(xLogo,0);
        ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.clip();
        const img = getImage(crestUrl, ()=> requestAnimationFrame(drawWheel));
        if (img && img.complete){
          const box = Math.max(4, 2*(logoHalf-1));
          const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
          const s = Math.min(box/iw, box/ih);
          ctx.drawImage(img,-iw*s/2,-ih*s/2, iw*s, ih*s);
        } else { ctx.fillStyle='rgba(255,255,255,.14)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph); }
        ctx.restore(); ctx.restore();
      }
      const pill = `#${t.jersey || '—'}`;
      const fit = fitSingleLine(ctx, pill, {maxWidth, targetPx:Math.min(20, 0.2*arcLen), minPx:10});
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.font = `900 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.fillStyle=fg; ctx.fillText(fit.text, xText, 0);
    }
    if (render==='team-logo'){
      // logo + (optional) team name
      if (t.logo_url){
        ctx.save(); ctx.translate(xLogo,0);
        ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.clip();
        const img = getImage(t.logo_url, ()=> requestAnimationFrame(drawWheel));
        if (img && img.complete){
          const box = Math.max(4, 2*(logoHalf-1));
          const iw=img.naturalWidth||box, ih=img.naturalHeight||box;
          const s = Math.min(box/iw, box/ih);
          ctx.drawImage(img,-iw*s/2,-ih*s/2, iw*s, ih*s);
        } else { ctx.fillStyle='rgba(255,255,255,.14)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph); }
        ctx.restore(); ctx.restore();
      }
      if (GAME.variant==='logo' && optB.checked){
        const fit = fitSingleLine(ctx, t.team_name, {maxWidth, targetPx:Math.min(22, 0.22*arcLen)});
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
        ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
        ctx.fillStyle=fg; ctx.strokeText(fit.text, xText, 0); ctx.fillText(fit.text, xText, 0);
      }
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
  theTarget:
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

/* ---------- History ---------- */
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
    img.alt = MODE==='player' ? h.team_name : `${h.team_name} logo`;
    const span=document.createElement('span');
    span.textContent = MODE==='player'
      ? `${h.team_name} (${CLUB_BY_ID.get(String(h.club_id)) || FALLBACK_CLUBS[String(h.club_id)] || 'Unknown Team'})`
      : `${h.team_name} (${h.league_code})`;
    div.append(img,span); historyEl.append(div);
  });
}

/* ---------- Reveal helpers ---------- */
function ensureRevealStyles(){
  if (document.getElementById('reveal-style')) return;
  const s=document.createElement('style'); s.id='reveal-style';
  s.textContent = `
    .reveal-wrap{position:relative;display:inline-block}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none}
    .reveal-btn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;white-space:nowrap;z-index:3}
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
function unblurEl(el){ if(!el) return; el.style.filter=''; const w=el.parentElement; const o=w && w.querySelector('.reveal-overlay'); if(o) o.remove(); const b=w && w.querySelector('.reveal-btn'); if(b) b.remove(); }
function addReveal(key, el, enabled, label){
  const w = wrap(el);
  const prior = w.querySelector('.reveal-btn'); if (prior) prior.remove();
  if (enabled || modalReveal[key]){ unblurEl(el); return; }
  blurEl(el);
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

    mClub.textContent   = CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_CLUBS[String(item.club_id)] || '—';
    mJersey.textContent = item.jersey ? `#${item.jersey}` : '—';
    mNat.textContent    = item.nationality || '—';

    addReveal('a', mLogo,   GAME.variant==='photo', 'image');
    addReveal('b', mHead,   GAME.variant!=='icons', 'name');
    addReveal('c', mJersey, GAME.variant==='icons', 'jersey number');
    addReveal('d', mNat,    false, 'nationality');
    addReveal('e', mClub,   GAME.variant==='icons', 'club');
  } else {
    mHead.textContent = item.team_name || '—';
    mLogo.src = item.logo_url || '';
    mSub.textContent  = leagueLabel(item.league_code) || '';

    rowStadium.style.display='';
    rowClub.style.display='none';
    rowJersey.style.display='none';
    rowNat.style.display='none';
    mStadium.textContent = item.stadium || '—';

    addReveal('a', mLogo,    GAME.variant==='logo', 'logo');
    addReveal('b', mHead,    GAME.variant==='name', 'name');
    addReveal('c', mStadium, GAME.variant==='stadium', 'stadium');
    addReveal('d', mSub,     GAME.variant==='stadium', 'league');
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none', 150); }

/* ---------- Toolbar UI ---------- */
function setToolbarPressed(btn){
  [btnGuessTeam, btnGuessStadium, btnGuessPlayer, btnFreeSpin].forEach(b=>{
    b.setAttribute('aria-pressed', String(b===btn));
  });
}
function renderVariantBar(){
  variantBar.innerHTML = '';
  const mk = (id,label,active)=> {
    const b = document.createElement('button');
    b.className = 'mode-pill';
    b.textContent = label;
    b.setAttribute('aria-pressed', active?'true':'false');
    b.onclick = ()=> {
      GAME.variant = id;
      localStorage.setItem('fsGameVariant', GAME.variant);
      applyToolbarToEngine();
    };
    return b;
  };

  if (GAME.mode==='guess-team'){
    variantBar.append(
      mk('logo','By Logo', GAME.variant==='logo'),
      mk('stadium','By Stadium (+ League)', GAME.variant==='stadium')
    );
  } else if (GAME.mode==='guess-stadium'){
    variantBar.append(
      mk('name','By Team Name', GAME.variant==='name'),
      mk('logo','By Logo', GAME.variant==='logo')
    );
  } else if (GAME.mode==='guess-player'){
    variantBar.append(
      mk('photo','By Photo', GAME.variant==='photo'),
      mk('icons','By Club + Flag + Number', GAME.variant==='icons')
    );
  } else {
    variantBar.append(mk('logo','Classic Wheel', true));
  }
}

function applyToolbarToEngine(){
  // Map GAME.mode -> MODE + labels + chips
  if (GAME.mode==='guess-player'){
    MODE='player';
  } else {
    MODE='team';
  }
  localStorage.setItem('fsMode', MODE);

  applyModeShowControls();
  renderChips();
  selectedIdx=-1;
  updatePerfBanner();
  drawWheel();
}

/* ---------- Events ---------- */
function wire(){
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
    const all = visibleCodesAll();
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = all.includes(i.value); });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  };
  qpNone.onclick = () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  };
  qpTop.onclick = () => {
    if (MODE==='player'){
      const allow = new Set(PL_TOP6);
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
  optC?.addEventListener('change', refresh);
  optD?.addEventListener('change', refresh);
  optE?.addEventListener('change', refresh);

  spinBtn.onclick = spin; 
  spinFab.onclick = spin;

  resetHistoryBtn.onclick = ()=>{ history=[]; localStorage.setItem('clubHistory', JSON.stringify(history)); renderHistory(); };

  mClose.onclick = ()=> !spinning && closeModal();
  backdrop.addEventListener('click', e=>{ if (!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !spinning) closeModal(); });

  let t; 
  window.addEventListener('resize', ()=>{
    clearTimeout(t);
    t=setTimeout(()=>{ sizeCanvas(); positionSpinFab(); drawWheel(); },120);
  }, {passive:true});

  /* Toolbar buttons */
  btnGuessTeam.onclick = ()=>{
    GAME.mode='guess-team';
    GAME.variant = (GAME.variant==='logo' || GAME.variant==='stadium') ? GAME.variant : 'logo';
    localStorage.setItem('fsGameMode', GAME.mode);
    setToolbarPressed(btnGuessTeam); renderVariantBar(); applyToolbarToEngine();
  };
  btnGuessStadium.onclick = ()=>{
    GAME.mode='guess-stadium';
    GAME.variant = (GAME.variant==='name' || GAME.variant==='logo') ? GAME.variant : 'name';
    localStorage.setItem('fsGameMode', GAME.mode);
    setToolbarPressed(btnGuessStadium); renderVariantBar(); applyToolbarToEngine();
  };
  btnGuessPlayer.onclick = ()=>{
    GAME.mode='guess-player';
    GAME.variant = (GAME.variant==='photo' || GAME.variant==='icons') ? GAME.variant : 'photo';
    localStorage.setItem('fsGameMode', GAME.mode);
    setToolbarPressed(btnGuessPlayer); renderVariantBar(); applyToolbarToEngine();
  };
  btnFreeSpin.onclick = ()=>{
    GAME.mode='free-spin';
    GAME.variant='logo';
    localStorage.setItem('fsGameMode', GAME.mode);
    setToolbarPressed(btnFreeSpin); renderVariantBar(); applyToolbarToEngine();
  };
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
  for (const [id,name] of Object.entries(FALLBACK_CLUBS)){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, name);
  }
  TOTAL_TEAMS = TEAMS.length;
}

async function loadPlayers(){
  const res = await fetch('/data/players.json', {cache:'no-store'});
  if (!res.ok) throw new Error('players.json not found');
  const raw = await res.json();

  PLAYERS = (raw||[]).map(p=>{
    const name   = p.name || p.player_name || 'Player';
    const clubId = String(p.club_id ?? p.team_id ?? '');
    const team   = TEAM_BY_ID.get(clubId);
    const color  = team?.primary_color || '#163058';
    const img    = p.image_url || p.image || p.file || '';
    const nat    = p.nationality || p.country || '';
    const jersey = p.jersey_number ?? p.jersey ?? p.number ?? '';

    return {
      team_name: name,
      image_url: img,
      club_id: clubId,
      league_code: team?.league_code || 'EPL',
      nationality: nat,
      jersey: jersey ? String(jersey).replace('#','') : '',
      primary_color: color
    };
  });

  TOTAL_PLAYERS = PLAYERS.length;
  for (const id of new Set(PLAYERS.map(p=>String(p.club_id)))){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, FALLBACK_CLUBS[id] || `Club #${id}`);
  }
}

/* ---------- Boot ---------- */
(async function init(){
  try{
    await loadTeams();
    await loadPlayers();
  } catch (e){
    console.error('Failed to load data:', e);
  }

  // Restore toolbar state
  setToolbarPressed(
    GAME.mode==='guess-team'   ? btnGuessTeam :
    GAME.mode==='guess-stadium'? btnGuessStadium :
    GAME.mode==='guess-player' ? btnGuessPlayer :
                                 btnFreeSpin
  );
  renderVariantBar();

  MODE = (GAME.mode==='guess-player') ? 'player' : 'team';
  localStorage.setItem('fsMode', MODE);

  applyModeShowControls();
  renderChips();
  renderHistory();
  sizeCanvas();
  updatePerfBanner();
  drawWheel();
  positionSpinFab();
  wire();
})();

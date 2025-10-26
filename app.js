/* Football Spinner — TEAM / PLAYER unified (modern FX)
   - TEAM wheel: Logo/Name on wheel (+Stadium optional). League: modal-only (reveal).
   - PLAYER wheel: Image/Name on wheel only. Jersey/Nationality/Club live in modal with reveal.
   - >50 items → ambient stripes (no text/images) but still wedges.
   - Players are loaded from /data/players.json (single source of truth).
   - Player chips are derived from players.json (club_id). Club names resolved via teams.json + fallback.
   - Modern visuals: conic glow ring, pointer LED, motion blur trail, wedge highlight, confetti/sparkles.
   - Modern audio: swept-noise whoosh (band-pass), per-slice vinyl tick, soft end-chord with plate reverb.
*/

/* =========================
   Mode & state
   ========================= */
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
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

/* =========================
   DOM
   ========================= */
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const chipsWrap = document.getElementById('chips');
const chipsTop  = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore= document.getElementById('toggleMore');
const qpAll     = document.getElementById('qpAll');
const qpNone    = document.getElementById('qpNone');
const qpTop     = document.getElementById('qpTop');

const optA = document.getElementById('optA'); // A
const optB = document.getElementById('optB'); // B
const optC = document.getElementById('optC'); // C
const optD = document.getElementById('optD'); // D
const optE = document.getElementById('optE'); // E (Club) — optional in HTML
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
const mSub       = document.getElementById('mSub');   // TEAM: League (reveal) / PLAYER: kept empty (avoid duplication)
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

/* =========================
   Utils
   ========================= */
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

/* =========================
   Chips helpers
   ========================= */
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

/* =========================
   Labels & presets
   ========================= */
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
const PL_TOP6 = ['18','9','14','8','19','6']; // Chelsea, City, United, Liverpool, Arsenal, Spurs

/* Fallback club names for PL ids not in teams.json */
const FALLBACK_CLUBS = {
  '6':'Tottenham Hotspur','8':'Liverpool','9':'Manchester City','10':'Southampton',
  '11':'Fulham','13':'Everton','14':'Manchester United','15':'Aston Villa','18':'Chelsea',
  '19':'Arsenal','20':'Newcastle United','21':'West Ham United','26':'Leicester City',
  '27':'Burnley','29':'Wolverhampton Wanderers','51':'Crystal Palace','52':'AFC Bournemouth',
  '62':'Sheffield United','63':'Nottingham Forest','71':'Leeds United','78':'Brighton & Hove Albion',
  '236':'Brentford'
};

/* =========================
   Data selection
   ========================= */
function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size === 0) return [];

  if (MODE === 'player'){
    return PLAYERS.filter(p => active.has(String(p.club_id)));
  }
  return TEAMS.filter(t => active.has(t.league_code));
}

/* =========================
   Perf banner (progress out of total)
   ========================= */
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

/* =========================
   Chips render (mode aware)
   ========================= */
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

/* =========================
   Show-on-wheel (mode aware)
   ========================= */
function applyModeShowControls(){
  if (MODE==='player'){
    lblA.textContent='Image';         optA.checked = true;
    lblB.textContent='Name';          optB.checked = true;
    lblC.textContent='Jersey Number'; optC.checked = false;
    lblD.textContent='Nationality';   optD.checked = false;
    if (lblE) { lblE.textContent='Club'; if (optE) optE.checked=false; }
  } else {
    lblA.textContent='Logo';    optA.checked = true;
    lblB.textContent='Name';    optB.checked = true;
    lblC.textContent='Stadium'; optC.checked = false;
    lblD.textContent='League';  optD.checked = true; // modal only
    if (lblE) { lblE.textContent='Club'; if (optE) optE.checked=false; } // not used in TEAM
  }
}

/* =========================
   Canvas sizing
   ========================= */
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

/* =========================
   Drawing helpers (ambient patterns)
   ========================= */
const PERF = { hideTextThreshold: 50, minTextWidth: 44, minLogoBox: 26 };

function drawIdle(ctx,W,H){
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2,H/2);
  const r = Math.min(W,H)*0.48;
  const g = ctx.createRadialGradient(0,0,r*0.1, 0,0,r);
  g.addColorStop(0,'#121b34'); g.addColorStop(0.5,'#0f1830'); g.addColorStop(1,'#0a1428');
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fillStyle=g; ctx.fill();
  // glass conic ring
  const grd = ctx.createConicGradient(0,0,0);
  grd.addColorStop(0.00,'rgba(34,211,238,.18)');
  grd.addColorStop(0.25,'rgba(100,168,255,.18)');
  grd.addColorStop(0.50,'rgba(155,107,255,.18)');
  grd.addColorStop(0.75,'rgba(100,168,255,.18)');
  grd.addColorStop(1.00,'rgba(34,211,238,.18)');
  ctx.lineWidth = 10; ctx.strokeStyle = grd;
  ctx.beginPath(); ctx.arc(0,0,r*0.98,0,TAU); ctx.stroke();
  ctx.restore();
}

function drawAmbientGrid(ctx, W, H){
  ctx.save(); ctx.translate(W/2,H/2);
  const r = Math.min(W,H)*0.48;
  // outer rim ticked
  const ticks = 96;
  for (let i=0;i<ticks;i++){
    const a = (i/ticks)*TAU;
    ctx.beginPath();
    const inner = r*0.94 + (i%2?0:1.5);
    ctx.moveTo(Math.cos(a)*inner, Math.sin(a)*inner);
    ctx.lineTo(Math.cos(a)*r,     Math.sin(a)*r);
    ctx.lineWidth = (i%2)?1:2;
    ctx.strokeStyle = (i%2)?'rgba(200,220,255,.08)':'rgba(200,220,255,.12)';
    ctx.stroke();
  }
  // faint rings
  ctx.lineWidth=1.5;
  for (let i=1;i<=5;i++){
    ctx.beginPath(); ctx.arc(0,0,r*(i/5),0,TAU);
    ctx.strokeStyle = `rgba(160,190,255,${0.10 - i*0.012})`;
    ctx.stroke();
  }
  ctx.restore();
}

/* =========================
   FX (trail / confetti / sparkles)
   ========================= */
let lastTrailTime = 0;
const trail = [];     // {x,y,alpha}
const confetti = [];  // {x,y,vx,vy,alpha,rot,vr,clr}
const sparkles = [];  // {x,y,vx,vy,alpha}

function addTrail(x,y){
  trail.push({x,y,alpha:1});
  if (trail.length>50) trail.shift();
}
function stepTrail(ctx){
  for (const t of trail){ t.alpha *= 0.92; }
  while (trail.length && trail[0].alpha < 0.02) trail.shift();

  ctx.save();
  ctx.globalCompositeOperation='lighter';
  for (const t of trail){
    ctx.beginPath();
    ctx.arc(t.x,t.y, 5.5, 0, TAU);
    ctx.fillStyle=`rgba(120,200,255,${0.28*t.alpha})`;
    ctx.fill();
  }
  ctx.restore();
}

function burstConfetti(cx,cy, theme='blue'){
  const palette = theme==='blue'
    ? ['#64a8ff','#22d3ee','#9b6bff','#eaf3ff']
    : ['#ff5a7a','#ffd166','#7cffb2','#a0a7ff'];
  for (let i=0;i<30;i++){
    const a = Math.random()*TAU;
    const s = 2 + Math.random()*3.2;
    confetti.push({
      x:cx, y:cy,
      vx:Math.cos(a)*s, vy:Math.sin(a)*s - 1.2,
      alpha:1,
      rot:Math.random()*TAU,
      vr:(Math.random()-.5)*0.2,
      clr: palette[Math.floor(Math.random()*palette.length)]
    });
  }
  for (let i=0;i<24;i++){
    const a = Math.random()*TAU;
    const s = 1.2 + Math.random()*2.0;
    sparkles.push({
      x:cx, y:cy,
      vx:Math.cos(a)*s, vy:Math.sin(a)*s,
      alpha:1
    });
  }
}
function stepConfetti(ctx){
  ctx.save();
  ctx.globalCompositeOperation='screen';
  for (const c of confetti){
    c.vy += 0.045; // gravity
    c.x += c.vx; c.y += c.vy;
    c.rot += c.vr;
    c.alpha *= 0.985;
    ctx.save();
    ctx.translate(c.x,c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.clr + Math.floor(c.alpha*255).toString(16).padStart(2,'0');
    ctx.fillRect(-3,-1.5,6,3);
    ctx.restore();
  }
  while (confetti.length && confetti[0].alpha<0.05) confetti.shift();

  ctx.globalCompositeOperation='lighter';
  for (const s of sparkles){
    s.x+=s.vx; s.y+=s.vy; s.vx*=0.98; s.vy*=0.98; s.alpha*=0.93;
    ctx.beginPath();
    ctx.arc(s.x,s.y, 1.8, 0, TAU);
    ctx.fillStyle=`rgba(255,255,255,${0.55*s.alpha})`;
    ctx.fill();
  }
  while (sparkles.length && sparkles[0].alpha<0.05) sparkles.shift();
  ctx.restore();
}

/* =========================
   Wheel drawing
   ========================= */
let lastSliceAtPointer = -1; // for precise ticks

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

  // background + conic gloss
  drawIdle(ctx,W,H);

  ctx.save(); ctx.translate(W/2,H/2);
  ctx.rotate(mod(currentAngle,TAU));

  const r = Math.min(W,H)*0.48;
  const slice = TAU/N;

  // wedges
  for (let i=0;i<N;i++){
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,i*slice,(i+1)*slice); ctx.closePath();
    ctx.fillStyle = data[i].primary_color || '#294a7a';
    ctx.fill();

    // crisp rim tick
    ctx.save();
    ctx.rotate(i*slice);
    ctx.beginPath();
    ctx.moveTo(r*0.93,0); ctx.lineTo(r,0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.stroke();
    ctx.restore();
  }

  if (hideAll){
    ctx.restore();
    drawAmbientGrid(ctx,W,H);
  } else {
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
          ctx.fillStyle='rgba(255,255,255,.14)';
          const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
        }
        ctx.restore(); ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // pointer LED + trail + sparkles layer
  const fctx = fx.getContext('2d');
  fctx.setTransform(DPR,0,0,DPR,0,0);
  const W2 = wheel.width / DPR, H2 = wheel.height / DPR;
  fctx.clearRect(0,0,W2,H2);

  const r2 = Math.min(W2,H2)*0.48;
  const theta = mod(POINTER_ANGLE - mod(currentAngle,TAU), TAU);
  const tx = W2/2 + Math.cos(theta)*r2*0.99;
  const ty = H2/2 + Math.sin(theta)*r2*0.99;

  // LED
  fctx.save();
  fctx.filter = 'blur(2px)';
  fctx.beginPath(); fctx.arc(tx,ty,5.5,0,TAU);
  fctx.fillStyle='rgba(100,168,255,.85)'; fctx.fill();
  fctx.restore();

  // motion blur trail
  const now = performance.now();
  if (now - lastTrailTime > 14) { addTrail(tx,ty); lastTrailTime = now; }
  stepTrail(fctx);
  stepConfetti(fctx);

  // highlight current wedge rim
  if (N>0){
    const offset = mod(POINTER_ANGLE - mod(currentAngle,TAU), TAU);
    const idxAtPointer = Math.floor(offset / (TAU/N)) % N;

    // clean tick detection: emit on change
    if (spinning && idxAtPointer !== lastSliceAtPointer){
      vinylTick(); // precise per-slice tick
      lastSliceAtPointer = idxAtPointer;
    }

    // shimmer arc
    fctx.save();
    fctx.translate(W2/2,H2/2);
    const a0 = idxAtPointer*(TAU/N), a1=(idxAtPointer+1)*(TAU/N);
    fctx.rotate(-mod(currentAngle,TAU));
    fctx.beginPath();
    fctx.arc(0,0,r2*0.995, a0, a1);
    fctx.lineWidth = 6;
    fctx.strokeStyle = 'rgba(255,255,255,.22)';
    fctx.stroke();
    fctx.restore();
  }
}

/* =========================
   WebAudio (modern)
   ========================= */
let ac, master, reverb;
function ensureAudio(){
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
  reverb = ac.createConvolver(); reverb.buffer = makePlateImpulse(ac, 1.2, 2.5); // short airy plate
  const verbGain = ac.createGain(); verbGain.gain.value = 0.18;
  reverb.connect(verbGain).connect(master);
}

function makePlateImpulse(ctx, seconds=1.0, decay=2.0){
  const rate = ctx.sampleRate;
  const len = rate * seconds;
  const impulse = ctx.createBuffer(2, len, rate);
  for (let c=0;c<2;c++){
    const ch = impulse.getChannelData(c);
    for (let i=0;i<len;i++){
      ch[i] = (Math.random()*2-1) * Math.pow(1 - i/len, decay);
    }
  }
  return impulse;
}

function sweptWhoosh(dur=1.0){
  ensureAudio();
  const noise = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * (0.8 + 0.2*Math.random());
  const src = ac.createBufferSource(); src.buffer = noise;

  const bp = ac.createBiquadFilter(); bp.type='bandpass';
  const q = ac.createBiquadFilter();  q.type='peaking'; q.frequency.value=1600; q.Q.value=0.8; q.gain.value=1.5;

  const g = ac.createGain();
  const now = ac.currentTime;
  bp.frequency.setValueAtTime(400, now);
  bp.frequency.exponentialRampToValueAtTime(2200, now+dur*0.9);

  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.5, now+0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, now+dur);

  src.connect(bp).connect(q).connect(g).connect(master);
  src.start(now); src.stop(now+dur+0.02);
}

function vinylTick(){
  ensureAudio();
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  const hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=900;

  o.type='square'; o.frequency.value=1000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t+0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.06);

  o.connect(g).connect(hp).connect(master);
  o.start(t); o.stop(t+0.08);
}

function endChord(){
  ensureAudio();
  const notes = [392,494,587]; // G B D
  const now = ac.currentTime;
  notes.forEach((f,i)=>{
    const o=ac.createOscillator(), g=ac.createGain();
    o.type='triangle'; o.frequency.value=f;
    g.gain.value=0.0001;
    g.gain.exponentialRampToValueAtTime(0.35, now+0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.7+i*0.02);
    o.connect(g); g.connect(master); g.connect(reverb);
    o.start(now+0.01*i); o.stop(now+0.8+i*0.02);
  });
}

/* =========================
   Spin
   ========================= */
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

  const start = performance.now(), dur=3400;
  const easeOutCubic = x=>1-Math.pow(1-x,3);

  sweptWhoosh(1.0);
  lastSliceAtPointer = -1;

  function step(now){
    const p = clamp(0,(now-start)/dur,1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p<1) requestAnimationFrame(step);
    else {
      const theta = mod(currentAngle,TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;
      // snap to center
      const center = idx*slice + slice/2;
      const delta = mod(center - offset, TAU);
      currentAngle = mod(currentAngle + delta, TAU);

      // FX burst at pointer
      const DPR = Math.max(1, window.devicePixelRatio||1);
      const W = wheel.width/DPR, H = wheel.height/DPR;
      const r = Math.min(W,H)*0.48;
      const px = W/2 + Math.cos(POINTER_ANGLE)*r;
      const py = H/2 + Math.sin(POINTER_ANGLE)*r;
      burstConfetti(px,py,'blue');

      endChord();

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

/* =========================
   History
   ========================= */
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

/* =========================
   Reveal overlay in modal
   ========================= */
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

/* =========================
   Modal
   ========================= */
function openModal(item){
  ensureRevealStyles();
  modalReveal = {a:false,b:false,c:false,d:false,e:false};

  if (MODE==='player'){
    // Title & image
    mHead.textContent = item.team_name || '—';
    mLogo.src = item.image_url || '';

    // Subtitle empty (avoid nationalities duplication)
    mSub.textContent  = '';

    // Visible rows
    rowStadium.style.display='none';
    rowClub.style.display='';
    rowJersey.style.display='';
    rowNat.style.display='';

    mClub.textContent   = CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_CLUBS[String(item.club_id)] || '—';
    mJersey.textContent = item.jersey ? `#${item.jersey}` : '—';
    mNat.textContent    = item.nationality || '—';

    // Reveals (A=image, B=name, C=jersey, D=nationality, E=club)
    addReveal('a', mLogo,   !!optA.checked, 'image');
    addReveal('b', mHead,   !!optB.checked, 'name');
    addReveal('c', mJersey, !!optC.checked, 'jersey number');
    addReveal('d', mNat,    !!optD.checked, 'nationality');
    if (optE) addReveal('e', mClub, !!optE.checked, 'club');
  } else {
    // TEAM
    mHead.textContent = item.team_name || '—';
    mLogo.src = item.logo_url || '';
    mSub.textContent  = leagueLabel(item.league_code) || '';

    rowStadium.style.display='';
    rowClub.style.display='none';
    rowJersey.style.display='none';
    rowNat.style.display='none';
    mStadium.textContent = item.stadium || '—';

    // A=logo, B=name, C=stadium, D=league
    addReveal('a', mLogo,    !!optA.checked, 'logo');
    addReveal('b', mHead,    !!optB.checked, 'name');
    addReveal('c', mStadium, !!optC.checked, 'stadium');
    addReveal('d', mSub,     !!optD.checked, 'league');
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none', 150); }

/* =========================
   Mode switch
   ========================= */
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

/* =========================
   Loaders
   ========================= */
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
  // seed fallbacks so all club_ids resolve
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

  // Ensure label for every club_id
  for (const id of new Set(PLAYERS.map(p=>String(p.club_id)))){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, FALLBACK_CLUBS[id] || `Club #${id}`);
  }
}

/* =========================
   Events
   ========================= */
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
  optC.addEventListener('change', refresh);
  optD.addEventListener('change', refresh);
  if (optE) optE.addEventListener('change', refresh);

  const startSpin = ()=>{ ensureAudio(); spin(); };
  spinBtn.onclick = startSpin;
  spinFab.onclick = startSpin;

  resetHistoryBtn.onclick = ()=>{ history=[]; localStorage.setItem('clubHistory', JSON.stringify(history)); renderHistory(); };

  mClose.onclick = ()=> !spinning && closeModal();
  backdrop.addEventListener('click', e=>{ if (!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !spinning) closeModal(); });

  let t; window.addEventListener('resize', ()=>{ clearTimeout(t); t=setTimeout(()=>{ sizeCanvas(); drawWheel(); },120); }, {passive:true});
}

/* =========================
   Boot
   ========================= */
(async function init(){
  try{
    await loadTeams();
    await loadPlayers();
  } catch (e){
    console.error('Failed to load data:', e);
  }

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

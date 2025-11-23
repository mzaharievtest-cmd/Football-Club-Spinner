/* Football Spinner — TEAM / PLAYER unified
   - TEAM defaults: Premier League selected; Show on Wheel = Logo only.
   - PLAYER defaults: only Arsenal selected; Show on Wheel = Image only; “All Premier League teams” quick-pick.
   - PLAYER: exclude players without a usable image (incl. placeholder.png) from the wheel.
   - PL Top-6 sorted first alphabetically.
   - History stored per item with type {type:'team'|'player', item:{…}} and rendered per active mode.
   - Modal: clean layout + modern “Show …” reveal buttons (centered over blurred element).
   - AI Quiz: when enabled, fetches a real-time question for the landed team/player from /quiz
     and shows it inside the result modal.
*/

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let TEAMS = [];
let TEAM_BY_ID = new Map();
let CLUB_BY_ID = new Map();

let PLAYERS = [];
let TOTAL_TEAMS = 0;
let TOTAL_PLAYERS = 0;

let CLUB_KNOWLEDGE = [];
let CLUB_KNOWLEDGE_BY_NAME = new Map();
let CLUB_KNOWLEDGE_BY_LEAGUE_AND_NAME = new Map();
let CLUB_FACTS = [];

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;

// History v2 — separate buckets for team & player
let historyStore = { team: [], player: [] };

(function initHistory(){
  try {
    // New format: { team: [...], player: [...] }
    const v2 = JSON.parse(localStorage.getItem('fsHistoryV2') || 'null');
    if (v2 && typeof v2 === 'object') {
      historyStore.team   = Array.isArray(v2.team)   ? v2.team   : [];
      historyStore.player = Array.isArray(v2.player) ? v2.player : [];
      return;
    }

    // Legacy migration from clubHistory (mixed array)
    const legacyRaw = JSON.parse(localStorage.getItem('clubHistory') || '[]');
    const teams = [];
    const players = [];

    for (const h of legacyRaw) {
      if (!h || typeof h !== 'object') continue;

      if ('type' in h && 'item' in h) {
        // Already wrapped
        if (h.type === 'player') players.push(h.item);
        else teams.push(h.item);
      } else {
        // Heuristic: players had image_url / club_id
        if (h.image_url || h.club_id) players.push(h);
        else teams.push(h);
      }
    }

    historyStore = { team: teams, player: players };
    localStorage.setItem('fsHistoryV2', JSON.stringify(historyStore));
  } catch (e) {
    console.warn('History init failed', e);
    historyStore = { team: [], player: [] };
  }
})();

const saveHistory = () => {
  try {
    localStorage.setItem('fsHistoryV2', JSON.stringify(historyStore));
  } catch (e) {
    console.warn('History save failed', e);
  }
};

const getHistoryBucket = (mode = MODE) =>
  mode === 'player' ? historyStore.player : historyStore.team;

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

/* AI Quiz DOM (matches your HTML) */
const quizContainer = document.getElementById('quizContainer');   // main quiz block in modal
const quizQuestion  = document.getElementById('quizQuestion');
const quizAnswers   = document.getElementById('quizAnswers');
const quizFeedback  = document.getElementById('quizFeedback');
const quizNextBtn   = document.getElementById('quizNextBtn');
const quizEndBtn    = document.getElementById('quizEndBtn');
const quizProgress  = document.getElementById('quizProgress');
const quizScore     = document.getElementById('quizScore');

// Sidebar AI controls
const aiQuizToggle     = document.getElementById('aiQuizToggle');      // checkbox
const aiQuizDifficulty = document.getElementById('aiQuizDifficulty');  // select (auto/easy/medium/hard)
const aiQuizCategory   = document.getElementById('aiQuizCategory');    // currently just a hint for prompt
const aiQuizRounds     = document.getElementById('aiQuizRounds');      // endless / 5 / 10

/* Reveal state (global) */
let modalReveal = { a:false, b:false, c:false, d:false, e:false };

/* AI Quiz state */
let AI_QUIZ_ENABLED = false;
let currentQuiz = null;           // { question, answers:[...], correctIndex, explanation? }
let lastQuizItem = null;          // item used for current quiz
let quizRoundsPlayed = 0;
let quizCorrectCount = 0;

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

/* --- Color helpers --- */
function parseHexToRgb(hex){
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return null;
  hex = hex.replace('#','');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return { r, g, b };
}
function rgbToHex({r,g,b}){
  const to = v => {
    v = Math.max(0, Math.min(255, Math.round(v)));
    return v.toString(16).padStart(2,'0');
  };
  return `#${to(r)}${to(g)}${to(b)}`;
}
function mixRgb(a, b, weight){
  const w = clamp(0, weight, 1);
  const iw = 1 - w;
  return {
    r: a.r * iw + b.r * w,
    g: a.g * iw + b.g * w,
    b: a.b * iw + b.b * w
  };
}

/* Text contrast color */
function textColorFor(hex){
  const rgb = parseHexToRgb(hex);
  if (!rgb) return '#fff';
  const { r, g, b } = rgb;
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}

/* Slice color = team primary_color from teams.json; fallback dark navy */
function getSliceColor(primary) {
  if (primary && /^#?[0-9a-f]{6}$/i.test(primary)) {
    return primary.startsWith('#') ? primary : `#${primary}`;
  }
  return '#020617';
}

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
const PL_TOP6 = ['19','18','8','9','14','6']; // Arsenal, Chelsea, Liverpool, Man City, Man United, Spurs

/* ---------- Fallback team names ---------- */
const FALLBACK_TEAMS = {
  '6':'Tottenham Hotspur','8':'Liverpool','9':'Manchester City','10':'Southampton',
  '11':'Fulham','13':'Everton','14':'Manchester United','15':'Aston Villa','18':'Chelsea',
  '19':'Arsenal','20':'Newcastle United','21':'West Ham United','26':'Leicester City',
  '27':'Burnley','29':'Wolverhampton Wanderers','51':'Crystal Palace','52':'AFC Bournemouth',
  '62':'Sheffield United','63':'Nottingham Forest','71':'Leeds United','78':'Brighton & Hove Albion',
  '236':'Brentford'
};

/* ---------- Data selection ---------- */
function activeCodes(){
  const arr=[];
  chipsWrap.querySelectorAll('input[type="checkbox"]:checked').forEach(i => arr.push(i.value));
  return arr;
}

function getCurrentData(){
  const active = new Set(activeCodes());
  if (active.size === 0) return [];
  if (MODE === 'player'){
    return PLAYERS.filter(p =>
      active.has(String(p.club_id)) &&
      p.image_url &&
      String(p.image_url).trim().length > 4 &&
      !/placeholder\.png$/i.test(p.image_url)
    );
  }
  return TEAMS.filter(t => active.has(t.league_code));
}

/* ---------- Perf banner ---------- */
function updatePerfBanner(){
  const data = getCurrentData();
  const n = data.length;
  const total = (MODE==='player') ? (TOTAL_PLAYERS || 1) : (TOTAL_TEAMS || 1);
  const pct = Math.max(0, Math.min(1, n / total));
  perfTip.style.setProperty('--pct', pct);
  perfTip.innerHTML = `<span class="meter-text">${n} ${MODE==='player'?'players loaded':'teams ready to spin'}</span>`;

  const disabled = n === 0;
  spinBtn.disabled = disabled;
  spinFab.disabled = disabled;

  // hide SPIN if no selection
  const hasSelection = activeCodes().length > 0;
  const visibility = hasSelection ? '' : 'hidden';

  if (spinFab) {
    spinFab.style.visibility = visibility;
  }
  if (spinBtn) {
    spinBtn.style.visibility = visibility;
  }
}

/* ---------- Chips helpers & render ---------- */
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
    const ids = Array.from(new Set(PLAYERS.map(p => String(p.club_id))));
    const labelFor = id => CLUB_BY_ID.get(id) || FALLBACK_TEAMS[id] || `Team #${id}`;

    const top6 = PL_TOP6.filter(id => ids.includes(id))
      .sort((a,b)=> labelFor(a).localeCompare(labelFor(b),'en',{sensitivity:'base'}));
    const rest = ids.filter(id => !PL_TOP6.includes(id))
      .sort((a,b)=> labelFor(a).localeCompare(labelFor(b),'en',{sensitivity:'base'}));

    const defaultSelected = new Set(['19']); // Arsenal only
    top6.forEach(id => chipsTop.appendChild(makeChip(id, labelFor(id), defaultSelected.has(id))));
    rest.forEach(id => chipsMore.appendChild(makeChip(id, labelFor(id), defaultSelected.has(id))));

    if (qpAll){ qpAll.textContent='All Premier League teams'; qpAll.title='Select all Premier League teams'; }
    toggleMore.textContent='Show more Premier League teams'; toggleMore.setAttribute('aria-expanded','false'); chipsMore.hidden=true;
    if (qpTopBtn){ qpTopBtn.textContent='Top 6 Premier League Teams'; qpTopBtn.title='Select the Big Six from the Premier League'; }

  } else {
    const codes = [...new Set(TEAMS.map(t=>t.league_code))];
    const top = TOP5.filter(c => codes.includes(c));
    const more = codes.filter(c => !top.includes(c)).sort();

    top.forEach(c => chipsTop.appendChild(makeChip(c, leagueLabel(c), c==='EPL')));
    more.forEach(c => chipsMore.appendChild(makeChip(c, leagueLabel(c), false)));

    if (qpAll){ qpAll.textContent='All Leagues'; qpAll.title='Select all leagues'; }
    toggleMore.textContent='Show more leagues'; toggleMore.setAttribute('aria-expanded','false'); chipsMore.hidden=true;
    if (qpTopBtn){ qpTopBtn.textContent='Top 5 Leagues'; qpTopBtn.title='Select only the top 5 leagues'; }
  }

  selectedIdx = -1;
  updatePerfBanner();
  drawWheel();
}

/* ---------- Show-on-wheel defaults ---------- */
function applyModeShowControls(){
  if (MODE==='player'){
    lblA.textContent='Image';  optA.checked = true;
    lblB.textContent='Name';   optB.checked = false;
    if (lblC){ lblC.textContent='Jersey Number'; if (optC) optC.checked=false; }
    if (lblD){ lblD.textContent='Nationality';   if (optD) optD.checked=false; }
    if (lblE && optE){ lblE.textContent='Team';  optE.checked=false; }
  } else {
    lblA.textContent='Logo';   optA.checked = true;
    lblB.textContent='Name';   optB.checked = false;
    if (lblC){ lblC.textContent='Stadium'; if (optC) optC.checked=false; }
    if (lblD){ lblD.textContent='League';  if (optD) optD.checked=false; }
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
  const cx = (cr.left + cr.width/2) - wr.left;
  const cy = (cr.top  + cr.height/2) - wr.top;
  spinFab.style.left = `${cx}px`;
  spinFab.style.top  = `${cy}px`;
}

/* ---------- Wheel ---------- */
const PERF = { hideTextThreshold: 50, minTextWidth: 44, minLogoBox: 26 };

function drawIdle(ctx, W, H){
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);

  const r = Math.min(W, H) * 0.48;

  // Background disc gradient
  const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1, '#0B1B38');

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();

  // Subtle inner glow
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, 0, TAU);
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.fill();

  // Small sparkle ring
  ctx.save();
  ctx.rotate(currentAngle);
  const glowR = r * 0.82;
  for (let i = 0; i < 48; i++) {
    const a = (TAU / 48) * i;
    const x = Math.cos(a) * glowR;
    const y = Math.sin(a) * glowR;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, TAU);
    ctx.fillStyle = (i % 4 === 0)
      ? 'rgba(96,165,250,0.65)'
      : 'rgba(148,163,184,0.35)';
    ctx.fill();
  }
  ctx.restore();

  const mainLabel = (MODE === 'player')
    ? 'No players on the wheel'
    : 'No teams on the wheel';

  const subLabel = (MODE === 'player')
    ? 'Select at least one team on the left to start spinning.'
    : 'Select at least one league on the left to start spinning.';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '700 22px Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(248,250,252,0.96)';
  ctx.fillText(mainLabel, 0, -10);

  ctx.font = '400 15px Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.fillText(subLabel, 0, 18);

  ctx.restore();
}

function drawTickRing(ctx, R, ticks=120){
  ctx.save();
  ctx.rotate(mod(currentAngle, TAU));
  const h = Math.max(6, R*0.02);
  for(let i=0;i<ticks;i++){
    const a = i*(TAU/ticks);
    const x = Math.cos(a)*(R-h/2);
    const y = Math.sin(a)*(R-h/2);
    ctx.save(); ctx.translate(x,y); ctx.rotate(a);
    ctx.fillStyle = (i%5===0) ? 'rgba(200,220,255,.22)' : 'rgba(200,220,255,.12)';
    ctx.fillRect(-1,-h/2,2,h);
    ctx.restore();
  }
  ctx.restore();
}

function fitSingleLine(ctx, text, {maxWidth, targetPx}){
  let size = targetPx;
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  let width = ctx.measureText(text).width;
  if (width <= maxWidth) return { text, fontPx:size };
  while (size > 10 && width > maxWidth){
    size -= 1;
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    width = ctx.measureText(text).width;
  }
  if (width > maxWidth){
    while (text.length > 3 && width > maxWidth){
      text = text.slice(0,-1);
      width = ctx.measureText(text + '…').width;
    }
    text = text + '…';
  }
  return { text, fontPx:size };
}

function drawWheel(){
  const data = getCurrentData();
  const N = data.length;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR, H = wheel.height / DPR;

  updatePerfBanner();

  if (N === 0) {
    drawIdle(ctx, W, H);
    return;
  }

  const hideAll   = N >= PERF.hideTextThreshold;
  const noContent = !optA.checked && !optB.checked;

  ctx.imageSmoothingEnabled = !hideAll;
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);
  ctx.rotate(mod(currentAngle,TAU));

  const r     = Math.min(W,H)*0.48;
  const slice = TAU/N;

  // wedges
  for (let i=0;i<N;i++){
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,r,i*slice,(i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = getSliceColor(data[i].primary_color);
    ctx.fill();
  }

  if (noContent) {
    ctx.restore();
    const ctx2 = wheel.getContext('2d');
    ctx2.save();
    ctx2.translate(W/2,H/2);
    drawTickRing(ctx2, r*0.98, 120);
    ctx2.lineWidth = 1;
    for (let i=1;i<=4;i++){
      ctx2.beginPath();
      ctx2.arc(0,0,r*i/5,0,TAU);
      ctx2.strokeStyle = `rgba(140,170,220,${0.06 + i*0.02})`;
      ctx2.setLineDash([6,22]);
      ctx2.lineDashOffset = (i*10 + currentAngle*36)%1000;
      ctx2.stroke();
    }
    ctx2.restore();
    return;
  }

  // performance mode
  if (hideAll){
    ctx.restore();
    const ctx2 = wheel.getContext('2d');
    ctx2.save();
    ctx2.translate(W/2,H/2);
    drawTickRing(ctx2, r*0.98, Math.min(180, Math.max(100, Math.round(N/2))));
    ctx2.lineWidth=1;
    for(let i=1;i<=4;i++){
      ctx2.beginPath();
      ctx2.arc(0,0,r*i/5,0,TAU);
      ctx2.strokeStyle=`rgba(140,170,220,${0.06 + i*0.02})`;
      ctx2.setLineDash([6,22]);
      ctx2.lineDashOffset = (i*10 + currentAngle*36)%1000;
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
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,r-1,a0,a1);
    ctx.closePath();
    ctx.clip();
    ctx.rotate(aMid);
    const needFlip = Math.cos(aMid) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    const logoSize = clamp(PERF.minLogoBox, 0.38*arcLen, 62);
    const logoHalf = logoSize/2;
    const pad      = 10;
    const xLogo    = sign * (r*0.74);
    const xText    = sign * (r*0.42);
    const logoInner= xLogo - sign*(logoHalf+pad);
    const maxWidth = Math.max(PERF.minTextWidth, Math.abs(logoInner - xText));

    const fg = textColorFor(t.primary_color);

    if (canName && maxWidth>=PERF.minTextWidth){
      const fit = fitSingleLine(ctx, t.team_name, {
        maxWidth,
        targetPx: Math.min(22, 0.22*arcLen)
      });
      ctx.textAlign='left';
      ctx.textBaseline='middle';
      ctx.font = `800 ${fit.fontPx}px Inter, system-ui, sans-serif`;
      ctx.strokeStyle='rgba(0,0,0,.35)';
      ctx.lineWidth=Math.max(1,Math.round(fit.fontPx/10));
      ctx.fillStyle=fg;
      const x = Math.min(xText, logoInner);
      ctx.strokeText(fit.text, x, 0);
      ctx.fillText(fit.text,   x, 0);
    }

    if (canLogoOrImg){
      ctx.save();
      ctx.translate(xLogo, 0);

      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf - 1, 0, TAU);
      ctx.clip();
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(-logoHalf, -logoHalf, logoHalf * 2, logoHalf * 2);

      const url = MODE === 'team' ? t.logo_url : t.image_url;
      const img = getImage(url, () => requestAnimationFrame(drawWheel));

      if (img && img.complete){
        const box = Math.max(4, 2 * (logoHalf - 1));
        const iw = img.naturalWidth  || box;
        const ih = img.naturalHeight || box;
        const s  = Math.min(box / iw, box / ih);
        ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
      } else {
        ctx.fillStyle = 'rgba(148,163,184,.6)';
        const ph = (logoHalf - 3) * 2;
        ctx.fillRect(-ph/2, -ph/2, ph, ph);
      }

      ctx.restore();
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

/* ---------- Analytics ---------- */
function track(eventName, params = {}) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    const base = { mode: MODE, screen: 'wheel' };
    window.gtag('event', eventName, { ...base, ...params });
    if (localStorage.debugFS === '1') {
      console.log('[GA4]', eventName, { ...base, ...params });
    }
  }
}

window.trackAffiliate = function(partner) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'affiliate_click', {
      partner: partner,
      mode: localStorage.getItem('fsMode') || 'team',
      page_location: window.location.href
    });
  }
};

/* ---------- Spin ---------- */
function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  track('spin_click', { items_available: data.length });

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

function showResult(idx){
  const data = getCurrentData();
  const item = data[idx];
  if (!item) return;

  if (MODE === 'team') {
    track('spin_result', {
      result_type: 'team',
      team_name: item.team_name || '(unknown)',
      league_code: item.league_code || '',
      stadium_present: !!item.stadium
    });
  } else {
    track('spin_result', {
      result_type: 'player',
      player_name: item.team_name || '(unknown)',
      club_id: String(item.club_id || ''),
      has_image: !!(item.image_url && !/placeholder\.png$/i.test(item.image_url)),
      nationality: item.nationality || '',
      jersey: item.jersey || ''
    });
  }

  const bucket = getHistoryBucket(MODE);
  bucket.unshift(item);
  if (bucket.length > 50) bucket.length = 50;
  saveHistory();
  renderHistory();

  lastQuizItem = item;
  openModal(item);

  // Load AI quiz in real time (if enabled)
  if (AI_QUIZ_ENABLED) {
    loadQuizForItem(item);
  } else if (quizContainer) {
    quizContainer.hidden = true;
  }
}

/* ---------- History ---------- */
function renderHistory(){
  historyEl.innerHTML = '';
  const bucket = getHistoryBucket(MODE);

  if (!bucket.length){
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = 'Your journey starts with a spin!';
    historyEl.appendChild(empty);
    return;
  }

  bucket.forEach(item => {
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
    span.textContent = item.team_name || (MODE === 'player' ? 'Player' : 'Team');

    div.append(img, span);
    historyEl.append(div);
  });
}

/* ---------- Reveal helpers (Show buttons) ---------- */
function ensureRevealStyles(){
  if (document.getElementById('reveal-style')) return;
  const s=document.createElement('style'); s.id='reveal-style';
  s.textContent = `
    .reveal-wrap{
      position:relative;
      display:inline-block;
      vertical-align:middle;
    }
    .reveal-overlay{
      position:absolute; inset:0; border-radius:inherit;
      background:rgba(10,16,32,.28);
      backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
      pointer-events:none;
    }
    .reveal-btn{
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      padding:8px 14px; border-radius:999px;
      border:1px solid rgba(90,161,255,.6);
      background:#152036; color:#fff; font-weight:800; letter-spacing:.02em;
      white-space:nowrap; z-index:3; box-shadow:0 6px 18px rgba(34,211,238,.18);
      text-transform:none;
    }
    .reveal-btn:hover{ transform:translate(-50%,-50%) scale(1.03); }
  `;
  document.head.appendChild(s);
}
function wrap(el){
  if (!el) return null;
  if (el.parentElement && el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const w=document.createElement('span'); w.className='reveal-wrap';
  el.parentElement.insertBefore(w, el); w.appendChild(el); return w;
}
function blurEl(el){
  if(!el) return;
  const w = wrap(el);
  el.style.filter='blur(14px)';
  if(!w.querySelector('.reveal-overlay')){
    const o=document.createElement('span'); o.className='reveal-overlay'; w.appendChild(o);
  }
}
function unblurEl(el){
  if(!el) return;
  const w=el.parentElement;
  el.style.filter='';
  const o=w && w.querySelector('.re
veal-overlay'); if(o) o.remove();
  const b=w && w.querySelector('.reveal-btn'); if(b) b.remove();
}
function addReveal(key, el, enabled, label){
  ensureRevealStyles();
  const w = wrap(el);
  const prior = w.querySelector('.reveal-btn'); if (prior) prior.remove();

  if (enabled || modalReveal[key]){ unblurEl(el); return; }

  blurEl(el);
  const b=document.createElement('button'); b.type='button'; b.className='reveal-btn'; b.textContent=`Show ${label}`;
  b.onclick=()=>{ modalReveal[key]=true; track('reveal_click', { field: label }); unblurEl(el); };
  w.appendChild(b);
}

/* ---------- Modal ---------- */
function openModal(item){
  ensureRevealStyles();
  modalReveal = {a:false,b:false,c:false,d:false,e:false};

  const showRow = (rowEl, on) => {
    if (!rowEl) return;
    if (on) { rowEl.hidden = false; rowEl.style.display = ''; }
    else    { rowEl.hidden = true;  rowEl.style.display = 'none'; }
  };

  if (MODE === 'player') {
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = '';
    mLogo.src = item.image_url || '';

    showRow(rowStadium, false);
    showRow(rowClub,    true);
    showRow(rowJersey,  true);
    showRow(rowNat,     true);

    mClub.textContent   = CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_TEAMS[String(item.club_id)] || '—';
    mJersey.textContent = item.jersey ? `#${item.jersey}` : '—';
    mNat.textContent    = item.nationality || '—';

    addReveal('a', mLogo, !!optA.checked, 'image');
    addReveal('b', mHead, !!optB.checked, 'name');
    if (optC) addReveal('c', mJersey, !!optC.checked, 'jersey number');
    if (optD) addReveal('d', mNat,    !!optD.checked, 'nationality');
    if (optE) addReveal('e', mClub,   !!optE.checked, 'team');

  } else {
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = leagueLabel(item.league_code) || '';
    mLogo.src = item.logo_url || '';

    showRow(rowStadium, true);
    showRow(rowClub,    false);
    showRow(rowJersey,  false);
    showRow(rowNat,     false);

    mStadium.textContent = item.stadium || '—';

    addReveal('a', mLogo,   !!optA.checked, 'logo');
    addReveal('b', mHead,   !!optB.checked, 'name');
    if (optC) addReveal('c', mStadium, !!optC.checked, 'stadium');
    if (optD) addReveal('d', mSub,     !!optD.checked, 'league');
  }

  // If quiz disabled, keep block hidden
  if (quizContainer && !AI_QUIZ_ENABLED) {
    quizContainer.hidden = true;
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}

function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=>backdrop.style.display='none', 150);
}

/* ---------- FIRST init IIFE (kept as-is) ---------- */
(async function init(){
  try{
    await loadTeams();
    await loadPlayers();
  } catch (e){
    console.error('Failed to load data:', e);
  }

  setMode(MODE);
  renderHistory();

  sizeCanvas();
  positionSpinFab();
  wire();
})();

/* ---------- Mode switch ---------- */
function setMode(next){
  MODE = (next === 'player') ? 'player' : 'team';
  localStorage.setItem('fsMode', MODE);

  const filterTitleEl = document.getElementById('filter-title');
  if (MODE === 'player') {
    filterTitleEl && (filterTitleEl.textContent = 'Select Teams');
    if (qpAll){ qpAll.textContent = 'All Premier League teams'; qpAll.title = 'Select all Premier League teams'; }
    if (qpTopBtn){ qpTopBtn.textContent = 'Top 6 Premier League Teams'; qpTopBtn.title = 'Select the Big Six from the Premier League'; }
  } else {
    filterTitleEl && (filterTitleEl.textContent = 'Select Leagues');
    if (qpAll){ qpAll.textContent = 'All Leagues'; qpAll.title = 'Select all leagues'; }
    if (qpTopBtn){ qpTopBtn.textContent = 'Top 5 Leagues'; qpTopBtn.title = 'Select only the top 5 leagues'; }
  }

  applyModeShowControls();
  renderChips();
  renderHistory();

  // hide quiz when switching mode until next spin
  if (quizContainer) {
    quizContainer.hidden = true;
  }

  track('mode_set', { mode_after: MODE });
}

/* ---------- Loaders ---------- */
async function loadTeams(){
  const res = await fetch('./teams.json?v='+Date.now());
  if (!res.ok) throw new Error('teams.json not found');
  const raw = await res.json();

  TEAMS = (raw || []).map(t => {
    let primary = t.primary_color || '#020617';
    if (!/^#?[0-9a-f]{6}$/i.test(primary)) {
      primary = '#020617';
    } else if (!primary.startsWith('#')) {
      primary = `#${primary}`;
    }
    return {
      ...t,
      stadium: t.stadium || '',
      primary_color: primary
    };
  });

  TEAM_BY_ID.clear();
  CLUB_BY_ID.clear();

  for (const t of TEAMS){
    const id = String(t.team_id);
    TEAM_BY_ID.set(id, t);
    CLUB_BY_ID.set(id, t.team_name);
  }
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

  for (const id of new Set(PLAYERS.map(p=>String(p.club_id)))){
    if (!CLUB_BY_ID.has(id)) CLUB_BY_ID.set(id, FALLBACK_TEAMS[id] || `Team #${id}`);
  }
}

async function loadClubKnowledge() {
  try {
    const res = await fetch('/data/club_knowledge.normalized.json', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('club_knowledge.normalized.json not found');
    }

    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : [];
    CLUB_KNOWLEDGE = arr;

    CLUB_KNOWLEDGE_BY_NAME.clear();
    CLUB_KNOWLEDGE_BY_LEAGUE_AND_NAME.clear();
    CLUB_FACTS = [];

    arr.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;

      const clubName =
        (entry.club || entry.team_name || entry.name || '').trim();
      if (!clubName) return;

      const league =
        (entry.league_code || entry.league || '').toUpperCase();

      const keyName = clubName.toLowerCase();
      CLUB_KNOWLEDGE_BY_NAME.set(keyName, entry);

      if (league) {
        const k = league + '|' + keyName;
        CLUB_KNOWLEDGE_BY_LEAGUE_AND_NAME.set(k, entry);
      }

      const label = clubName;
      const pushFacts = list => {
        if (!Array.isArray(list)) return;
        list.forEach(txt => {
          const s = (txt || '').toString().trim();
          if (!s) return;
          CLUB_FACTS.push({ club: label, league, text: s });
        });
      };

      pushFacts(entry.trivia);
      pushFacts(entry.fan_culture);
      pushFacts(entry.iconic_seasons);
      pushFacts(entry.famous_wins);
      pushFacts(entry.heartbreaking_moments);
    });

    if (localStorage.debugFS === '1') {
      console.log('[quiz] Loaded club knowledge entries:', CLUB_KNOWLEDGE.length);
      console.log('[quiz] Total facts available:', CLUB_FACTS.length);
    }
  } catch (e) {
    console.warn('Failed to load club knowledge:', e);
    CLUB_KNOWLEDGE = [];
    CLUB_FACTS = [];
  }
}

/* ---------- AI QUIZ HELPERS (client-side, using club_knowledge) ---------- */

function resetQuizUI() {
  if (!quizContainer) return;
  quizContainer.hidden = false;
  if (quizQuestion) quizQuestion.textContent = '';
  if (quizAnswers)  quizAnswers.innerHTML = '';
  if (quizFeedback) quizFeedback.textContent = '';
}

function updateQuizMeta() {
  if (!quizProgress && !quizScore) return;
  const maxRounds = aiQuizRounds?.value || 'endless';

  if (quizProgress) {
    if (maxRounds === 'endless') {
      quizProgress.textContent = quizRoundsPlayed
        ? `Round ${quizRoundsPlayed}`
        : '';
    } else {
      quizProgress.textContent = quizRoundsPlayed
        ? `Question ${quizRoundsPlayed} of ${maxRounds}`
        : `Up to ${maxRounds} questions`;
    }
  }

  if (quizScore) {
    quizScore.textContent = quizRoundsPlayed
      ? `Score: ${quizCorrectCount}/${quizRoundsPlayed}`
      : '';
  }
}

function getQuizContextForItem(item) {
  if (MODE === 'player') {
    return {
      kind: 'player',
      name: item.team_name || '',
      clubName: CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_TEAMS[String(item.club_id)] || '',
      league: 'EPL',
      nationality: item.nationality || '',
      jersey: item.jersey || ''
    };
  }
  return {
    kind: 'club',
    name: item.team_name || '',
    leagueCode: item.league_code || '',
    leagueName: leagueLabel(item.league_code) || '',
    stadium: item.stadium || ''
  };
}

function findKnowledgeEntryForItem(item) {
  const ctx = getQuizContextForItem(item);
  let clubName = ctx.kind === 'player'
    ? ctx.clubName
    : ctx.name;

  clubName = (clubName || '').trim();
  if (!clubName) return null;

  const keyName = clubName.toLowerCase();
  const league = (ctx.leagueCode || ctx.league || 'EPL').toUpperCase();

  let entry = CLUB_KNOWLEDGE_BY_LEAGUE_AND_NAME.get(league + '|' + keyName) || null;
  if (!entry) entry = CLUB_KNOWLEDGE_BY_NAME.get(keyName) || null;
  return entry;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildQuestionFromKnowledge(item, entry) {
  const ctx = getQuizContextForItem(item);
  const clubName = ctx.kind === 'player' ? ctx.clubName : ctx.name;
  const leagueName = ctx.leagueName || leagueLabel(ctx.leagueCode || 'EPL');

  const collectFacts = e => {
    const out = [];
    const push = list => {
      if (!Array.isArray(list)) return;
      list.forEach(txt => {
        const s = (txt || '').toString().trim();
        if (s) out.push(s);
      });
    };
    push(e.trivia);
    push(e.fan_culture);
    push(e.iconic_seasons);
    push(e.famous_wins);
    push(e.heartbreaking_moments);
    return out;
  };

  const ownFacts = collectFacts(entry);
  const ownFact = ownFacts.length
    ? ownFacts[Math.floor(Math.random() * ownFacts.length)]
    : null;

  if (!ownFact && clubName && leagueName) {
    const q = `Which league does ${clubName} currently play in?`;
    const answers = [leagueName];
    const allLeagueNames = Object.values(LEAGUE_LABELS);
    shuffleInPlace(allLeagueNames);
    for (const name of allLeagueNames) {
      if (answers.length >= 4) break;
      if (name === leagueName) continue;
      if (!answers.includes(name)) answers.push(name);
    }
    shuffleInPlace(answers);
    const correctIndex = answers.indexOf(leagueName);
    return { question: q, answers, correctIndex };
  }

  if (!ownFact) {
    return null;
  }

  const wrongFactsPool = CLUB_FACTS.filter(f => f.club !== clubName);
  shuffleInPlace(wrongFactsPool);
  const wrong = wrongFactsPool.slice(0, 3).map(f => f.text);
  const answers = [ownFact, ...wrong];
  shuffleInPlace(answers);
  const correctIndex = answers.indexOf(ownFact);

  const q = `Which of these facts is true about ${clubName}?`;

  return {
    question: q,
    answers,
    correctIndex
  };
}

async function loadQuizForItem(item) {
  if (!quizContainer || !quizQuestion || !quizAnswers) return;

  resetQuizUI();

  if (!CLUB_KNOWLEDGE.length) {
    await loadClubKnowledge();
  }

  const ctx = getQuizContextForItem(item);
  const difficulty = aiQuizDifficulty?.value || 'auto';
  const category   = aiQuizCategory?.value || 'mixed';

  track('quiz_request', {
    difficulty,
    category,
    kind: ctx.kind,
    name: ctx.name || ctx.clubName || '',
    league: ctx.leagueName || ctx.leagueCode || ctx.league || ''
  });

  quizQuestion.textContent = 'Loading quiz question...';
  if (quizFeedback) {
    quizFeedback.textContent = '';
  }

  let entry = findKnowledgeEntryForItem(item);

  if (!entry && CLUB_KNOWLEDGE.length) {
    entry = CLUB_KNOWLEDGE[Math.floor(Math.random() * CLUB_KNOWLEDGE.length)];
  }
  if (!entry) {
    quizQuestion.textContent = 'No quiz data available for this club yet.';
    quizAnswers.innerHTML = '';
    if (quizFeedback) quizFeedback.textContent = 'Spin again or disable the quiz.';
    track('quiz_error', { message: 'no_entry_for_club' });
    return;
  }

  const quiz = buildQuestionFromKnowledge(item, entry);
  if (!quiz || !Array.isArray(quiz.answers) || typeof quiz.correctIndex !== 'number') {
    quizQuestion.textContent = 'Could not create a valid question.';
    quizAnswers.innerHTML = '';
    if (quizFeedback) quizFeedback.textContent = 'Try spinning again.';
    track('quiz_error', { message: 'build_question_failed' });
    return;
  }

  quizRoundsPlayed += 1;
  currentQuiz = quiz;
  updateQuizMeta();

  renderQuiz(quiz);

  if (quizFeedback) {
    quizFeedback.textContent = 'Pick one answer to see if you’re right.';
  }
}

function renderQuiz(quiz) {
  if (!quizContainer || !quizQuestion || !quizAnswers) return;
  quizContainer.hidden = false;
  quizQuestion.textContent = quiz.question || '';

  quizAnswers.innerHTML = '';
  quiz.answers.forEach((answerText, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiz-answer chip-btn';
    btn.textContent = answerText;
    btn.addEventListener('click', () => handleQuizAnswerClick(i));
    quizAnswers.appendChild(btn);
  });
}

function handleQuizAnswerClick(index) {
  if (!currentQuiz) return;
  const correct = index === currentQuiz.correctIndex;
  const buttons = quizAnswers?.querySelectorAll('.quiz-answer') || [];

  buttons.forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('quiz-correct', 'quiz-wrong');
    if (i === currentQuiz.correctIndex) {
      btn.classList.add('quiz-correct');
    } else if (i === index && !correct) {
      btn.classList.add('quiz-wrong');
    }
  });

  if (correct) {
    quizCorrectCount += 1;
  }
  updateQuizMeta();

  if (quizFeedback) {
    quizFeedback.textContent = correct
      ? 'Correct! Nicely done.'
      : 'Not quite. The correct answer is highlighted.';
  }

  track('quiz_answer', {
    correct,
    picked_index: index,
    correct_index: currentQuiz.correctIndex
  });
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
    track('quickpick', { pick: (MODE==='player' ? 'all_pl_teams' : 'all_leagues') });
  });
  qpNone && (qpNone.onclick = () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; });
    selectedIdx=-1; updatePerfBanner(); drawWheel();
    track('quickpick', { pick: 'clear' });
  });
  qpTopBtn && (qpTopBtn.onclick = () => {
    if (MODE==='player'){
      const allow = new Set(PL_TOP6);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
      track('quickpick', { pick: 'top6_pl' });
    } else {
      const allow = new Set(TOP5);
      chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = allow.has(i.value); });
      track('quickpick', { pick: 'top5_leagues' });
    }
    selectedIdx=-1; updatePerfBanner(); drawWheel();
  });

  const refresh = ()=>{ if (!spinning){ selectedIdx=-1; drawWheel(); } };
  optA.addEventListener('change', ()=>{ refresh(); track('show_option_toggled', { option: (MODE==='player'?'image':'logo'), enabled: !!optA.checked }); });
  optB.addEventListener('change', ()=>{ refresh(); track('show_option_toggled', { option: 'name', enabled: !!optB.checked }); });
  optC?.addEventListener('change', ()=>{ refresh(); track('show_option_toggled', { option: (MODE==='player'?'jersey':'stadium'), enabled: !!optC.checked }); });
  optD?.addEventListener('change', ()=>{ refresh(); track('show_option_toggled', { option: (MODE==='player'?'nationality':'league'), enabled: !!optD.checked }); });
  optE?.addEventListener('change', ()=>{ refresh(); track('show_option_toggled', { option: 'team_label', enabled: !!optE.checked }); });

  spinBtn && (spinBtn.onclick = spin);
  spinFab && (spinFab.onclick = spin);

  resetHistoryBtn && (resetHistoryBtn.onclick = ()=>{
    const bucket = getHistoryBucket(MODE);
    bucket.length = 0;
    saveHistory();
    renderHistory();
    track('history_cleared', { mode: MODE });
  });

  mClose && (mClose.onclick = ()=> { if (!spinning){ closeModal(); track('modal_close'); } });
  backdrop && backdrop.addEventListener('click', e=>{ if (!spinning && e.target===backdrop){ closeModal(); track('modal_close_backdrop'); }});
  window.addEventListener('keydown', e=> { if (e.key==='Escape' && !spinning){ closeModal(); track('modal_close_escape'); }});

  // AI mode toggle (sidebar)
  if (aiQuizToggle) {
    AI_QUIZ_ENABLED = aiQuizToggle.checked;
    aiQuizToggle.addEventListener('change', () => {
      AI_QUIZ_ENABLED = aiQuizToggle.checked;
      if (!AI_QUIZ_ENABLED && quizContainer) {
        quizContainer.hidden = true;
      }
      if (AI_QUIZ_ENABLED) {
        // fresh session
        quizRoundsPlayed = 0;
        quizCorrectCount = 0;
        if (quizProgress) quizProgress.textContent = '';
        if (quizScore) quizScore.textContent = '';
      }
      track('quiz_toggle', { enabled: AI_QUIZ_ENABLED });
    });
  }

  // Quiz next / end
  if (quizNextBtn) {
    quizNextBtn.addEventListener('click', () => {
      if (!AI_QUIZ_ENABLED || !lastQuizItem) return;
      const maxRounds = aiQuizRounds?.value || 'endless';
      if (maxRounds !== 'endless' && quizRoundsPlayed >= parseInt(maxRounds, 10)) {
        if (quizFeedback) {
          quizFeedback.textContent = 'Quiz finished — change rounds or spin again to restart.';
        }
        return;
      }
      resetQuizUI();
      loadQuizForItem(lastQuizItem);
      track('quiz_next', { rounds_played: quizRoundsPlayed });
    });
  }

  if (quizEndBtn) {
    quizEndBtn.addEventListener('click', () => {
      if (quizContainer) {
        quizContainer.hidden = true;
      }
      track('quiz_end', {
        rounds_played: quizRoundsPlayed,
        correct: quizCorrectCount
      });
    });
  }

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

  setMode(MODE);
  renderHistory();

  sizeCanvas();
  positionSpinFab();
  wire();
})();

/* Football Spinner — TEAM / PLAYER unified
   - TEAM defaults: Premier League selected; Show on Wheel = Logo only.
   - PLAYER defaults: only Arsenal selected; Show on Wheel = Image only; “All Premier League teams” quick-pick.
   - PLAYER: exclude players without a usable image (incl. placeholder.png) from the wheel.
   - PL Top-6 sorted first alphabetically.
   - History stored per item with type {type:'team'|'player', item:{…}} and rendered per active mode.
   - Modal: clean layout + modern “Show …” reveal buttons (centered over blurred element).
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

/* AI Quiz DOM */
const aiQuizToggle      = document.getElementById('aiQuizToggle');
const aiQuizDifficulty  = document.getElementById('aiQuizDifficulty');
const aiQuizCategory    = document.getElementById('aiQuizCategory');
const aiQuizRounds      = document.getElementById('aiQuizRounds');

const quizContainer     = document.getElementById('quizContainer');
const quizQuestionEl    = document.getElementById('quizQuestion');
const quizAnswersWrap   = document.getElementById('quizAnswers');
const quizAnswerButtons = quizAnswersWrap ? Array.from(quizAnswersWrap.querySelectorAll('.quiz-answer')) : [];
const quizFeedbackEl    = document.getElementById('quizFeedback');
const quizProgressEl    = document.getElementById('quizProgress');
const quizScoreEl       = document.getElementById('quizScore');
const quizNextBtn       = document.getElementById('quizNextBtn');
const quizEndBtn        = document.getElementById('quizEndBtn');

/* Reveal state (global) */
let modalReveal = { a:false, b:false, c:false, d:false, e:false };

/* AI Quiz state */
const aiQuizState = {
  enabled: false,
  difficulty: 'auto',
  category: 'mixed',
  roundsMode: 'endless',
  totalAsked: 0,
  totalCorrect: 0,
  currentItem: null, // { item, mode }
  locked: false
};

(function initAiQuizFromStorage(){
  if (!aiQuizToggle) return;
  try {
    aiQuizState.enabled    = localStorage.getItem('fsAiQuizEnabled') === '1';
    aiQuizState.difficulty = localStorage.getItem('fsAiQuizDifficulty') || 'auto';
    aiQuizState.category   = localStorage.getItem('fsAiQuizCategory') || 'mixed';
    aiQuizState.roundsMode = localStorage.getItem('fsAiQuizRounds') || 'endless';
  } catch(e){}

  aiQuizToggle.checked = aiQuizState.enabled;
  if (aiQuizDifficulty) aiQuizDifficulty.value = aiQuizState.difficulty;
  if (aiQuizCategory)   aiQuizCategory.value   = aiQuizState.category;
  if (aiQuizRounds)     aiQuizRounds.value     = aiQuizState.roundsMode;

  if (quizContainer) quizContainer.hidden = !aiQuizState.enabled;
})();

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

/* Small random helpers for quiz */
function randInt(max){ return Math.floor(Math.random() * max); }
function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sampleFrom(arr, excludeSet, count){
  const pool = arr.filter(v => !excludeSet.has(v));
  const out = [];
  while (pool.length && out.length < count){
    const idx = randInt(pool.length);
    out.push(pool.splice(idx,1)[0]);
  }
  return out;
}

/* Normalize quiz answers to 4 slots (hide extra buttons if empty) */
function normalizeAnswersForUi(q){
  const ans = Array.isArray(q.answers) ? q.answers.slice(0,4) : [];
  while (ans.length < 4) ans.push('');
  q.answers = ans;
  if (q.correctIndex == null || q.correctIndex < 0 || q.correctIndex > 3){
    q.correctIndex = 0;
  }
  return q;
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

  // hide SPIN buttons if no leagues/teams are selected
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

  // Text depending on mode
  const mainLabel = (MODE === 'player')
    ? 'No players on the wheel'
    : 'No teams on the wheel';

  const subLabel = (MODE === 'player')
    ? 'Select at least one team on the left to start spinning.'
    : 'Select at least one league on the left to start spinning.';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Main text
  ctx.font = '700 22px Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(248,250,252,0.96)';
  ctx.fillText(mainLabel, 0, -10);

  // Sub text
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

  // 0 teams/leagues selected → full idle graphic
  if (N === 0) {
    drawIdle(ctx, W, H);
    return;
  }

  const hideAll   = N >= PERF.hideTextThreshold;
  const noContent = !optA.checked && !optB.checked;   // nothing to render on slices

  ctx.imageSmoothingEnabled = !hideAll;
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);
  ctx.rotate(mod(currentAngle,TAU));

  const r     = Math.min(W,H)*0.48;
  const slice = TAU/N;

  // --- wedges ---
  for (let i=0;i<N;i++){
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,r,i*slice,(i+1)*slice);
    ctx.closePath();
    ctx.fillStyle = getSliceColor(data[i].primary_color);
    ctx.fill();
  }

  // If there is NOTHING to show (A+B off), overlay tick rings and stop.
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

  // Many slices → performance mode
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

  // --- slice contents (logos/names) ---
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

      // outer soft ring
      ctx.beginPath();
      ctx.arc(0, 0, logoHalf, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.stroke();

      // inner disc (light grey background for logo)
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

      ctx.restore(); // inner disc
      ctx.restore(); // logo transform
    }

    ctx.restore(); // slice clip
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
  const o=w && w.querySelector('.reveal-overlay'); if(o) o.remove();
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

    // stadium is read directly from teams.json
    mStadium.textContent = item.stadium || '—';

    addReveal('a', mLogo,   !!optA.checked, 'logo');
    addReveal('b', mHead,   !!optB.checked, 'name');
    if (optC) addReveal('c', mStadium, !!optC.checked, 'stadium');
    if (optD) addReveal('d', mSub,     !!optD.checked, 'league');
  }

  // reset / keep quiz UI visibility (question will be set separately)
  if (quizContainer && !aiQuizState.enabled) {
    quizContainer.hidden = true;
  }

  backdrop.style.display='flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}

function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=>backdrop.style.display='none', 150);
}

/* ---------- AI Quiz: Question Generation ---------- */

function makeTeamQuizQuestion(item){
  const leagueName = leagueLabel(item.league_code);
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const allLeagueNames = [...new Set(allCodes.map(c => leagueLabel(c)))];

  const hasStadium = !!item.stadium;
  let qType = 'league';

  if (aiQuizState.category === 'club') {
    qType = hasStadium ? 'stadium' : 'league';
  } else if (aiQuizState.category === 'history' || aiQuizState.category === 'fans') {
    qType = 'league';
  } else if (aiQuizState.category === 'mixed') {
    if (hasStadium && Math.random() < 0.5) qType = 'stadium';
    else qType = 'league';
  } else {
    qType = 'league';
  }

  // Stadium question
  if (qType === 'stadium' && hasStadium){
    const allStadiums = [...new Set(TEAMS.map(t => t.stadium).filter(Boolean))];
    const correct = item.stadium;
    const wrongs = sampleFrom(allStadiums, new Set([correct]), 3);
    const answers = shuffle([correct, ...wrongs]);
    return normalizeAnswersForUi({
      question: `What is ${item.team_name}'s home stadium?`,
      answers,
      correctIndex: answers.indexOf(correct)
    });
  }

  // Default league question
  const correct = leagueName;
  const wrongs = sampleFrom(allLeagueNames, new Set([correct]), 3);
  const answers = shuffle([correct, ...wrongs]);
  return normalizeAnswersForUi({
    question: `Which league do ${item.team_name} play in?`,
    answers,
    correctIndex: answers.indexOf(correct)
  });
}

function makePlayerQuizQuestion(item){
  const nat = item.nationality;
  const jersey = item.jersey;
  const clubName = CLUB_BY_ID.get(String(item.club_id)) || FALLBACK_TEAMS[String(item.club_id)] || '';

  let qType;
  if (aiQuizState.category === 'club') qType = 'club';
  else if (aiQuizState.category === 'player') qType = 'nat';
  else if (aiQuizState.category === 'manager') qType = 'club';
  else if (aiQuizState.category === 'history' || aiQuizState.category === 'fans') qType = 'nat';
  else qType = 'mixed';

  if (qType === 'mixed'){
    const candidates = [];
    if (nat) candidates.push('nat');
    if (jersey) candidates.push('jersey');
    if (clubName) candidates.push('club');
    qType = candidates.length ? candidates[randInt(candidates.length)] : 'nat';
  }

  // Club question
  if (qType === 'club' && clubName){
    const allClubs = [...new Set(Array.from(CLUB_BY_ID.values()))];
    const correct = clubName;
    const wrongs = sampleFrom(allClubs, new Set([correct]), 3);
    const answers = shuffle([correct, ...wrongs]);
    return normalizeAnswersForUi({
      question: `Which club does ${item.team_name} currently play for?`,
      answers,
      correctIndex: answers.indexOf(correct)
    });
  }

  // Jersey question
  if (qType === 'jersey' && jersey){
    const correct = `#${jersey}`;
    const numbersPool = [];
    for (let n = 1; n <= 99; n++) numbersPool.push(`#${n}`);
    const wrongs = sampleFrom(numbersPool, new Set([correct]), 3);
    const answers = shuffle([correct, ...wrongs]);
    return normalizeAnswersForUi({
      question: `What shirt number does ${item.team_name} wear?`,
      answers,
      correctIndex: answers.indexOf(correct)
    });
  }

  // Default nationality question
  const allNats = [...new Set(PLAYERS.map(p => p.nationality).filter(Boolean))];
  const correctNat = nat || 'Unknown';
  const wrongsNat = sampleFrom(allNats, new Set([correctNat]), 3);
  const answersNat = shuffle([correctNat, ...wrongsNat]);
  return normalizeAnswersForUi({
    question: `Which country does ${item.team_name} represent?`,
    answers: answersNat,
    correctIndex: answersNat.indexOf(correctNat)
  });
}

function makeQuizQuestionForItem(item, mode){
  if (mode === 'player') return makePlayerQuizQuestion(item);
  return makeTeamQuizQuestion(item);
}

function updateQuizScoreLabel(){
  if (!quizScoreEl) return;
  if (!aiQuizState.totalAsked) {
    quizScoreEl.textContent = '';
    return;
  }
  quizScoreEl.textContent = `Score: ${aiQuizState.totalCorrect}/${aiQuizState.totalAsked}`;
}

function updateQuizProgressLabel(){
  if (!quizProgressEl) return;
  if (!aiQuizState.enabled) {
    quizProgressEl.textContent = '';
    return;
  }
  const nextIndex = aiQuizState.totalAsked + 1;
  const limit = (aiQuizState.roundsMode === 'endless') ? null : parseInt(aiQuizState.roundsMode, 10);
  if (limit && !Number.isNaN(limit)){
    quizProgressEl.textContent = `Question ${nextIndex} of ${limit}`;
  } else {
    quizProgressEl.textContent = `Question ${nextIndex}`;
  }
}

function setupQuizQuestion(item, mode){
  if (!quizContainer || !quizQuestionEl || !quizAnswerButtons.length) return;
  const q = makeQuizQuestionForItem(item, mode);

  quizContainer.hidden = false;
  quizQuestionEl.textContent = q.question || '';
  if (quizFeedbackEl) quizFeedbackEl.textContent = '';
  updateQuizProgressLabel();

  quizAnswerButtons.forEach((btn, idx) => {
    const text = q.answers[idx] || '';
    btn.textContent = text;
    btn.dataset.correct = (idx === q.correctIndex && text) ? '1' : '0';
    btn.disabled = !text;
    btn.style.display = text ? '' : 'none';
    btn.classList.remove('quiz-answer-correct','quiz-answer-wrong','quiz-answer-selected');
  });

  if (quizNextBtn) quizNextBtn.disabled = true;
  aiQuizState.locked = false;
}

function handleQuizAfterSpin(item){
  if (!aiQuizState.enabled || !quizContainer) return;
  aiQuizState.currentItem = { item, mode: MODE };
  setupQuizQuestion(item, MODE);
}

/* ---------- AI Quiz: Answer handling ---------- */

function onQuizAnswerClick(e){
  if (!aiQuizState.enabled || aiQuizState.locked) return;
  const btn = e.currentTarget;
  if (!btn) return;

  aiQuizState.locked = true;
  const isCorrect = btn.dataset.correct === '1';

  aiQuizState.totalAsked += 1;
  if (isCorrect) aiQuizState.totalCorrect += 1;
  updateQuizScoreLabel();

  quizAnswerButtons.forEach(b => {
    const correct = b.dataset.correct === '1';
    b.disabled = true;
    b.classList.remove('quiz-answer-correct','quiz-answer-wrong','quiz-answer-selected');
    if (correct) b.classList.add('quiz-answer-correct');
    if (b === btn) {
      b.classList.add('quiz-answer-selected');
      if (!correct) b.classList.add('quiz-answer-wrong');
    }
  });

  if (quizFeedbackEl){
    quizFeedbackEl.textContent = isCorrect
      ? 'Correct! Nice one.'
      : 'Not quite – check the correct answer and try another question or spin again.';
  }
  if (quizNextBtn) quizNextBtn.disabled = false;

  track('quiz_answered', {
    correct: isCorrect,
    mode: MODE
  });
}

/* ---------- Result + History ---------- */
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
      player_name: item.team_name || '(unknown)', // player display name is kept in team_name field
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
  openModal(item);
  handleQuizAfterSpin(item);
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
  renderHistory();           // per-mode history

  track('mode_set', { mode_after: MODE });
}

/* ---------- Loaders ---------- */
async function loadTeams(){
  const res = await fetch('./teams.json?v='+Date.now());
  if (!res.ok) throw new Error('teams.json not found');
  const raw = await res.json();

  // teams.json is the single source of truth for stadium + primary_color
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

  let t;
  window.addEventListener('resize', ()=>{
    clearTimeout(t);
    t=setTimeout(()=>{ sizeCanvas(); positionSpinFab(); drawWheel(); },120);
  }, {passive:true});

  /* AI Quiz wiring */
  if (aiQuizToggle){
    aiQuizToggle.addEventListener('change', () => {
      aiQuizState.enabled = !!aiQuizToggle.checked;
      try { localStorage.setItem('fsAiQuizEnabled', aiQuizState.enabled ? '1' : '0'); } catch(e){}
      if (quizContainer) quizContainer.hidden = !aiQuizState.enabled;
      if (!aiQuizState.enabled){
        if (quizFeedbackEl) quizFeedbackEl.textContent = '';
        if (quizProgressEl) quizProgressEl.textContent = '';
      }
      track('quiz_toggle', { enabled: aiQuizState.enabled });
    });
  }
  if (aiQuizDifficulty){
    aiQuizDifficulty.addEventListener('change', () => {
      aiQuizState.difficulty = aiQuizDifficulty.value || 'auto';
      try { localStorage.setItem('fsAiQuizDifficulty', aiQuizState.difficulty); } catch(e){}
    });
  }
  if (aiQuizCategory){
    aiQuizCategory.addEventListener('change', () => {
      aiQuizState.category = aiQuizCategory.value || 'mixed';
      try { localStorage.setItem('fsAiQuizCategory', aiQuizState.category); } catch(e){}
    });
  }
  if (aiQuizRounds){
    aiQuizRounds.addEventListener('change', () => {
      aiQuizState.roundsMode = aiQuizRounds.value || 'endless';
      try { localStorage.setItem('fsAiQuizRounds', aiQuizState.roundsMode); } catch(e){}
    });
  }

  if (quizAnswerButtons.length){
    quizAnswerButtons.forEach(btn => {
      btn.addEventListener('click', onQuizAnswerClick);
    });
  }
  if (quizNextBtn){
    quizNextBtn.addEventListener('click', () => {
      if (!aiQuizState.enabled || !aiQuizState.currentItem) return;
      setupQuizQuestion(aiQuizState.currentItem.item, aiQuizState.currentItem.mode);
      track('quiz_next_question', { mode: MODE });
    });
  }
  if (quizEndBtn){
    quizEndBtn.addEventListener('click', () => {
      aiQuizState.totalAsked = 0;
      aiQuizState.totalCorrect = 0;
      aiQuizState.currentItem = null;
      aiQuizState.locked = false;
      if (quizContainer) quizContainer.hidden = true;
      if (quizScoreEl) quizScoreEl.textContent = '';
      if (quizProgressEl) quizProgressEl.textContent = '';
      if (quizFeedbackEl) quizFeedbackEl.textContent = 'Quiz ended. Enable AI Quiz again when you want a new round.';
      track('quiz_end', { mode: MODE });
    });
  }
}

/* ---------- Boot ---------- */
(async function init(){
  try{
    await loadTeams();   // stadium + primary_color from teams.json
    await loadPlayers(); // players inherit primary_color from TEAM_BY_ID
  } catch (e){
    console.error('Failed to load data:', e);
  }

  setMode(MODE);      // apply initial mode + UI
  renderHistory();    // per-mode history

  sizeCanvas();
  positionSpinFab();
  wire();
})();

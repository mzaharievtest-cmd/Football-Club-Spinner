/* Football Club Spinner — unified TEAM/PLAYER app.js
   - TEAM mode: league chips (Top 5 + more)
   - PLAYER mode: Premier League team chips (Top 6 + more), slices show player image/name
   - >50 selected players auto-hide labels for legibility
   - Modal shows club; in PLAYER mode also shows nationality / jersey as separate, toggle-controlled
*/

/* ───────────────────────── State ───────────────────────── */
let TEAMS = [];
let PLAYERS = [];
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

let lastModalItem = null; // team or player for the modal
let modalRevealState = { logo: false, name: false, subA: false, subB: false };

/* ───────────────────────── DOM ───────────────────────── */
const chipsWrap   = document.getElementById('chips');
const chipsTop    = document.getElementById('chipsTop');
const chipsMore   = document.getElementById('chipsMore');
const toggleMore  = document.getElementById('toggleMore');

const spinBtn     = document.getElementById('spinBtn');
const spinFab     = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName     = document.getElementById('optName');   // TEAM: Name ; PLAYER: Name
const optLogo     = document.getElementById('optLogo');   // TEAM: Logo ; PLAYER: Image
const optStadium  = document.getElementById('optStadium');// TEAM: Stadium ; PLAYER: Nationality
const optLeague   = document.getElementById('optLeague'); // TEAM: League  ; PLAYER: Jersey

const lblName = document.getElementById('lblName');
const lblLogo = document.getElementById('lblLogo');
const lblSub1 = document.getElementById('lblSub1');
const lblSub2 = document.getElementById('lblSub2');

const perfTip     = document.getElementById('perfTip');
const historyEl   = document.getElementById('history');

const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const wheel = document.getElementById('wheel');
const fx    = document.getElementById('fx');

/* Modal */
const backdrop  = document.getElementById('backdrop');
const modalEl   = document.getElementById('modal');
const mClose    = document.getElementById('mClose');
const mHead     = document.getElementById('mHead');
const mSub      = document.getElementById('mSub');
const mLogo     = document.getElementById('mLogo');
const mStadium  = document.getElementById('mStadium'); // holds Stadium (team) OR (#/nation) (player)
const mFieldLbl = document.getElementById('mFieldLabel');

/* ───────────────────────── Utils ───────────────────────── */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod   = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold : 140,
  minTextWidth: 44,
  minLogoBox: 28
};

function normTeamLabel(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/football club|f\.?c\.?|a\.?f\.?c\.?/gi,'')
    .trim().toLowerCase();
}

function textColorFor(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '#fff';
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  const L = 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
  return L > 0.35 ? '#0b0f17' : '#fff';
}
function luminance(hex){
  if(!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return 0;
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return 0.2126*(r/255)**2.2 + 0.7152*(g/255)**2.2 + 0.0722*(b/255)**2.2;
}

/* single-line fit */
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx = 9, maxPx = 28, weight = 800, fontFamily = 'Inter, system-ui, sans-serif' }) {
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px ${fontFamily}`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };
  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated: false };
  }
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '') + '…', fontPx: minPx, truncated: true };
}

/* Images */
const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached) return cached.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => onLoad && onLoad();
  img.onerror = () => onLoad && onLoad();
  IMG_CACHE.set(url, { img });
  return img;
}

/* Public-path helpers for players */
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p;
}
function slugifyName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
const PLAYER_IMAGE_MAP = {};
function imageForPlayerName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return PLAYER_IMAGE_MAP[key];
  const slug = slugifyName(name);
  return `/players/${slug}.png`;
}

/* ─────────────────── Team/League data ─────────────────── */
const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga",
  BEL: "Jupiler Pro League",
  BUL: "efbet Liga",
  CRO: "SuperSport HNL",
  CZE: "Fortuna Liga",
  DEN: "Superliga",
  EPL: "Premier League",
  L1:  "Ligue 1",
  BUN: "Bundesliga",
  GRE: "Super League 1",
  ISR: "Ligat ha'Al",
  SA:  "Serie A",
  NED: "Eredivisie",
  NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa",
  POR: "Liga Portugal",
  ROU: "SuperLiga",
  RUS: "Premier Liga",
  SCO: "Scottish Premiership",
  SRB: "Super liga Srbije",
  LLA: "LaLiga",
  SWE: "Allsvenskan",
  SUI: "Super League",
  TUR: "Süper Lig",
  UKR: "Ukrainian Premier League",
  PLAYER: "Players"
};

const TOP5 = ['EPL','SA','BUN','L1','LLA'];
const TOP6_KEYS = ['manchester city','manchester united','liverpool','arsenal','tottenham hotspur','chelsea'];

/* ───────────────────── Chips UI ───────────────────── */
function makeChip(value, checked) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${value}" ${checked ? 'checked aria-checked="true"' : ''}>
    <span class="chip-text">${value}</span>
  `;
  return label;
}

function renderChipsForTeam() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => {
    const el = makeChip(code, code === 'EPL'); // EPL selected by default
    el.querySelector('.chip-text').textContent = LEAGUE_LABELS[code] || code;
    chipsTop.appendChild(el);
  });

  moreCodes.forEach(code => {
    const el = makeChip(code, false);
    el.querySelector('.chip-text').textContent = LEAGUE_LABELS[code] || code;
    chipsMore.appendChild(el);
  });

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded','false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');
}

function renderChipsForPlayer() {
  const clubs = new Map(); // key -> display label
  PLAYERS.forEach(p => {
    if (!p.club) return;
    const k = p.clubKey || normTeamLabel(p.club);
    if (!k || clubs.has(k)) return;
    clubs.set(k, p.club);
  });

  const top6 = TOP6_KEYS.filter(k => clubs.has(k));
  const rest = [...clubs.keys()].filter(k => !top6.includes(k))
    .sort((a,b) => clubs.get(a).localeCompare(clubs.get(b)));

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  top6.forEach(k => {
    const el = makeChip(k, true);
    el.querySelector('.chip-text').textContent = clubs.get(k);
    chipsTop.appendChild(el);
  });

  rest.forEach(k => {
    const el = makeChip(k, false);
    el.querySelector('.chip-text').textContent = clubs.get(k);
    chipsMore.appendChild(el);
  });

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more Premier League clubs';
  toggleMore.setAttribute('aria-expanded','false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');
}

function visibleCodes() {
  const codes = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) {
    codes.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  }
  return codes;
}

function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
  updateSelectionBanner();
}

/* ───────────────────── Data select ───────────────────── */
function getCurrentData() {
  const active = Array.from(document.querySelectorAll('#chips input:checked')).map(i => i.value);

  if (MODE === 'player') {
    if (!PLAYERS.length) return [];
    if (!active.length) return PLAYERS; // All players if none checked

    const set = new Set(active.map(normTeamLabel));
    return PLAYERS.filter(p => {
      if (p.team_id && set.has(String(p.team_id))) return true; // (future-proof)
      return set.has(p.clubKey);
    });
  }

  // TEAM mode: league chips
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
}

function updateSelectionBanner() {
  const N = getCurrentData().length;
  perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
  const maxRef = MODE === 'player' ? 600 : 120; // animate bar
  perfTip.style.setProperty('--pct', Math.min(1, N / maxRef));
}

/* ───────────────────── History ───────────────────── */
function saveHistory(){ localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory(){ history = []; saveHistory(); renderHistory(); }
function renderHistory(){
  historyEl.innerHTML = '';
  if (history.length === 0) {
    historyEl.setAttribute('aria-live','polite');
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url || item.image_url || '';
    i.alt = (item.team_name || item.name || 'Item');
    i.onerror = () => { i.src = ''; i.alt = 'No image'; };
    const s = document.createElement('span');
    const subtitle = (MODE === 'player')
      ? (item.club ? ` (${item.club})` : '')
      : (` (${LEAGUE_LABELS[item.league_code] || item.league_code})`);
    s.textContent = `${item.team_name || item.name}${subtitle}`;
    div.append(i, s);
    historyEl.append(div);
  });
}

/* ───────────────────── Modal (reveal) ───────────────────── */
function ensureRevealStyles() {
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;margin-left:10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;z-index:3;position:relative;white-space:nowrap}
    #mHead + .reveal-btn{display:inline-block;margin-left:0}
    .reveal-wrap{position:relative;display:inline-block;z-index:0}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none;z-index:2}
  `;
  document.head.appendChild(s);
}
function removeExistingRevealBtn(id){ const old=document.getElementById(id); if(old) old.remove(); }
function ensureWrapped(el){
  if(!el||!el.parentElement) return null;
  if(el.parentElement.classList.contains('reveal-wrap')) return el.parentElement;
  const wrap=document.createElement('span');
  wrap.className='reveal-wrap';
  el.parentElement.insertBefore(wrap, el);
  wrap.appendChild(el);
  return wrap;
}
function addOverlay(el){ const w=ensureWrapped(el); if(!w) return; if(!w.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; w.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const w=el.parentElement; if(w.classList.contains('reveal-wrap')){ const ov=w.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.pointerEvents='none'; addOverlay(el); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.pointerEvents=''; removeOverlay(el); el.setAttribute('aria-hidden','false'); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap') ? el.parentElement : el; host?.insertAdjacentElement?.('afterend', btn); }

function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);
  const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button');
  btn.id = btnId; btn.type = 'button'; btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); modalRevealState[key] = true; unblurElement(el); btn.remove(); });
  placeButtonAfter(el, btn);
}
function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalItem) return;
  // TEAM: logo,name,stadium,league || PLAYER: image,name,nationality,jersey
  applyRevealByKey('logo',  mLogo,   !!optLogo?.checked, 'revealLogoBtn', MODE==='player'?'image':'logo');
  applyRevealByKey('name',  mHead,   !!optName?.checked, 'revealNameBtn', 'name');
  applyRevealByKey('subA',  mSub,    !!optStadium?.checked, 'revealSubABtn', MODE==='player'?'nationality':'league'); // (we show league in mSub line)
  applyRevealByKey('subB',  mStadium,!!optLeague?.checked,  'revealSubBBtn', MODE==='player'?'jersey number':'stadium');
}

/* Modal open/close */
function preloadModalLogo(url, cb) {
  if (!url) { cb && cb(); return; }
  const img = getLogo(url, () => done());
  let called = false;
  function done(){ if (called) return; called = true; cb && cb(); }
  if (img) {
    try { if (img.complete) { done(); }
    else if (typeof img.decode === 'function') { img.decode().then(done).catch(done); } }
    catch { done(); }
  } else { done(); }
}

function openModal(item){
  ensureRevealStyles();
  lastModalItem = item;
  modalRevealState = { logo:false, name:false, subA:false, subB:false };

  const isPlayer = MODE === 'player';

  const title = isPlayer ? (item.name || item.team_name || 'Player') : (item.team_name || 'Team');
  const subTop = isPlayer
    ? (item.club || '')
    : (LEAGUE_LABELS[item.league_code] || item.league_code || '');

  if (mHead) mHead.textContent = title;
  if (mSub)  mSub.textContent  = subTop;

  if (mLogo) { mLogo.setAttribute('decoding','sync'); mLogo.setAttribute('loading','eager'); mLogo.src = item.logo_url || item.image_url || ''; mLogo.alt = title; }

  if (mFieldLbl) mFieldLbl.textContent = isPlayer ? 'Details' : 'Stadium';

  if (mStadium) {
    if (isPlayer) {
      const jersey = (item.jersey_number !== undefined && item.jersey_number !== null && item.jersey_number !== '') ? `#${item.jersey_number}` : '—';
      const nat = item.nationality || '—';
      mStadium.textContent = `${jersey} · ${nat}`;
    } else {
      mStadium.textContent = item.stadium || '—';
    }
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => { modalEl.classList.add('show'); updateModalRevealFromToggles(); });
}
function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=> { backdrop.style.display='none'; }, 150);
}

/* ───────────────────── Sizing / Lock ───────────────────── */
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width  = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;
  wheel.style.width = cssSize + 'px'; wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px'; fx.style.height = cssSize + 'px';
}

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, [role="button"]';
function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll(INTERACTIVE_SELECTOR);
  els.forEach(el => {
    if (lock) {
      if (!el.dataset.lockSaved) {
        el.dataset.lockSaved = '1';
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true; el.setAttribute('aria-disabled','true');
    } else {
      if (el.dataset.lockSaved === '1') {
        const prev = el.dataset.prevDisabled === '1';
        el.disabled = prev;
        if (!prev) el.removeAttribute('aria-disabled');
        delete el.dataset.lockSaved; delete el.dataset.prevDisabled;
      }
    }
  });
}

/* ───────────────────── Drawing ───────────────────── */
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2, H/2);

  const radius = Math.min(W, H) * 0.48;
  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A'); g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57'); g.addColorStop(1.00, '#0B1B38');

  ctx.beginPath(); ctx.arc(0,0, radius, 0, TAU); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();

  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0, radius*(i/5), 0, TAU); ctx.stroke(); }
  ctx.restore();
}

function drawWheel(){
  const data = getCurrentData();
  const N = data.length;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    updateSelectionBanner();
    return;
  }

  // Dynamic thresholds; PLAYER: hide everything if >50
  const bothTextOn = !!optName?.checked && !!optStadium?.checked;
  let hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  let hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;
  if (MODE === 'player' && N > 50) { hideTextThresholdDyn = 1; hideLogosThresholdDyn = 1; }

  const hideLogos = N >= hideLogosThresholdDyn;
  const hideText  = N >= hideTextThresholdDyn;

  updateSelectionBanner();

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2, H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // Wedges
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const startAngle = i * sliceAngle;
    const endAngle   = (i + 1) * sliceAngle;

    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.arc(0,0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // Selected rim stroke
  if (!hideText && selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle;
    const a1 = (selectedIdx + 1) * sliceAngle;
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0, radius - 1, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke(); ctx.restore();
  }

  if (!hideText || !hideLogos) {
    for (let i = 0; i < N; i++) {
      const t = data[i] || {};

      const a0 = i * sliceAngle;
      const a1 = (i + 1) * sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      const nameTargetPx    = clamp(12, 0.20 * sliceArc, 24);
      const stadiumTargetPx = clamp(9,  0.14 * sliceArc, 18);
      let   logoSize        = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize / 2;
      const pad = 10;

      const fg = textColorFor(t.primary_color);
      const lum = luminance(t.primary_color);

      ctx.save();
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0,0, radius - 1, a0, a1);
      ctx.closePath(); ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const xBoxLeft = Math.min(xText, logoInner);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      // Toggles per mode
      const showImage = !!optLogo?.checked;
      const showName  = !!optName?.checked;
      const showSubA  = !!optStadium?.checked; // PLAYER: nationality ; TEAM: stadium (but we put LEAGUE on mSub in modal)
      const showSubB  = !!optLeague?.checked;  // PLAYER: jersey ; TEAM: league

      const nameText = (MODE === 'player') ? (t.name || t.team_name) : (t.team_name);
      const subA = (MODE === 'player') ? (t.nationality || '') : (t.stadium || '');
      const subB = (MODE === 'player')
        ? ((t.jersey_number!==undefined && t.jersey_number!==null && t.jersey_number!=='') ? `#${t.jersey_number}` : '')
        : (LEAGUE_LABELS[t.league_code] || t.league_code || '');

      const canShowName = !hideText && showName && nameText && maxTextWidth >= PERF.minTextWidth;
      const canShowSubA = !hideText && showSubA && subA && maxTextWidth >= PERF.minTextWidth;
      const canShowSubB = !hideText && showSubB && subB && maxTextWidth >= PERF.minTextWidth;
      const canShowLogo = !hideLogos && showImage && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;

      /* Text block */
      if (canShowName || canShowSubA || canShowSubB) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let namePx = 0, stadPx = 0, subBPx = 0;
        let nameFit = { text:'', fontPx:0 };
        let stadFit = { text:'', fontPx:0 };
        let subBFit = { text:'', fontPx:0 };

        if (canShowName) {
          nameFit = fitSingleLine(ctx, nameText || '', { maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx:9, maxPx:24, weight: heavy?900:800 });
          namePx = nameFit.fontPx;
        }
        const stadTarget = (canShowName && namePx) ? Math.max(8, Math.round(namePx * 0.82)) : stadiumTargetPx;
        if (canShowSubA) {
          stadFit = fitSingleLine(ctx, subA || '', { maxWidth: maxTextWidth, targetPx: stadTarget, minPx:8, maxPx:20, weight:700 });
          stadPx = stadFit.fontPx;
        }
        if (canShowSubB) {
          subBFit = fitSingleLine(ctx, subB || '', { maxWidth: maxTextWidth, targetPx: Math.max(8, Math.round(stadTarget * 0.95)), minPx:8, maxPx:18, weight:700 });
          subBPx = subBFit.fontPx;
        }

        const lines = (canShowName?1:0) + (canShowSubA?1:0) + (canShowSubB?1:0);
        const gap = lines >= 2 ? 3 : 0;
        const totalH = (canShowName?namePx:0) + (canShowSubA?stadPx:0) + (canShowSubB?subBPx:0) + gap*(lines-1);
        let yCursor = -totalH/2;

        if (canShowName) {
          yCursor += namePx/2;
          ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(namePx/10));
          ctx.fillStyle = fillCol; ctx.strokeText(nameFit.text, xBoxLeft, yCursor); ctx.fillText(nameFit.text, xBoxLeft, yCursor);
          yCursor += namePx/2 + gap;
        }
        if (canShowSubA) {
          yCursor += stadPx/2;
          ctx.font = `700 ${stadPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(stadPx/10));
          ctx.fillStyle = fillCol; ctx.save(); ctx.globalAlpha = 0.92;
          ctx.strokeText(stadFit.text, xBoxLeft, yCursor); ctx.fillText(stadFit.text, xBoxLeft, yCursor);
          ctx.restore();
          yCursor += stadPx/2 + (canShowSubB?gap:0);
        }
        if (canShowSubB) {
          yCursor += subBPx/2;
          ctx.font = `700 ${subBPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(subBPx/10));
          ctx.fillStyle = fillCol; ctx.save(); ctx.globalAlpha = 0.92;
          ctx.strokeText(subBFit.text, xBoxLeft, yCursor); ctx.fillText(subBFit.text, xBoxLeft, yCursor);
          ctx.restore();
        }

        ctx.restore();
      }

      /* Image ring */
      if (canShowLogo) {
        ctx.save(); ctx.translate(xLogo, 0);
        if (N < PERF.hideLogosThreshold) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2; }

        ctx.beginPath(); ctx.arc(0, 0, logoHalf, 0, TAU); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();

        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, logoHalf - 1, 0, TAU); ctx.closePath(); ctx.clip();
        const img = getLogo(t.logo_url, () => requestAnimationFrame(drawWheel));
        if (img && img.complete) {
          const box = Math.max(4, 2 * (logoHalf - 1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box / iw, box / ih);
          ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          const ph = (logoHalf - 3) * 2;
          ctx.fillRect(-ph/2, -ph/2, ph, ph);
        }
        ctx.restore(); ctx.restore();
      }

      ctx.restore(); // slice clip
    }
  }

  ctx.restore();
}

/* ───────────────────── Spin / Result ───────────────────── */
function setResult(idx){
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  history.unshift(t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();

  const logo = t.logo_url || t.image_url || '';
  if (logo) preloadModalLogo(logo, () => openModal(t));
  else openModal(t);
}

function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true;
  lockUI(true);
  spinBtn.disabled = true; spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;

  const extraTurns  = 6 + Math.floor(Math.random()*3); // 6..8
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;

  const start = performance.now();
  const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(now){
    const p = clamp(0, (now - start) / duration, 1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p < 1){
      requestAnimationFrame(anim);
    } else {
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning = false;
      lockUI(false);
      updateSpinAvailability();

      selectedIdx = idx;
      drawWheel();
      setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

/* ───────────────────── Players loader ───────────────────── */
async function tryFetchPlayers() {
  const candidates = [
    '/data/players.json',
    '/players/players.json',
    new URL('./players/players.json', location.href).toString()
  ];
  for (const url of candidates) {
    try { const res = await fetch(url, { cache: 'no-store' }); if (res.ok) return { res, url }; } catch {}
  }
  return { res: null, url: null };
}

async function loadPlayers() {
  const { res } = await tryFetchPlayers();
  if (!res) throw new Error('players.json not found');
  const raw = await res.json();

  PLAYERS = (raw || []).map(p => {
    const name = p.name || p.player_name || 'Player';
    const fromJson = p.image_url || p.image || p.file || p.file_url || '';
    const img = fromJson ? resolvePublicUrl(fromJson) : imageForPlayerName(name);

    const club = p.club || p.team || p.team_name || '';
    const team_id = p.team_id || p.teamId || p.meta?.team_id || null;
    const clubLabel = club || '';
    const clubKey   = normTeamLabel(clubLabel);

    const nationality = p.nationality || p.country || p.meta?.nationality || '';
    const jersey = p.jersey_number ?? p.number ?? p.meta?.jersey_number ?? '';

    return {
      team_name: name,
      logo_url: img,
      league_code: clubKey || 'PLAYER',
      primary_color: '#163058',
      stadium: '',

      name,
      image_url: img,
      club: clubLabel,
      clubKey,
      team_id,
      nationality,
      jersey_number: jersey,
      meta: p
    };
  });

  return PLAYERS;
}

/* ───────────────────── Mode switching ───────────────────── */
function relabelTogglesForMode() {
  if (!lblName || !lblLogo || !lblSub1 || !lblSub2) return;
  if (MODE === 'player') {
    lblLogo.textContent = 'Image';
    lblName.textContent = 'Name';
    lblSub1.textContent = 'Nationality';
    lblSub2.textContent = 'Jersey Number';
  } else {
    lblLogo.textContent = 'Logo';
    lblName.textContent = 'Name';
    lblSub1.textContent = 'Stadium';
    lblSub2.textContent = 'League';
  }
}

function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn?.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn?.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn?.setAttribute('aria-pressed', MODE === 'team' ? 'true':'false');
  modePlayerBtn?.setAttribute('aria-pressed', MODE === 'player' ? 'true':'false');

  relabelTogglesForMode();

  if (MODE === 'player') {
    // Build player chips and redraw
    if (!PLAYERS.length) {
      loadPlayers().then(() => {
        renderChipsForPlayer();
        selectedIdx = -1; sizeCanvas(); drawWheel(); updateSpinAvailability(); updateSelectionBanner();
      }).catch(err => {
        console.warn('players.json unavailable; reverting to TEAM', err);
        MODE = 'team'; relabelTogglesForMode();
        renderChipsForTeam(); selectedIdx = -1; drawWheel(); updateSpinAvailability();
      });
    } else {
      renderChipsForPlayer();
      selectedIdx = -1; drawWheel(); updateSpinAvailability(); updateSelectionBanner();
    }
  } else {
    renderChipsForTeam();
    selectedIdx = -1; drawWheel(); updateSpinAvailability(); updateSelectionBanner();
  }
}

/* ───────────────────── Events ───────────────────── */
function setupEventListeners() {
  modeTeamBtn?.addEventListener('click', () => setMode('team'));
  modePlayerBtn?.addEventListener('click', () => setMode('player'));

  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1; drawWheel(); updateSpinAvailability(); updateSelectionBanner();
  });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    toggleMore.textContent =
      (MODE === 'player')
        ? (hidden ? 'Show fewer clubs' : 'Show more Premier League clubs')
        : (hidden ? 'Show fewer leagues' : 'Show more leagues');
    toggleMore.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  });

  const onWheelToggleChange = () => {
    if (spinning) return;
    drawWheel();
    if (isModalOpen()) updateModalRevealFromToggles();
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange);

  spinBtn?.addEventListener('click', spin);
  spinFab?.addEventListener('click', spin);

  resetHistoryBtn?.addEventListener('click', () => { if (!spinning) resetHistory(); });
  mClose?.addEventListener('click', () => { if (!spinning) closeModal(); });
  backdrop?.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

/* ───────────────────── Boot ───────────────────── */
function boot() {
  fetch(`./teams.json?v=${Date.now()}`)
    .then(res => res.json())
    .then(data => {
      TEAMS = data || [];
      ensureRevealStyles();
      sizeCanvas();

      // Default: TEAM view with EPL checked;
      renderChipsForTeam();
      setCheckedCodes(['EPL']);
      renderHistory();
      drawWheel();
      setupEventListeners();

      // make the toggle labels reflect the initial mode
      relabelTogglesForMode();

      // If stored mode is player, switch now (after teams loaded so chips exist)
      if (localStorage.getItem('fsMode') === 'player') {
        setMode('player');
      }
    })
    .catch(err => {
      console.error('Failed to load teams.json', err);
      drawGradientIdle(wheel.getContext('2d'), wheel.width, wheel.height);
    });
}

boot();

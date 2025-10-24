// Football Club Spinner — app.js
// Fixes included:
// - League never rendered on wheel (TEAM mode)
// - If >2 leagues selected → wedges only (no text/images)
// - Reset History moved under the history list
// - Player mode: PL 2025/26 team filters + “Show more Premier League clubs”
// - Player wheel supports Name / Photo / Jersey / Nationality toggles

/* ======================= STATE ======================= */
let TEAMS = [];
let PLAYERS = [];
let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let currentAngle = 0;  // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// Modal/session state
let lastModalItem = null; // team or player object
let modalRevealState = { logo: false, name: false, stadium: false, league: false };

/* ======================= DOM ======================= */
const chipsWrap = document.getElementById('chips');
const chipsTop = document.getElementById('chipsTop');
const chipsMore = document.getElementById('chipsMore');
const toggleMore = document.getElementById('toggleMore');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName = document.getElementById('optName');
const optLogo = document.getElementById('optLogo');
const optStadium = document.getElementById('optStadium');
const optLeague = document.getElementById('optLeague');

const optNameLabel = document.getElementById('optNameLabel');
const optLogoLabel = document.getElementById('optLogoLabel');
const optStadiumLabel = document.getElementById('optStadiumLabel');
const optLeagueLabel = document.getElementById('optLeagueLabel');

const currentText = document.getElementById('currentText'); // (optional status)
const historyEl = document.getElementById('history');

const backdrop = document.getElementById('backdrop');
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');
const mHead = document.getElementById('mHead');
const mSub = document.getElementById('mSub');
const mLogo = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');
const mMetaLabel = document.getElementById('mMetaLabel');

const qpAll = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpTop5 = document.getElementById('qpTop5');
const quickPicksTeam = document.getElementById('quickPicksTeam');

const filtersTitleTeam = document.getElementById('filtersTitleTeam');
const filtersTitlePlayer = document.getElementById('filtersTitlePlayer');
const wheelTitleTeam = document.getElementById('wheelTitleTeam');
const wheelTitlePlayer = document.getElementById('wheelTitlePlayer');

const perfTip = document.getElementById('perfTip');
const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx');

const modeTeamBtn = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

/* ======================= CONSTANTS ======================= */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

const LEAGUE_LABELS = {
  AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga",
  CRO:"SuperSport HNL", CZE:"Fortuna Liga", DEN:"Superliga", EPL:"Premier League",
  L1:"Ligue 1", BUN:"Bundesliga", GRE:"Super League 1", ISR:"Ligat ha'Al",
  SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien", POL:"PKO BP Ekstraklasa",
  POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga", SCO:"Scottish Premiership",
  SRB:"Super liga Srbije", LLA:"LaLiga", SWE:"Allsvenskan", SUI:"Super League",
  TUR:"Süper Lig", UKR:"Ukrainian Premier League"
};

const PL_TOP = ["Chelsea","Manchester City","Manchester United","Liverpool","Arsenal"]; // top strip in PLAYER mode
const FALLBACK_SILHOUETTE = "/players/silhouette-player.png";

/* ======================= IMAGE CACHE ======================= */
const IMG_CACHE = new Map();
function getImage(url, onLoad) {
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

/* ======================= HELPERS ======================= */
function textColorFor(hex) {
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
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx = 9, maxPx = 28, weight = 800 }) {
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px };
  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px };
  }
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '') + '…', fontPx: minPx };
}
function slugify(str) {
  return String(str||'')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p.replace(/^\/+/, '');
}

/* ======================= SIZING ======================= */
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;

  wheel.style.width = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px';
  fx.style.height = cssSize + 'px';
}

/* ======================= UI LOCK ======================= */
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, [role="button"]';
function lockUI(lock) {
  document.body.classList.toggle('ui-locked', !!lock);
  document.querySelectorAll(INTERACTIVE_SELECTOR).forEach(el => {
    if (lock) {
      if (!el.dataset.lockSaved) {
        el.dataset.lockSaved = '1';
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    } else if (el.dataset.lockSaved === '1') {
      const prev = el.dataset.prevDisabled === '1';
      el.disabled = prev;
      if (!prev) el.removeAttribute('aria-disabled');
      delete el.dataset.lockSaved;
      delete el.dataset.prevDisabled;
    }
  });
}

/* ======================= CHIPS ======================= */
const TOP5 = ['EPL','SA','BUN','L1','LLA'];

function makeChip(value, labelText, checked) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${value}" ${checked ? 'checked aria-checked="true"' : ''} />
    <span class="chip-text" title="${labelText}">${labelText}</span>
  `;
  return label;
}

function renderLeagueChips() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded', 'false');

  // Titles / quick picks visible
  filtersTitleTeam.classList.remove('hidden');
  filtersTitlePlayer.classList.add('hidden');
  quickPicksTeam.classList.remove('hidden');

  // Toggle labels (TEAM)
  optNameLabel.textContent = 'Name';
  optLogoLabel.textContent = 'Logo';
  optStadiumLabel.textContent = 'Stadium';
  optLeagueLabel.textContent = 'League';
  document.getElementById('wheelTitlePlayer').classList.add('hidden');
  document.getElementById('wheelTitleTeam').classList.remove('hidden');

  // toggleMore wording
  toggleMore.dataset.mode = 'team';
}

function renderPlayerTeamChips() {
  // Build list of PL team names from PLAYERS.club
  const clubs = [...new Set(PLAYERS.map(p => (p.club || '').trim()))].filter(Boolean);
  // Order: PL_TOP first (if present), rest alpha
  const top = PL_TOP.filter(n => clubs.includes(n));
  const rest = clubs.filter(n => !top.includes(n)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';
  top.forEach(name => chipsTop.appendChild(makeChip(name, name, true)));
  rest.forEach(name => chipsMore.appendChild(makeChip(name, name, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more Premier League clubs';
  toggleMore.setAttribute('aria-expanded', 'false');

  // Titles / quick picks hidden (PLAYER)
  filtersTitleTeam.classList.add('hidden');
  filtersTitlePlayer.classList.remove('hidden');
  quickPicksTeam.classList.add('hidden');

  // Toggle labels (PLAYER)
  optNameLabel.textContent = 'Name';
  optLogoLabel.textContent = 'Photo';
  optStadiumLabel.textContent = 'Jersey';
  optLeagueLabel.textContent = 'Nationality';

  document.getElementById('wheelTitleTeam').classList.add('hidden');
  document.getElementById('wheelTitlePlayer').classList.remove('hidden');

  toggleMore.dataset.mode = 'player';
}

function visibleChipValues() {
  const arr = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) arr.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  return arr;
}
function selectedChipValues() {
  return Array.from(chipsWrap.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}

function setCheckedValues(values = []) {
  const set = new Set(values);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
  updateSelectionBanner();
}

/* ======================= DATA SELECTION ======================= */
function getCurrentData() {
  if (MODE === 'player') {
    const chosenClubs = selectedChipValues();
    if (!PLAYERS.length) return [];
    if (chosenClubs.length === 0) return PLAYERS;
    return PLAYERS.filter(p => chosenClubs.includes(p.club || ''));
  }
  // TEAM mode → filter by league codes
  const active = selectedChipValues();
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = (n === 0);
  if (spinFab) spinFab.disabled = (n === 0);
}
function updateSelectionBanner() {
  const N = getCurrentData().length;
  perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

/* ======================= HISTORY ======================= */
function saveHistory(){ localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory(){ history = []; saveHistory(); renderHistory(); }
function renderHistory(){
  historyEl.innerHTML = '';
  if (history.length === 0) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = 'Spin the wheel to start';
    historyEl.appendChild(div);
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const img = document.createElement('img');
    img.src = item.logo_url || FALLBACK_SILHOUETTE;
    img.alt = `${item.team_name} image`;
    const s = document.createElement('span');
    const sub = MODE === 'player' ? (item.club || '') : (LEAGUE_LABELS[item.league_code] || item.league_code);
    s.textContent = `${item.team_name}${sub ? ' ('+sub+')' : ''}`;
    div.append(img, s);
    historyEl.appendChild(div);
  });
}

/* ======================= MODAL ======================= */
function openModal(item){
  lastModalItem = item;
  modalRevealState = { logo: false, name: false, stadium: false, league: false };

  if (MODE === 'player') {
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = item.club || '';
    mLogo.src = item.logo_url || FALLBACK_SILHOUETTE;
    mLogo.alt = `${item.team_name} photo`;
    mMetaLabel.textContent = 'Jersey';
    mStadium.textContent = (item.jersey_number != null ? String(item.jersey_number) : '—');
  } else {
    const leagueLabel = LEAGUE_LABELS[item.league_code] || item.league_code;
    mHead.textContent = item.team_name || '—';
    mSub.textContent  = leagueLabel;
    mLogo.src = item.logo_url || '';
    mLogo.alt = `${item.team_name} logo`;
    mMetaLabel.textContent = 'Stadium';
    mStadium.textContent = item.stadium || '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => modalEl.classList.add('show'));
}
function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=> { backdrop.style.display='none'; }, 150);
}
mClose.onclick = () => { if (!spinning) closeModal(); };
backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

/* ======================= DRAW ======================= */
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2, H/2);

  const radius = Math.min(W, H) * 0.48;
  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');

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

  // TEAM-only rule: if >2 different leagues selected, draw wedges only
  let hideAll = false;
  if (MODE === 'team') {
    const activeCodes = selectedChipValues();
    const unique = new Set(activeCodes);
    if (unique.size > 2) hideAll = true;
  }

  const bothTextOn = !!optName.checked && !!optStadium.checked;
  const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;

  const hideLogos = hideAll || (N >= hideLogosThresholdDyn) || !optLogo.checked;
  const hideText  = hideAll || (N >= hideTextThresholdDyn);

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
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = t.primary_color || '#4f8cff';
    ctx.fill();
  }

  // Selected rim stroke (only when we are drawing text)
  if (!hideText && selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle;
    const a1 = (selectedIdx + 1) * sliceAngle;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0,0, radius - 1, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  // Content
  if (!hideText || !hideLogos) {
    for (let i = 0; i < N; i++) {
      const t = data[i] || {};

      const a0 = i * sliceAngle;
      const a1 = (i + 1) * sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      const nameTargetPx = clamp(12, 0.20 * sliceArc, 24);
      const subTargetPx  = clamp(9,  0.14 * sliceArc, 18);
      let   logoSize     = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize / 2;
      const pad = 10;

      const fg = textColorFor(t.primary_color);
      const lum = luminance(t.primary_color);

      ctx.save();
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0,0, radius - 1, a0, a1); ctx.closePath(); ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const xBoxLeft = Math.min(xText, logoInner);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      // Build lines depending on MODE
      const nameLabel = t.team_name || '';
      let subLabel = '';
      if (MODE === 'player') {
        const wantJersey = optStadium.checked;
        const wantNation = optLeague.checked;
        const parts = [];
        if (wantJersey && t.jersey_number != null) parts.push(`#${t.jersey_number}`);
        if (wantNation && t.nationality) parts.push(t.nationality);
        subLabel = parts.join(' · ');
      } else {
        // TEAM mode: “League” never drawn on the wheel by design
        if (optStadium.checked && t.stadium) subLabel = t.stadium;
      }

      const canShowName = !hideText && optName.checked && nameLabel && maxTextWidth >= PERF.minTextWidth;
      const canShowSub  = !hideText && subLabel && maxTextWidth >= PERF.minTextWidth;
      const canShowLogo = !hideLogos && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;

      if (canShowName || canShowSub) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let namePx = 0, subPx = 0;
        let nameFit = { text: '', fontPx: 0 };
        let subFit  = { text: '', fontPx: 0 };

        if (canShowName) {
          nameFit = fitSingleLine(ctx, nameLabel, { maxWidth: maxTextWidth, targetPx: nameTargetPx, minPx: 9, maxPx: 24, weight: heavy ? 900 : 800 });
          namePx = nameFit.fontPx;
        }
        if (canShowSub) {
          const target = (canShowName && namePx) ? Math.max(8, Math.round(namePx * 0.82)) : subTargetPx;
          subFit = fitSingleLine(ctx, subLabel, { maxWidth: maxTextWidth, targetPx: target, minPx: 8, maxPx: 20, weight: 700 });
          subPx = subFit.fontPx;
        }

        const gap = (canShowName && canShowSub) ? 3 : 0;
        const totalH = (canShowName ? namePx : 0) + (canShowSub ? subPx : 0) + gap;
        let y = -totalH/2;

        if (canShowName) {
          y += namePx/2;
          ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(namePx / 10));
          ctx.fillStyle = fillCol;
          ctx.strokeText(nameFit.text, xBoxLeft, y);
          ctx.fillText(nameFit.text, xBoxLeft, y);
          y += namePx/2 + gap;
        }
        if (canShowSub) {
          y += subPx/2;
          ctx.font = `700 ${subPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(subPx / 10));
          ctx.fillStyle = fillCol;
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.strokeText(subFit.text, xBoxLeft, y);
          ctx.fillText(subFit.text, xBoxLeft, y);
          ctx.restore();
        }
        ctx.restore();
      }

      if (canShowLogo) {
        ctx.save();
        ctx.translate(xLogo, 0);

        if (N < PERF.hideLogosThreshold) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 2;
        }

        ctx.beginPath(); ctx.arc(0,0, logoHalf, 0, TAU); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();

        ctx.save();
        ctx.beginPath(); ctx.arc(0,0, logoHalf - 1, 0, TAU); ctx.closePath(); ctx.clip();

        const img = getImage(t.logo_url, () => requestAnimationFrame(drawWheel));
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
        ctx.restore();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  ctx.restore();
}

/* ======================= RESULT + SPIN ======================= */
function setResult(idx){
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  history.unshift(t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();

  openModal(t);
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
  const extraTurns  = 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;

  const start    = performance.now();
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

/* ======================= EVENTS ======================= */
function setupEventListeners() {
  // Mode switch
  modeTeamBtn.addEventListener('click', () => switchMode('team'));
  modePlayerBtn.addEventListener('click', () => switchMode('player'));

  // Chips change
  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    updateSpinAvailability();
    updateSelectionBanner();
  });

  // Show more
  toggleMore.addEventListener('click', () => {
    const nowHidden = chipsMore.hidden;
    chipsMore.hidden = !nowHidden;
    const playerMode = toggleMore.dataset.mode === 'player';
    toggleMore.textContent = nowHidden
      ? (playerMode ? 'Show fewer Premier League clubs' : 'Show fewer leagues')
      : (playerMode ? 'Show more Premier League clubs' : 'Show more leagues');
    toggleMore.setAttribute('aria-expanded', nowHidden ? 'true' : 'false');
  });

  // Quick picks (TEAM only)
  qpAll.addEventListener('click',  () => setCheckedValues(visibleChipValues()));
  qpNone.addEventListener('click', () => setCheckedValues([]));
  qpTop5.addEventListener('click', () => {
    const vis = new Set(visibleChipValues());
    setCheckedValues(TOP5.filter(c => vis.has(c)));
  });

  // Wheel toggles
  [optName, optLogo, optStadium, optLeague].forEach(el => el.addEventListener('change', () => {
    if (spinning) return;
    drawWheel();
  }));

  // Buttons
  spinBtn.addEventListener('click', spin);
  spinFab.addEventListener('click', spin);
  resetHistoryBtn.addEventListener('click', () => { if (!spinning) resetHistory(); });

  // Resize
  let rTO;
  window.addEventListener('resize', () => {
    clearTimeout(rTO);
    rTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

/* ======================= PLAYER DATA LOADING ======================= */
function imageFromNameOrJson(p) {
  const fromJson = p.image_url || p.image || p.file || p.file_url || '';
  if (fromJson) return resolvePublicUrl(fromJson);
  return `/players/${slugify(p.name || p.player_name || 'player')}.png`;
}

async function loadPlayers() {
  const candidates = ['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
  let data = null;
  for (const u of candidates) {
    try { const res = await fetch(u, { cache: 'no-store' }); if (res.ok) { data = await res.json(); break; } } catch {}
  }
  if (!Array.isArray(data)) data = [];

  // Normalize to wheel’s shape
  PLAYERS = data.map(p => {
    const name = p.name || p.player_name || 'Player';
    const club = p.club || p.team || '';
    const img  = imageFromNameOrJson({ ...p, name });
    const nat  = p.nationality || (p.nation && p.nation.name) || '';
    const jersey = p.jersey_number ?? p.shirt_number ?? null;
    return {
      team_name: name,
      logo_url: img || FALLBACK_SILHOUETTE,
      league_code: 'EPL',
      primary_color: '#163058',
      stadium: '',

      // player-specific
      name, club, nationality: nat, jersey_number: jersey
    };
  });

  // Build PLAYER chips
  renderPlayerTeamChips();
  // Default-select top clubs
  setCheckedValues(PL_TOP.filter(n => PLAYERS.some(p => p.club === n)));
}

/* ======================= MODE SWITCH ======================= */
function switchMode(next) {
  if (MODE === next) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  // Button styles
  modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn.setAttribute('aria-pressed', MODE === 'team' ? 'true' : 'false');
  modePlayerBtn.setAttribute('aria-pressed', MODE === 'player' ? 'true' : 'false');

  // Render filters for mode
  if (MODE === 'player') {
    renderPlayerTeamChips();
    drawWheel();
    updateSpinAvailability();
  } else {
    renderLeagueChips();
    // default EPL checked
    setCheckedValues(['EPL']);
  }
}

/* ======================= BOOT ======================= */
fetch(`./teams.json?v=${Date.now()}`)
  .then(r => r.json())
  .then(data => {
    TEAMS = data || [];
    sizeCanvas();
    renderHistory();
    setupEventListeners();

    // initial filters depending on stored mode
    if (MODE === 'player') {
      // Build team filters after players load
      renderLeagueChips(); // temporary to avoid empty UI flash
      loadPlayers().then(() => {
        drawWheel();
        updateSpinAvailability();
      });
    } else {
      renderLeagueChips();
      setCheckedValues(['EPL']);
      drawWheel();
      updateSpinAvailability();
    }
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    sizeCanvas(); drawWheel();
  });

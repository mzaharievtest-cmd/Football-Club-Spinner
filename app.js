/**
 * app.js
 * Football Spinner — main UI logic
 *
 * - TEAM / PLAYER mode toggle
 * - TEAM mode uses TEAMS loaded from teams.json (existing behavior)
 * - PLAYER mode loads /players/players.json and normalizes records to the same "team" shape
 * - Wheel drawing, spinning, modal, history, chips, and controls
 *
 * Keep in sync with index.html IDs and style.css.
 */

'use strict';

// -------------------- App state --------------------
let TEAMS = [];
let PLAYERS = null; // normalized player objects (team-shaped)
let MODE = 'team'; // 'team' or 'player'

let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory') || '[]');

// -------------------- DOM --------------------
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

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl = document.getElementById('history');

const modeTeamBtn = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

const teamView = document.getElementById('teamView');
const playerView = document.getElementById('playerView');
const playerListContainer = document.getElementById('playerList');

const backdrop = document.getElementById('backdrop');
const modalEl = document.getElementById('modal');
const mClose = document.getElementById('mClose');
const mHead = document.getElementById('mHead');
const mSub = document.getElementById('mSub');
const mLogo = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');

const qpAll  = document.getElementById('qpAll');
const qpNone = document.getElementById('qpNone');
const qpTop5 = document.getElementById('qpTop5');
const perfTip = document.getElementById('perfTip');

const wheel = document.getElementById('wheel');
const fx = document.getElementById('fx');

// -------------------- Constants & Utils --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const TOP5 = ['EPL','SA','BUN','L1','LLA'];
const LEAGUE_LABELS = {
  AUT: "Austrian Bundesliga", BEL: "Jupiler Pro League", BUL: "efbet Liga", CRO: "SuperSport HNL",
  CZE: "Fortuna Liga", DEN: "Superliga", EPL: "Premier League", L1:  "Ligue 1", BUN: "Bundesliga",
  GRE: "Super League 1", ISR: "Ligat ha'Al", SA:  "Serie A", NED: "Eredivisie", NOR: "Eliteserien",
  POL: "PKO BP Ekstraklasa", POR: "Liga Portugal", ROU: "SuperLiga", RUS: "Premier Liga",
  SCO: "Scottish Premiership", SRB: "Super liga Srbije", LLA: "LaLiga", SWE: "Allsvenskan",
  SUI: "Super League", TUR: "Süper Lig", UKR: "Ukrainian Premier League"
};

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

function deviceDPR() { return Math.max(1, window.devicePixelRatio || 1); }

function _polite() { return new Promise(r => setTimeout(r, 40 + Math.random()*110)); }

// -------------------- Image cache --------------------
const IMG_CACHE = new Map();
function getLogo(url, onLoad) {
  if (!url) return null;
  const cached = IMG_CACHE.get(url);
  if (cached) return cached.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => { onLoad && onLoad(); };
  img.onerror = () => { onLoad && onLoad(); };
  IMG_CACHE.set(url, { img });
  return img;
}

// -------------------- Mode handling --------------------
function setMode(newMode) {
  if (newMode === MODE) return;
  MODE = newMode;
  modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');

  if (MODE === 'team') {
    teamView.classList.remove('hidden');
    playerView.classList.add('hidden');
    drawWheel();
  } else {
    teamView.classList.add('hidden');
    playerView.classList.remove('hidden');
    if (!PLAYERS) {
      loadPlayers().then(() => {
        selectedIdx = -1;
        drawWheel();
      }).catch(err => {
        console.error('Failed to load players.json', err);
        drawWheel(); // fallback
      });
    } else {
      selectedIdx = -1;
      drawWheel();
    }
  }
}

modeTeamBtn && modeTeamBtn.addEventListener('click', () => setMode('team'));
modePlayerBtn && modePlayerBtn.addEventListener('click', () => setMode('player'));

// -------------------- Load players.json (normalized to team-shape) --------------------
async function loadPlayers() {
  try {
    const res = await fetch('/players/players.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('players.json fetch failed: ' + res.status);
    const data = await res.json();

    PLAYERS = Array.isArray(data) ? data.map(p => {
      const name = p.name || p.player_name || p.full_name || p.displayName || 'Player';
      const img = p.image_url || p.file_url || p.image || p.imageUrl || '/img/silhouette-player.png';
      const league_code = p.league_code || p.league || p.comp || 'PLAYER';
      const primary_color = p.primary_color || p.color || '#163058';
      return {
        team_name: name,
        logo_url: img,
        primary_color,
        league_code,
        stadium: p.stadium || '',
        meta: p,
        name,
        image_url: img,
        qid: p.wikidata_id || p.qid || p.QID || null,
        club: p.club || p.team || null
      };
    }) : [];

    console.log(`loadPlayers(): loaded ${PLAYERS.length} player records`);
    renderPlayerListPreview();

  } catch (e) {
    console.error('Failed to load players.json', e);
    throw e;
  }
}

function renderPlayerListPreview(limit = 40) {
  if (!playerListContainer || !PLAYERS) return;
  playerListContainer.innerHTML = '';
  const slice = PLAYERS.slice(0, limit);
  slice.forEach(p => {
    const it = document.createElement('div');
    it.className = 'player-item';
    it.innerHTML = `<img class="player-thumb" src="${p.image_url || '/img/silhouette-player.png'}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" width="48" height="48"><div class="player-meta"><div class="player-name">${escapeHtml(p.name)}</div></div>`;
    playerListContainer.appendChild(it);
  });
}

// -------------------- Data provider --------------------
function visibleCodes() {
  const codes = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) {
    codes.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  }
  return codes;
}
function getFiltered() {
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);
  return TEAMS.filter(t => active.includes(t.league_code));
}

function getCurrentData() {
  if (MODE === 'player') {
    // Return normalized PLAYERS; leave filtering disabled by default for players
    return PLAYERS && PLAYERS.length ? PLAYERS : [];
  } else {
    return getFiltered();
  }
}

// -------------------- Drawing (wheel) --------------------
function drawGradientIdle(ctx, W, H) {
  const DPR = deviceDPR();
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);
  const radius = Math.min(W,H) * 0.48;
  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');
  ctx.beginPath();
  ctx.arc(0,0, radius,0,TAU);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){
    ctx.beginPath();
    ctx.arc(0,0, radius*(i/5), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWheel(){
  const data = getCurrentData();
  const N = data.length;
  const ctx = wheel.getContext('2d');
  const DPR = deviceDPR();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    perfTip.textContent = `0 ${MODE === 'player' ? 'players' : 'teams'} selected`;
    return;
  }

  const hideLogos = (MODE === 'team') ? (N >= PERF.hideLogosThreshold) : (N >= 300);
  const hideText  = N >= PERF.hideTextThreshold;
  perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W,H) * 0.48;
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
    if (MODE === 'team') {
      ctx.fillStyle = t.primary_color || '#4f8cff';
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(16,24,40,0.92)' : 'rgba(10,16,28,0.92)';
    }
    ctx.fill();
  }

  // Selected rim stroke
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

  // Content (logos/text)
  for (let i = 0; i < N; i++) {
    const t = data[i] || {};
    const a0 = i * sliceAngle;
    const a1 = (i + 1) * sliceAngle;
    const aMid = (a0 + a1) / 2;
    const sliceArc = radius * (a1 - a0);

    const logoSize = clamp(28, 0.40 * sliceArc, 64);
    const logoHalf = logoSize / 2;
    const pad = 10;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, radius - 1, a0, a1);
    ctx.closePath();
    ctx.clip();

    ctx.rotate(aMid);
    const needFlip = Math.cos(aMid) < 0;
    if (needFlip) ctx.rotate(Math.PI);
    const sign = needFlip ? -1 : 1;

    const xLogo = sign * (radius * 0.74);
    const xText = sign * (radius * 0.42);
    const logoInner = xLogo - sign * (logoHalf + pad);
    const xBoxLeft = Math.min(xText, logoInner);
    const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

    if (MODE === 'team') {
      const canShowName    = optName?.checked && t.team_name && maxTextWidth >= PERF.minTextWidth;
      const canShowStadium = optStadium?.checked && t.stadium && maxTextWidth >= PERF.minTextWidth;
      const canShowLogo    = optLogo?.checked && t.logo_url && logoHalf*2 >= PERF.minLogoBox;

      if (canShowName || canShowStadium) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const strokeCol = 'rgba(12,16,28,0.65)';
        const fillCol = '#fff';
        let namePx = 14, stadPx = 12;
        if (canShowName) {
          ctx.font = `800 ${namePx}px Inter, system-ui, sans-serif`;
          ctx.lineWidth = Math.max(1, Math.round(namePx / 10));
          ctx.strokeStyle = strokeCol;
          ctx.fillStyle = fillCol;
          ctx.strokeText(t.team_name, xBoxLeft, 0 - (canShowStadium ? 8 : 0));
          ctx.fillText(t.team_name, xBoxLeft, 0 - (canShowStadium ? 8 : 0));
        }
        if (canShowStadium) {
          ctx.font = `700 ${stadPx}px Inter, system-ui, sans-serif`;
          ctx.globalAlpha = 0.92;
          ctx.strokeText(t.stadium, xBoxLeft, 12);
          ctx.fillText(t.stadium, xBoxLeft, 12);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }

      if (optLogo?.checked && t.logo_url) {
        ctx.save();
        ctx.translate(xLogo, 0);
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf, 0, TAU);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf - 1, 0, TAU);
        ctx.closePath();
        ctx.clip();

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
        ctx.restore();
        ctx.restore();
      }

    } else { // PLAYER MODE
      const playerName = t.name || t.team_name || 'Player';
      const playerImgUrl = t.image_url || t.logo_url || '';

      if (playerImgUrl) {
        ctx.save();
        ctx.translate(xLogo, 0);
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf, 0, TAU);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf - 1, 0, TAU);
        ctx.closePath();
        ctx.clip();

        const img = getLogo(playerImgUrl, () => requestAnimationFrame(drawWheel));
        if (img && img.complete) {
          const box = Math.max(4, 2 * (logoHalf - 1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box / iw, box / ih);
          ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          const ph = (logoHalf - 3) * 2;
          ctx.fillRect(-ph/2, -ph/2, ph, ph);
        }
        ctx.restore();
        ctx.restore();
      }

      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const namePx = Math.max(10, Math.round(sliceArc * 0.08));
      ctx.font = `700 ${Math.min(20, namePx)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      const yText = logoHalf + 8;
      ctx.fillText(playerName, xBoxLeft, yText);
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

// -------------------- Spin / Result --------------------
function setResult(idx) {
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  if (MODE === 'team') {
    const leagueLabel = (t && (t.league_code && (LEAGUE_LABELS[t.league_code] || t.league_code))) || '';
    if (currentText) currentText.textContent = `${t.team_name} · ${leagueLabel}`;
    if (currentLogo) { currentLogo.src = t.logo_url || ""; currentLogo.alt = (t.team_name || 'Club') + ' logo'; }
    history.unshift(t);
  } else {
    if (currentText) currentText.textContent = `${t.name || t.team_name || 'Player'}`;
    if (currentLogo) { currentLogo.src = t.image_url || t.logo_url || ""; currentLogo.alt = (t.name || 'Player') + ' photo'; }
    history.unshift(t);
  }

  if (history.length > 50) history = history.slice(0,50);
  localStorage.setItem('clubHistory', JSON.stringify(history));
  renderHistory();

  const openRec = t;
  if (openRec && (openRec.image_url || openRec.logo_url)) {
    setTimeout(() => {
      if (openRec && (openRec.image_url || openRec.logo_url)) {
        openModal({
          team_name: MODE === 'team' ? (openRec.team_name || '') : (openRec.name || ''),
          league_code: MODE === 'team' ? openRec.league_code : '',
          logo_url: MODE === 'team' ? openRec.logo_url : (openRec.image_url || '')
        });
      }
    }, 160);
  }
}

function spin() {
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) {
    if (currentText) currentText.textContent = `Please select at least one ${MODE === 'player' ? 'player' : 'league'}.`;
    return;
  }

  spinning = true;
  lockUI(true);
  spinBtn.disabled = true; spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;
  const extraTurns  = 6 + Math.floor(Math.random()*3);
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
      const hasAny = getCurrentData().length > 0;
      spinBtn.disabled = !hasAny;
      spinFab.disabled = !hasAny;
      selectedIdx = idx;
      drawWheel();
      setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

// -------------------- UI helpers --------------------
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
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    } else {
      if (el.dataset.lockSaved === '1') {
        const prev = el.dataset.prevDisabled === '1';
        el.disabled = prev;
        if (!prev) el.removeAttribute('aria-disabled');
        delete el.dataset.lockSaved;
        delete el.dataset.prevDisabled;
      }
    }
  });
}

function renderChips() {
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded', 'false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');
}

function makeChip(code, checked) {
  const full = LEAGUE_LABELS[code] || code;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${code}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${full}">
    <span class="chip-text" title="${full}">${full}</span>
  `;
  return label;
}

function setCheckedCodes(codes = []) {
  const set = new Set(codes);
  chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => {
    i.checked = set.has(i.value);
    i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  });
  selectedIdx = -1;
  drawWheel();
  const hasAny = getFiltered().length > 0;
  spinBtn.disabled = !hasAny;
  spinFab.disabled = !hasAny;
  if (!hasAny && currentText) currentText.textContent = 'Please select at least one league.';
  perfTip.textContent = `${getFiltered().length} teams selected`;
}

function renderHistory() {
  historyEl.innerHTML = '';
  if (history.length === 0) {
    historyEl.setAttribute('aria-live', 'polite');
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url || item.image_url || '';
    i.alt = `${item.team_name || item.name || 'Item'} image`;
    i.className = 'history-logo';
    i.width = 38; i.height = 38;
    i.onerror = () => { i.src = ''; i.alt = 'No image'; };
    const s = document.createElement('span');
    const label = item.team_name || item.name || (LEAGUE_LABELS[item.league_code] || item.league_code) || '—';
    s.textContent = `${label}`;
    div.append(i, s);
    historyEl.append(div);
  });
}

// -------------------- Modal helpers --------------------
function openModal({ team_name = '', league_code = '', logo_url = '' } = {}) {
  if (!backdrop || !modalEl) return;
  mHead.textContent = team_name || '';
  mSub.textContent = league_code ? (LEAGUE_LABELS[league_code] || league_code) : '';
  mLogo.src = logo_url || '';
  mLogo.alt = team_name ? `${team_name} image` : 'Image';
  mStadium.textContent = '';
  backdrop.style.display = 'flex';
  requestAnimationFrame(() => modalEl.classList.add('show'));
  // trap focus briefly
  mClose.focus();
}

function closeModal() {
  if (!backdrop || !modalEl) return;
  modalEl.classList.remove('show');
  setTimeout(() => { backdrop.style.display = 'none'; }, 200);
}

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    const len = getFiltered().length;
    spinBtn.disabled = len === 0;
    spinFab.disabled = len === 0;
    if (len === 0 && currentText) currentText.textContent = 'Please select at least one league.';
  });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    if (hidden) {
      chipsMore.hidden = false;
      toggleMore.textContent = 'Show fewer leagues';
      toggleMore.setAttribute('aria-expanded', 'true');
    } else {
      chipsMore.hidden = true;
      toggleMore.textContent = 'Show more leagues';
      toggleMore.setAttribute('aria-expanded', 'false');
    }
  });

  optName?.addEventListener('change', () => { if (!spinning) drawWheel(); });
  optLogo?.addEventListener('change', () => { if (!spinning) drawWheel(); });
  optStadium?.addEventListener('change', () => { if (!spinning) drawWheel(); });
  optLeague?.addEventListener('change', () => { if (!spinning) drawWheel(); });

  spinBtn.onclick = spin;
  spinFab.onclick = spin;

  resetHistoryBtn.addEventListener('click', () => { if (!spinning) { history = []; localStorage.removeItem('clubHistory'); renderHistory(); } });
  mClose.onclick = () => { if (!spinning) closeModal(); };
  backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  qpAll?.addEventListener('click', () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = true; i.setAttribute('aria-checked', 'true'); });
    selectedIdx = -1; drawWheel();
  });
  qpNone?.addEventListener('click', () => {
    chipsWrap.querySelectorAll('input[type="checkbox"]').forEach(i => { i.checked = false; i.setAttribute('aria-checked', 'false'); });
    selectedIdx = -1; drawWheel();
  });
  qpTop5?.addEventListener('click', () => {
    const codes = TOP5;
    setCheckedCodes(codes);
  });

  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = deviceDPR();
  wheel.width = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width;
  fx.height = wheel.height;
  wheel.style.width = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px';
  fx.style.height = cssSize + 'px';
}

// -------------------- Boot --------------------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(data => {
    TEAMS = data;
    renderChips();
    renderHistory();
    sizeCanvas();
    setCheckedCodes(['EPL']);
    drawWheel();
    setupEventListeners();
    modeTeamBtn && modeTeamBtn.addEventListener('click', () => setMode('team'));
    modePlayerBtn && modePlayerBtn.addEventListener('click', () => setMode('player'));
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    if (currentText) currentText.textContent = 'Failed to load teams.';
  });

// Expose a couple helpers for console debugging
window.__fs = { drawWheel, spin, setMode, loadPlayers, TEAMS, PLAYERS };

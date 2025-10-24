// Football Club Spinner — unified TEAM/PLAYER app.js
// - TEAM mode: filter by leagues; wedges show club logo + name + stadium/league
// - PLAYER mode: filter by teams; wedges show player photo + name + (#jersey · nationality)
// - Toggles and chips adapt automatically per mode.

let TEAMS = [];
let PLAYERS = [];

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let currentAngle = 0;
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// ---------- DOM ----------
const chipsWrap  = document.getElementById('chips');
const chipsTop   = document.getElementById('chipsTop');
const chipsMore  = document.getElementById('chipsMore');
const toggleMore = document.getElementById('toggleMore');

const spinBtn = document.getElementById('spinBtn');
const spinFab = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName    = document.getElementById('optName');
const optLogo    = document.getElementById('optLogo');
const optSub1    = document.getElementById('optStadium'); // TEAM: Stadium | PLAYER: Jersey
const optSub2    = document.getElementById('optLeague');  // TEAM: League  | PLAYER: Nationality
const lblName    = document.getElementById('lblName');
const lblLogo    = document.getElementById('lblLogo');
const lblSub1    = document.getElementById('lblSub1');
const lblSub2    = document.getElementById('lblSub2');

const perfTip = document.getElementById('perfTip');

const wheel = document.getElementById('wheel');
const fx    = document.getElementById('fx');

// Mode buttons
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');

// Modal
const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead    = document.getElementById('mHead');
const mSub     = document.getElementById('mSub');
const mLogo    = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium');
const mFieldLabel = document.getElementById('mFieldLabel');

let lastModalItem = null;

// ---------- Utils ----------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod   = (x, m) => ((x % m) + m) % m;

// Performance thresholds
const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold:  140,
  minTextWidth: 44,
  minLogoBox: 28
};

// League labels
const LEAGUE_LABELS = {
  AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga", CRO:"SuperSport HNL",
  CZE:"Fortuna Liga", DEN:"Superliga", EPL:"Premier League", L1:"Ligue 1", BUN:"Bundesliga",
  GRE:"Super League 1", ISR:"Ligat ha'Al", SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien",
  POL:"PKO BP Ekstraklasa", POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga",
  SCO:"Scottish Premiership", SRB:"Super liga Srbije", LLA:"LaLiga", SWE:"Allsvenskan",
  SUI:"Super League", TUR:"Süper Lig", UKR:"Ukrainian Premier League", PLAYER:"Players"
};

const TOP5 = ['EPL','SA','BUN','L1','LLA'];

// Image cache
const IMG_CACHE = new Map();
function cacheImg(url, onLoad) {
  if (!url) return null;
  const hit = IMG_CACHE.get(url);
  if (hit) return hit.img;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  img.onload = () => onLoad && onLoad();
  img.onerror = () => onLoad && onLoad();
  IMG_CACHE.set(url, { img });
  return img;
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

// Fit one line
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx=9, maxPx=28, weight=800, fontFamily='Inter, system-ui, sans-serif' }) {
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px ${fontFamily}`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px };
  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px };
  }
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '') + '…', fontPx: minPx };
}

// ---------- Sizing ----------
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;

  wheel.style.width = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width = cssSize + 'px';
  fx.style.height = cssSize + 'px';
}

// ---------- UI lock ----------
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
      el.setAttribute('aria-disabled','true');
    } else if (el.dataset.lockSaved === '1') {
      const prev = el.dataset.prevDisabled === '1';
      el.disabled = prev;
      if (!prev) el.removeAttribute('aria-disabled');
      delete el.dataset.lockSaved;
      delete el.dataset.prevDisabled;
    }
  });
}

// ---------- Chips (dynamic per mode) ----------
function makeChip(value, labelText, checked) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${value}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${labelText}">
    <span class="chip-text" title="${labelText}">${labelText}</span>
  `;
  return label;
}

function renderChips() {
  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';
  chipsMore.hidden = true;

  if (MODE === 'team') {
    // by leagues, with TOP5 shortcut
    const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
    const topCodes = TOP5.filter(c => allCodes.includes(c));
    const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

    topCodes.forEach(code => chipsTop.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, code==='EPL')));
    moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, LEAGUE_LABELS[code] || code, false)));

    document.getElementById('filter-title').textContent = 'Leagues (filter)';
    document.getElementById('wheel-title').textContent  = 'Club Wheel';
    toggleMore.textContent = 'Show more leagues';
    lblName.textContent = 'Name'; lblLogo.textContent = 'Logo';
    lblSub1.textContent = 'Stadium'; lblSub2.textContent = 'League';
  } else {
    // PLAYER: chips are Teams (clubs) derived from PLAYERS
    const clubs = new Map(); // id -> name
    for (const p of PLAYERS) {
      if (p.club_id && p.club_name) clubs.set(String(p.club_id), p.club_name);
    }
    const sorted = [...clubs.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
    // put 10 first as "Top"
    const top = sorted.slice(0, 10);
    const more = sorted.slice(10);

    top.forEach(([id, name]) => chipsTop.appendChild(makeChip(id, name, true)));
    more.forEach(([id, name]) => chipsMore.appendChild(makeChip(id, name, true)));

    document.getElementById('filter-title').textContent = 'Teams (filter)';
    document.getElementById('wheel-title').textContent  = 'Player Wheel';
    toggleMore.textContent = 'Show more teams';
    lblName.textContent = 'Player'; lblLogo.textContent = 'Photo';
    lblSub1.textContent = 'Jersey'; lblSub2.textContent = 'Nationality';
  }

  toggleMore.setAttribute('aria-expanded','false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');

  updateSpinAvailability();
  updateSelectionBanner();
}

function visibleCodes() {
  const codes = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i=>i.value);
  if (!chipsMore.hidden) codes.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i=>i.value));
  return codes;
}

function setCheckedCodes(codes=[]) {
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

// ---------- Data helpers ----------
function getCurrentData() {
  const active = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);

  if (MODE === 'player') {
    if (!PLAYERS.length) return [];
    // filter by selected team ids
    return active.length ? PLAYERS.filter(p => active.includes(String(p.club_id))) : PLAYERS;
  }
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
}

function saveHistory(){ localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory(){ history = []; saveHistory(); renderHistory(); }
function renderHistory() {
  const container = document.getElementById('history');
  container.innerHTML = '';
  if (history.length === 0) {
    container.setAttribute('aria-live','polite');
    container.innerHTML = '<div class="item">Spin the wheel to start</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url || item.image_url || '';
    i.alt = (item.team_name || item.name || 'Item') + ' image';
    const s = document.createElement('span');
    if (MODE === 'player') {
      s.textContent = `${item.name} (${item.club_name || '—'})`;
    } else {
      const full = LEAGUE_LABELS[item.league_code] || item.league_code;
      s.textContent = `${item.team_name} (${full})`;
    }
    div.append(i, s);
    container.append(div);
  });
}

// ---------- Mode switching ----------
function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn.setAttribute('aria-pressed', MODE === 'team' ? 'true' : 'false');
  modePlayerBtn.setAttribute('aria-pressed', MODE === 'player' ? 'true' : 'false');

  // Update modal field label
  mFieldLabel.textContent = (MODE === 'player') ? 'Club' : 'Stadium';

  // Redraw chips according to mode
  renderChips();
  selectedIdx = -1;
  drawWheel();
}

modeTeamBtn.addEventListener('click',  () => setMode('team'));
modePlayerBtn.addEventListener('click', () => setMode('player'));

// ---------- Selection banner ----------
function updateSelectionBanner() {
  const N = getCurrentData().length;
  perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
}

// ---------- Drawing ----------
function drawGradientIdle(ctx, W, H) {
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,W,H);

  ctx.save(); ctx.translate(W/2, H/2);
  const radius = Math.min(W, H) * 0.48;

  const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
  g.addColorStop(0.00, '#1A2C5A');
  g.addColorStop(0.35, '#21386F');
  g.addColorStop(0.65, '#0E2A57');
  g.addColorStop(1.00, '#0B1B38');

  ctx.beginPath(); ctx.arc(0,0, radius, 0, TAU); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();

  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0, radius*(i/5),0,TAU); ctx.stroke(); }
  ctx.restore();
}

function getDisplayParts(t) {
  if (MODE === 'player') {
    const name = t.name || t.team_name || 'Player';
    const img  = t.image_url || t.logo_url || '';
    const color = '#163058';
    const subParts = [];
    if (optSub1.checked && t.jersey_number) subParts.push(`#${t.jersey_number}`);
    if (optSub2.checked && t.nationality)   subParts.push(t.nationality);
    return { name, image: img, color, sub: subParts.join(' · ') };
  }
  // TEAM
  const name = t.team_name || 'Club';
  const img  = t.logo_url || '';
  const color = t.primary_color || '#4f8cff';
  const sub = (optSub1.checked && t.stadium ? t.stadium : '') ||
              (optSub2.checked ? (LEAGUE_LABELS[t.league_code] || t.league_code) : '');
  return { name, image: img, color, sub };
}

function drawWheel() {
  const data = getCurrentData();
  const N = data.length;

  const ctx = wheel.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const W = wheel.width / DPR, H = wheel.height / DPR;

  if (N === 0) { drawGradientIdle(ctx, W, H); updateSelectionBanner(); return; }

  const bothTextOn = !!optName.checked && !!optSub1.checked;
  const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;

  const hideLogos = N >= hideLogosThresholdDyn;
  const hideText  = N >= hideTextThresholdDyn;

  updateSelectionBanner();

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(W/2, H/2);

  const angleDraw = mod(currentAngle, TAU);
  ctx.rotate(angleDraw);

  const radius = Math.min(W, H) * 0.48;
  const sliceAngle = TAU / N;

  // Wedges
  for (let i=0;i<N;i++) {
    const t = data[i] || {};
    const d = getDisplayParts(t);

    const a0 = i * sliceAngle, a1 = (i+1)*sliceAngle;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0, radius, a0, a1); ctx.closePath();
    ctx.fillStyle = d.color || '#4f8cff'; ctx.fill();
  }

  // Selected rim stroke
  if (!hideText && selectedIdx >= 0 && selectedIdx < N) {
    const a0 = selectedIdx * sliceAngle, a1 = (selectedIdx+1)*sliceAngle;
    ctx.save();
    ctx.beginPath(); ctx.arc(0,0, radius-1, a0, a1);
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    ctx.restore();
  }

  // Content (images/text)
  if (!hideText || !hideLogos) {
    for (let i=0;i<N;i++) {
      const t = data[i] || {};
      const d = getDisplayParts(t);

      const a0 = i * sliceAngle, a1 = (i+1)*sliceAngle;
      const aMid = (a0 + a1) / 2;
      const sliceArc = radius * (a1 - a0);

      const nameTargetPx = clamp(12, 0.20 * sliceArc, 24);
      const subTargetPx  = clamp(9,  0.14 * sliceArc, 18);
      let   imgSize      = clamp(28, 0.40 * sliceArc, 64);
      const imgHalf = imgSize / 2, pad = 10;

      const fg  = textColorFor(d.color);
      const lum = luminance(d.color);

      ctx.save();
      ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0, radius-1, a0, a1); ctx.closePath(); ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0;
      if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xImg  = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const imgInner = xImg - sign * (imgHalf + pad);
      const xBoxLeft = Math.min(xText, imgInner);
      const maxTextW = Math.max(50, Math.abs(imgInner - xText));

      const canShowName = !hideText && optName.checked && d.name && maxTextW >= PERF.minTextWidth;
      const subText = (MODE === 'player')
        ? [ (optSub1.checked && t.jersey_number) ? `#${t.jersey_number}` : null,
            (optSub2.checked && t.nationality) ? t.nationality : null ].filter(Boolean).join(' · ')
        : ((optSub1.checked && t.stadium) ? t.stadium : (optSub2.checked ? (LEAGUE_LABELS[t.league_code] || t.league_code) : ''));
      const canShowSub  = !hideText && subText && maxTextW >= PERF.minTextWidth;
      const canShowImg  = !hideLogos && optLogo.checked && d.image && (imgHalf*2) >= PERF.minLogoBox;

      if (canShowName || canShowSub) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let nameFit = { text:'', fontPx:0 }, subFit = { text:'', fontPx:0 };
        if (canShowName) {
          nameFit = fitSingleLine(ctx, d.name, { maxWidth:maxTextW, targetPx:nameTargetPx, minPx:9, maxPx:24, weight: heavy?900:800 });
        }
        if (canShowSub) {
          const target = nameFit.fontPx ? Math.max(8, Math.round(nameFit.fontPx * 0.82)) : subTargetPx;
          subFit = fitSingleLine(ctx, subText, { maxWidth:maxTextW, targetPx:target, minPx:8, maxPx:20, weight:700 });
        }

        const gap = (canShowName && canShowSub) ? 3 : 0;
        const totalH = (canShowName?nameFit.fontPx:0) + (canShowSub?subFit.fontPx:0) + gap;
        let y = -totalH/2;

        if (canShowName) {
          y += nameFit.fontPx/2;
          ctx.font = `${heavy?900:800} ${nameFit.fontPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(nameFit.fontPx/10));
          ctx.fillStyle = fillCol;
          ctx.strokeText(nameFit.text, xBoxLeft, y);
          ctx.fillText(nameFit.text, xBoxLeft, y);
          y += nameFit.fontPx/2 + gap;
        }
        if (canShowSub) {
          y += subFit.fontPx/2;
          ctx.font = `700 ${subFit.fontPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(subFit.fontPx/10));
          ctx.fillStyle = fillCol; ctx.save(); ctx.globalAlpha = 0.92;
          ctx.strokeText(subFit.text, xBoxLeft, y);
          ctx.fillText(subFit.text, xBoxLeft, y);
          ctx.restore();
        }
        ctx.restore();
      }

      if (canShowImg) {
        ctx.save(); ctx.translate(xImg, 0);

        if (N < PERF.hideLogosThreshold) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2;
        }

        // Outer ring
        ctx.beginPath(); ctx.arc(0,0, imgHalf, 0, TAU); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();

        // Clip & draw
        ctx.save(); ctx.beginPath(); ctx.arc(0,0, imgHalf-1, 0, TAU); ctx.closePath(); ctx.clip();

        const img = cacheImg(d.image, () => requestAnimationFrame(drawWheel));
        if (img && img.complete) {
          const box = Math.max(4, 2*(imgHalf-1));
          const iw = img.naturalWidth || box, ih = img.naturalHeight || box;
          const s = Math.min(box/iw, box/ih);
          ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          const ph = (imgHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
        }
        ctx.restore(); ctx.restore();
      }

      ctx.restore(); // wedge clip
    }
  }

  ctx.restore();
}

// ---------- Result + Spin ----------
function setResult(idx) {
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  lastModalItem = t;

  if (MODE === 'player') {
    mHead.textContent = t.name || 'Player';
    mSub.textContent  = t.club_name || '';
    mLogo.src = t.image_url || '';
    mLogo.alt = (t.name || 'Player') + ' photo';
    mFieldLabel.textContent = 'Club';
    mStadium.textContent = t.club_name || '—';
  } else {
    const league = LEAGUE_LABELS[t.league_code] || t.league_code;
    mHead.textContent = t.team_name || '—';
    mSub.textContent  = league;
    mLogo.src = t.logo_url || '';
    mLogo.alt = (t.team_name || 'Club') + ' logo';
    mFieldLabel.textContent = 'Stadium';
    mStadium.textContent = t.stadium || '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));

  // history
  const entry = (MODE === 'player')
    ? { name: t.name, image_url: t.image_url, club_name: t.club_name, logo_url: t.image_url, team_name: t.name, league_code: 'PLAYER' }
    : t;
  history.unshift(entry);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();
}

function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>{ backdrop.style.display='none'; },150); }
mClose.onclick = closeModal;
backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && backdrop.style.display === 'flex') closeModal(); });

function spin() {
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true; lockUI(true);
  spinBtn.disabled = true; spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length, slice = TAU / N;
  const extraTurns = 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random() * TAU;
  const targetAngle = TAU * extraTurns + finalOffset;

  const start = performance.now();
  const duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(now){
    const p = clamp(0, (now - start) / duration, 1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();
    if (p < 1) requestAnimationFrame(anim);
    else {
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      const centerAngle = idx * slice + slice/2;
      const snapDelta = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snapDelta, TAU);

      spinning = false; lockUI(false);
      updateSpinAvailability();

      selectedIdx = idx; drawWheel(); setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

spinBtn.onclick = spin;
spinFab.onclick = spin;

// ---------- Events ----------
chipsWrap.addEventListener('change', () => {
  if (spinning) return;
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
  updateSelectionBanner();
});

toggleMore.addEventListener('click', () => {
  if (spinning) return;
  const hidden = chipsMore.hidden;
  chipsMore.hidden = !hidden;
  toggleMore.textContent = (MODE === 'player')
    ? (hidden ? 'Show fewer teams' : 'Show more teams')
    : (hidden ? 'Show fewer leagues' : 'Show more leagues');
  toggleMore.setAttribute('aria-expanded', hidden ? 'true' : 'false');
});

function onWheelToggleChange(){
  if (spinning) return;
  drawWheel();
}
optName.addEventListener('change', onWheelToggleChange);
optLogo.addEventListener('change', onWheelToggleChange);
optSub1.addEventListener('change', onWheelToggleChange);
optSub2.addEventListener('change', onWheelToggleChange);

resetHistoryBtn.addEventListener('click', ()=>{ if (!spinning) resetHistory(); });

let resizeTO;
window.addEventListener('resize', () => {
  clearTimeout(resizeTO);
  resizeTO = setTimeout(()=>{ sizeCanvas(); drawWheel(); }, 120);
}, { passive:true });

// ---------- Player loader ----------
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p;
}

async function loadPlayers() {
  const candidates = ['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
  let res = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache:'no-store' });
      if (r.ok) { res = r; break; }
    } catch {}
  }
  if (!res) { PLAYERS = []; return; }
  const raw = await res.json();

  PLAYERS = (raw || []).map(p => ({
    id: p.id || p.player_id || undefined,
    name: p.name || p.player_name || 'Player',
    image_url: resolvePublicUrl(p.image_url || p.image || p.file || ''),
    nationality: p.nationality || (p.nationality_name || ''),
    jersey_number: p.jersey_number || p.number || '',
    club_id: String(p.team_id || p.club_id || p.teamId || ''),
    club_name: p.club || p.team || p.team_name || '',
    league_code: 'PLAYER', // not used for filtering in player mode
    primary_color: '#163058'
  }));
}

// ---------- Boot ----------
(async function boot(){
  try {
    const teamsRes = await fetch(`./teams.json?v=${Date.now()}`);
    TEAMS = await teamsRes.json();
  } catch (e) {
    console.error('Failed to load teams.json', e);
    TEAMS = [];
  }

  sizeCanvas();
  renderHistory();

  // Preload players (non-blocking)
  await loadPlayers();

  // Initial chips: use saved mode if players available; else force TEAM.
  if (MODE === 'player' && !PLAYERS.length) MODE = 'team';
  modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');
  mFieldLabel.textContent = (MODE === 'player') ? 'Club' : 'Stadium';
  renderChips();

  // Defaults
  if (MODE === 'team') setCheckedCodes(['EPL']);
  drawWheel();
})();

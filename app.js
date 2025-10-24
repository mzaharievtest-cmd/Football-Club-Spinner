/* Football Spinner — unified TEAM/PLAYER wheel
   - PLAYER mode shows faces + names; modal shows #jersey · nationality
   - TEAM mode hides logos/text when more than 2 distinct leagues are selected
   - PLAYER filters = Premier League 2025/26 teams (Top 6 + “Show more clubs”)
*/

let TEAMS = [];
let PLAYERS = [];

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';

let currentAngle = 0; // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// Modal/session state
let lastModalItem = null; // team or player (normalized)
let modalRevealState = { logo: false, name: false, stadium: false, league: false };

// -------------------- DOM --------------------
const chipsWrap  = document.getElementById('chips');
const chipsTop   = document.getElementById('chipsTop');
const chipsMore  = document.getElementById('chipsMore');
const toggleMore = document.getElementById('toggleMore');

const spinBtn        = document.getElementById('spinBtn');
const spinFab        = document.getElementById('spinFab');
const resetHistoryBtn= document.getElementById('resetHistoryBtn');

const optName   = document.getElementById('optName');
const optLogo   = document.getElementById('optLogo');
const optStadium= document.getElementById('optStadium');
const optLeague = document.getElementById('optLeague'); // affects modal only

const perfTip     = document.getElementById('perfTip');
const historyEl   = document.getElementById('history');

// Mode switch
const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');
const teamView   = document.getElementById('teamView');
const playerView = document.getElementById('playerView');
const playerListEl = document.getElementById('playerList');

// Canvases
const wheel = document.getElementById('wheel');
const fx    = document.getElementById('fx');

// Modal
const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead    = document.getElementById('mHead');
const mSub     = document.getElementById('mSub');     // league/club line
const mLogo    = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium'); // stadium or #jersey · nationality

// -------------------- Utils --------------------
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod   = (x, m) => ((x % m) + m) % m;
const isModalOpen = () => backdrop && backdrop.style.display === 'flex';

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

// League labels (unchanged)
const LEAGUE_LABELS = {
  AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga", CRO:"SuperSport HNL",
  CZE:"Fortuna Liga", DEN:"Superliga", EPL:"Premier League", L1:"Ligue 1", BUN:"Bundesliga",
  GRE:"Super League 1", ISR:"Ligat ha'Al", SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien",
  POL:"PKO BP Ekstraklasa", POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga",
  SCO:"Scottish Premiership", SRB:"Super liga Srbije", LLA:"LaLiga", SWE:"Allsvenskan",
  SUI:"Super League", TUR:"Süper Lig", UKR:"Ukrainian Premier League", PLAYER:"Players"
};

// Premier League Top 6 list (chips for PLAYER mode)
const PL_TOP6 = [
  'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Arsenal', 'Tottenham Hotspur'
];

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

// -------- Single-line fitting --------
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

// -------------------- Sizing --------------------
function sizeCanvas() {
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(300, Math.round(rect.width || 640), 1200);
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  wheel.width  = Math.round(cssSize * DPR);
  wheel.height = Math.round(cssSize * DPR);
  fx.width = wheel.width; fx.height = wheel.height;

  wheel.style.width  = cssSize + 'px';
  wheel.style.height = cssSize + 'px';
  fx.style.width     = cssSize + 'px';
  fx.style.height    = cssSize + 'px';
}

// -------------------- Strict UI lock while spinning --------------------
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

// -------------------- History --------------------
function saveHistory() { localStorage.setItem('clubHistory', JSON.stringify(history)); }
function resetHistory() { history = []; saveHistory(); renderHistory(); }
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
    i.src = item.logo_url;
    i.alt = `${item.team_name} image`;
    i.onerror = () => { i.src = ''; i.alt = 'No image'; };
    const s = document.createElement('span');
    s.textContent = MODE === 'player'
      ? `${item.team_name} (${item.club || '—'})`
      : `${item.team_name} (${LEAGUE_LABELS[item.league_code] || item.league_code})`;
    div.append(i, s);
    historyEl.append(div);
  });
}

// -------------------- Reveal helpers for modal --------------------
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
function addOverlay(el){ const wrap=ensureWrapped(el); if(!wrap) return; if(!wrap.querySelector('.reveal-overlay')){ const ov=document.createElement('span'); ov.className='reveal-overlay'; wrap.appendChild(ov); } }
function removeOverlay(el){ if(!el||!el.parentElement) return; const wrap=el.parentElement; if(wrap.classList.contains('reveal-wrap')){ const ov=wrap.querySelector('.reveal-overlay'); if(ov) ov.remove(); } }
function blurElement(el){ if(!el) return; el.style.setProperty('filter','blur(14px) saturate(0.9)','important'); el.style.setProperty('-webkit-filter','blur(14px) saturate(0.9)','important'); el.style.pointerEvents='none'; addOverlay(el); }
function unblurElement(el){ if(!el) return; el.style.removeProperty('filter'); el.style.removeProperty('-webkit-filter'); el.style.pointerEvents=''; removeOverlay(el); el.setAttribute('aria-hidden','false'); }
function placeButtonAfter(el,btn){ const host=el?.parentElement?.classList.contains('reveal-wrap') ? el.parentElement : el; if (host?.insertAdjacentElement) host.insertAdjacentElement('afterend', btn); }

function applyRevealByKey(key, el, enabled, btnId, labelText) {
  if (!el) return;
  removeExistingRevealBtn(btnId);
  const revealed = !!modalRevealState[key];
  if (enabled || revealed) { unblurElement(el); return; }
  blurElement(el);
  const btn = document.createElement('button');
  btn.id = btnId; btn.type = 'button'; btn.className = 'reveal-btn';
  btn.textContent = `Show ${labelText}`;
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    modalRevealState[key] = true;
    unblurElement(el);
    btn.remove();
  }, { passive: false });
  placeButtonAfter(el, btn);
}
function updateModalRevealFromToggles() {
  if (!isModalOpen() || !lastModalItem) return;
  applyRevealByKey('logo',    mLogo,    !!optLogo?.checked,    'revealLogoBtn',    'image');
  applyRevealByKey('name',    mHead,    !!optName?.checked,    'revealNameBtn',    'name');
  applyRevealByKey('stadium', mStadium, !!optStadium?.checked, 'revealStadiumBtn', MODE === 'player' ? 'details' : 'stadium');
  applyRevealByKey('league',  mSub,     !!optLeague?.checked,  'revealLeagueBtn',  MODE === 'player' ? 'club' : 'league');
}

// -------------------- Modal open/close --------------------
function openModal(item){
  ensureRevealStyles();
  lastModalItem = item;
  modalRevealState = { logo: false, name: false, stadium: false, league: false };

  if (MODE === 'player') {
    const club = item.club || '—';
    const jersey = item.jersey_number ? `#${item.jersey_number}` : '';
    const nat = item.nationality || '';
    const details = [jersey, nat].filter(Boolean).join(' · ');
    if (mHead) mHead.textContent = item.team_name || '—';
    if (mSub)  mSub.textContent = club;
    if (mLogo) { mLogo.setAttribute('decoding','sync'); mLogo.setAttribute('loading','eager'); mLogo.src = item.logo_url || ''; mLogo.alt = (item.team_name || 'Player') + ' photo'; }
    if (mStadium) mStadium.textContent = details || '—';
  } else {
    const leagueLabel = LEAGUE_LABELS[item.league_code] || item.league_code;
    if (mHead) mHead.textContent = item.team_name || '—';
    if (mSub)  mSub.textContent = leagueLabel;
    if (mLogo) { mLogo.setAttribute('decoding','sync'); mLogo.setAttribute('loading','eager'); mLogo.src = item.logo_url || ''; mLogo.alt = (item.team_name || 'Club') + ' logo'; }
    if (mStadium) mStadium.textContent = item.stadium || '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => {
    modalEl.classList.add('show');
    updateModalRevealFromToggles();
  });
}
function closeModal(){
  modalEl.classList.remove('show');
  setTimeout(()=> { backdrop.style.display='none'; }, 150);
}
window.openModal = openModal;
window.closeModal = closeModal;

// -------------------- Selection banner --------------------
function updateSelectionBanner() {
  const N = getCurrentData().length;
  perfTip.textContent = `${N} ${MODE === 'player' ? 'players' : 'teams'} selected`;
  // Optional progress meter fill
  const max = MODE === 'player' ? 600 : 400;
  perfTip.style.setProperty('--pct', Math.min(1, N / max));
}

// -------------------- Drawing --------------------
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

  ctx.beginPath();
  ctx.arc(0,0, radius, 0, TAU);
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

// Helper: count selected league codes (TEAM mode)
function selectedLeagueCount() {
  const codes = Array.from(chipsWrap.querySelectorAll('input:checked')).map(i => i.value);
  return new Set(codes).size;
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

  // DYNAMIC THRESHOLDS
  const bothTextOn = !!optName?.checked && !!optStadium?.checked;
  const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
  const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;

  let hideLogos = N >= hideLogosThresholdDyn;
  let hideText  = N >= hideTextThresholdDyn;

  // League-limit rule (TEAM only): if > 2 leagues selected, hide *everything*
  if (MODE === 'team' && selectedLeagueCount() > 2) {
    hideLogos = true;
    hideText  = true;
  }

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

      const canShowName    = !hideText && optName?.checked && t.team_name && maxTextWidth >= PERF.minTextWidth;
      const canShowStadium = !hideText && optStadium?.checked && t.stadium && maxTextWidth >= PERF.minTextWidth; // in PLAYER: #jersey · nationality
      const canShowLogo    = !hideLogos && optLogo?.checked && t.logo_url && (logoHalf * 2) >= PERF.minLogoBox;

      // Name + secondary line
      if (canShowName || canShowStadium) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let namePx = 0, stadPx = 0;
        let nameFit = { text: '', fontPx: 0 };
        let stadFit = { text: '', fontPx: 0 };

        if (canShowName) {
          nameFit = fitSingleLine(ctx, t.team_name || '', {
            maxWidth: maxTextWidth,
            targetPx: nameTargetPx,
            minPx: 9,
            maxPx: 24,
            weight: heavy ? 900 : 800
          });
          namePx = nameFit.fontPx;
        }

        const stadTarget = (canShowName && namePx) ? Math.max(8, Math.round(namePx * 0.82)) : stadiumTargetPx;
        if (canShowStadium) {
          stadFit = fitSingleLine(ctx, t.stadium || '', {
            maxWidth: maxTextWidth,
            targetPx: stadTarget,
            minPx: 8,
            maxPx: 20,
            weight: 700
          });
          stadPx = stadFit.fontPx;
        }

        const gap = (canShowName && canShowStadium) ? 3 : 0;
        const totalH = (canShowName ? namePx : 0) + (canShowStadium ? stadPx : 0) + gap;
        let yCursor = -totalH / 2;

        if (canShowName) {
          yCursor += namePx / 2;
          ctx.font = `${heavy ? 900 : 800} ${namePx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(namePx / 10));
          ctx.fillStyle = fillCol;
          ctx.strokeText(nameFit.text, xBoxLeft, yCursor);
          ctx.fillText(nameFit.text, xBoxLeft, yCursor);
          yCursor += namePx / 2 + gap;
        }

        if (canShowStadium) {
          yCursor += stadPx / 2;
          ctx.font = `700 ${stadPx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = Math.max(1, Math.round(stadPx / 10));
          ctx.fillStyle = fillCol;
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.strokeText(stadFit.text, xBoxLeft, yCursor);
          ctx.fillText(stadFit.text, xBoxLeft, yCursor);
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
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;
        }

        // Ring
        ctx.beginPath();
        ctx.arc(0, 0, logoHalf, 0, TAU);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();

        // Image
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

      ctx.restore(); // wedge clip
    }
  }

  ctx.restore();
}

// -------------------- Result + Spin --------------------
function setResult(idx){
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  history.unshift(t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory();
  renderHistory();

  // Preload & open modal
  if (t.logo_url) {
    const img = getLogo(t.logo_url, () => openModal(t));
    if (img && img.complete) openModal(t);
  } else {
    openModal(t);
  }
}

function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) return;

  spinning = true;
  lockUI(true);
  spinBtn.disabled = true;
  spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;

  const extraTurns  = 6 + Math.floor(Math.random()*3); // 6..8
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

      // Snap the chosen slice center under the pointer
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

// -------------------- Filters / Chips --------------------
function makeChip(value, labelText, checked) {
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${value}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${labelText}">
    <span class="chip-text" title="${labelText}">${labelText}</span>
  `;
  return label;
}

// TEAM mode chips (by league codes)
const TOP5 = ['EPL','SA','BUN','L1','LLA'];
function renderChipsTeam() {
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
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');

  // Quick-pick labels
  const qpTop = document.getElementById('qpTop5');
  if (qpTop) qpTop.textContent = 'Top 5';
}

// PLAYER mode chips (by clubs; Top 6 first)
function allPremierLeagueClubsFromPlayers() {
  const clubs = [...new Set(PLAYERS.map(p => String(p.club || '').trim()).filter(Boolean))];
  // keep Top6 first, then the rest sorted
  const rest = clubs.filter(c => !PL_TOP6.includes(c)).sort((a,b)=>a.localeCompare(b));
  return [...PL_TOP6.filter(c => clubs.includes(c)), ...rest];
}
function renderChipsPlayer() {
  const clubs = allPremierLeagueClubsFromPlayers();
  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';

  const top = clubs.filter(c => PL_TOP6.includes(c));
  const more= clubs.filter(c => !PL_TOP6.includes(c));

  top.forEach(c => chipsTop.appendChild(makeChip(c, c, true)));
  more.forEach(c => chipsMore.appendChild(makeChip(c, c, false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more Premier League clubs';
  toggleMore.setAttribute('aria-expanded', 'false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');

  // Quick-pick labels
  const qpTop = document.getElementById('qpTop5');
  if (qpTop) qpTop.textContent = 'Top 6';
}

function renderChips() {
  if (MODE === 'player') renderChipsPlayer();
  else renderChipsTeam();
}

// Only select visible codes (league codes in TEAM, club names in PLAYER)
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
  if (getCurrentData().length === 0) perfTip.textContent = MODE === 'player' ? 'Select at least one club.' : 'Please select at least one league.';
}

// Current dataset (TEAM=by league; PLAYER=by club)
function getCurrentData() {
  const active = Array.from(document.querySelectorAll('#chips input:checked')).map(i => i.value);
  if (MODE === 'player') {
    if (!PLAYERS.length) return [];
    // active contains club names
    return active.length ? PLAYERS.filter(p => active.includes(p.club)) : PLAYERS;
  }
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSpinAvailability() {
  const n = getCurrentData().length;
  spinBtn && (spinBtn.disabled = n === 0);
  spinFab && (spinFab.disabled = n === 0);
}

// -------------------- PLAYER data loader --------------------
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
function resolvePublicUrl(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p.replace(/^\/+/, '');
}
function slugifyName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// Optional custom mappings for mismatched filenames
const PLAYER_IMAGE_MAP = {
  'bukayo saka': '/players/saka.png'
};

function imageForPlayerName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (PLAYER_IMAGE_MAP[key]) return PLAYER_IMAGE_MAP[key];
  const slug = slugifyName(name);
  return `/players/${slug}.png`;
}

async function tryFetchPlayers() {
  const candidates = ['/data/players.json', '/players/players.json', new URL('./players/players.json', location.href).toString()];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return res;
    } catch {}
  }
  return null;
}

async function loadPlayers() {
  const res = await tryFetchPlayers();
  if (!res) throw new Error('players.json not found');

  const raw = await res.json();

  PLAYERS = (raw || []).map(p => {
    const name = p.name || p.player_name || 'Player';
    const club = p.club || p.team || '';
    const fromJson = p.image_url || p.image || p.file || p.file_url || '';
    const img = resolvePublicUrl(fromJson) || imageForPlayerName(name);
    const jersey = p.jersey_number || p.number || '';
    const nationality = p.nationality || p.country || '';

    // Reuse the wheel schema:
    return {
      isPlayer: true,
      team_name: name,        // primary line on wheel
      logo_url: img,          // photo
      league_code: 'PLAYER',  // not used for filtering in PLAYER mode
      primary_color: '#163058',
      stadium: [jersey ? `#${jersey}` : '', nationality].filter(Boolean).join(' · '), // secondary line on wheel
      // extras used in modal/history:
      name, club, image_url: img,
      jersey_number: jersey,
      nationality
    };
  });

  // Optional preview list
  if (playerListEl) {
    playerListEl.innerHTML = '';
    PLAYERS.slice(0, 80).forEach(pl => {
      const el = document.createElement('div');
      el.className = 'player-item';
      el.innerHTML = `<img src="${pl.logo_url}" alt="${pl.name}" width="40" height="40" style="border-radius:10px;object-fit:cover;margin-right:8px"> ${pl.name} <span style="opacity:.7;margin-left:6px">(${pl.club || ''})</span>`;
      playerListEl.appendChild(el);
    });
  }
}

// -------------------- Events / Boot --------------------
function setupEventListeners() {
  // Mode switch
  modeTeamBtn?.addEventListener('click', () => setMode('team'));
  modePlayerBtn?.addEventListener('click', async () => {
    await setMode('player');
  });

  // Chips changes
  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    updateSpinAvailability();
    updateSelectionBanner();
    updateQuickPickActive();
  });

  // Toggle more
  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    if (MODE === 'player') {
      toggleMore.textContent = hidden ? 'Show fewer clubs' : 'Show more Premier League clubs';
    } else {
      toggleMore.textContent = hidden ? 'Show fewer leagues' : 'Show more leagues';
    }
    toggleMore.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    updateQuickPickActive();
  });

  // Quick picks
  const qpAll  = document.getElementById('qpAll');
  const qpNone = document.getElementById('qpNone');
  const qpTop5 = document.getElementById('qpTop5');

  function setActive(btn) {
    [qpAll, qpNone, qpTop5].forEach(b => b?.classList?.toggle('active', b === btn));
  }

  qpAll.onclick  = () => { if (spinning) return; setCheckedCodes(visibleCodes()); setActive(qpAll); };
  qpNone.onclick = () => { if (spinning) return; setCheckedCodes([]); setActive(qpNone); };
  qpTop5.onclick = () => {
    if (spinning) return;
    if (MODE === 'player') {
      const top = PL_TOP6.filter(c => visibleCodes().includes(c));
      setCheckedCodes(top);
    } else {
      const TOP5 = ['EPL','SA','BUN','L1','LLA'];
      setCheckedCodes(TOP5.filter(c => visibleCodes().includes(c)));
    }
    setActive(qpTop5);
  };

  function updateQuickPickActive() {
    const vis = new Set(visibleCodes());
    const sel = Array.from(chipsWrap.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    const selVisible = sel.filter(c => vis.has(c));

    const allVisibleSelected = selVisible.length === vis.size && Array.from(vis).every(c => selVisible.includes(c));
    const noneSelected = selVisible.length === 0;

    let topList = MODE === 'player' ? PL_TOP6.filter(c => vis.has(c)) : ['EPL','SA','BUN','L1','LLA'].filter(c => vis.has(c));
    const topSelectedOnly = selVisible.length === topList.length && topList.every(c => selVisible.includes(c));

    if (allVisibleSelected) setActive(qpAll);
    else if (noneSelected) setActive(qpNone);
    else if (topSelectedOnly) setActive(qpTop5);
    else setActive(null);
  }

  // Show-on-wheel toggles — redraw + update modal reveal
  const onWheelToggleChange = () => {
    if (spinning) return;
    drawWheel();
    if (isModalOpen()) updateModalRevealFromToggles();
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange); // modal only

  // Spin actions
  spinBtn.onclick = spin;
  spinFab.onclick = spin;

  // History & modal
  resetHistoryBtn.addEventListener('click', () => { if (!spinning) resetHistory(); });
  mClose.onclick = () => { if (!spinning) closeModal(); };
  backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  // Resize
  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { sizeCanvas(); drawWheel(); }, 120);
  }, { passive: true });
}

async function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn   && modeTeamBtn.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn && modePlayerBtn.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn   && modeTeamBtn.setAttribute('aria-pressed', MODE === 'team' ? 'true':'false');
  modePlayerBtn && modePlayerBtn.setAttribute('aria-pressed', MODE === 'player' ? 'true':'false');

  teamView   && teamView.classList.toggle('hidden', MODE === 'player');
  playerView && playerView.classList.toggle('hidden', MODE === 'team');

  if (MODE === 'player') {
    // Load players once
    if (!PLAYERS.length) {
      try { await loadPlayers(); }
      catch (e) {
        console.warn('players.json unavailable; reverting to TEAM', e);
        MODE = 'team';
        setMode('team');
        return;
      }
    }
    renderChipsPlayer();
    // Default selection = Top 6 visible
    setCheckedCodes(PL_TOP6.filter(c => visibleCodes().includes(c)));
  } else {
    renderChipsTeam();
    setCheckedCodes(['EPL']);
  }

  selectedIdx = -1;
  sizeCanvas();
  drawWheel();
  updateSpinAvailability();
  updateSelectionBanner();
}

// -------------------- Boot --------------------
fetch(`./teams.json?v=${Date.now()}`)
  .then(res => res.json())
  .then(async data => {
    TEAMS = data;
    renderHistory();
    sizeCanvas();
    setupEventListeners();

    // Default: render TEAM chips, then reflect saved mode
    renderChipsTeam();
    setCheckedCodes(['EPL']);
    drawWheel();

    // If user previously left in PLAYER mode, switch now
    if (MODE === 'player') await setMode('player');
  })
  .catch(err => {
    console.error('Failed to load teams.json', err);
    drawWheel();
  });

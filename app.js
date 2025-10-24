// Football Club Spinner — app.js (TEAM + PLAYER)
// - PLAYER mode: shows player faces/names; filters by Premier League clubs (Top-6 preset).
// - Hides all wheel content in PLAYER mode when > 50 players selected.
// - Modal in PLAYER mode: club subtitle + separate badges for jersey & nationality (with toggles).
// - TEAM mode unchanged visually (small fixes; league-on-wheel never shown on wedges).

/* =================== State =================== */
let TEAMS = [];
let PLAYERS = [];

let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';
let currentAngle = 0;               // radians
let spinning = false;
let selectedIdx = -1;
let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

// For modal "reveal" buttons in TEAM mode
let lastModalItem = null;
let modalRevealState = { logo:false, name:false, stadium:false, league:false };

/* =================== DOM =================== */
const chipsWrap   = document.getElementById('chips');
const chipsTop    = document.getElementById('chipsTop');
const chipsMore   = document.getElementById('chipsMore');
const toggleMore  = document.getElementById('toggleMore');

const spinBtn     = document.getElementById('spinBtn');
const spinFab     = document.getElementById('spinFab');
const resetHistoryBtn = document.getElementById('resetHistoryBtn');

const optName     = document.getElementById('optName');   // TEAM: Name   | PLAYER: Name
const optLogo     = document.getElementById('optLogo');   // TEAM: Logo   | PLAYER: Image
const optStadium  = document.getElementById('optStadium'); // TEAM only
const optLeague   = document.getElementById('optLeague');  // TEAM only
const optNation   = document.getElementById('optNation');  // PLAYER only (optional in HTML)
const optJersey   = document.getElementById('optJersey');  // PLAYER only (optional in HTML)

const currentText = document.getElementById('currentText');
const currentLogo = document.getElementById('currentLogo');

const historyEl   = document.getElementById('history');

const backdrop = document.getElementById('backdrop');
const modalEl  = document.getElementById('modal');
const mClose   = document.getElementById('mClose');
const mHead    = document.getElementById('mHead');
const mSub     = document.getElementById('mSub');
const mLogo    = document.getElementById('mLogo');
const mStadium = document.getElementById('mStadium'); // reused to host jersey/nation badges for PLAYER

const qpAll   = document.getElementById('qpAll');
const qpNone  = document.getElementById('qpNone');
const qpTop5  = document.getElementById('qpTop5');   // TEAM: Top 5   | PLAYER: Top 6
const perfTip = document.getElementById('perfTip');

const wheel = document.getElementById('wheel');
const fx    = document.getElementById('fx');

const modeTeamBtn   = document.getElementById('modeTeam');
const modePlayerBtn = document.getElementById('modePlayer');
const teamView      = document.getElementById('teamView');
const playerView    = document.getElementById('playerView');
const playerListEl  = document.getElementById('playerList'); // optional mini list

/* =================== Constants =================== */
const TAU = Math.PI * 2;
const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;

const PERF = {
  hideLogosThreshold: 80,
  hideTextThreshold: 140,
  minTextWidth: 44,
  minLogoBox: 28
};

// Player hard “content off” limit
const PLAYER_CONTENT_OFF_THRESHOLD = 50; // > 50 players → show wedges only

// Top-6 Premier League clubs for Player preset
const TOP6_CLUBS = [
  'Arsenal FC', 'Chelsea FC', 'Liverpool FC',
  'Manchester City', 'Manchester United', 'Tottenham Hotspur'
];

/* =================== Helpers =================== */
const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
const mod = (x, m) => ((x % m) + m) % m;

const IMG_CACHE = new Map();
function getImage(url, onLoad) {
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
function fitSingleLine(ctx, text, { maxWidth, targetPx, minPx=9, maxPx=28, weight=800, fontFamily='Inter, system-ui, sans-serif' }){
  let px = clamp(minPx, Math.round(targetPx), maxPx);
  ctx.font = `${weight} ${px}px ${fontFamily}`;
  if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated:false };
  while (px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, fontPx: px, truncated:false };
  }
  let s = (text || '').trim();
  while (s && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0,-1);
  return { text: (s || '') + '…', fontPx: minPx, truncated:true };
}

/* =================== Mode switching =================== */
modeTeamBtn?.addEventListener('click',  () => setMode('team'));
modePlayerBtn?.addEventListener('click', () => setMode('player'));

function setMode(next){
  if (next === MODE) return;

  MODE = next;
  localStorage.setItem('fsMode', MODE);

  modeTeamBtn?.classList.toggle('mode-btn-active', MODE === 'team');
  modePlayerBtn?.classList.toggle('mode-btn-active', MODE === 'player');
  modeTeamBtn?.setAttribute('aria-pressed', MODE === 'team' ? 'true' : 'false');
  modePlayerBtn?.setAttribute('aria-pressed', MODE === 'player' ? 'true' : 'false');

  teamView?.classList.toggle('hidden', MODE === 'player');
  playerView?.classList.toggle('hidden', MODE === 'team');

  // Rebuild chips for the chosen mode
  renderChips();
  selectedIdx = -1;
  drawWheel();
  updateSpinAvailability();
}

/* =================== Data selection =================== */
function getActiveChipValues(){
  // Gather all checked chip values (either league codes for TEAM or club names for PLAYER)
  return Array.from(chipsWrap.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}

function getCurrentData(){
  const active = getActiveChipValues();

  if (MODE === 'player') {
    if (!PLAYERS.length) return [];
    // No chips selected → none
    if (!active.length) return [];
    return PLAYERS.filter(p => active.includes(p.club || ''));
  }

  // TEAM mode (always filter by selected leagues)
  return TEAMS.filter(t => active.includes(t.league_code));
}

function updateSpinAvailability(){
  const n = getCurrentData().length;
  if (spinBtn) spinBtn.disabled = n === 0;
  if (spinFab) spinFab.disabled = n === 0;
}

/* =================== Canvas sizing =================== */
function sizeCanvas(){
  const rect = (wheel.parentElement || wheel).getBoundingClientRect();
  const cssSize = clamp(320, Math.round(rect.width || 640), 1200);
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

/* =================== Chips (TEAM vs PLAYER) =================== */
const TOP5_LEAGUES = ['EPL','SA','BUN','L1','LLA'];

function makeChip(codeOrName, labelText, checked){
  const idVal = codeOrName;
  const label = document.createElement('label');
  label.className = 'chip';
  label.innerHTML = `
    <input type="checkbox" value="${idVal}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${labelText}">
    <span class="chip-text" title="${labelText}">${labelText}</span>
  `;
  return label;
}

function renderChipsTeam(){
  const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
  const topCodes = TOP5_LEAGUES.filter(c => allCodes.includes(c));
  const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';
  topCodes.forEach(code => chipsTop.appendChild(makeChip(code, leagueLabel(code), code === 'EPL')));
  moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, leagueLabel(code), false)));

  chipsMore.hidden = true;
  toggleMore.textContent = 'Show more leagues';
  toggleMore.setAttribute('aria-expanded','false');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');

  // Quick pick labels
  qpTop5?.classList.remove('hidden');
  qpTop5 && (qpTop5.textContent = 'Top 5');
}

function renderChipsPlayer(){
  // Build club list from PLAYERS
  const clubs = [...new Set(PLAYERS.map(p => p.club).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  // Put top-6 up top, rest into "more"
  const top = TOP6_CLUBS.filter(n => clubs.includes(n));
  const rest = clubs.filter(n => !top.includes(n));

  chipsTop.innerHTML = '';
  chipsMore.innerHTML = '';
  top.forEach(name => chipsTop.appendChild(makeChip(name, name, true)));
  rest.forEach(name => chipsMore.appendChild(makeChip(name, name, false)));

  chipsMore.hidden = false; // show some by default? keep collapsed initially:
  chipsMore.hidden = true;

  toggleMore.textContent = chipsMore.hidden ? 'Show more Premier League clubs' : 'Show fewer clubs';
  toggleMore.setAttribute('aria-expanded', chipsMore.hidden ? 'false' : 'true');
  toggleMore.disabled = false;
  toggleMore.classList.remove('disabled');

  // Quick pick label (Top 6)
  qpTop5?.classList.remove('hidden');
  qpTop5 && (qpTop5.textContent = 'Top 6');
}

function renderChips(){
  if (!chipsWrap) return;
  if (MODE === 'player') renderChipsPlayer(); else renderChipsTeam();
  updateSpinAvailability();
  updateSelectionBanner();
}

function visibleChipValues(){
  // Values of visible chips (useful for quick-picks)
  const values = Array.from(chipsTop.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
  if (!chipsMore.hidden) {
    values.push(...Array.from(chipsMore.querySelectorAll('input[type="checkbox"]')).map(i => i.value));
  }
  return values;
}

function setCheckedChipValues(values){
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

/* =================== Labels =================== */
function leagueLabel(code){
  const MAP = {
    AUT:'Austrian Bundesliga', BEL:'Jupiler Pro League', BUL:'efbet Liga',
    CRO:'SuperSport HNL', CZE:'Fortuna Liga', DEN:'Superliga', EPL:'Premier League',
    L1:'Ligue 1', BUN:'Bundesliga', GRE:'Super League 1', ISR:"Ligat ha'Al", SA:'Serie A',
    NED:'Eredivisie', NOR:'Eliteserien', POL:'PKO BP Ekstraklasa', POR:'Liga Portugal',
    ROU:'SuperLiga', RUS:'Premier Liga', SCO:'Scottish Premiership', SRB:'Super liga Srbije',
    LLA:'LaLiga', SWE:'Allsvenskan', SUI:'Super League', TUR:'Süper Lig', UKR:'Ukrainian Premier League',
    PLAYER:'Players'
  };
  return MAP[code] || code;
}

/* =================== Selection banner =================== */
function updateSelectionBanner(){
  const N = getCurrentData().length;
  const label = MODE === 'player' ? 'players' : 'teams';
  if (perfTip){
    perfTip.style.setProperty('--pct', Math.min(1, N / 120));
    perfTip.textContent = `${N} ${label} selected`;
  }
}

/* =================== Drawing =================== */
function drawGradientIdle(ctx, W, H){
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2, H/2);

  const radius = Math.min(W,H)*0.48;
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
  const W = wheel.width / DPR;
  const H = wheel.height / DPR;

  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);

  if (N === 0) {
    drawGradientIdle(ctx, W, H);
    updateSelectionBanner();
    return;
  }

  // Decide visibility
  let hideLogos = false, hideText = false;

  if (MODE === 'player') {
    // Hard cap: if too many players, show wedges only
    if (N > PLAYER_CONTENT_OFF_THRESHOLD) {
      hideLogos = true; hideText = true;
    } else {
      // Show both, unless caller unticked checkboxes
      hideLogos = !optLogo?.checked;
      hideText  = !optName?.checked && !optNation?.checked && !optJersey?.checked;
    }
  } else {
    // TEAM original thresholds
    const bothTextOn = !!optName?.checked && !!optStadium?.checked;
    const hideTextThresholdDyn  = bothTextOn ? 55 : PERF.hideTextThreshold;
    const hideLogosThresholdDyn = bothTextOn ? Math.min(55, PERF.hideLogosThreshold) : PERF.hideLogosThreshold;
    hideLogos = N >= hideLogosThresholdDyn || !optLogo?.checked;
    hideText  = N >= hideTextThresholdDyn  || (!optName?.checked && !optStadium?.checked);
  }

  updateSelectionBanner();

  ctx.imageSmoothingEnabled = !hideText;
  ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(mod(currentAngle, TAU));

  const radius = Math.min(W,H)*0.48;
  const sliceAngle = TAU / N;

  // Wedges (colors: use team primary; for players use neutral)
  for (let i=0;i<N;i++){
    const t = data[i] || {};
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.arc(0,0, radius, i*sliceAngle, (i+1)*sliceAngle);
    ctx.closePath();
    ctx.fillStyle = (MODE === 'player') ? '#23406b' : (t.primary_color || '#4f8cff');
    ctx.fill();
  }

  // Selected rim
  if (!hideText && selectedIdx >= 0 && selectedIdx < N){
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

  if (!hideText || !hideLogos){
    for (let i=0;i<N;i++){
      const t = data[i] || {};
      const a0 = i*sliceAngle, a1 = (i+1)*sliceAngle, aMid = (a0+a1)/2;
      const sliceArc = radius * (a1 - a0);
      const nameTargetPx = clamp(12, 0.20 * sliceArc, 24);
      let logoSize = clamp(28, 0.40 * sliceArc, 64);
      const logoHalf = logoSize/2;
      const pad = 10;

      // Map props per mode
      let text1 = '', imgUrl = '', fg='#fff', lum=0, subbits = [];
      if (MODE === 'player'){
        text1 = t.name || t.team_name || 'Player';
        imgUrl = t.image_url || t.logo_url || '';
        fg = '#fff'; lum = 0;
        if (optNation?.checked && t.nationality) subbits.push(t.nationality);
        if (optJersey?.checked && t.jersey_number) subbits.push(`#${t.jersey_number}`);
      } else {
        text1 = t.team_name || '';
        imgUrl = t.logo_url || '';
        fg = textColorFor(t.primary_color); lum = luminance(t.primary_color);
      }
      const subline = subbits.join(' · ');

      ctx.save();
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0,0, radius - 1, a0, a1);
      ctx.closePath(); ctx.clip();

      ctx.rotate(aMid);
      const needFlip = Math.cos(aMid) < 0; if (needFlip) ctx.rotate(Math.PI);
      const sign = needFlip ? -1 : 1;

      const xLogo = sign * (radius * 0.74);
      const xText = sign * (radius * 0.42);
      const logoInner = xLogo - sign * (logoHalf + pad);
      const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

      const canShowName  = !hideText && !!optName?.checked && text1 && maxTextWidth >= PERF.minTextWidth;
      const canShowLogo  = !hideLogos && !!optLogo?.checked && imgUrl && (logoHalf*2) >= PERF.minLogoBox;
      const canShowSub   = !hideText && MODE==='player' && subline && maxTextWidth >= PERF.minTextWidth;

      // Text block
      if (canShowName || canShowSub){
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const heavy = (lum >= 0.35 && lum <= 0.45);
        const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
        const fillCol = fg;

        let namePx = 0, subPx = 0;
        if (canShowName){
          const fit = fitSingleLine(ctx, text1, {
            maxWidth: maxTextWidth, targetPx: nameTargetPx,
            minPx: 9, maxPx: 24, weight: heavy ? 900 : 800
          });
          namePx = fit.fontPx;
          ctx.font = `${heavy?900:800} ${namePx}px Inter, system-ui, sans-serif`;
          ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(namePx/10));
          ctx.fillStyle = fillCol;
          ctx.strokeText(fit.text, Math.min(xText, logoInner), - (canShowSub ? 6 : 0));
          ctx.fillText  (fit.text, Math.min(xText, logoInner), - (canShowSub ? 6 : 0));
        }
        if (canShowSub){
          subPx = Math.max(9, Math.round((namePx||nameTargetPx) * 0.8));
          ctx.font = `700 ${subPx}px Inter, system-ui, sans-serif`;
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = fillCol;
          ctx.fillText(subline, Math.min(xText, logoInner), (canShowName ? (subPx + 2) : 0));
        }
        ctx.restore();
      }

      // Image
      if (canShowLogo){
        ctx.save();
        ctx.translate(xLogo,0);

        ctx.beginPath();
        ctx.arc(0,0, logoHalf, 0, TAU);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();

        ctx.save();
        ctx.beginPath(); ctx.arc(0,0, logoHalf - 1, 0, TAU); ctx.closePath(); ctx.clip();

        const img = getImage(imgUrl, () => requestAnimationFrame(drawWheel));
        if (img && img.complete){
          const box = Math.max(4, 2*(logoHalf-1));
          const iw = img.naturalWidth||box, ih = img.naturalHeight||box;
          const s = Math.min(box/iw, box/ih);
          ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          const ph = (logoHalf-3)*2; ctx.fillRect(-ph/2, -ph/2, ph, ph);
        }
        ctx.restore(); // clip
        ctx.restore(); // translate
      }

      ctx.restore(); // slice clip
    }
  }

  ctx.restore();
}

/* =================== Result + Spin =================== */
function setResult(idx){
  const data = getCurrentData();
  const t = data[idx];
  selectedIdx = idx;
  drawWheel();

  if (MODE === 'player'){
    if (currentText) currentText.textContent = t.name + (t.club ? ` · ${t.club}` : '');
    if (currentLogo) currentLogo.src = t.image_url || '';
  } else {
    const league = leagueLabel(t.league_code);
    if (currentText) currentText.textContent = `${t.team_name} · ${league}`;
    if (currentLogo) currentLogo.src = t.logo_url || '';
  }

  // history (store raw item)
  history.unshift(MODE === 'player'
    ? { team_name: t.name, logo_url: t.image_url, league_code: 'PLAYER' }
    : t);
  if (history.length > 50) history = history.slice(0,50);
  saveHistory(); renderHistory();

  // open modal
  if (MODE === 'player') {
    preloadModalImage(t.image_url, () => openModal(t));
  } else {
    preloadModalImage(t.logo_url, () => openModal(t));
  }
}

function spin(){
  if (spinning) return;
  const data = getCurrentData();
  if (!data.length) { currentText && (currentText.textContent = MODE==='player'?'Select at least one club.':'Please select at least one league.'); return; }

  spinning = true;
  lockUI(true);
  spinBtn.disabled = true; spinFab.disabled = true;
  selectedIdx = -1;

  const N = data.length;
  const slice = TAU / N;
  const extraTurns = 6 + Math.floor(Math.random()*3);
  const finalOffset = Math.random()*TAU;
  const targetAngle = TAU*extraTurns + finalOffset;

  const start = performance.now(), duration = 3200;
  const easeOutCubic = x => 1 - Math.pow(1-x, 3);

  function anim(now){
    const p = clamp(0, (now-start)/duration, 1);
    currentAngle = targetAngle * easeOutCubic(p);
    drawWheel();

    if (p < 1) requestAnimationFrame(anim);
    else {
      const theta = mod(currentAngle, TAU);
      const offset = mod(POINTER_ANGLE - theta, TAU);
      const idx = Math.floor(offset / slice) % N;

      const centerAngle = idx*slice + slice/2;
      const snap = mod(centerAngle - offset, TAU);
      currentAngle = mod(currentAngle + snap, TAU);

      spinning = false; lockUI(false);
      const hasAny = getCurrentData().length > 0;
      spinBtn.disabled = !hasAny; spinFab.disabled = !hasAny;

      selectedIdx = idx; drawWheel(); setResult(idx);
    }
  }
  requestAnimationFrame(anim);
}

/* =================== Modal =================== */
function ensureRevealStyles(){
  if (document.getElementById('reveal-style')) return;
  const s = document.createElement('style');
  s.id = 'reveal-style';
  s.textContent = `
    .reveal-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;margin-left:10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.6);background:#152036;color:#fff;font-weight:800;letter-spacing:.03em;cursor:pointer;user-select:none;z-index:3;position:relative;white-space:nowrap}
    #mHead + .reveal-btn{display:inline-block;margin-left:0}
    .reveal-wrap{position:relative;display:inline-block;z-index:0}
    .reveal-overlay{position:absolute;inset:0;border-radius:inherit;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:transparent;pointer-events:none;z-index:2}
    .badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid rgba(90,161,255,.16);background:rgba(17,28,48,.85);font-weight:800}
  `;
  document.head.appendChild(s);
}
function openModal(item){
  ensureRevealStyles();
  lastModalItem = item;
  modalRevealState = { logo:false, name:false, stadium:false, league:false };

  if (MODE === 'player'){
    const name = item.name || 'Player';
    const club = item.club || '—';
    if (mHead) mHead.textContent = name;
    if (mSub)  mSub.textContent  = club;
    if (mLogo){ mLogo.decoding='sync'; mLogo.loading='eager'; mLogo.src = item.image_url || ''; mLogo.alt = `${name} photo`; }
    if (mStadium){
      // insert separate badges (jersey + nationality)
      const parts = [];
      const wantJ = optJersey?.checked !== false;     // default true if missing toggle
      const wantN = optNation?.checked !== false;     // default true if missing toggle
      if (wantJ && item.jersey_number) parts.push(`<span id="mBadgeJersey" class="badge">#${item.jersey_number}</span>`);
      if (wantN && item.nationality)  parts.push(`<span id="mBadgeNation" class="badge">${item.nationality}</span>`);
      mStadium.innerHTML = parts.join(' ');
    }
  } else {
    const league = leagueLabel(item.league_code);
    if (mHead)   mHead.textContent = item.team_name || '—';
    if (mSub)    mSub.textContent  = league;
    if (mLogo)   { mLogo.decoding='sync'; mLogo.loading='eager'; mLogo.src = item.logo_url || ''; mLogo.alt = (item.team_name || 'Club') + ' logo'; }
    if (mStadium) mStadium.textContent = item.stadium || '—';
  }

  backdrop.style.display = 'flex';
  requestAnimationFrame(()=> modalEl.classList.add('show'));
}
function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none', 150); }
window.openModal = openModal; window.closeModal = closeModal;

function preloadModalImage(url, cb){
  if (!url) { cb && cb(); return; }
  const img = getImage(url, ()=>done());
  let called=false; function done(){ if(called) return; called=true; cb&&cb(); }
  if (img) {
    try { if (img.complete) done(); else if (typeof img.decode==='function') img.decode().then(done).catch(done); }
    catch { done(); }
  } else done();
}

/* =================== History + UI lock =================== */
function saveHistory(){ localStorage.setItem('clubHistory', JSON.stringify(history)); }
function renderHistory(){
  if (!historyEl) return;
  historyEl.innerHTML = '';
  if (history.length === 0){
    historyEl.setAttribute('aria-live','polite');
    historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
    return;
  }
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const i = document.createElement('img');
    i.src = item.logo_url || '';
    i.alt = (item.team_name || 'item') + ' image';
    i.onerror = () => { i.src=''; i.alt='No image'; };
    const s = document.createElement('span');
    s.textContent = item.team_name;
    div.append(i,s);
    historyEl.append(div);
  });
}

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, [role="button"]';
function lockUI(lock){
  document.body.classList.toggle('ui-locked', !!lock);
  const els = document.querySelectorAll(INTERACTIVE_SELECTOR);
  els.forEach(el=>{
    if (lock){
      if (!el.dataset.lockSaved){
        el.dataset.lockSaved = '1';
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true; el.setAttribute('aria-disabled','true');
    } else {
      if (el.dataset.lockSaved === '1'){
        const prev = el.dataset.prevDisabled === '1';
        el.disabled = prev;
        if (!prev) el.removeAttribute('aria-disabled');
        delete el.dataset.lockSaved; delete el.dataset.prevDisabled;
      }
    }
  });
}

/* =================== Events =================== */
function setupEventListeners(){
  chipsWrap?.addEventListener('change', ()=>{
    if (spinning) return;
    selectedIdx = -1; drawWheel(); updateSpinAvailability(); updateSelectionBanner();
  });

  toggleMore?.addEventListener('click', ()=>{
    if (spinning) return;
    const hidden = chipsMore.hidden;
    chipsMore.hidden = !hidden;
    if (MODE === 'player'){
      toggleMore.textContent = chipsMore.hidden ? 'Show more Premier League clubs' : 'Show fewer clubs';
    } else {
      toggleMore.textContent = chipsMore.hidden ? 'Show more leagues' : 'Show fewer leagues';
    }
    toggleMore.setAttribute('aria-expanded', chipsMore.hidden ? 'false' : 'true');
  });

  // Quick picks
  qpAll && (qpAll.onclick = ()=>{ if(spinning) return; setCheckedChipValues(visibleChipValues()); qpAll.classList.add('active'); qpNone?.classList.remove('active'); qpTop5?.classList.remove('active'); });
  qpNone && (qpNone.onclick=()=>{ if(spinning) return; setCheckedChipValues([]); qpNone.classList.add('active'); qpAll?.classList.remove('active'); qpTop5?.classList.remove('active'); });
  qpTop5 && (qpTop5.onclick=()=>{
    if (spinning) return;
    if (MODE==='player') setCheckedChipValues(TOP6_CLUBS.filter(c => visibleChipValues().includes(c)));
    else setCheckedChipValues(TOP5_LEAGUES.filter(c => visibleChipValues().includes(c)));
    qpTop5.classList.add('active'); qpAll?.classList.remove('active'); qpNone?.classList.remove('active');
  });

  // Wheel toggles → redraw & update modal bits
  const onWheelToggleChange = ()=>{
    if (spinning) return;
    drawWheel();
    if (MODE==='player' && lastModalItem && backdrop.style.display==='flex'){
      // rebuild badges quickly
      openModal(lastModalItem);
    }
  };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optStadium?.addEventListener('change', onWheelToggleChange);
  optLeague?.addEventListener('change', onWheelToggleChange);
  optNation?.addEventListener('change', onWheelToggleChange);
  optJersey?.addEventListener('change', onWheelToggleChange);

  spinBtn && (spinBtn.onclick = spin);
  spinFab && (spinFab.onclick = spin);

  resetHistoryBtn?.addEventListener('click', ()=>{ if(!spinning){ history=[]; saveHistory(); renderHistory(); } });
  mClose && (mClose.onclick = ()=>{ if(!spinning) closeModal(); });
  backdrop?.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && backdrop.style.display==='flex') closeModal(); });

  let resizeTO;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=>{ sizeCanvas(); drawWheel(); }, 120);
  }, { passive:true });
}

/* =================== Player loading =================== */
const FALLBACK_SILHOUETTE = '/players/silhouette-player.png';
function resolvePublicUrl(p){
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return '/' + p;
}
function slugifyName(n){
  return String(n||'')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function imageForPlayerName(name){
  const slug = slugifyName(name);
  return `/players/${slug}.png`;
}

async function tryFetchPlayersJson(){
  const candidates = ['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
  for (const url of candidates){
    try{
      const res = await fetch(url, { cache:'no-store' });
      if (res.ok) return await res.json();
    }catch{}
  }
  return [];
}

async function loadPlayers(){
  const raw = await tryFetchPlayersJson();
  PLAYERS = (raw||[]).map(p=>{
    const name = p.name || p.player_name || 'Player';
    const img = resolvePublicUrl(p.image_url || p.image || p.file || '') || imageForPlayerName(name);
    return {
      // generic fields used by wheel
      team_name: name,        // reused for text fitting code
      logo_url: img,          // reused for image drawing
      primary_color: '#163058',
      stadium: '',
      // player specifics
      name,
      image_url: img,
      club: p.club || p.team || '',
      nationality: p.nationality || p.country || '',
      jersey_number: p.jersey_number || p.number || '',
      league_code: 'PLAYER',
      meta: p
    };
  });

  if (playerListEl){
    playerListEl.innerHTML = '';
    PLAYERS.slice(0,60).forEach(pl=>{
      const el = document.createElement('div');
      el.className = 'player-item';
      el.innerHTML = `<img src="${pl.image_url}" alt="${pl.name}" width="40" height="40" style="border-radius:10px;object-fit:cover;margin-right:8px"> ${pl.name}`;
      playerListEl.appendChild(el);
    });
  }
  return PLAYERS;
}

/* =================== Boot =================== */
fetch(`./teams.json?v=${Date.now()}`)
  .then(r=>r.json())
  .then(async data=>{
    TEAMS = data || [];

    // Try players (non-fatal)
    try { await loadPlayers(); } catch {}

    renderChips(); // based on initial MODE
    renderHistory();
    sizeCanvas();
    // In TEAM mode default to EPL selected; in PLAYER mode Top-6 preset is already applied by renderChips()
    if (MODE==='team'){
      // set EPL on
      setCheckedChipValues(['EPL']);
    } else {
      // ensure at least top-6 checked
      setCheckedChipValues(TOP6_CLUBS.filter(c => visibleChipValues().includes(c)));
    }
    drawWheel();
    setupEventListeners();

    // reflect saved toggle buttons
    modeTeamBtn?.classList.toggle('mode-btn-active', MODE === 'team');
    modePlayerBtn?.classList.toggle('mode-btn-active', MODE === 'player');
    teamView?.classList.toggle('hidden', MODE === 'player');
    playerView?.classList.toggle('hidden', MODE === 'team');
  })
  .catch(err=>{
    console.error('Failed to load teams.json', err);
    currentText && (currentText.textContent = 'Failed to load teams.');
  });

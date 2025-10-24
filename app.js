/* Football Club/Player Spinner — app.js (all-in-one)
   - TEAM mode: identical visuals
   - PLAYER mode: Image / Name / Nationality / Jersey toggles; filter by club
   - Resolves player.club from team_id using teams.json
   - Hides all wheel content when >50 players selected
*/

(() => {
  // ---------------- State ----------------
  let TEAMS = [];
  let PLAYERS = [];
  let TEAM_ID_INDEX = Object.create(null); // team_id -> {name,key}

  let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';
  let currentAngle = 0;
  let spinning = false;
  let selectedIdx = -1;
  let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

  // Modal/session state
  let lastModalItem = null;
  let modalRevealState = { logo: false, name: false, sub1: false, sub2: false };

  // ---------------- DOM ----------------
  const chipsWrap   = document.getElementById('chips');
  const chipsTop    = document.getElementById('chipsTop');
  const chipsMore   = document.getElementById('chipsMore');
  const toggleMore  = document.getElementById('toggleMore');
  const spinBtn     = document.getElementById('spinBtn');
  const spinFab     = document.getElementById('spinFab');
  const resetHistoryBtn = document.getElementById('resetHistoryBtn');

  const optName     = document.getElementById('optName');
  const optLogo     = document.getElementById('optLogo');
  const optSub1     = document.getElementById('optStadium'); // TEAM: stadium, PLAYER: nationality
  const optSub2     = document.getElementById('optLeague');  // TEAM: league,   PLAYER: jersey

  const lblName     = document.getElementById('lblName');
  const lblLogo     = document.getElementById('lblLogo');
  const lblSub1     = document.getElementById('lblSub1');
  const lblSub2     = document.getElementById('lblSub2');

  const historyEl   = document.getElementById('history');
  const perfTip     = document.getElementById('perfTip');

  const modeTeamBtn   = document.getElementById('modeTeam');
  const modePlayerBtn = document.getElementById('modePlayer');

  const wheel = document.getElementById('wheel');
  const fx    = document.getElementById('fx');

  // Modal
  const backdrop = document.getElementById('backdrop');
  const modalEl  = document.getElementById('modal');
  const mClose   = document.getElementById('mClose');
  const mHead    = document.getElementById('mHead');
  const mSub     = document.getElementById('mSub');
  const mLogo    = document.getElementById('mLogo');
  const mStadium = document.getElementById('mStadium'); // reused

  // ---------------- Utils ----------------
  const TAU = Math.PI * 2;
  const POINTER_ANGLE = ((-Math.PI / 2) + TAU) % TAU;
  const clamp = (min, v, max) => Math.max(min, Math.min(max, v));
  const mod = (x, m) => ((x % m) + m) % m;

  const PERF = {
    hideLogosThreshold: 80,
    hideTextThreshold: 140,
    minTextWidth: 44,
    minLogoBox: 28
  };

  const LEAGUE_LABELS = {
    AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga", CRO:"SuperSport HNL",
    CZE:"Fortuna Liga", DEN:"Superliga", EPL:"Premier League", L1:"Ligue 1", BUN:"Bundesliga",
    GRE:"Super League 1", ISR:"Ligat ha'Al", SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien",
    POL:"PKO BP Ekstraklasa", POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga",
    SCO:"Scottish Premiership", SRB:"Super liga Srbije", LLA:"LaLiga", SWE:"Allsvenskan",
    SUI:"Super League", TUR:"Süper Lig", UKR:"Ukrainian Premier League", PLAYER:"Players"
  };

  const TOP6 = ["Manchester City", "Liverpool FC", "Manchester United", "Chelsea FC", "Arsenal FC", "Tottenham Hotspur"];
  const TOP6_KEYS = TOP6.map(normTeamLabel);

  // Image cache
  const IMG_CACHE = new Map();
  function getLogo(url, onLoad) {
    if (!url) return null;
    const c = IMG_CACHE.get(url);
    if (c) return c.img;
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

  function normTeamLabel(s){ return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

  function resolvePublicUrl(p){ if(!p) return ''; if(/^https?:\/\//i.test(p)) return p; if(p.startsWith('/')) return p; return '/' + p; }
  function imageForPlayerName(name){
    const slug = String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    return `/players/${slug}.png`;
  }

  // ---------------- Mode switch ----------------
  function reflectModeLabels() {
    if (MODE === 'player') {
      lblName && (lblName.textContent = 'Name');
      lblLogo && (lblLogo.textContent = 'Image');
      lblSub1 && (lblSub1.textContent = 'Nationality');
      lblSub2 && (lblSub2.textContent = 'Jersey Number');
    } else {
      lblName && (lblName.textContent = 'Name');
      lblLogo && (lblLogo.textContent = 'Logo');
      lblSub1 && (lblSub1.textContent = 'Stadium');
      lblSub2 && (lblSub2.textContent = 'League');
    }
  }

  function setMode(next){
    if (next === MODE) return;
    MODE = next;
    localStorage.setItem('fsMode', MODE);
    reflectModeLabels();

    modeTeamBtn  && modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
    modePlayerBtn&& modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
    modeTeamBtn  && modeTeamBtn.setAttribute('aria-pressed', MODE==='team'?'true':'false');
    modePlayerBtn&& modePlayerBtn.setAttribute('aria-pressed', MODE==='player'?'true':'false');

    // rebuild chips according to mode
    if (MODE === 'player') {
      // if players not loaded yet, load then render
      if (!PLAYERS.length) {
        loadPlayers().then(() => {
          renderChipsForPlayer();
          selectedIdx = -1;
          sizeCanvas(); drawWheel(); updateSpinAvailability();
        }).catch(() => {
          // fallback
          MODE = 'team';
          renderChipsForTeam();
          sizeCanvas(); drawWheel(); updateSpinAvailability();
        });
      } else {
        renderChipsForPlayer();
        selectedIdx = -1; drawWheel(); updateSpinAvailability();
      }
    } else {
      renderChipsForTeam();
      selectedIdx = -1; drawWheel(); updateSpinAvailability();
    }
  }

  modeTeamBtn  && modeTeamBtn.addEventListener('click',  () => setMode('team'));
  modePlayerBtn&& modePlayerBtn.addEventListener('click', () => setMode('player'));

  // ---------------- Data helpers ----------------
  function visibleCodes(){
    const codes = Array.from(chipsTop.querySelectorAll('input[type=checkbox]')).map(i => i.value);
    if (!chipsMore.hidden) codes.push(...Array.from(chipsMore.querySelectorAll('input[type=checkbox]')).map(i => i.value));
    return codes;
  }

  function makeChip(value, checked, titleText){
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `
      <input type="checkbox" value="${value}" ${checked ? 'checked aria-checked="true"' : ''} aria-label="${titleText || value}">
      <span class="chip-text" title="${titleText || value}">${titleText || value}</span>
    `;
    return label;
  }

  function renderChipsForTeam(){
    const allCodes = [...new Set(TEAMS.map(t => t.league_code))];
    const TOP5 = ['EPL','SA','BUN','L1','LLA'];
    const topCodes = TOP5.filter(c => allCodes.includes(c));
    const moreCodes = allCodes.filter(c => !topCodes.includes(c)).sort();

    chipsTop.innerHTML = ''; chipsMore.innerHTML = '';

    topCodes.forEach(code => chipsTop.appendChild(makeChip(code, code === 'EPL', LEAGUE_LABELS[code] || code)));
    moreCodes.forEach(code => chipsMore.appendChild(makeChip(code, false, LEAGUE_LABELS[code] || code)));

    chipsMore.hidden = true;
    toggleMore.textContent = 'Show more leagues';
    toggleMore.setAttribute('aria-expanded','false');
  }

  function renderChipsForPlayer(){
    // Build club map from PLAYERS (resolved names)
    const clubs = new Map(); // key -> label
    PLAYERS.forEach(p => {
      const key = p.clubKey || '';
      const label = p.club || '';
      if (!key || !label) return;
      if (!clubs.has(key)) clubs.set(key, label);
    });

    const top6 = TOP6_KEYS.filter(k => clubs.has(k));
    const rest = [...clubs.keys()].filter(k => !top6.includes(k)).sort((a,b)=>clubs.get(a).localeCompare(clubs.get(b)));

    chipsTop.innerHTML = ''; chipsMore.innerHTML = '';
    top6.forEach(k => chipsTop.appendChild(makeChip(k, true, clubs.get(k))));
    rest.forEach(k => chipsMore.appendChild(makeChip(k, false, clubs.get(k))));

    chipsMore.hidden = true;
    toggleMore.textContent = 'Show more Premier League clubs';
    toggleMore.setAttribute('aria-expanded','false');
  }

  function getCurrentData(){
    const active = Array.from(document.querySelectorAll('#chips input:checked')).map(i => i.value);

    if (MODE === 'player') {
      if (!PLAYERS.length) return [];
      if (!active.length) return PLAYERS;
      const set = new Set(active); // clubKey values
      return PLAYERS.filter(p => set.has(p.clubKey));
    }
    // TEAM mode (filter by league_code)
    return TEAMS.filter(t => active.includes(t.league_code));
  }

  function updateSpinAvailability() {
    const n = getCurrentData().length;
    if (spinBtn) spinBtn.disabled = n === 0;
    if (spinFab) spinFab.disabled = n === 0;
    perfTip && (perfTip.textContent = `${n} ${MODE==='player' ? 'players' : 'teams'} selected`);
    perfTip && (perfTip.style.setProperty('--pct', Math.min(1, n/100)));
  }

  // ---------------- Canvas sizing ----------------
  function sizeCanvas(){
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

  // ---------------- Drawing ----------------
  function drawGradientIdle(ctx, W, H) {
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(W/2,H/2);
    const radius = Math.min(W,H) * 0.48;
    const g = ctx.createRadialGradient(0,0, radius*0.1, 0,0, radius);
    g.addColorStop(0.00,'#1A2C5A'); g.addColorStop(0.35,'#21386F'); g.addColorStop(0.65,'#0E2A57'); g.addColorStop(1.00,'#0B1B38');
    ctx.beginPath(); ctx.arc(0,0,radius,0,TAU); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle='rgba(255,255,255,0.06)';
    for (let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0,radius*(i/5),0,TAU); ctx.stroke(); }
    ctx.restore();
  }

  function drawWheel(){
    const data = getCurrentData();
    const N = data.length;
    const ctx = wheel.getContext('2d');
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const W = wheel.width / DPR, H = wheel.height / DPR;

    if (N === 0) { drawGradientIdle(ctx, W, H); updateSpinAvailability(); return; }

    // Dynamic thresholds
    let hideTextThresholdDyn = PERF.hideTextThreshold;
    let hideLogosThresholdDyn = PERF.hideLogosThreshold;

    // PLAYER special rule: if >50 selected, hide everything
    let forceHideAll = (MODE === 'player' && N > 50);
    if (forceHideAll) { hideTextThresholdDyn = 0; hideLogosThresholdDyn = 0; }

    const hideLogos = forceHideAll || (N >= hideLogosThresholdDyn) || !optLogo?.checked;
    const hideText  = forceHideAll || (N >= hideTextThresholdDyn);

    updateSpinAvailability();

    ctx.imageSmoothingEnabled = !hideText;
    ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

    ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(W/2,H/2);

    const angleDraw = mod(currentAngle, TAU);
    ctx.rotate(angleDraw);

    const radius = Math.min(W,H) * 0.48;
    const sliceAngle = TAU / N;

    // Wedges
    for (let i=0;i<N;i++){
      const t = data[i] || {};
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0,0,radius, i*sliceAngle, (i+1)*sliceAngle);
      ctx.closePath();
      ctx.fillStyle = t.primary_color || '#4f8cff';
      ctx.fill();
    }

    // Selected rim
    if (!hideText && selectedIdx >= 0 && selectedIdx < N){
      const a0 = selectedIdx*sliceAngle, a1=(selectedIdx+1)*sliceAngle;
      ctx.save(); ctx.beginPath(); ctx.arc(0,0,radius-1,a0,a1);
      ctx.lineWidth = Math.max(2, Math.round(radius*0.015));
      ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.stroke(); ctx.restore();
    }

    // Content
    if (!forceHideAll) {
      for (let i=0;i<N;i++){
        const t = data[i] || {};
        const a0 = i*sliceAngle, a1 = (i+1)*sliceAngle, aMid=(a0+a1)/2;
        const sliceArc = radius * (a1 - a0);

        // Player vs Team fields
        const title = (MODE==='player') ? (t.name || t.team_name || 'Player') : (t.team_name || 'Team');
        const sub1Text = (MODE==='player') ? (t.nationality || '') : (t.stadium || '');
        const sub2Text = (MODE==='player') ? (t.jersey_number ? `#${t.jersey_number}` : '') : ((LEAGUE_LABELS[t.league_code] || t.league_code || ''));

        const showName = !hideText && !!optName?.checked && title;
        const showSub1 = !hideText && !!optSub1?.checked && sub1Text;
        const showSub2 = !hideText && !!optSub2?.checked && sub2Text;
        const showLogo = !hideLogos && !!t.logo_url;

        const nameTargetPx    = clamp(12, 0.20 * sliceArc, 24);
        const subTargetPx     = clamp(9,  0.14 * sliceArc, 18);
        let   logoSize        = clamp(28, 0.40 * sliceArc, 64);

        const logoHalf = logoSize/2, pad=10;
        const fg = textColorFor(t.primary_color);
        const lum = luminance(t.primary_color);

        ctx.save();
        ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius-1,a0,a1); ctx.closePath(); ctx.clip();
        ctx.rotate(aMid);
        const needFlip = Math.cos(aMid) < 0; if(needFlip) ctx.rotate(Math.PI);
        const sign = needFlip ? -1 : 1;

        const xLogo = sign * (radius * 0.74);
        const xText = sign * (radius * 0.42);
        const logoInner = xLogo - sign * (logoHalf + pad);
        const xBoxLeft = Math.min(xText, logoInner);
        const maxTextWidth = Math.max(50, Math.abs(logoInner - xText));

        // Text block
        if ((showName || showSub1 || showSub2) && maxTextWidth >= PERF.minTextWidth){
          ctx.save();
          ctx.textAlign='left'; ctx.textBaseline='middle';
          const heavy = (lum >= 0.35 && lum <= 0.45);
          const strokeCol = heavy ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
          const fillCol   = fg;

          let yCursor = 0; let lineHeights = []; let fits = [];

          if (showName){
            const fit = fitSingleLine(ctx, title, {maxWidth, targetPx:nameTargetPx, minPx:9, maxPx:24, weight:heavy?900:800});
            fits.push({text:fit.text, px:fit.fontPx, weight:heavy?900:800});
          }
          if (showSub1){
            const px = showName ? Math.max(8, Math.round((fits[0]?.px||14)*0.82)) : subTargetPx;
            const fit = fitSingleLine(ctx, sub1Text, {maxWidth, targetPx:px, minPx:8, maxPx:20, weight:700});
            fits.push({text:fit.text, px:fit.fontPx, weight:700});
          }
          if (showSub2){
            const base = (fits[0]?.px || subTargetPx);
            const px = Math.max(8, Math.round(base*0.78));
            const fit = fitSingleLine(ctx, sub2Text, {maxWidth, targetPx:px, minPx:8, maxPx:18, weight:700});
            fits.push({text:fit.text, px:fit.fontPx, weight:700});
          }

          const gap = (fits.length>=2) ? 3 : 0;
          const totalH = fits.reduce((s,f)=>s+f.px,0) + gap*(fits.length-1);
          yCursor = -totalH/2;

          for (const f of fits){
            yCursor += f.px/2;
            ctx.font = `${f.weight} ${f.px}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle = strokeCol; ctx.lineWidth = Math.max(1, Math.round(f.px/10));
            ctx.fillStyle = fillCol;
            ctx.strokeText(f.text, xBoxLeft, yCursor);
            ctx.fillText(f.text, xBoxLeft, yCursor);
            yCursor += f.px/2 + gap;
          }
          ctx.restore();
        }

        // Logo
        if (showLogo){
          ctx.save(); ctx.translate(xLogo,0);
          if (N < PERF.hideLogosThreshold){ ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=4; ctx.shadowOffsetY=2; }
          ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke();

          ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.closePath(); ctx.clip();
          const img = getLogo(t.logo_url, () => requestAnimationFrame(drawWheel));
          if (img && img.complete){
            const box = Math.max(4, 2*(logoHalf-1));
            const iw=img.naturalWidth||box, ih=img.naturalHeight||box; const s=Math.min(box/iw, box/ih);
            ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
          } else {
            ctx.fillStyle='rgba(255,255,255,0.12)'; const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
          }
          ctx.restore(); ctx.restore();
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }

  // ---------------- Spin + result ----------------
  function setResult(idx){
    const data = getCurrentData(); const t = data[idx]; selectedIdx = idx; drawWheel();

    // Save to history & open modal
    history.unshift(t); if (history.length > 50) history = history.slice(0,50);
    localStorage.setItem('clubHistory', JSON.stringify(history));
    renderHistory();

    openModal(t);
  }

  function spin(){
    if (spinning) return;
    const data = getCurrentData();
    if (!data.length) return;

    spinning = true; lockUI(true);
    spinBtn.disabled = true; spinFab.disabled=true; selectedIdx = -1;

    const N = data.length, slice = TAU / N;
    const extraTurns = 6 + Math.floor(Math.random()*3);
    const finalOffset = Math.random() * TAU;
    const targetAngle = TAU * extraTurns + finalOffset;

    const start = performance.now(), duration=3200;
    const easeOutCubic = x => 1 - Math.pow(1-x,3);

    function anim(now){
      const p = clamp(0, (now - start)/duration, 1);
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

        spinning=false; lockUI(false);
        const hasAny = getCurrentData().length>0; spinBtn.disabled=!hasAny; spinFab.disabled=!hasAny;
        selectedIdx = idx; drawWheel(); setResult(idx);
      }
    }
    requestAnimationFrame(anim);
  }

  // ---------------- Modal ----------------
  function isModalOpen(){ return backdrop && backdrop.style.display === 'flex'; }
  function openModal(item){
    lastModalItem = item; modalRevealState = { logo:false, name:false, sub1:false, sub2:false };

    const isPlayer = (MODE === 'player');
    const title = isPlayer ? (item.name || 'Player') : (item.team_name || 'Team');
    const subTop = isPlayer ? (item.club || '') : (LEAGUE_LABELS[item.league_code] || item.league_code || '');
    const sub1Label = isPlayer ? 'Nationality' : 'Stadium';
    const sub1Val   = isPlayer ? (item.nationality || '—') : (item.stadium || '—');
    const sub2Label = isPlayer ? 'Jersey' : '';
    const sub2Val   = isPlayer ? (item.jersey_number ? `#${item.jersey_number}` : '—') : '';

    if (mHead) mHead.textContent = title;
    if (mSub)  mSub.textContent  = subTop || '—';
    if (mLogo){ mLogo.setAttribute('decoding','sync'); mLogo.setAttribute('loading','eager'); mLogo.src=item.logo_url||''; mLogo.alt = title; }

    if (mStadium){
      // reuse one row: show "#12 · Country" when both toggles on, else each as available
      const showNat = !!optSub1?.checked;
      const showJsy = !!optSub2?.checked;
      let txt = '—';
      if (isPlayer){
        if (showNat && showJsy) txt = `${sub2Val} · ${sub1Val === 'Nationality' ? (item.nationality || '—') : '—'}`;
        else if (showJsy) txt = sub2Val;
        else if (showNat) txt = (item.nationality || '—');
        else txt = '—';
      } else {
        txt = !!optSub1?.checked ? (item.stadium || '—') : '—';
      }
      mStadium.textContent = txt;
    }

    backdrop.style.display='flex';
    requestAnimationFrame(()=> modalEl.classList.add('show'));
  }
  function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none',150); }
  mClose && mClose.addEventListener('click', ()=>{ if(!spinning) closeModal(); });
  backdrop && backdrop.addEventListener('click', e => { if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e => { if(!spinning && e.key==='Escape' && isModalOpen()) closeModal(); });

  // ---------------- History ----------------
  function renderHistory(){
    historyEl.innerHTML = '';
    if (history.length === 0) {
      historyEl.setAttribute('aria-live','polite');
      historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
      return;
    }
    history.forEach(item => {
      const div = document.createElement('div'); div.className='item';
      const i = document.createElement('img'); i.src = item.logo_url || ''; i.alt = (item.name || item.team_name || ''); i.onerror = ()=>{i.src=''; i.alt='No image';};
      const s = document.createElement('span');
      if (MODE === 'player'){
        s.textContent = `${item.name || 'Player'} (${item.club || '—'})`;
      } else {
        const full = LEAGUE_LABELS[item.league_code] || item.league_code;
        s.textContent = `${item.team_name} (${full})`;
      }
      div.append(i,s); historyEl.append(div);
    });
  }

  // ---------------- Events ----------------
  function lockUI(lock){
    document.body.classList.toggle('ui-locked', !!lock);
    const els = document.querySelectorAll('button, input, select, textarea, [role="button"]');
    els.forEach(el => {
      if (lock) {
        if (!el.dataset.lockSaved){ el.dataset.lockSaved='1'; el.dataset.prevDisabled = el.disabled?'1':'0'; }
        el.disabled = true; el.setAttribute('aria-disabled','true');
      } else {
        if (el.dataset.lockSaved==='1'){
          const prev = el.dataset.prevDisabled === '1';
          el.disabled = prev; if(!prev) el.removeAttribute('aria-disabled');
          delete el.dataset.lockSaved; delete el.dataset.prevDisabled;
        }
      }
    });
  }

  chipsWrap.addEventListener('change', () => {
    if (spinning) return;
    selectedIdx = -1;
    drawWheel();
    updateSpinAvailability();
  });

  toggleMore.addEventListener('click', () => {
    if (spinning) return;
    const hidden = chipsMore.hidden;
    if (MODE === 'player') {
      chipsMore.hidden = !hidden;
      toggleMore.textContent = hidden ? 'Show fewer clubs' : 'Show more Premier League clubs';
      toggleMore.setAttribute('aria-expanded', hidden ? 'true':'false');
    } else {
      chipsMore.hidden = !hidden;
      toggleMore.textContent = hidden ? 'Show fewer leagues' : 'Show more leagues';
      toggleMore.setAttribute('aria-expanded', hidden ? 'true':'false');
    }
  });

  const onWheelToggleChange = () => { if(!spinning){ drawWheel(); if(isModalOpen()) openModal(lastModalItem); } };
  optName?.addEventListener('change', onWheelToggleChange);
  optLogo?.addEventListener('change', onWheelToggleChange);
  optSub1?.addEventListener('change', onWheelToggleChange);
  optSub2?.addEventListener('change', onWheelToggleChange);

  spinBtn && (spinBtn.onclick = spin);
  spinFab && (spinFab.onclick = spin);

  resetHistoryBtn && resetHistoryBtn.addEventListener('click', () => { if (!spinning){ history=[]; localStorage.setItem('clubHistory','[]'); renderHistory(); }});

  let resizeTO;
  window.addEventListener('resize', () => { clearTimeout(resizeTO); resizeTO=setTimeout(()=>{ sizeCanvas(); drawWheel(); }, 120); }, { passive:true });

  // ---------------- Data loading ----------------
  async function tryFetchPlayers(){
    const candidates = ['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
    for (const url of candidates){
      try { const res = await fetch(url, { cache: 'no-store' }); if (res.ok) return {res,url}; } catch {}
    }
    return { res:null, url:null };
  }

  async function loadPlayers(){
    const { res } = await tryFetchPlayers();
    if (!res) throw new Error('players.json not found');
    const raw = await res.json();

    PLAYERS = (raw || []).map(p => {
      const name = p.name || p.player_name || 'Player';

      const fromJson = p.image_url || p.image || p.file || p.file_url || '';
      const img = fromJson ? resolvePublicUrl(fromJson) : imageForPlayerName(name);

      const teamIdRaw = p.team_id ?? p.teamId ?? p.club_id ?? p.clubId ?? p.meta?.team_id ?? p.meta?.club_id;
      const teamId = (teamIdRaw !== undefined && teamIdRaw !== null && teamIdRaw !== '') ? String(teamIdRaw) : null;

      const explicitClub = p.club || p.team || p.team_name || '';
      let clubName = explicitClub && explicitClub.trim() ? explicitClub.trim() : '';
      if (!clubName && teamId && TEAM_ID_INDEX[teamId]?.name) clubName = TEAM_ID_INDEX[teamId].name;

      const clubKey = clubName ? normTeamLabel(clubName) : (teamId ? `id:${teamId}` : '');

      const nationality = p.nationality || p.country || p.meta?.nationality || '';
      const jersey = p.jersey_number ?? p.number ?? p.shirt_number ?? p.meta?.jersey_number ?? '';

      return {
        team_name: name,
        logo_url: img,
        league_code: 'PLAYER',
        primary_color: '#163058',
        stadium: '',

        name, image_url: img,
        club: clubName, clubKey, team_id: teamId,
        nationality, jersey_number: jersey,
        meta: p
      };
    });

    return PLAYERS;
  }

  // ---------------- Boot ----------------
  function boot(){
    fetch(`./teams.json?v=${Date.now()}`)
      .then(res => res.json())
      .then(async data => {
        TEAMS = data || [];

        // Build team_id index
        TEAM_ID_INDEX = Object.create(null);
        for (const t of TEAMS) {
          const id = String(t.id ?? t.team_id ?? t.teamId ?? '');
          if (!id || !t.team_name) continue;
          TEAM_ID_INDEX[id] = { name: t.team_name, key: normTeamLabel(t.team_name) };
        }

        reflectModeLabels();

        // Default to TEAM visual chips first
        if (MODE === 'player') {
          await loadPlayers().catch(()=>{});
          renderChipsForPlayer();
        } else {
          renderChipsForTeam();
        }

        renderHistory();
        sizeCanvas();
        drawWheel();
        updateSpinAvailability();

        // Reflect active mode buttons
        modeTeamBtn  && modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
        modePlayerBtn&& modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
        modeTeamBtn  && modeTeamBtn.setAttribute('aria-pressed', MODE==='team'?'true':'false');
        modePlayerBtn&& modePlayerBtn.setAttribute('aria-pressed', MODE==='player'?'true':'false');
      })
      .catch(err => {
        console.error('Failed to load teams.json', err);
      });
  }

  boot();
})();

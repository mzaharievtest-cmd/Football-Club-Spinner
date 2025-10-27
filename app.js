/* Football Spinner — modes, variants, wheel, reveal, confetti */

(() => {
  // ---------- DOM HELPERS ----------
  const $  = (s, r=document)=> r.querySelector(s);
  const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));

  const canvas = $('#wheel');
  const ctx = canvas.getContext('2d');
  const fx = $('#fx');
  const spinBtn = $('#spinFab');
  const freeBtn = $('#fsFreeSpinBtn');
  const revealBtn = $('#fsRevealBtn');
  const resultEl = $('#fsResult');
  const resultTitle = $('#fsResultTitle');
  const resultSub = $('#fsResultSub');
  const resultMedia = $('#fsResultMedia');
  const cheer = $('#fsCheer');

  const modeBtns = $$('.fs-mode-btn');
  const subbar = $('#fsSubbar');

  // ---------- DATA SOURCES (replace with your real assets) ----------
  // Minimal demo data. Update paths or swap to your data builder.
  const DATA_SOURCES = {
    teamLogo: [
      { id:'ars', title:'Arsenal', sub:'Premier League', img:'assets/clubs/arsenal.png' },
      { id:'rm',  title:'Real Madrid', sub:'La Liga', img:'assets/clubs/realmadrid.png' },
      { id:'bvb', title:'Dortmund', sub:'Bundesliga', img:'assets/clubs/dortmund.png' },
      { id:'psg', title:'PSG', sub:'Ligue 1', img:'assets/clubs/psg.png' },
    ],
    teamStadium: [
      { id:'ars', title:'Emirates Stadium', sub:'Arsenal · Premier League', img:'assets/stadiums/emirates.jpg' },
      { id:'rm',  title:'Santiago Bernabéu', sub:'Real Madrid · La Liga', img:'assets/stadiums/bernabeu.jpg' },
      { id:'bvb', title:'Signal Iduna Park', sub:'Borussia Dortmund · Bundesliga', img:'assets/stadiums/signal-iduna.jpg' },
      { id:'psg', title:'Parc des Princes', sub:'PSG · Ligue 1', img:'assets/stadiums/parc.jpg' },
    ],
    stadiumByTeamName: [
      { id:'ars', title:'Arsenal', sub:'Team Name', img:null },
      { id:'rm',  title:'Real Madrid', sub:'Team Name', img:null },
      { id:'bvb', title:'Borussia Dortmund', sub:'Team Name', img:null },
      { id:'psg', title:'Paris Saint-Germain', sub:'Team Name', img:null },
    ],
    stadiumByLogo: [
      { id:'ars', title:'Arsenal', sub:'By Logo', img:'assets/clubs/arsenal.png' },
      { id:'rm',  title:'Real Madrid', sub:'By Logo', img:'assets/clubs/realmadrid.png' },
      { id:'bvb', title:'Dortmund', sub:'By Logo', img:'assets/clubs/dortmund.png' },
      { id:'psg', title:'PSG', sub:'By Logo', img:'assets/clubs/psg.png' },
    ],
    playerPhoto: [
      { id:'p1', title:'Player A', sub:'Forward', img:'assets/players/p1.jpg' },
      { id:'p2', title:'Player B', sub:'Midfielder', img:'assets/players/p2.jpg' },
      { id:'p3', title:'Player C', sub:'Defender', img:'assets/players/p3.jpg' },
      { id:'p4', title:'Player D', sub:'Goalkeeper', img:'assets/players/p4.jpg' },
    ],
    playerIcons: [
      { id:'p1', title:'Player A', sub:'Club + Flag + #9',   img:null, icons:['assets/clubs/realmadrid.png','assets/flags/ar.png','assets/nums/9.svg'] },
      { id:'p2', title:'Player B', sub:'Club + Flag + #7',   img:null, icons:['assets/clubs/arsenal.png','assets/flags/pt.png','assets/nums/7.svg'] },
      { id:'p3', title:'Player C', sub:'Club + Flag + #10',  img:null, icons:['assets/clubs/psg.png','assets/flags/fr.png','assets/nums/10.svg'] },
      { id:'p4', title:'Player D', sub:'Club + Flag + #1',   img:null, icons:['assets/clubs/dortmund.png','assets/flags/de.png','assets/nums/1.svg'] },
    ]
  };

  // ---------- STATE ----------
  const state = {
    mode: 'team',          // 'team' | 'stadium' | 'player'
    variant: 'team:logo',  // namespaced
    renderType: 'logo',    // 'logo' | 'stadium' | 'name' | 'photo' | 'icons'
    slices: [],            // built from variant
    spinning: false,
    angle: 0,
    velocity: 0,
    friction: 0.985,
    picked: null
  };

  const VARIANTS = {
    team: [
      { label: 'By Logo',               key: 'team:logo',    render: 'logo' },
      { label: 'By Stadium (+ League)', key: 'team:stadium', render: 'stadium' },
    ],
    stadium: [
      { label: 'By Team Name', key: 'stadium:name',  render: 'name' },
      { label: 'By Logo',      key: 'stadium:logo',  render: 'logo' },
    ],
    player: [
      { label: 'By Photo',                 key: 'player:photo',  render: 'photo' },
      { label: 'By Club + Flag + Number',  key: 'player:icons',  render: 'icons' },
    ]
  };

  // ---------- BUILD SLICES ----------
  function buildSlices(mode, variant){
    if (mode === 'team') {
      state.renderType = variant==='team:stadium' ? 'stadium' : 'logo';
      return variant==='team:stadium' ? DATA_SOURCES.teamStadium : DATA_SOURCES.teamLogo;
    }
    if (mode === 'stadium') {
      state.renderType = variant==='stadium:logo' ? 'logo' : 'name';
      return variant==='stadium:logo' ? DATA_SOURCES.stadiumByLogo : DATA_SOURCES.stadiumByTeamName;
    }
    if (mode === 'player') {
      state.renderType = variant==='player:icons' ? 'icons' : 'photo';
      return variant==='player:icons' ? DATA_SOURCES.playerIcons : DATA_SOURCES.playerPhoto;
    }
    return [];
  }

  // ---------- SUBBAR RENDER ----------
  function renderSubbar(mode) {
    const variants = VARIANTS[mode] || [];
    subbar.innerHTML = '';
    variants.forEach((v, idx) => {
      const btn = document.createElement('button');
      btn.className = 'fs-variant-btn' + (idx===0 ? ' is-active' : '');
      btn.textContent = v.label;
      btn.setAttribute('role','tab');
      btn.setAttribute('aria-selected', idx===0 ? 'true' : 'false');
      btn.dataset.variant = v.key;
      subbar.appendChild(btn);
    });
  }

  // ---------- APPLY MODE/VARIANT ----------
  function applyMode(nextMode){
    if (nextMode === state.mode) return;
    state.mode = nextMode;
    modeBtns.forEach(b=>{
      const active = b.dataset.mode === nextMode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderSubbar(nextMode);
    const first = subbar.querySelector('.fs-variant-btn');
    if (first) applyVariant(first.dataset.variant);
  }

  function applyVariant(key){
    // toggle UI
    $$('.fs-variant-btn', subbar).forEach(b=>{
      const active = b.dataset.variant === key;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    state.variant = key;
    state.slices = buildSlices(state.mode, state.variant);
    // redraw
    drawWheel();
  }

  // ---------- WHEEL DRAWING ----------
  const TAU = Math.PI * 2;

  function drawWheel(){
    const { width, height } = canvas;
    const cx = width/2, cy = height/2;
    ctx.clearRect(0,0,width,height);

    const n = Math.max(1, state.slices.length);
    const step = TAU / n;
    const radius = Math.min(cx, cy) - 16;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.angle);

    for (let i=0; i<n; i++){
      const slice = state.slices[i];
      const a0 = i * step;
      const a1 = a0 + step;

      // wedge
      const hue = (i * (360/n)) | 0;
      const bg = `hsl(${hue} 70% 38%)`;
      const bg2 = `hsl(${(hue+20)%360} 70% 26%)`;

      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.arc(0,0,radius,a0,a1);
      ctx.closePath();
      const grad = ctx.createLinearGradient(
        Math.cos(a0)*radius, Math.sin(a0)*radius,
        Math.cos(a1)*radius, Math.sin(a1)*radius
      );
      grad.addColorStop(0, bg);
      grad.addColorStop(1, bg2);
      ctx.fillStyle = grad;
      ctx.fill();

      // stroke
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // content
      const mid = (a0 + a1)/2;
      const tx = Math.cos(mid) * (radius * 0.68);
      const ty = Math.sin(mid) * (radius * 0.68);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(mid);

      // Render modes
      if ((state.renderType === 'logo' || state.renderType === 'photo' || state.renderType === 'stadium') && slice.img){
        // draw image if available
        drawImageCached(slice.img, -28, -28, 56, 56);
      } else if (state.renderType === 'icons' && Array.isArray(slice.icons)){
        // 3 small icons inline
        let x=-30;
        slice.icons.slice(0,3).forEach(src=>{
          drawImageCached(src, x, -16, 24, 24); x+=26;
        });
      } else {
        // fallback: text
        ctx.fillStyle = '#fff';
        ctx.font = '700 14px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, slice.title, 0, 0, 120, 18);
      }

      ctx.restore();
    }

    // center hub
    ctx.beginPath();
    ctx.arc(0,0,36,0,TAU);
    ctx.fillStyle = '#0b1530';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(100,160,255,.5)';
    ctx.stroke();

    ctx.restore();
  }

  const IMG_CACHE = new Map();
  function drawImageCached(src, x,y,w,h){
    let obj = IMG_CACHE.get(src);
    if (!obj){
      const img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.src = src;
      obj = { img, loaded:false };
      img.onload = () => { obj.loaded=true; drawWheel(); };
      img.onerror = () => { obj.error=true; };
      IMG_CACHE.set(src, obj);
    }
    if (obj.loaded){
      ctx.save();
      roundRect(ctx, x,y,w,h, 8);
      ctx.clip();
      ctx.drawImage(obj.img, x,y,w,h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      roundRect(ctx, x,y,w,h, 8);
      ctx.stroke();
    } else {
      // placeholder
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      roundRect(ctx, x,y,w,h, 8);
      ctx.fill();
    }
  }

  function roundRect(ctx, x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y,   x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x,   y+h, rr);
    ctx.arcTo(x,   y+h, x,   y,   rr);
    ctx.arcTo(x,   y,   x+w, y,   rr);
    ctx.closePath();
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight){
    const words = (text || '').split(' ');
    let line=''; let yy=y;
    for (let n=0;n<words.length;n++){
      const test = line + (line ? ' ' : '') + words[n];
      const metrics = context.measureText(test);
      if (metrics.width > maxWidth && n>0){
        context.fillText(line, x, yy);
        line = words[n];
        yy += lineHeight;
      } else line = test;
    }
    context.fillText(line, x, yy);
  }

  // ---------- SPIN ----------
  function spin(){
    if (state.spinning || state.slices.length===0) return;
    state.spinning = true;
    state.velocity = 0.35 + Math.random()*0.25; // initial angular velocity
    animate();
  }

  function animate(){
    if (!state.spinning) return;
    state.angle += state.velocity;
    state.velocity *= state.friction;

    // stop condition
    if (state.velocity < 0.003){
      state.spinning = false;
      snapToWinner();
      return;
    }
    drawWheel();
    requestAnimationFrame(animate);
  }

  function snapToWinner(){
    // pick wedge at pointer (top). Pointer is at angle=0 in screen space.
    const n = Math.max(1, state.slices.length);
    const step = TAU / n;
    // Normalize angle so 0 is at top
    const a = ((state.angle % TAU) + TAU) % TAU;
    // Pointer at -PI/2 (canvas top) relative to the wheel rotation:
    const pointerAngle = (-Math.PI/2 - a + TAU) % TAU;
    const idx = Math.floor(pointerAngle / step);
    const winner = state.slices[idx % n];
    state.picked = winner;

    // Subtle snap to center of that wedge:
    const mid = (idx + 0.5) * step;
    const target = -Math.PI/2 - mid;
    state.angle = target;
    drawWheel();
  }

  // ---------- REVEAL ----------
  function reveal(){
    const result = state.picked || randomPick();
    if (!result) return;

    // Result card
    resultEl.hidden = false;
    resultTitle.textContent = result.title || '—';
    resultSub.textContent   = result.sub || '';

    resultMedia.innerHTML = '';
    if (state.renderType === 'icons' && Array.isArray(result.icons)){
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.gap='6px'; wrap.style.alignItems='center';
      result.icons.forEach(src=>{
        const img = document.createElement('img');
        img.src = src; img.alt=''; img.width=20; img.height=20; img.style.objectFit='contain';
        wrap.appendChild(img);
      });
      resultMedia.appendChild(wrap);
    } else if (result.img){
      const img = document.createElement('img');
      img.src = result.img; img.alt = result.title || '';
      resultMedia.appendChild(img);
    } else {
      resultMedia.textContent = '🏆';
    }

    // Cheer + confetti
    try { cheer && cheer.play().catch(()=>{}); } catch(_) {}
    burstConfetti(fx);
  }

  function randomPick(){
    const s = state.slices;
    return s.length ? s[(Math.random()*s.length)|0] : null;
  }

  // ---------- CONFETTI ----------
  function burstConfetti(canvas){
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const N = 140;
    const parts = Array.from({length:N},()=>({
      x: W/2, y: H/2, r: 2+Math.random()*3,
      vx: (Math.random()*2-1)*6, vy: (Math.random()*2-1)*6 - 2,
      a: 1, c: `hsl(${Math.floor(Math.random()*360)} 90% 55%)`
    }));
    let t = 0;
    function tick(){
      t++;
      ctx2.clearRect(0,0,W,H);
      parts.forEach(p=>{
        p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.a -= 0.012;
        ctx2.globalAlpha = Math.max(p.a,0);
        ctx2.beginPath(); ctx2.arc(p.x,p.y,p.r,0,Math.PI*2); ctx2.fillStyle=p.c; ctx2.fill();
      });
      ctx2.globalAlpha=1;
      if (t<120) requestAnimationFrame(tick); else ctx2.clearRect(0,0,W,H);
    }
    tick();
  }

  // ---------- EVENTS ----------
  // Mode buttons
  modeBtns.forEach(b=>{
    b.addEventListener('click', ()=>{
      applyMode(b.dataset.mode);
    });
  });

  // Subbar clicks
  subbar.addEventListener('click', (e)=>{
    const btn = e.target.closest('.fs-variant-btn'); if (!btn) return;
    applyVariant(btn.dataset.variant);
  });

  // Spin
  spinBtn.addEventListener('click', spin);
  freeBtn?.addEventListener('click', ()=> spinBtn.click());
  revealBtn.addEventListener('click', reveal);

  // ---------- INIT ----------
  function init(){
    // initial subbar + slices
    renderSubbar(state.mode);
    const first = subbar.querySelector('.fs-variant-btn');
    if (first) applyVariant(first.dataset.variant);
    drawWheel();
    // expose small API if you want to integrate elsewhere
    window.FS_getSlices   = () => state.slices.slice();
    window.FS_renderType  = () => state.renderType;
    window.FS_forceReveal = reveal;
  }
  init();
})();

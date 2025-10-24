/* Football Spinner — unified TEAM & PLAYER
   - TEAM: Logo, Name, Stadium, League
   - PLAYER: Image, Name, Jersey, Nationality, Club
   - Player filtering by club (Premier League 2025/26 set via teams.json/player data)
   - Hides all wheel content when >50 players selected (perf rule)
   - Fix: maxTextWidth variable bug
*/

(() => {
  // ---------- State ----------
  let TEAMS = [];
  let PLAYERS = [];
  let TEAM_ID_INDEX = Object.create(null); // team_id -> { name, key }

  let MODE = (localStorage.getItem('fsMode') === 'player') ? 'player' : 'team';
  let currentAngle = 0;
  let spinning = false;
  let selectedIdx = -1;
  let history = JSON.parse(localStorage.getItem('clubHistory')) || [];

  // ---------- DOM ----------
  const chipsWrap = document.getElementById('chips');
  const chipsTop  = document.getElementById('chipsTop');
  const chipsMore = document.getElementById('chipsMore');
  const toggleMore= document.getElementById('toggleMore');

  const spinBtn   = document.getElementById('spinBtn');
  const spinFab   = document.getElementById('spinFab');
  const resetHistoryBtn = document.getElementById('resetHistoryBtn');

  // Show-on-wheel toggles
  const optLogo   = document.getElementById('optLogo');       // TEAM: Logo, PLAYER: Image
  const optName   = document.getElementById('optName');       // both
  const optJersey = document.getElementById('optJersey');     // PLAYER only
  const optNat    = document.getElementById('optNationality');// PLAYER only
  const optClub   = document.getElementById('optClub');       // PLAYER only
  const optStadium= document.getElementById('optStadium');    // TEAM only
  const optLeague = document.getElementById('optLeague');     // TEAM only

  // Labels (we relabel for mode)
  const lblLogo   = document.getElementById('lblLogo');
  const lblName   = document.getElementById('lblName');
  const lblJersey = document.getElementById('lblJersey');
  const lblNation = document.getElementById('lblNationality');
  const lblClub   = document.getElementById('lblClub');
  const lblStadium= document.getElementById('lblStadium');
  const lblLeague = document.getElementById('lblLeague');

  const historyEl = document.getElementById('history');
  const perfTip   = document.getElementById('perfTip');

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

  const mClubRow = document.getElementById('mClubRow');
  const mClub    = document.getElementById('mClub');

  const mRowInfo = document.getElementById('mRowInfo');
  const mFieldLabel = document.getElementById('mFieldLabel');
  const mStadium    = document.getElementById('mStadium');
  const mJersey     = document.getElementById('mJersey');
  const mNation     = document.getElementById('mNation');

  // ---------- Utils ----------
  const TAU = Math.PI * 2;
  const POINTER_ANGLE = ((-Math.PI/2) + TAU) % TAU;
  const clamp=(a,b,c)=>Math.max(a,Math.min(b,c));
  const mod  =(x,m)=>((x%m)+m)%m;

  const PERF = { hideLogosThreshold:80, hideTextThreshold:140, minTextWidth:44, minLogoBox:28 };

  const LEAGUE_LABELS = {
    AUT:"Austrian Bundesliga", BEL:"Jupiler Pro League", BUL:"efbet Liga", CRO:"SuperSport HNL",
    CZE:"Fortuna Liga", DEN:"Superliga", EPL:"Premier League", L1:"Ligue 1", BUN:"Bundesliga",
    GRE:"Super League 1", ISR:"Ligat ha'Al", SA:"Serie A", NED:"Eredivisie", NOR:"Eliteserien",
    POL:"PKO BP Ekstraklasa", POR:"Liga Portugal", ROU:"SuperLiga", RUS:"Premier Liga",
    SCO:"Scottish Premiership", SRB:"Super liga Srbije", LLA:"LaLiga", SWE:"Allsvenskan",
    SUI:"Super League", TUR:"Süper Lig", UKR:"Ukrainian Premier League", PLAYER:"Players"
  };

  const TOP6 = ["Manchester City","Liverpool FC","Manchester United","Chelsea FC","Arsenal FC","Tottenham Hotspur"];
  const TOP6_KEYS = TOP6.map(slug);

  function slug(s){return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
  function txtColorFor(hex){ if(!hex||!/^#?[0-9a-f]{6}$/i.test(hex))return'#fff'; hex=hex.replace('#',''); const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16); const L=0.2126*(r/255)**2.2+0.7152*(g/255)**2.2+0.0722*(b/255)**2.2; return L>0.35?'#0b0f17':'#fff';}
  function lum(hex){ if(!hex||!/^#?[0-9a-f]{6}$/i.test(hex))return 0; hex=hex.replace('#',''); const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16); return 0.2126*(r/255)**2.2+0.7152*(g/255)**2.2+0.0722*(b/255)**2.2; }
  function resolvePublicUrl(p){ if(!p) return ''; if(/^https?:\/\//i.test(p)) return p; if(p.startsWith('/')) return p; return '/' + p; }
  function faceFor(name){ const s=String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); return `/players/${s}.png`; }

  function fitOneLine(ctx,text,{maxWidth,targetPx,minPx=9,maxPx=28,weight=800,fontFamily='Inter, system-ui, sans-serif'}){
    let px=clamp(minPx,Math.round(targetPx),maxPx); ctx.font=`${weight} ${px}px ${fontFamily}`;
    if(ctx.measureText(text).width<=maxWidth) return {text,fontPx:px};
    while(px>minPx){ px-=1; ctx.font=`${weight} ${px}px ${fontFamily}`; if(ctx.measureText(text).width<=maxWidth) return {text,fontPx:px};}
    let s=(text||'').trim(); while(s && ctx.measureText(s+'…').width>maxWidth) s=s.slice(0,-1);
    return {text:(s||'')+'…',fontPx:minPx};
  }

  // image cache
  const IMG_CACHE=new Map();
  function getImg(url,onLoad){ if(!url) return null; const c=IMG_CACHE.get(url); if(c) return c.img; const img=new Image(); img.crossOrigin='anonymous'; img.src=url; img.onload=()=>onLoad&&onLoad(); img.onerror=()=>onLoad&&onLoad(); IMG_CACHE.set(url,{img}); return img; }

  // ---------- Mode ----------
  function setMode(next){
    if(next===MODE) return;
    MODE = next;
    localStorage.setItem('fsMode', MODE);

    // relabel toggles
    if (MODE==='player'){
      lblLogo.textContent='Image'; lblName.textContent='Name';
      lblJersey.textContent='Jersey Number'; lblNation.textContent='Nationality'; lblClub.textContent='Club';
      lblStadium.textContent='Stadium (team)'; lblLeague.textContent='League (team)';

      // build PLAYER chips
      if (!PLAYERS.length) {
        loadPlayers().then(()=>{ renderPlayerChips(); sizeCanvas(); selectedIdx=-1; drawWheel(); updateSpinAvailability(); })
                     .catch(()=>{ MODE='team'; renderTeamChips(); drawWheel(); updateSpinAvailability(); });
      } else {
        renderPlayerChips(); selectedIdx=-1; drawWheel(); updateSpinAvailability();
      }
    } else {
      lblLogo.textContent='Logo'; lblName.textContent='Name';
      lblJersey.textContent='Jersey Number'; lblNation.textContent='Nationality'; lblClub.textContent='Club';
      lblStadium.textContent='Stadium'; lblLeague.textContent='League';

      renderTeamChips(); selectedIdx=-1; drawWheel(); updateSpinAvailability();
    }

    modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
    modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
    modeTeamBtn.setAttribute('aria-pressed', MODE==='team' ? 'true' : 'false');
    modePlayerBtn.setAttribute('aria-pressed', MODE==='player' ? 'true' : 'false');
  }

  modeTeamBtn.addEventListener('click',  () => setMode('team'));
  modePlayerBtn.addEventListener('click', () => setMode('player'));

  // ---------- Chips ----------
  function makeChip(value, checked, title){
    const label=document.createElement('label');
    label.className='chip';
    label.innerHTML = `
      <input type="checkbox" value="${value}" ${checked?'checked aria-checked="true"':''} aria-label="${title}">
      <span class="chip-text" title="${title}">${title}</span>
    `;
    return label;
  }

  function renderTeamChips(){
    const codes=[...new Set(TEAMS.map(t=>t.league_code))];
    const TOP5=['EPL','SA','BUN','L1','LLA'];
    const top = TOP5.filter(c=>codes.includes(c));
    const more= codes.filter(c=>!top.includes(c)).sort();
    chipsTop.innerHTML=''; chipsMore.innerHTML='';
    top.forEach(code=>chipsTop.appendChild(makeChip(code, code==='EPL', LEAGUE_LABELS[code]||code)));
    more.forEach(code=>chipsMore.appendChild(makeChip(code,false,LEAGUE_LABELS[code]||code)));
    chipsMore.hidden=true;
    toggleMore.textContent='Show more leagues';
    toggleMore.setAttribute('aria-expanded','false');

    // Quick pick labels
    document.getElementById('qpTop5').textContent='Top 5';
  }

  function renderPlayerChips(){
    // Collect clubs from PLAYERS (resolved names)
    const clubs = new Map(); // key -> label
    PLAYERS.forEach(p => { if (p.clubKey && p.club) clubs.set(p.clubKey, p.club); });
    const top6 = TOP6_KEYS.filter(k=>clubs.has(k));
    const rest = [...clubs.keys()].filter(k=>!top6.includes(k)).sort((a,b)=>clubs.get(a).localeCompare(clubs.get(b)));

    chipsTop.innerHTML=''; chipsMore.innerHTML='';
    top6.forEach(k=>chipsTop.appendChild(makeChip(k, true, clubs.get(k))));
    rest.forEach(k=>chipsMore.appendChild(makeChip(k,false, clubs.get(k))));

    chipsMore.hidden=true;
    toggleMore.textContent='Show more Premier League clubs';
    toggleMore.setAttribute('aria-expanded','false');

    // Quick pick labels for PLAYER
    document.getElementById('qpTop5').textContent='Top 6';
  }

  function selectedChipValues() {
    const topVals = Array.from(chipsTop.querySelectorAll('input:checked')).map(i=>i.value);
    const moreVals = chipsMore.hidden ? [] : Array.from(chipsMore.querySelectorAll('input:checked')).map(i=>i.value);
    return topVals.concat(moreVals);
  }

  function getCurrentData(){
    if (MODE==='player'){
      if (!PLAYERS.length) return [];
      const active = selectedChipValues();
      if (!active.length) return PLAYERS;
      const set=new Set(active);
      return PLAYERS.filter(p=>set.has(p.clubKey));
    } else {
      const active = selectedChipValues();
      return TEAMS.filter(t=>active.includes(t.league_code));
    }
  }

  // ---------- Availability ----------
  function updateSpinAvailability(){
    const n = getCurrentData().length;
    spinBtn.disabled = n===0;
    spinFab.disabled = n===0;
    perfTip.textContent = `${n} ${MODE==='player'?'players':'teams'} selected`;
    perfTip.style.setProperty('--pct', Math.min(1, n/100));
  }

  // ---------- Sizing ----------
  function sizeCanvas(){
    const rect=(wheel.parentElement||wheel).getBoundingClientRect();
    const cssSize=clamp(300, Math.round(rect.width||640), 1200);
    const DPR=Math.max(1, window.devicePixelRatio||1);
    wheel.width=Math.round(cssSize*DPR); wheel.height=Math.round(cssSize*DPR);
    fx.width=wheel.width; fx.height=wheel.height;
    wheel.style.width=cssSize+'px'; wheel.style.height=cssSize+'px';
    fx.style.width=cssSize+'px'; fx.style.height=cssSize+'px';
  }

  // ---------- Draw ----------
  function drawGradientIdle(ctx,W,H){
    const DPR=Math.max(1,window.devicePixelRatio||1);
    ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(W/2,H/2);
    const r=Math.min(W,H)*0.48;
    const g=ctx.createRadialGradient(0,0,r*0.1,0,0,r);
    g.addColorStop(0,'#1A2C5A'); g.addColorStop(0.35,'#21386F'); g.addColorStop(0.65,'#0E2A57'); g.addColorStop(1,'#0B1B38');
    ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
    ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,0.06)';
    for(let i=1;i<=5;i++){ ctx.beginPath(); ctx.arc(0,0,r*(i/5),0,TAU); ctx.stroke(); }
    ctx.restore();
  }

  function drawWheel(){
    const data=getCurrentData();
    const N=data.length;
    const ctx=wheel.getContext('2d');
    const DPR=Math.max(1,window.devicePixelRatio||1);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    const W=wheel.width/DPR, H=wheel.height/DPR;

    if(N===0){ drawGradientIdle(ctx,W,H); updateSpinAvailability(); return; }

    // Perf rules
    let forceHideAll = false;
    if (MODE==='player' && N>50) forceHideAll = true;

    const hideLogos = forceHideAll || !optLogo.checked || (N >= PERF.hideLogosThreshold);
    const hideText  = forceHideAll || (N >= PERF.hideTextThreshold);

    updateSpinAvailability();

    ctx.imageSmoothingEnabled = !hideText;
    ctx.imageSmoothingQuality = hideText ? 'low' : 'high';

    ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(W/2,H/2);

    const angleDraw = mod(currentAngle, TAU);
    ctx.rotate(angleDraw);

    const radius = Math.min(W,H)*0.48;
    const sliceAngle = TAU/N;

    // Wedges
    for(let i=0;i<N;i++){
      const t=data[i]||{};
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0,0,radius, i*sliceAngle, (i+1)*sliceAngle);
      ctx.closePath();
      ctx.fillStyle=t.primary_color||'#4f8cff';
      ctx.fill();
    }

    // Selected rim
    if(!hideText && selectedIdx>=0 && selectedIdx<N){
      const a0=selectedIdx*sliceAngle, a1=(selectedIdx+1)*sliceAngle;
      ctx.save(); ctx.beginPath(); ctx.arc(0,0,radius-1,a0,a1);
      ctx.lineWidth=Math.max(2, Math.round(radius*0.015));
      ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.stroke(); ctx.restore();
    }

    // Content
    if(!forceHideAll){
      for(let i=0;i<N;i++){
        const t=data[i]||{};
        const a0=i*sliceAngle, a1=(i+1)*sliceAngle, aMid=(a0+a1)/2;
        const sliceArc = radius*(a1-a0);

        const isPlayer = (MODE==='player');
        const title = isPlayer ? (t.name || t.team_name || 'Player') : (t.team_name || 'Team');
        const subNat  = isPlayer ? (optNat.checked    ? (t.nationality||'') : '') : (optStadium.checked ? (t.stadium||'') : '');
        const subJsy  = isPlayer ? (optJersey.checked ? (t.jersey_number?`#${t.jersey_number}`:'') : '') : '';
        const subClub = isPlayer ? (optClub.checked   ? (t.club || '') : '') : (optLeague.checked ? (LEAGUE_LABELS[t.league_code]||t.league_code||'') : '');

        const showName = !hideText && optName.checked && title;
        const showSubA = !hideText && !!subNat;
        const showSubB = !hideText && !!subJsy;
        const showSubC = !hideText && !!subClub;
        const showFace = !hideLogos && !!t.logo_url;

        const nameTargetPx = clamp(12, 0.20*sliceArc, 24);
        const subTargetPx  = clamp(9,  0.14*sliceArc, 18);
        const logoSize     = clamp(28, 0.40*sliceArc, 64);
        const logoHalf=logoSize/2, pad=10;

        const fg = txtColorFor(t.primary_color);
        const L  = lum(t.primary_color);

        ctx.save();
        ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius-1,a0,a1); ctx.closePath(); ctx.clip();
        ctx.rotate(aMid);
        const flip = Math.cos(aMid)<0; if(flip) ctx.rotate(Math.PI);
        const sign = flip ? -1 : 1;

        const xFace = sign * (radius * 0.74);
        const xText = sign * (radius * 0.42);
        const faceInner = xFace - sign * (logoHalf + pad);
        const xBoxLeft = Math.min(xText, faceInner);
        const maxTextWidth = Math.max(50, Math.abs(faceInner - xText)); // <-- correct variable

        // text block
        if ((showName || showSubA || showSubB || showSubC) && maxTextWidth >= PERF.minTextWidth){
          ctx.save();
          ctx.textAlign='left'; ctx.textBaseline='middle';
          const strokeCol = (L>=0.35 && L<=0.45) ? 'rgba(0,0,0,0.35)' : 'rgba(12,16,28,0.65)';
          const fillCol = fg;

          const lines = [];
          if (showName){
            const fit = fitOneLine(ctx, title, {maxWidth:maxTextWidth, targetPx:nameTargetPx, minPx:9, maxPx:24, weight:800});
            lines.push({txt:fit.text, px:fit.fontPx, w:800});
          }
          if (showSubA){
            const px = lines.length ? Math.max(8, Math.round(lines[0].px*0.84)) : subTargetPx;
            const fit = fitOneLine(ctx, subNat, {maxWidth:maxTextWidth, targetPx:px, minPx:8, maxPx:20, weight:700});
            lines.push({txt:fit.text, px:fit.fontPx, w:700});
          }
          if (showSubB){
            const base = lines.length ? lines[0].px : subTargetPx;
            const px = Math.max(8, Math.round(base*0.78));
            const fit = fitOneLine(ctx, subJsy, {maxWidth:maxTextWidth, targetPx:px, minPx:8, maxPx:18, weight:700});
            lines.push({txt:fit.text, px:fit.fontPx, w:700});
          }
          if (showSubC){
            const base = lines.length ? lines[0].px : subTargetPx;
            const px = Math.max(8, Math.round(base*0.78));
            const fit = fitOneLine(ctx, subClub, {maxWidth:maxTextWidth, targetPx:px, minPx:8, maxPx:18, weight:700});
            lines.push({txt:fit.text, px:fit.fontPx, w:700});
          }

          const gap = lines.length>1 ? 3 : 0;
          const totalH = lines.reduce((s,l)=>s+l.px,0) + gap*(lines.length-1);
          let y = -totalH/2;

          for (const ln of lines){
            y += ln.px/2;
            ctx.font = `${ln.w} ${ln.px}px Inter, system-ui, sans-serif`;
            ctx.strokeStyle=strokeCol; ctx.lineWidth=Math.max(1,Math.round(ln.px/10));
            ctx.fillStyle=fillCol;
            ctx.strokeText(ln.txt, xBoxLeft, y);
            ctx.fillText(ln.txt, xBoxLeft, y);
            y += ln.px/2 + gap;
          }
          ctx.restore();
        }

        // face/logo
        if (showFace){
          ctx.save(); ctx.translate(xFace,0);
          if (N < PERF.hideLogosThreshold){ ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=4; ctx.shadowOffsetY=2; }
          ctx.beginPath(); ctx.arc(0,0,logoHalf,0,TAU); ctx.closePath();
          ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fill();
          ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke();
          ctx.save(); ctx.beginPath(); ctx.arc(0,0,logoHalf-1,0,TAU); ctx.closePath(); ctx.clip();
          const img=getImg(t.logo_url, ()=>requestAnimationFrame(drawWheel));
          if (img && img.complete){
            const box=Math.max(4,2*(logoHalf-1));
            const iw=img.naturalWidth||box, ih=img.naturalHeight||box; const s=Math.min(box/iw, box/ih);
            ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s);
          } else {
            ctx.fillStyle='rgba(255,255,255,0.12)';
            const ph=(logoHalf-3)*2; ctx.fillRect(-ph/2,-ph/2,ph,ph);
          }
          ctx.restore(); ctx.restore();
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }

  // ---------- Spin ----------
  function setResult(idx){
    const data=getCurrentData();
    const t=data[idx];
    selectedIdx=idx; drawWheel();

    // history
    history.unshift(t); if(history.length>50) history=history.slice(0,50);
    localStorage.setItem('clubHistory', JSON.stringify(history));
    renderHistory();

    openModal(t);
  }

  function spin(){
    if(spinning) return;
    const data=getCurrentData();
    if(!data.length) return;

    spinning=true; lockUI(true);
    spinBtn.disabled=true; spinFab.disabled=true; selectedIdx=-1;

    const N=data.length, slice=TAU/N;
    const extraTurns = 6 + Math.floor(Math.random()*3);
    const finalOffset= Math.random()*TAU;
    const targetAngle = TAU*extraTurns + finalOffset;

    const start=performance.now(), duration=3200;
    const easeOutCubic = x=>1-Math.pow(1-x,3);

    function anim(now){
      const p=clamp(0,(now-start)/duration,1);
      currentAngle = targetAngle * easeOutCubic(p);
      drawWheel();
      if(p<1) requestAnimationFrame(anim);
      else {
        const theta=mod(currentAngle,TAU);
        const offset=mod(POINTER_ANGLE - theta, TAU);
        const idx=Math.floor(offset/slice)%N;
        const center=idx*slice + slice/2;
        const snap=mod(center - offset, TAU);
        currentAngle = mod(currentAngle + snap, TAU);

        spinning=false; lockUI(false);
        const hasAny=getCurrentData().length>0; spinBtn.disabled=!hasAny; spinFab.disabled=!hasAny;
        selectedIdx=idx; drawWheel(); setResult(idx);
      }
    }
    requestAnimationFrame(anim);
  }

  // ---------- Modal ----------
  function openModal(item){
    const isPlayer = (MODE==='player');
    const title = isPlayer ? (item.name || 'Player') : (item.team_name || 'Team');
    const subtitle = isPlayer ? '' : (LEAGUE_LABELS[item.league_code] || item.league_code || '');

    mHead.textContent = title;
    mSub.textContent  = subtitle;
    mLogo.src = item.logo_url || '';
    mLogo.alt = title;

    // PLAYER extras
    if (isPlayer){
      mClubRow.style.display = 'flex';
      mClub.textContent = item.club || '—';

      mFieldLabel.textContent = 'Details';
      mStadium.style.display='none';

      // show badges if toggles on
      mJersey.style.display = optJersey.checked ? 'inline-block' : 'none';
      mNation.style.display = optNat.checked    ? 'inline-block' : 'none';
      mJersey.textContent   = item.jersey_number ? `#${item.jersey_number}` : '—';
      mNation.textContent   = item.nationality || '—';
    } else {
      // TEAM
      mClubRow.style.display = 'none';
      mFieldLabel.textContent = 'Stadium';
      mStadium.style.display='inline-block';
      mStadium.textContent = item.stadium || '—';
      mJersey.style.display='none';
      mNation.style.display='none';
    }

    backdrop.style.display='flex';
    requestAnimationFrame(()=>modalEl.classList.add('show'));
  }
  function closeModal(){ modalEl.classList.remove('show'); setTimeout(()=>backdrop.style.display='none',150); }

  mClose.addEventListener('click', ()=>{ if(!spinning) closeModal(); });
  backdrop.addEventListener('click', e=>{ if(!spinning && e.target===backdrop) closeModal(); });
  window.addEventListener('keydown', e=>{ if(!spinning && e.key==='Escape' && backdrop.style.display==='flex') closeModal(); });

  // ---------- History ----------
  function renderHistory(){
    historyEl.innerHTML='';
    if(history.length===0){
      historyEl.innerHTML = '<div class="item">Spin the wheel to start your club journey</div>';
      return;
    }
    history.forEach(item=>{
      const div=document.createElement('div'); div.className='item';
      const i=document.createElement('img'); i.src=item.logo_url||''; i.alt=item.name||item.team_name||''; i.onerror=()=>{i.src=''; i.alt='No image';};
      const s=document.createElement('span');
      if (MODE==='player') s.textContent = `${item.name||'Player'} (${item.club||'—'})`;
      else s.textContent = `${item.team_name} (${LEAGUE_LABELS[item.league_code]||item.league_code})`;
      div.append(i,s); historyEl.append(div);
    });
  }

  // ---------- Events ----------
  function lockUI(lock){
    document.body.classList.toggle('ui-locked', !!lock);
    const els=document.querySelectorAll('button,input,select,textarea,[role="button"]');
    els.forEach(el=>{
      if(lock){
        if(!el.dataset.lockSaved){ el.dataset.lockSaved='1'; el.dataset.prevDisabled=el.disabled?'1':'0'; }
        el.disabled=true; el.setAttribute('aria-disabled','true');
      }else{
        if(el.dataset.lockSaved==='1'){ const prev=el.dataset.prevDisabled==='1'; el.disabled=prev; if(!prev) el.removeAttribute('aria-disabled'); delete el.dataset.lockSaved; delete el.dataset.prevDisabled; }
      }
    });
  }

  chipsWrap.addEventListener('change', ()=>{ if(spinning) return; selectedIdx=-1; drawWheel(); updateSpinAvailability(); });

  toggleMore.addEventListener('click', ()=>{
    if(spinning) return;
    const hidden=chipsMore.hidden;
    chipsMore.hidden = !hidden;
    if (MODE==='player'){
      toggleMore.textContent = hidden ? 'Show fewer clubs' : 'Show more Premier League clubs';
    } else {
      toggleMore.textContent = hidden ? 'Show fewer leagues' : 'Show more leagues';
    }
    toggleMore.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  });

  const onToggle = ()=>{ if(spinning) return; drawWheel(); if(backdrop.style.display==='flex') openModal(getCurrentData()[selectedIdx] || getCurrentData()[0] || {}); };
  [optLogo,optName,optJersey,optNat,optClub,optStadium,optLeague].forEach(el=>el && el.addEventListener('change', onToggle));

  spinBtn.addEventListener('click', spin);
  spinFab.addEventListener('click', spin);

  resetHistoryBtn.addEventListener('click', ()=>{ if(!spinning){ history=[]; localStorage.setItem('clubHistory','[]'); renderHistory(); }});

  let rTO; window.addEventListener('resize', ()=>{ clearTimeout(rTO); rTO=setTimeout(()=>{ sizeCanvas(); drawWheel(); },120); }, {passive:true});

  // ---------- Data loading ----------
  async function fetchPlayersJson(){
    const candidates=['/data/players.json','/players/players.json', new URL('./players/players.json', location.href).toString()];
    for(const u of candidates){ try{ const r=await fetch(u,{cache:'no-store'}); if(r.ok) return r; }catch{} }
    return null;
  }

  async function loadPlayers(){
    const res = await fetchPlayersJson();
    if(!res) throw new Error('players.json not found');
    const raw = await res.json();

    PLAYERS = (raw||[]).map(p=>{
      const name = p.name || p.player_name || 'Player';
      const imgPath = p.image_url || p.image || p.file || p.file_url || '';
      const img = imgPath ? resolvePublicUrl(imgPath) : faceFor(name);

      const teamIdRaw = p.team_id ?? p.teamId ?? p.club_id ?? p.clubId ?? p.meta?.team_id ?? p.meta?.club_id;
      const teamId = (teamIdRaw!==undefined && teamIdRaw!==null && teamIdRaw!=='') ? String(teamIdRaw) : null;

      const explicitClub = p.club || p.team || p.team_name || '';
      let clubName = explicitClub && explicitClub.trim() ? explicitClub.trim() : '';
      if (!clubName && teamId && TEAM_ID_INDEX[teamId]?.name) clubName = TEAM_ID_INDEX[teamId].name;

      const clubKey = clubName ? slug(clubName) : (teamId ? `id:${teamId}` : '');

      const nationality = p.nationality || p.country || p.meta?.nationality || '';
      const jersey = p.jersey_number ?? p.number ?? p.shirt_number ?? p.meta?.jersey_number ?? '';

      return {
        // fields used by wheel renderer (reuse structure)
        team_name: name,
        logo_url: img,
        league_code: 'PLAYER',
        primary_color: '#163058',
        stadium: '',

        // player extras
        name,
        image_url: img,
        club: clubName,
        clubKey,
        team_id: teamId,
        nationality,
        jersey_number: jersey,
        meta: p
      };
    });
    return PLAYERS;
  }

  // ---------- Boot ----------
  function boot(){
    fetch(`./teams.json?v=${Date.now()}`)
      .then(res => res.json())
      .then(async data => {
        TEAMS = data || [];

        TEAM_ID_INDEX = Object.create(null);
        for (const t of TEAMS){
          const id = String(t.id ?? t.team_id ?? t.teamId ?? '');
          if (!id || !t.team_name) continue;
          TEAM_ID_INDEX[id] = { name: t.team_name, key: slug(t.team_name) };
        }

        sizeCanvas();

        if (MODE==='player'){
          lblLogo.textContent='Image'; lblName.textContent='Name';
          lblJersey.textContent='Jersey Number'; lblNation.textContent='Nationality'; lblClub.textContent='Club';
          lblStadium.textContent='Stadium (team)'; lblLeague.textContent='League (team)';

          await loadPlayers().catch(()=>{});
          renderPlayerChips();
        } else {
          lblLogo.textContent='Logo'; lblName.textContent='Name';
          lblJersey.textContent='Jersey Number'; lblNation.textContent='Nationality'; lblClub.textContent='Club';
          lblStadium.textContent='Stadium'; lblLeague.textContent='League';

          renderTeamChips();
        }

        renderHistory();
        drawWheel();
        updateSpinAvailability();

        modeTeamBtn.classList.toggle('mode-btn-active', MODE==='team');
        modePlayerBtn.classList.toggle('mode-btn-active', MODE==='player');
        modeTeamBtn.setAttribute('aria-pressed', MODE==='team'?'true':'false');
        modePlayerBtn.setAttribute('aria-pressed', MODE==='player'?'true':'false');
      })
      .catch(err => {
        console.error('Failed to load teams.json', err);
        sizeCanvas(); drawWheel();
      });
  }

  boot();
})();

/* Maitoisten Opiston presidentinvaalit — äänten laskenta
 * Kaksi toimintatilaa:
 *  - PILVI  (Firebase Realtime Database): sama tila jaetaan kaikille koneille, joten
 *           useampi laskijakone + iso näyttö näkevät saman äänimäärän reaaliajassa.
 *  - PAIKALLINEN (localStorage + BroadcastChannel): vain saman koneen ikkunat,
 *           käytetään jos Firebase-asetuksia ei ole annettu (firebase-config.js).
 * Äänet tallennetaan lisäyslokina (jokainen ääni oma rivi) -> kaksi laskijaa voi
 * kirjata yhtä aikaa ilman ristiriitoja; laskurit johdetaan lokista. */

const STORAGE_KEY = 'maitosten-vaalit-v1';
const CHANNEL_NAME = 'maitosten-vaalit';
const DB_ROOT = 'elections/maitoset';           // jaettu polku pilvitilassa

const FB = window.FIREBASE_CONFIG || null;
let MODE = (FB && FB.databaseURL) ? 'cloud' : 'local';   // voi pudota 'local':iin jos pilviyhteys ei toimi

const PALETTE = [
  '#003580', '#c8102e', '#178a3f', '#e07b00', '#5b2d8e',
  '#0091ad', '#b5179e', '#2d6a4f', '#7048e8', '#d1495b',
];

const DEFAULT_TITLE = 'Maitoisten Opiston presidentinvaalit';
const DEFAULT_CANDIDATES = () => ([
  { id: 'c1', name: 'Alexander Virtanen', color: PALETTE[0], photo: null, number: '2' },
  { id: 'c2', name: 'Sanna Korhonen',     color: PALETTE[1], photo: null, number: '3' },
  { id: 'c3', name: 'Pekka Nieminen',     color: PALETTE[2], photo: null, number: '4' },
  { id: 'c4', name: 'Li Mäkinen',         color: PALETTE[3], photo: null, number: '5' },
  { id: 'c5', name: 'Olli Hämäläinen',    color: PALETTE[4], photo: null, number: '6' },
  { id: 'c6', name: 'Riikka Laine',       color: PALETTE[5], photo: null, number: '7' },
]);

// Salasanat (laskenta + asetukset). Vaihdettavissa asetuksista; tallennetaan hashattuna.
const DEFAULT_PW = { count: 'Mlasku', setup: 'M.asetukset' };
function hashStr(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }

/* Sanitointi: kaikki ehdokasdata (myös pilvestä/toisesta ikkunasta tuleva) puhdistetaan
 * ennen renderöintiä -> estää XSS-injektion väri-/kuvakenttien kautta ja rajoittaa koon. */
const HEX = /^#[0-9A-Fa-f]{3,8}$/;
function sanitizeCandidates(arr) {
  return (Array.isArray(arr) ? arr : []).filter(Boolean).map(c => ({
    id: String((c && c.id) || '').slice(0, 40),
    name: String((c && c.name) || '').slice(0, 60),
    color: (c && typeof c.color === 'string' && HEX.test(c.color)) ? c.color : PALETTE[0],
    photo: (c && typeof c.photo === 'string' && c.photo.startsWith('data:image/') && c.photo.length < 300000) ? c.photo : null,
    number: String((c && c.number) || '').slice(0, 4),
  }));
}
function sanitizeTitle(t) { return String(t || DEFAULT_TITLE).slice(0, 100); }
function sanitizePw(pw) {
  return { count: (pw && typeof pw.count === 'string') ? pw.count : null,
           setup: (pw && typeof pw.setup === 'string') ? pw.setup : null };
}

/* Yhtenäinen muistinvarainen tila, jonka näkymät lukevat.
 *   log: [{id, t, key?}]  (key on olemassa vain pilvitilassa kumoamista varten) */
let state = { title: DEFAULT_TITLE, candidates: [], log: [], pw: { count: null, setup: null } };
let ready = (MODE === 'local');   // pilvitilassa true kun ensimmäinen data on saapunut
let connected = false;
let everConnected = false;        // onko pilviyhteys joskus muodostunut (erottaa "ei koskaan" vs "katkesi")

/* Konekohtainen tunniste: pilvitilassa "kumoa viimeisin" poistaa vain tämän koneen äänet */
const DEVICE_ID = (() => {
  let d = localStorage.getItem('vaalit-device');
  if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('vaalit-device', d); }
  return d;
})();
let cloudError = false;          // pilviyhteys epäonnistui -> näytä virheruutu + varareitti
let cloudTimeout = null;
const pendingUndo = new Set();   // ääniavaimet joita ollaan poistamassa (nopea tuplakumous)
let localListenersAttached = false;

let votesRef = null, metaRef = null;

/* ---- Paikallistila: localStorage + BroadcastChannel ---- */
const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null;

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.candidates)) {
        return { title: sanitizeTitle(parsed.title), candidates: sanitizeCandidates(parsed.candidates),
                 log: Array.isArray(parsed.log) ? parsed.log : [], pw: sanitizePw(parsed.pw) };
      }
    }
  } catch (e) { /* ignore */ }
  return { title: DEFAULT_TITLE, candidates: DEFAULT_CANDIDATES(), log: [], pw: { count: null, setup: null } };
}
function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Muisti täynnä — tallennus epäonnistui', '#c8102e');   // esim. QuotaExceededError
  }
  if (channel) channel.postMessage(state);
}
function notify() { render(); }

/* Vastaanota saman koneen muut ikkunat (paikallistila). Kutsutaan kerran. */
function attachLocalListeners() {
  if (localListenersAttached) return;
  localListenersAttached = true;
  const adopt = (obj) => {
    state = { title: sanitizeTitle(obj.title), candidates: sanitizeCandidates(obj.candidates),
              log: Array.isArray(obj.log) ? obj.log : [], pw: sanitizePw(obj.pw) };
    render();
  };
  if (channel) channel.onmessage = (e) => { if (e.data && Array.isArray(e.data.candidates)) adopt(e.data); };
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { const p = JSON.parse(e.newValue); if (p && Array.isArray(p.candidates)) adopt(p); } catch (_) {}
  });
}

/* Pudota paikallistilaan jos pilviyhteys ei toimi (operaattorin valinta virheruudusta). */
function fallBackToLocal() {
  MODE = 'local';
  cloudError = false;
  clearTimeout(cloudTimeout);
  setNetWarn(false);
  state = loadLocal();
  ready = true;
  attachLocalListeners();
  toast('Jatketaan paikallisesti', '#e07b00');
  render();
}

/* ---- Pilvitila: Firebase ---- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Lataus epäonnistui: ' + src));
    document.head.appendChild(s);
  });
}

function cloudReady() { ready = true; notify(); }   // yhteyden/virheen tilaa hoitaa .info/connected + timeout

/* Ei-estävä varoituspalkki: appi toimii mutta pilviyhteyttä ei ole (äänet jonossa). */
function setNetWarn(show) {
  let el = document.getElementById('netbanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'netbanner'; el.className = 'netbanner';
    el.textContent = 'Ei pilviyhteyttä — äänet tallentuvat kun yhteys palaa. Tarkista verkko.';
    const bar = document.getElementById('topbar');
    if (bar && bar.parentNode) bar.parentNode.insertBefore(el, bar.nextSibling);
    else document.body.insertBefore(el, document.body.firstChild);
  }
  el.hidden = !show;
}

function initCloud() {
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.5/';
  // 9 s kuluttua: jos mitään ei latautunut -> estävä virheruutu; jos toimii muttei yhteyttä -> varoituspalkki
  cloudTimeout = setTimeout(() => {
    if (cloudError) return;
    if (!ready) { cloudError = true; ready = true; render(); }
    else if (!connected) setNetWarn(true);
  }, 9000);
  return loadScript(CDN + 'firebase-app-compat.js')
    .then(() => loadScript(CDN + 'firebase-database-compat.js'))
    .then(() => {
      firebase.initializeApp(FB);
      const db = firebase.database();
      metaRef = db.ref(DB_ROOT + '/meta');
      votesRef = db.ref(DB_ROOT + '/votes');

      // Siemennä ehdokkaat ATOMISESTI jos tietokanta on tyhjä (ei kilpailua kahden koneen välillä)
      metaRef.transaction(cur => (cur === null ? { title: DEFAULT_TITLE, candidates: DEFAULT_CANDIDATES() } : undefined))
        .catch(() => {});

      metaRef.on('value', snap => {
        if (MODE !== 'cloud') return;                 // ohita jos on pudottu paikallistilaan
        const m = snap.val() || {};
        state.title = sanitizeTitle(m.title);
        state.candidates = sanitizeCandidates(m.candidates);
        state.pw = { count: m.pwCount || null, setup: m.pwSetup || null };
        cloudReady();
      });
      votesRef.on('value', snap => {
        if (MODE !== 'cloud') return;
        const v = snap.val() || {};
        state.log = Object.keys(v)
          .map(key => ({ key, id: v[key].candId, t: v[key].t || 0, by: v[key].by }))
          .sort((a, b) => a.t - b.t);
        pendingUndo.forEach(k => { if (!v[k]) pendingUndo.delete(k); });   // siivoa jo poistetut
        cloudReady();
      });
      db.ref('.info/connected').on('value', s => {
        connected = !!s.val();
        if (connected) { everConnected = true; clearTimeout(cloudTimeout); cloudError = false; setNetWarn(false); render(); }
        else if (everConnected) setNetWarn(true);   // yhteys katkesi kesken -> varoita
        updateConn();
      });
    })
    .catch(err => {
      console.error('Firebase-yhteys epäonnistui:', err);   // SDK ei latautunut (esim. gstatic estetty)
      cloudError = true; ready = true; render();
    });
}

function updateConn() {
  const el = document.getElementById('conn');
  if (!el) return;
  if (MODE === 'local') {
    el.innerHTML = '<span class="cdot local"></span>Paikallinen';
    el.title = 'Vain tämän koneen ikkunat synkkaavat keskenään';
  } else if (connected) {
    el.innerHTML = '<span class="cdot ok"></span>Pilvi yhdistetty';
    el.title = 'Kaikki koneet synkkaavat reaaliajassa';
  } else {
    el.innerHTML = '<span class="cdot off"></span>Yhdistetään…';
    el.title = 'Odotetaan pilviyhteyttä';
  }
}

/* ---------------- Apurit ---------------- */
function counts() {
  const c = {};
  state.candidates.forEach(cand => c[cand.id] = 0);
  state.log.forEach(v => { if (c[v.id] != null) c[v.id]++; });
  return c;
}
function totalVotes() { const c = counts(); let t = 0; for (const k in c) t += c[k]; return t; }
// Kumottavat = tämän koneen äänet lokista (kestää sivun latauksen, toisin kuin istuntopino)
function myUndoable() { return state.log.filter(v => v.by === DEVICE_ID && !pendingUndo.has(v.key)); }
function canUndo() { return MODE === 'cloud' ? myUndoable().length > 0 : state.log.length > 0; }
// Tältä koneelta kirjatut äänet: pilvessä DEVICE_ID:llä merkityt, paikallistilassa kaikki
function myCount() {
  if (MODE !== 'cloud') return totalVotes();
  const ids = new Set(state.candidates.map(x => x.id));
  return state.log.reduce((n, v) => n + (v.by === DEVICE_ID && ids.has(v.id) ? 1 : 0), 0);
}

function initials(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return '?';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}
function pct(n, total) { return total ? (n / total * 100) : 0; }
function fmtPct(x) { return x.toFixed(1).replace('.', ',') + ' %'; }

/* Avatar: kuva jos ehdokkaalla on sellainen, muuten nimikirjaimet.
 * Väri ja kuva validoidaan tässäkin (defense-in-depth XSS:ää vastaan). */
function avatarHTML(cand, cls) {
  const color = HEX.test(cand.color || '') ? cand.color : PALETTE[0];
  const photo = (typeof cand.photo === 'string' && cand.photo.startsWith('data:image/')) ? cand.photo : null;
  if (photo) {
    return `<span class="${cls}" style="--c:${color}"><img src="${esc(photo)}" alt=""></span>`;
  }
  return `<span class="${cls}" style="--c:${color}">${esc(initials(cand.name))}</span>`;
}

/* Ehdokasnumero (näytetään kuvan tilalla vain laskennassa). Ilman numeroa -> nimikirjaimet. */
function numberBadge(cand) {
  const color = HEX.test(cand.color || '') ? cand.color : PALETTE[0];
  const num = String(cand.number || '').trim();
  return `<span class="avatar num-badge" style="--c:${color}">${esc(num || initials(cand.name))}</span>`;
}

/* Nimi kahtena rivinä (etunimi ylhäällä, sukunimi alhaalla) — kokonäytössä pilarit tasakokoisiksi */
function nameSpans(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const first = parts.length ? parts[0] : '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  return `<span class="bn-first">${esc(first)}</span><span class="bn-last">${esc(last)}</span>`;
}

/* Rajausikkuna: käyttäjä raahaa ja zoomaa kuvaa 3:4-suorakulmioon.
 * Palauttaa rajatun kuvan JPEG data-URLina (tai null jos peruttiin). */
const CROP_ASPECT = 3 / 4;   // pystysuorakulmio (leveys / korkeus)
function openCropper(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const FW = 276, FH = Math.round(FW / CROP_ASPECT);   // rajauskehys näytöllä
      const OUTW = 300, OUTH = Math.round(OUTW / CROP_ASPECT);
      const nW = img.naturalWidth, nH = img.naturalHeight;
      const baseScale = Math.max(FW / nW, FH / nH);         // "cover"

      const ov = document.createElement('div');
      ov.className = 'crop-overlay';
      ov.innerHTML = `
        <div class="crop-box">
          <div class="crop-title">Rajaa kuva</div>
          <div class="crop-hint">Raahaa kuvaa ja säädä kokoa liukusäätimellä.</div>
          <div class="crop-frame" style="width:${FW}px;height:${FH}px">
            <img class="crop-img" alt="" draggable="false">
          </div>
          <input type="range" class="crop-zoom" min="1" max="3" step="0.01" value="1">
          <div class="crop-actions">
            <button class="btn btn-ghost" data-c="cancel">Peruuta</button>
            <button class="btn btn-primary" data-c="ok">Käytä kuvaa</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const frame = ov.querySelector('.crop-frame');
      const im = ov.querySelector('.crop-img');
      const zoom = ov.querySelector('.crop-zoom');
      im.src = url;

      let scale = baseScale, tx = 0, ty = 0;
      const dims = () => ({ dW: nW * scale, dH: nH * scale });
      function clamp() {
        const { dW, dH } = dims();
        tx = Math.min(0, Math.max(FW - dW, tx));
        ty = Math.min(0, Math.max(FH - dH, ty));
      }
      function apply() {
        const { dW, dH } = dims();
        im.style.width = dW + 'px'; im.style.height = dH + 'px';
        im.style.left = tx + 'px'; im.style.top = ty + 'px';
      }
      (() => { const { dW, dH } = dims(); tx = (FW - dW) / 2; ty = (FH - dH) / 2; apply(); })();

      let dragging = false, px = 0, py = 0;
      frame.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; frame.setPointerCapture(e.pointerId); });
      frame.addEventListener('pointermove', e => {
        if (!dragging) return;
        tx += e.clientX - px; ty += e.clientY - py; px = e.clientX; py = e.clientY; clamp(); apply();
      });
      const endDrag = () => { dragging = false; };
      frame.addEventListener('pointerup', endDrag);
      frame.addEventListener('pointercancel', endDrag);

      zoom.addEventListener('input', () => {
        const newScale = baseScale * parseFloat(zoom.value);
        const cx = FW / 2, cy = FH / 2;
        const ipx = (cx - tx) / scale, ipy = (cy - ty) / scale;   // pidä keskikohta paikallaan
        scale = newScale;
        tx = cx - ipx * scale; ty = cy - ipy * scale;
        clamp(); apply();
      });

      function close(result) { URL.revokeObjectURL(url); ov.remove(); resolve(result); }
      ov.querySelector('[data-c="cancel"]').addEventListener('click', () => close(null));
      ov.addEventListener('click', e => { if (e.target === ov) close(null); });
      ov.querySelector('[data-c="ok"]').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = OUTW; canvas.height = OUTH;
        canvas.getContext('2d').drawImage(img, -tx / scale, -ty / scale, FW / scale, FH / scale, 0, 0, OUTW, OUTH);
        close(canvas.toDataURL('image/jpeg', 0.85));
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ---------------- Toimet ---------------- */
const writeError = () => toast('Tallennus epäonnistui — tarkista yhteys', '#c8102e');

function addVote(id) {
  if (MODE === 'cloud') {
    votesRef.push({ candId: id, t: firebase.database.ServerValue.TIMESTAMP, by: DEVICE_ID })
      .catch(writeError);
  } else {
    state.log.push({ id, t: Date.now() });
    persistLocal(); notify();
  }
}
function undoLast() {
  if (MODE === 'cloud') {
    const mine = myUndoable();
    if (!mine.length) return null;
    const last = mine[mine.length - 1];         // viimeisin oma ääni ajan mukaan
    pendingUndo.add(last.key);
    votesRef.child(last.key).remove()
      .catch(() => { pendingUndo.delete(last.key); toast('Kumous epäonnistui — tarkista yhteys', '#c8102e'); });
    return { id: last.id };
  }
  if (!state.log.length) return null;
  const removed = state.log.pop();
  persistLocal(); notify();
  return removed;
}
function resetVotes() {
  if (MODE === 'cloud') { pendingUndo.clear(); votesRef.remove().catch(writeError); }
  else { state.log = []; persistLocal(); notify(); }
}
function saveMeta(title, candidates) {
  if (MODE === 'cloud') {
    metaRef.update({ title, candidates }).catch(writeError);   // update säilyttää salasanat meta-nodessa
  } else {
    // Säilytä orpoäänet kuten pilvitilassakin (counts() jättää ne huomiotta) -> yhtenäinen käytös
    state.title = title;
    state.candidates = candidates;
    persistLocal(); notify();
  }
}

/* ---- Salasanat (laskenta + asetukset) ---- */
function currentPwHash(section) { return state.pw[section] || hashStr(DEFAULT_PW[section]); }
function checkPw(section, input) { return hashStr(input) === currentPwHash(section); }
function isUnlocked(section) { return sessionStorage.getItem('unlock-' + section) === currentPwHash(section); }
function setUnlocked(section) { sessionStorage.setItem('unlock-' + section, currentPwHash(section)); }
function savePassword(section, plain) {
  const h = hashStr(plain);
  if (MODE === 'cloud') metaRef.update({ [section === 'count' ? 'pwCount' : 'pwSetup']: h }).catch(writeError);
  else { state.pw[section] = h; persistLocal(); }
  sessionStorage.setItem('unlock-' + section, h);   // päivitä oma lukituksen avaus, ettei lukkiudu ulos
}

/* ---------------- Render-runko ---------------- */
const app = document.getElementById('app');

function currentView() {
  const h = location.hash.replace(/^#\//, '').split('?')[0];   // katkaise esim. "results?fs" -> "results"
  return ['count', 'results', 'setup'].includes(h) ? h : 'home';
}
function isFsHash() { return (location.hash.split('?')[1] || '') === 'fs'; }   // täsmällinen, ei löysä includes

/* Fullscreen-apurit (webkit-fallback Safaria varten) */
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function requestFs(el) { const fn = el.requestFullscreen || el.webkitRequestFullscreen; if (fn) { try { fn.call(el); } catch (_) {} } }
function exitNativeFs() { const fn = document.exitFullscreen || document.webkitExitFullscreen; if (fn) { try { fn.call(document); } catch (_) {} } }

function render() {
  const view = currentView();
  document.getElementById('brandTitle').textContent = state.title;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  const fs = isFsHash() && (view === 'results' || view === 'count');
  document.body.classList.toggle('fs', fs);
  app.classList.toggle('wide', view === 'results' || (view === 'count' && fs));
  if (!fs && fsElement()) exitNativeFs();       // varmista natiivi-kokonäytön sulku kun poistutaan
  updateConn();
  if (view !== 'results') resultsSig = null;   // rakenna tulokset uudelleen kun palataan näkymään

  if (cloudError) {
    app.innerHTML = `
      <div class="empty-note">
        <h3>Pilviyhteys ei toimi</h3>
        <p>Tarkista verkkoyhteys. Voit yrittää uudelleen, tai jatkaa vain tällä koneella
           (äänet eivät tällöin synkkaudu muille koneille).</p>
        <div class="err-actions">
          <button class="btn btn-primary" id="retryBtn">Yritä uudelleen</button>
          <button class="btn btn-ghost" id="localBtn">Jatka paikallisesti</button>
        </div>
      </div>`;
    app.querySelector('#retryBtn').addEventListener('click', () => location.reload());
    app.querySelector('#localBtn').addEventListener('click', fallBackToLocal);
    return;
  }
  if (!ready) {
    app.innerHTML = `<div class="empty-note"><h3>Yhdistetään pilveen…</h3>Haetaan ehdokkaita ja ääniä.</div>`;
    return;
  }

  // Salasanaportti laskennalle ja asetuksille (tulokset ja etusivu ovat avoimia)
  if ((view === 'count' && !isUnlocked('count')) || (view === 'setup' && !isUnlocked('setup'))) {
    renderGate(view);
    return;
  }

  if (view === 'count') renderCount();
  else if (view === 'results') renderResults();
  else if (view === 'setup') renderSetup();
  else renderHome();
}

function renderGate(section) {
  const label = section === 'setup' ? 'Asetukset' : 'Ääntenlasku';
  app.innerHTML = `
    <div class="gate">
      <h2>${label}</h2>
      <p>Syötä salasana jatkaaksesi.</p>
      <input type="password" id="pwInput" class="gate-input" autocomplete="off" autocapitalize="off" />
      <div class="pw-err" id="pwErr" hidden>Väärä salasana</div>
      <button class="btn btn-primary btn-lg" id="pwOk">Avaa</button>
    </div>`;
  const input = app.querySelector('#pwInput');
  const submit = () => {
    if (checkPw(section, input.value)) { setUnlocked(section); render(); }
    else { app.querySelector('#pwErr').hidden = false; input.value = ''; input.focus(); }
  };
  app.querySelector('#pwOk').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  input.focus();
}

/* ---------------- Etusivu ---------------- */
function renderHome() {
  app.innerHTML = `
    <div class="page-head">
      <h1>${esc(state.title)}</h1>
    </div>
    <div class="home-grid">
      <a class="home-card" href="#/count">
        <h2>Ääntenlasku</h2>
        <p>Kirjaa äänet ehdokkaille.</p>
      </a>
      <a class="home-card" href="#/results">
        <h2>Tulokset</h2>
        <p>Pylväät isolle näytölle.</p>
      </a>
    </div>
    <div class="home-stat">
      <div>
        <div class="big">${totalVotes()}</div>
        <div class="lbl">Ääniä laskettu</div>
      </div>
      <div>
        <div class="big">${state.candidates.length}</div>
        <div class="lbl">Ehdokasta</div>
      </div>
    </div>
  `;
}

/* ---------------- Ääntenlasku ---------------- */
function byNumber(a, b) {
  const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
  if (isNaN(na) && isNaN(nb)) return 0;
  if (isNaN(na)) return 1;            // numerottomat loppuun
  if (isNaN(nb)) return -1;
  return na - nb;
}

function renderCount() {
  if (!state.candidates.length) {
    app.innerHTML = emptyCandidates();
    return;
  }
  const ordered = [...state.candidates].sort(byNumber);   // laskennassa numerojärjestys
  app.innerHTML = `
    <div class="page-head">
      <h1>Ääntenlasku</h1>
      <p>Klikkaa ehdokasta jolle ääni kuuluu. Ohjelma pyytää vahvistuksen ennen kirjausta.</p>
    </div>
    <div class="count-bar">
      <div class="count-pills">
        <div class="counted-pill">Ääniä laskettu: <b>${totalVotes()}</b></div>
        <div class="counted-pill counted-pill--mine">Tältä koneelta: <b>${myCount()}</b></div>
      </div>
      <div class="count-actions">
        <button class="btn btn-ghost" id="undoBtn" ${canUndo() ? '' : 'disabled'}>Kumoa viimeisin${MODE === 'cloud' ? ' (tältä koneelta)' : ''}</button>
        <button class="btn btn-ghost" id="fsBtnCount">${isFsHash() ? 'Poistu koko näytöstä' : 'Koko näyttö'}</button>
      </div>
    </div>
    <div class="cand-grid">
      ${ordered.map(cand => `
        <button class="cand-card" style="--c:${cand.color}" data-id="${cand.id}">
          ${numberBadge(cand)}
          <span class="cand-meta">
            <span class="cand-name">${esc(cand.name)}</span>
          </span>
        </button>
      `).join('')}
    </div>
  `;

  app.querySelectorAll('.cand-card').forEach(card => {
    card.addEventListener('click', () => {
      const cand = state.candidates.find(x => x.id === card.dataset.id);
      confirmVote(cand);
    });
  });
  app.querySelector('#undoBtn').addEventListener('click', confirmUndo);
  app.querySelector('#fsBtnCount').addEventListener('click', () =>
    isFsHash() ? exitFullscreen() : enterFullscreen());
}

function confirmVote(cand) {
  openModal(`
    <div class="m-eyebrow">Vahvista ääni</div>
    <div class="m-cand">
      ${numberBadge(cand)}
      <span class="n">${esc(cand.name)}</span>
    </div>
    <div class="m-q">Kirjataanko yksi ääni tälle ehdokkaalle?</div>
    <div class="m-actions">
      <button class="btn btn-ghost" data-act="cancel">Peruuta</button>
      <button class="btn btn-good" data-act="ok">✔ Vahvista ääni</button>
    </div>
  `, {
    ok: () => {
      addVote(cand.id);
      closeModal();
      flashCard(cand.id);
      toast(`Ääni kirjattu: ${cand.name}`, cand.color);
    },
    cancel: closeModal,
  });
}

/* Mikä ääni kumoutuisi seuraavaksi (poistamatta) — vahvistusta varten */
function peekUndoCandidate() {
  let id = null;
  if (MODE === 'cloud') { const mine = myUndoable(); if (mine.length) id = mine[mine.length - 1].id; }
  else if (state.log.length) id = state.log[state.log.length - 1].id;
  if (!id) return null;
  return state.candidates.find(x => x.id === id)
    || { id, name: '(poistettu ehdokas)', color: '#6c757d', number: '?' };
}

function confirmUndo() {
  const cand = peekUndoCandidate();
  if (!cand) return;   // ei kumottavaa
  openModal(`
    <div class="m-eyebrow">Kumoa viimeisin ääni</div>
    <div class="m-cand">
      ${numberBadge(cand)}
      <span class="n">${esc(cand.name)}</span>
    </div>
    <div class="m-q">Poistetaanko tälle ehdokkaalle viimeksi kirjattu ääni?${MODE === 'cloud' ? ' (tältä koneelta)' : ''}</div>
    <div class="m-actions">
      <button class="btn btn-ghost" data-act="cancel">Peruuta</button>
      <button class="btn btn-danger" data-act="ok">Kumoa ääni</button>
    </div>
  `, {
    ok: () => {
      const removed = undoLast();
      closeModal();
      if (removed) {
        const c = state.candidates.find(x => x.id === removed.id);
        toast(`Kumottu${c ? ': ' + c.name : ''}`, c ? c.color : '#c8102e');
      }
    },
    cancel: closeModal,
  });
}

function confirmReset() {
  const total = totalVotes();
  openModal(`
    <div class="m-eyebrow">Nollaa äänet</div>
    <div class="m-cand"><span class="n">Poistetaanko kaikki ${total} ääntä?</span></div>
    <div class="m-q">Tätä ei voi perua. Ehdokkaat säilyvät. Kirjoita <b>NOLLAA</b> vahvistaaksesi.</div>
    <input type="text" id="resetConfirm" class="m-input" placeholder="NOLLAA" autocomplete="off" autocapitalize="characters" />
    <div class="m-actions">
      <button class="btn btn-ghost" data-act="cancel">Peruuta</button>
      <button class="btn btn-danger" data-act="ok" id="resetOk" disabled>Nollaa kaikki äänet</button>
    </div>
  `, {
    // Vahvistus vaatii tekstin "NOLLAA" — tarkistetaan tässä myös Enter-näppäimen varalta
    ok: () => {
      const inp = modalBody.querySelector('#resetConfirm');
      if (!inp || inp.value.trim().toUpperCase() !== 'NOLLAA') return;
      resetVotes(); closeModal(); toast('Äänet nollattu', '#c8102e');
    },
    cancel: closeModal,
  });
  const input = modalBody.querySelector('#resetConfirm');
  const ok = modalBody.querySelector('#resetOk');
  input.addEventListener('input', () => { ok.disabled = input.value.trim().toUpperCase() !== 'NOLLAA'; });
  input.focus();
}

function flashCard(id) {
  const card = app.querySelector(`.cand-card[data-id="${id}"]`);
  if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
}

/* ---------------- Tulokset ---------------- */
let resultsSig = null;   // rakennetaan luuranko uudelleen vain kun ehdokkaat / kokonäyttö muuttuu

// Kasvava "katto" pylväille: yhdellä äänellä pylväs on pieni (1/6) ja kasvaa äänien karttuessa
function niceCeiling(maxCount) {
  if (maxCount <= 0) return 6;
  const step = maxCount < 10 ? 2 : maxCount < 30 ? 5 : maxCount < 100 ? 10 : 25;
  return Math.max(6, (Math.floor(maxCount / step) + 1) * step);   // vähintään 6 -> aloitus pieni
}

function buildResults(ordered, isFs) {
  app.innerHTML = `
    ${isFs ? `
    <div class="fs-bar">
      <div class="fs-total"><b id="resTotalFs">0</b> ääntä laskettu</div>
      <button id="fsExit" class="fs-exit" title="Poistu kokonäytöstä (Esc)" aria-label="Poistu kokonäytöstä">✕</button>
    </div>
    ` : `
    <div class="results-head">
      <div>
        <h1>${esc(state.title)}</h1>
      </div>
      <div style="display:flex; align-items:flex-end; gap:22px;">
        <div class="results-total">
          <div class="num" id="resTotal">0</div>
          <div class="lbl">Ääntä laskettu</div>
        </div>
        <button class="btn btn-ghost" id="fsBtn">Koko näyttö</button>
      </div>
    </div>`}
    <div class="empty-note" id="resEmpty"><h3>Ei vielä ääniä</h3>Kun laskenta alkaa, pylväät kasvavat tähän reaaliajassa.</div>
    <div class="chart">
      <div class="bars">
        ${ordered.map(cand => `
          <div class="bar-col" data-id="${cand.id}">
            <div class="bar-track">
              <div class="bar" style="--c:${cand.color}; height:0%"><span class="bar-val">0</span></div>
            </div>
            <div class="bar-foot">
              ${avatarHTML(cand, 'bar-avatar')}
              <div class="bar-name">${nameSpans(cand.name)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const fsBtn = app.querySelector('#fsBtn');
  if (fsBtn) fsBtn.addEventListener('click', enterFullscreen);
  const fsExit = app.querySelector('#fsExit');
  if (fsExit) fsExit.addEventListener('click', exitFullscreen);
}

function renderResults() {
  const c = counts();
  const total = totalVotes();
  const isFs = isFsHash();
  const list = state.candidates;
  const ranked = [...list].sort((a, b) => c[b.id] - c[a.id]);   // eniten ääniä vasemmalle
  const maxCount = Math.max(0, ...list.map(x => c[x.id]));
  const ceiling = niceCeiling(maxCount);

  // Rakenna luuranko vain kun ehdokasjoukko / kokonäyttö muuttuu; muuten päivitä paikallaan
  const sig = JSON.stringify(list.map(x => [x.id, x.name, x.color, !!x.photo])) + '|' + isFs;
  if (sig !== resultsSig) {
    buildResults(ranked, isFs);
    resultsSig = sig;
    void app.offsetHeight;                      // pakota asettelu, jotta ensimmäinenkin kasvu animoituu 0:sta
  } else {
    reorderBars(ranked.map(x => x.id));         // animoi pylväät oikeaan järjestykseen
  }

  const totalEl = app.querySelector('#resTotal') || app.querySelector('#resTotalFs');
  if (totalEl) totalEl.textContent = total;
  const emptyEl = app.querySelector('#resEmpty');
  if (emptyEl) emptyEl.style.display = total === 0 ? '' : 'none';

  const trackEl = app.querySelector('.bar-track');
  const trackH = trackEl ? trackEl.clientHeight : 0;
  const MINPX = isFs ? 62 : 42;                 // 0-pylvään perustaso (numero mahtuu sisään)
  list.forEach(cand => {
    const col = app.querySelector(`.bar-col[data-id="${cand.id}"]`);
    if (!col) return;
    const n = c[cand.id];
    const bar = col.querySelector('.bar');
    // Ensimmäinenkin ääni nostaa selvästi perustason yläpuolelle; kasvaa katosta ylöspäin
    bar.style.height = (trackH > MINPX)
      ? Math.round(n <= 0 ? MINPX : MINPX + (n / ceiling) * (trackH - MINPX)) + 'px'
      : (n / ceiling * 100) + '%';
    bar.querySelector('.bar-val').textContent = n;
    col.classList.toggle('leader', n > 0 && n === maxCount);
  });
}

// FLIP: siirrä pylväät sulavasti uuteen järjestykseen (eniten ääniä vasemmalle)
function reorderBars(rankedIds) {
  const bars = app.querySelector('.bars');
  if (!bars) return;
  const first = new Map();
  Array.from(bars.children).forEach(col => first.set(col.dataset.id, col.getBoundingClientRect().left));
  rankedIds.forEach(id => {
    const col = bars.querySelector(`.bar-col[data-id="${id}"]`);
    if (col) bars.appendChild(col);
  });
  const deltas = new Map();
  let moved = false;
  rankedIds.forEach(id => {
    const col = bars.querySelector(`.bar-col[data-id="${id}"]`);
    if (!col) return;
    const dx = first.get(id) - col.getBoundingClientRect().left;
    deltas.set(id, dx);
    if (dx) moved = true;
  });
  if (!moved) return;
  rankedIds.forEach(id => {
    const col = bars.querySelector(`.bar-col[data-id="${id}"]`);
    if (col) { col.style.transition = 'none'; col.style.transform = `translateX(${deltas.get(id)}px)`; }
  });
  void bars.offsetWidth;
  rankedIds.forEach(id => {
    const col = bars.querySelector(`.bar-col[data-id="${id}"]`);
    if (col) { col.style.transition = 'transform .5s cubic-bezier(.22,.61,.36,1)'; col.style.transform = ''; }
  });
}

function enterFullscreen() {
  location.hash = '#/' + currentView() + '?fs';   // toimii sekä laskennassa että tuloksissa
  requestFs(document.documentElement);            // ?fs-tila riittää vaikka natiivi-API ei tukisi (iPad-Safari)
}
function exitFullscreen() {
  const base = currentView();
  if (fsElement()) exitNativeFs();
  location.hash = '#/' + base;
}

/* ---------------- Asetukset ---------------- */
function renderSetup() {
  app.innerHTML = `
    <div class="page-head">
      <h1>Asetukset</h1>
      <p>Muokkaa vaalin nimeä ja ehdokkaita. Muutokset päivittyvät heti laskentaan ja tuloksiin.</p>
    </div>
    <div class="setup-panel">
      <div class="field">
        <label for="titleInput">Vaalin nimi</label>
        <input type="text" id="titleInput" value="${esc(state.title)}" />
      </div>
      <div class="field">
        <label>Ehdokkaat</label>
        <div class="cand-rows" id="candRows"></div>
        <div class="setup-actions">
          <button class="btn btn-ghost" id="addBtn">+ Lisää ehdokas</button>
          <div class="spacer"></div>
          <button class="btn btn-ghost" id="clearBtn">Tyhjennä kaikki</button>
          <button class="btn btn-primary" id="saveBtn">Tallenna</button>
        </div>
      </div>
      <div class="hint">
        Vinkki: klikkaa värilaatikkoa vaihtaaksesi ehdokkaan pylvään värin.
        Ehdokkaan poistaminen ei poista jo kirjattuja ääniä toisilta ehdokkailta.
      </div>
    </div>
    <div class="setup-panel">
      <h3 class="sp-h">Salasanat</h3>
      <p class="hint" style="margin-top:0">Jätä tyhjäksi jos et halua vaihtaa. Muutos koskee kaikkia koneita.</p>
      <div class="field">
        <label for="pwCountInput">Ääntenlaskun salasana</label>
        <input type="text" id="pwCountInput" placeholder="uusi laskennan salasana" autocomplete="off" />
      </div>
      <div class="field">
        <label for="pwSetupInput">Asetusten salasana</label>
        <input type="text" id="pwSetupInput" placeholder="uusi asetusten salasana" autocomplete="off" />
      </div>
      <button class="btn btn-primary" id="savePwBtn">Tallenna salasanat</button>
    </div>
    <div class="setup-panel danger-zone">
      <h3>Nollaa äänet</h3>
      <p>Poistaa kaikki lasketut äänet kaikilta koneilta. Ehdokkaat säilyvät. Tätä ei voi perua.</p>
      <button class="btn btn-danger" id="resetVotesBtn">Nollaa äänet…</button>
    </div>
  `;

  // Työskennellään kopiolla, tallennus vasta "Tallenna"-napista
  let draft = state.candidates.map(c => ({ ...c }));

  function drawRows() {
    const wrap = app.querySelector('#candRows');
    wrap.innerHTML = draft.map((c, i) => `
      <div class="cand-row" data-i="${i}">
        <span class="swatch" style="background:${c.color}" title="Vaihda väri"></span>
        <input type="text" class="num-in" value="${esc(c.number || '')}" placeholder="nro" maxlength="4" title="Ehdokasnumero" aria-label="Ehdokasnumero" />
        <label class="photo-btn" style="--c:${c.color}" title="${c.photo ? 'Vaihda kuva' : 'Lisää kuva'}">
          ${c.photo ? `<img src="${c.photo}" alt="">` : '<span class="ph">Kuva</span>'}
          <input type="file" accept="image/*" hidden />
        </label>
        ${c.photo ? '<button class="photo-rm" title="Poista kuva" aria-label="Poista kuva">✕</button>' : ''}
        <input type="text" class="name-in" value="${esc(c.name)}" placeholder="Ehdokkaan nimi" />
        <button class="rm" title="Poista ehdokas" aria-label="Poista ehdokas">✕</button>
      </div>
    `).join('') || '<div class="hint">Ei ehdokkaita. Lisää vähintään yksi.</div>';

    wrap.querySelectorAll('.cand-row').forEach(row => {
      const i = +row.dataset.i;
      row.querySelector('.name-in').addEventListener('input', e => draft[i].name = e.target.value);
      row.querySelector('.num-in').addEventListener('input', e => draft[i].number = e.target.value);
      row.querySelector('.rm').addEventListener('click', () => { draft.splice(i, 1); drawRows(); });
      row.querySelector('.swatch').addEventListener('click', () => {
        const idx = PALETTE.indexOf(draft[i].color);
        draft[i].color = PALETTE[(idx + 1) % PALETTE.length];
        drawRows();
      });
      row.querySelector('.photo-btn input[type=file]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';                       // salli saman tiedoston valinta uudelleen
        if (!file) return;
        const dataURL = await openCropper(file);   // avaa rajaustyökalu
        if (dataURL) { draft[i].photo = dataURL; drawRows(); }
      });
      const rmPhoto = row.querySelector('.photo-rm');
      if (rmPhoto) rmPhoto.addEventListener('click', () => { draft[i].photo = null; drawRows(); });
    });
  }
  drawRows();

  app.querySelector('#addBtn').addEventListener('click', () => {
    let maxNum = 1;
    draft.forEach(c => { const n = parseInt(c.number, 10); if (!isNaN(n) && n > maxNum) maxNum = n; });
    draft.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                 name: '', color: PALETTE[draft.length % PALETTE.length], photo: null, number: String(maxNum + 1) });
    drawRows();
  });
  app.querySelector('#clearBtn').addEventListener('click', () => { draft = []; drawRows(); });

  app.querySelector('#saveBtn').addEventListener('click', () => {
    const title = app.querySelector('#titleInput').value.trim() || 'Presidentinvaalit';
    const cleaned = draft
      .map(c => ({ id: c.id, name: c.name.trim(), color: c.color, photo: c.photo || null, number: String(c.number || '').trim() }))
      .filter(c => c.name);
    if (!cleaned.length) { toast('Lisää vähintään yksi ehdokas', '#c8102e'); return; }
    saveMeta(title, cleaned);
    toast('Tallennettu', '#178a3f');
    location.hash = '#/count';
  });

  app.querySelector('#savePwBtn').addEventListener('click', () => {
    const pc = app.querySelector('#pwCountInput').value.trim();
    const ps = app.querySelector('#pwSetupInput').value.trim();
    if (!pc && !ps) { toast('Anna vähintään yksi uusi salasana', '#c8102e'); return; }
    if (pc) savePassword('count', pc);
    if (ps) savePassword('setup', ps);
    app.querySelector('#pwCountInput').value = '';
    app.querySelector('#pwSetupInput').value = '';
    toast('Salasanat päivitetty', '#178a3f');
  });

  app.querySelector('#resetVotesBtn').addEventListener('click', confirmReset);
}

function emptyCandidates() {
  return `
    <div class="empty-note">
      <h3>Ei ehdokkaita</h3>
      Lisää ehdokkaat <a href="#/setup">Asetukset</a>-näkymässä ennen laskennan aloittamista.
    </div>`;
}

/* ---------------- Modal ---------------- */
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
let modalHandlers = null;
let modalLastFocus = null;

function openModal(html, handlers) {
  modalLastFocus = document.activeElement;      // palauta fokus tänne sulkiessa
  modalBody.innerHTML = html;
  modalHandlers = handlers;
  modal.hidden = false;
  modalBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn = handlers[btn.dataset.act];
      if (fn) fn();
    });
  });
  const ok = modalBody.querySelector('[data-act="ok"]');
  if (ok) ok.focus();
}
function closeModal() {
  modal.hidden = true; modalHandlers = null;
  if (modalLastFocus && modalLastFocus.focus) { try { modalLastFocus.focus(); } catch (_) {} }
}

modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (modal.hidden || !modalHandlers) return;
  if (e.key === 'Escape' && modalHandlers.cancel) { modalHandlers.cancel(); return; }
  if (e.key === 'Enter' && modalHandlers.ok) { modalHandlers.ok(); return; }
  if (e.key === 'Tab') {                          // focus-trap: pidä fokus modaalin sisällä
    const f = modalBody.querySelectorAll('button:not([disabled]), input, a[href]');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ---------------- Toast ---------------- */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, color) {
  toastEl.innerHTML = `<span class="dot" style="background:${color || '#fff'}"></span>${esc(msg)}`;
  toastEl.hidden = false;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, 2200);
}

/* ---------------- Käynnistys ---------------- */
if (MODE === 'cloud') {
  initCloud();
} else {
  state = loadLocal();
  attachLocalListeners();
}

// Esc poistuu selaimen kokonäytöstä -> synkkaa hash takaisin normaaliin (webkit-fallback mukana)
function onFsChange() { if (!fsElement() && isFsHash()) location.hash = '#/' + currentView(); }
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// Offline-tuki: service worker (network-first, ei vanhentunutta versiota) -> uudelleenlataus toimii ilman verkkoa
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.addEventListener('hashchange', render);
render();

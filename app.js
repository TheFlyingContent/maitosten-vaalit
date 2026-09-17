/* Maitosten Opiston presidentinvaalit — äänten laskenta
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
const MODE = (FB && FB.databaseURL) ? 'cloud' : 'local';

const PALETTE = [
  '#003580', '#c8102e', '#178a3f', '#e07b00', '#5b2d8e',
  '#0091ad', '#b5179e', '#2d6a4f', '#7048e8', '#d1495b',
];

const DEFAULT_TITLE = 'Maitosten Opiston presidentinvaalit';
const DEFAULT_CANDIDATES = () => ([
  { id: 'c1', name: 'Alexander Virtanen', color: PALETTE[0], photo: null },
  { id: 'c2', name: 'Sanna Korhonen',     color: PALETTE[1], photo: null },
  { id: 'c3', name: 'Pekka Nieminen',     color: PALETTE[2], photo: null },
  { id: 'c4', name: 'Li Mäkinen',         color: PALETTE[3], photo: null },
  { id: 'c5', name: 'Olli Hämäläinen',    color: PALETTE[4], photo: null },
  { id: 'c6', name: 'Riikka Laine',       color: PALETTE[5], photo: null },
]);

/* Yhtenäinen muistinvarainen tila, jonka näkymät lukevat.
 *   log: [{id, t, key?}]  (key on olemassa vain pilvitilassa kumoamista varten) */
let state = { title: DEFAULT_TITLE, candidates: [], log: [] };
let ready = (MODE === 'local');   // pilvitilassa true kun ensimmäinen data on saapunut
let connected = false;

/* Konekohtainen tunniste: pilvitilassa "kumoa viimeisin" poistaa vain tämän koneen äänet */
const DEVICE_ID = (() => {
  let d = localStorage.getItem('vaalit-device');
  if (!d) { d = Math.random().toString(36).slice(2); localStorage.setItem('vaalit-device', d); }
  return d;
})();
let myVoteKeys = [];  // pilvitilassa tämän istunnon työntämät ääniavaimet

let votesRef = null, metaRef = null;

/* ---- Paikallistila: localStorage + BroadcastChannel ---- */
const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null;

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.candidates)) return parsed;
    }
  } catch (e) { /* ignore */ }
  return { title: DEFAULT_TITLE, candidates: DEFAULT_CANDIDATES(), log: [] };
}
function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (channel) channel.postMessage(state);
}
function notify() { render(); }

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

function initCloud() {
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.5/';
  return loadScript(CDN + 'firebase-app-compat.js')
    .then(() => loadScript(CDN + 'firebase-database-compat.js'))
    .then(() => {
      firebase.initializeApp(FB);
      const db = firebase.database();
      metaRef = db.ref(DB_ROOT + '/meta');
      votesRef = db.ref(DB_ROOT + '/votes');

      // Siemennä ehdokkaat jos tietokanta on tyhjä
      metaRef.once('value').then(snap => {
        if (!snap.exists()) metaRef.set({ title: DEFAULT_TITLE, candidates: DEFAULT_CANDIDATES() });
      }).catch(() => {});

      metaRef.on('value', snap => {
        const m = snap.val() || {};
        state.title = m.title || DEFAULT_TITLE;
        state.candidates = Array.isArray(m.candidates)
          ? m.candidates.filter(Boolean).map(c => ({ photo: null, ...c }))
          : [];
        ready = true;
        notify();
      });
      votesRef.on('value', snap => {
        const v = snap.val() || {};
        state.log = Object.keys(v)
          .map(key => ({ key, id: v[key].candId, t: v[key].t || 0 }))
          .sort((a, b) => a.t - b.t);
        ready = true;
        notify();
      });
      db.ref('.info/connected').on('value', s => { connected = !!s.val(); updateConn(); });
    })
    .catch(err => {
      console.error('Firebase-yhteys epäonnistui:', err);
      updateConn();
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
function canUndo() { return MODE === 'cloud' ? myVoteKeys.length > 0 : state.log.length > 0; }

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

/* Avatar: kuva jos ehdokkaalla on sellainen, muuten nimikirjaimet */
function avatarHTML(cand, cls) {
  if (cand.photo) {
    return `<span class="${cls}" style="--c:${cand.color}"><img src="${cand.photo}" alt=""></span>`;
  }
  return `<span class="${cls}" style="--c:${cand.color}">${esc(initials(cand.name))}</span>`;
}

/* Lue kuvatiedosto, rajaa keskeltä neliöksi ja pakkaa JPEGiksi -> data-URL.
 * Pieni koko jotta mahtuu localStorageen ja synkkaviestiin. */
function fileToSquareDataURL(file, size = 240, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kuvan lataus epäonnistui')); };
    img.src = url;
  });
}

/* ---------------- Toimet ---------------- */
function addVote(id) {
  if (MODE === 'cloud') {
    const ref = votesRef.push();
    myVoteKeys.push(ref.key);
    ref.set({ candId: id, t: firebase.database.ServerValue.TIMESTAMP, by: DEVICE_ID });
  } else {
    state.log.push({ id, t: Date.now() });
    persistLocal(); notify();
  }
}
function undoLast() {
  if (MODE === 'cloud') {
    if (!myVoteKeys.length) return null;
    const key = myVoteKeys.pop();
    const entry = state.log.find(v => v.key === key);
    votesRef.child(key).remove();
    return entry ? { id: entry.id } : null;
  }
  if (!state.log.length) return null;
  const removed = state.log.pop();
  persistLocal(); notify();
  return removed;
}
function resetVotes() {
  if (MODE === 'cloud') { myVoteKeys = []; votesRef.remove(); }
  else { state.log = []; persistLocal(); notify(); }
}
function saveMeta(title, candidates) {
  if (MODE === 'cloud') {
    metaRef.set({ title, candidates });
  } else {
    const ids = new Set(candidates.map(c => c.id));
    state.title = title;
    state.candidates = candidates;
    state.log = state.log.filter(v => ids.has(v.id)); // pudota poistettujen ehdokkaiden äänet
    persistLocal(); notify();
  }
}

/* ---------------- Render-runko ---------------- */
const app = document.getElementById('app');

function currentView() {
  const h = location.hash.replace(/^#\//, '').split('?')[0];   // katkaise esim. "results?fs" -> "results"
  return ['count', 'results', 'setup'].includes(h) ? h : 'home';
}

function render() {
  const view = currentView();
  document.getElementById('brandTitle').textContent = state.title;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.body.classList.toggle('fs', view === 'results' && location.hash.includes('fs'));
  app.classList.toggle('wide', view === 'results');
  updateConn();
  if (view !== 'results') resultsSig = null;   // rakenna tulokset uudelleen kun palataan näkymään

  if (!ready) {
    app.innerHTML = `<div class="empty-note"><h3>Yhdistetään pilveen…</h3>Haetaan ehdokkaita ja ääniä.</div>`;
    return;
  }

  if (view === 'count') renderCount();
  else if (view === 'results') renderResults();
  else if (view === 'setup') renderSetup();
  else renderHome();
}

/* ---------------- Etusivu ---------------- */
function renderHome() {
  app.innerHTML = `
    <div class="page-head">
      <h1>${esc(state.title)}</h1>
      <p>Valitse toiminto. Yksi laskija kirjaa äänet, iso näyttö näyttää tulokset reaaliajassa.</p>
    </div>
    <div class="home-grid">
      <a class="home-card" href="#/count">
        <h2>Ääntenlasku</h2>
        <p>Klikkaa ehdokasta, vahvista ääni erikseen ja kirjaa se. Vahinkoäänet estetään vahvistuksella ja voit kumota viimeisimmän.</p>
      </a>
      <a class="home-card" href="#/results">
        <h2>Äänten katsominen</h2>
        <p>Pylväsdiagrammi kaikkien ehdokkaiden äänistä — kuten oikeissa presidentinvaaleissa. Avaa tämä isolle näytölle.</p>
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
function renderCount() {
  const c = counts();
  if (!state.candidates.length) {
    app.innerHTML = emptyCandidates();
    return;
  }
  app.innerHTML = `
    <div class="page-head">
      <h1>Ääntenlasku</h1>
      <p>Klikkaa ehdokasta jolle ääni kuuluu. Ohjelma pyytää vahvistuksen ennen kirjausta.</p>
    </div>
    <div class="count-bar">
      <div class="counted-pill">Ääniä laskettu: <b>${totalVotes()}</b></div>
      <div class="count-actions">
        <button class="btn btn-ghost" id="undoBtn" ${canUndo() ? '' : 'disabled'}>Kumoa viimeisin${MODE === 'cloud' ? ' (tällä koneella)' : ''}</button>
        <button class="btn btn-ghost" id="resetBtn" ${totalVotes() ? '' : 'disabled'}>Nollaa laskenta</button>
      </div>
    </div>
    <div class="cand-grid">
      ${state.candidates.map(cand => `
        <button class="cand-card" style="--c:${cand.color}" data-id="${cand.id}">
          ${avatarHTML(cand, 'avatar')}
          <span class="cand-meta">
            <span class="cand-name">${esc(cand.name)}</span>
            <span class="cand-votes"><b>${c[cand.id]}</b> ääntä</span>
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
  app.querySelector('#undoBtn').addEventListener('click', () => {
    const removed = undoLast();
    if (removed) {
      const cand = state.candidates.find(x => x.id === removed.id);
      toast(`Kumottu${cand ? ': ' + cand.name : ''}`, cand ? cand.color : '#c8102e');
    }
  });
  app.querySelector('#resetBtn').addEventListener('click', confirmReset);
}

function confirmVote(cand) {
  openModal(`
    <div class="m-eyebrow">Vahvista ääni</div>
    <div class="m-cand">
      ${avatarHTML(cand, 'avatar')}
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

function confirmReset() {
  openModal(`
    <div class="m-eyebrow">Nollaa laskenta</div>
    <div class="m-cand"><span class="n">Poistetaanko kaikki ${totalVotes()} ääntä?</span></div>
    <div class="m-q">Tätä ei voi perua. Ehdokkaat säilyvät, mutta kaikki äänet nollataan.</div>
    <div class="m-actions">
      <button class="btn btn-ghost" data-act="cancel">Peruuta</button>
      <button class="btn btn-danger" data-act="ok">Nollaa kaikki äänet</button>
    </div>
  `, {
    ok: () => { resetVotes(); closeModal(); toast('Laskenta nollattu', '#c8102e'); },
    cancel: closeModal,
  });
}

function flashCard(id) {
  const card = app.querySelector(`.cand-card[data-id="${id}"]`);
  if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
}

/* ---------------- Tulokset ---------------- */
let resultsSig = null;   // rakennetaan luuranko uudelleen vain kun ehdokkaat / kokonäyttö muuttuu

// Kasvava "katto" pylväille: parilla äänellä pylväs ei ole täysi, vaan täyttyy äänien karttuessa
function niceCeiling(maxCount) {
  if (maxCount <= 0) return 1;
  const step = maxCount < 10 ? 2 : maxCount < 30 ? 5 : maxCount < 100 ? 10 : 25;
  return (Math.floor(maxCount / step) + 1) * step;
}

function buildResults(ordered, isFs) {
  app.innerHTML = `
    ${isFs ? `
    <div class="fs-total"><b id="resTotalFs">0</b> ääntä laskettu</div>
    <button id="fsExit" class="fs-exit" title="Poistu kokonäytöstä (Esc)">✕</button>
    ` : `
    <div class="results-head">
      <div>
        <h1>${esc(state.title)}</h1>
        <div class="sub">Ennakoimaton tulos · äänet päivittyvät reaaliajassa</div>
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
              <div class="bar-name">${esc(cand.name)}</div>
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
  const isFs = location.hash.includes('fs');
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

  list.forEach(cand => {
    const col = app.querySelector(`.bar-col[data-id="${cand.id}"]`);
    if (!col) return;
    const n = c[cand.id];
    col.querySelector('.bar').style.height = (n / ceiling * 100) + '%';
    col.querySelector('.bar-val').textContent = n;
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
  location.hash = '#/results?fs';
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}
function exitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  location.hash = '#/results';
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
  `;

  // Työskennellään kopiolla, tallennus vasta "Tallenna"-napista
  let draft = state.candidates.map(c => ({ ...c }));

  function drawRows() {
    const wrap = app.querySelector('#candRows');
    wrap.innerHTML = draft.map((c, i) => `
      <div class="cand-row" data-i="${i}">
        <span class="swatch" style="background:${c.color}" title="Vaihda väri"></span>
        <label class="photo-btn" style="--c:${c.color}" title="${c.photo ? 'Vaihda kuva' : 'Lisää kuva'}">
          ${c.photo ? `<img src="${c.photo}" alt="">` : '<span class="ph">Kuva</span>'}
          <input type="file" accept="image/*" hidden />
        </label>
        ${c.photo ? '<button class="photo-rm" title="Poista kuva">✕</button>' : ''}
        <input type="text" class="name-in" value="${esc(c.name)}" placeholder="Ehdokkaan nimi" />
        <button class="rm" title="Poista ehdokas">✕</button>
      </div>
    `).join('') || '<div class="hint">Ei ehdokkaita. Lisää vähintään yksi.</div>';

    wrap.querySelectorAll('.cand-row').forEach(row => {
      const i = +row.dataset.i;
      row.querySelector('.name-in').addEventListener('input', e => draft[i].name = e.target.value);
      row.querySelector('.rm').addEventListener('click', () => { draft.splice(i, 1); drawRows(); });
      row.querySelector('.swatch').addEventListener('click', () => {
        const idx = PALETTE.indexOf(draft[i].color);
        draft[i].color = PALETTE[(idx + 1) % PALETTE.length];
        drawRows();
      });
      row.querySelector('.photo-btn input[type=file]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { draft[i].photo = await fileToSquareDataURL(file); drawRows(); }
        catch (err) { toast('Kuvan käsittely epäonnistui', '#c8102e'); }
      });
      const rmPhoto = row.querySelector('.photo-rm');
      if (rmPhoto) rmPhoto.addEventListener('click', () => { draft[i].photo = null; drawRows(); });
    });
  }
  drawRows();

  app.querySelector('#addBtn').addEventListener('click', () => {
    draft.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                 name: '', color: PALETTE[draft.length % PALETTE.length], photo: null });
    drawRows();
  });
  app.querySelector('#clearBtn').addEventListener('click', () => { draft = []; drawRows(); });

  app.querySelector('#saveBtn').addEventListener('click', () => {
    const title = app.querySelector('#titleInput').value.trim() || 'Presidentinvaalit';
    const cleaned = draft
      .map(c => ({ id: c.id, name: c.name.trim(), color: c.color, photo: c.photo || null }))
      .filter(c => c.name);
    if (!cleaned.length) { toast('Lisää vähintään yksi ehdokas', '#c8102e'); return; }
    saveMeta(title, cleaned);
    toast('Tallennettu', '#178a3f');
    location.hash = '#/count';
  });
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

function openModal(html, handlers) {
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
function closeModal() { modal.hidden = true; modalHandlers = null; }

modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (modal.hidden || !modalHandlers) return;
  if (e.key === 'Escape' && modalHandlers.cancel) modalHandlers.cancel();
  if (e.key === 'Enter' && modalHandlers.ok) modalHandlers.ok();
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
  // Vastaanota muutokset saman koneen muista ikkunoista
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data && Array.isArray(e.data.candidates)) { state = e.data; render(); }
    };
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && Array.isArray(parsed.candidates)) { state = parsed; render(); }
      } catch (_) {}
    }
  });
}

// Esc poistuu selaimen kokonäytöstä -> synkkaa myös hash takaisin normaaliin
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && location.hash.includes('fs')) location.hash = '#/results';
});

window.addEventListener('hashchange', render);
render();

/* Maitosten Opiston presidentinvaalit — äänten laskenta
 * Staattinen vanilla-JS-sovellus. Ei backendiä.
 * Laskenta- ja tulosnäkymä synkataan reaaliajassa BroadcastChannelilla + localStoragella,
 * joten tulosnäkymän voi avata omaan ikkunaan isolle näytölle. */

const STORAGE_KEY = 'maitosten-vaalit-v1';
const CHANNEL_NAME = 'maitosten-vaalit';

const PALETTE = [
  '#003580', '#c8102e', '#178a3f', '#e07b00', '#5b2d8e',
  '#0091ad', '#b5179e', '#2d6a4f', '#7048e8', '#d1495b',
];

/* ---------------- Tila ---------------- */
const DEFAULT_STATE = () => ({
  title: 'Maitosten Opiston presidentinvaalit',
  candidates: [
    { id: 'c1', name: 'Alexander Virtanen', color: PALETTE[0] },
    { id: 'c2', name: 'Sanna Korhonen',     color: PALETTE[1] },
    { id: 'c3', name: 'Pekka Nieminen',     color: PALETTE[2] },
    { id: 'c4', name: 'Li Mäkinen',         color: PALETTE[3] },
    { id: 'c5', name: 'Olli Hämäläinen',    color: PALETTE[4] },
    { id: 'c6', name: 'Riikka Laine',       color: PALETTE[5] },
  ],
  log: [], // [{id, t}] äänet aikajärjestyksessä — laskurit johdetaan tästä, kumoaminen = pop
});

let state = load();

const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null;
let selfWrite = false;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.candidates)) return parsed;
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_STATE();
}

function persist() {
  selfWrite = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (channel) channel.postMessage(state);
}

/* Vastaanota muutokset muista ikkunoista */
if (channel) {
  channel.onmessage = (e) => {
    if (e.data && Array.isArray(e.data.candidates)) {
      state = e.data;
      render();
    }
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

/* ---------------- Apurit ---------------- */
function counts() {
  const c = {};
  state.candidates.forEach(cand => c[cand.id] = 0);
  state.log.forEach(v => { if (c[v.id] != null) c[v.id]++; });
  return c;
}
function totalVotes() { return state.log.length; }

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
  state.log.push({ id, t: Date.now() });
  persist();
}
function undoLast() {
  if (!state.log.length) return null;
  const removed = state.log.pop();
  persist();
  return removed;
}
function resetVotes() {
  state.log = [];
  persist();
}

/* ---------------- Render-runko ---------------- */
const app = document.getElementById('app');

function currentView() {
  const h = location.hash.replace(/^#\//, '');
  return ['count', 'results', 'setup'].includes(h) ? h : 'home';
}

function render() {
  const view = currentView();
  document.getElementById('brandTitle').textContent = state.title;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.body.classList.toggle('fs', view === 'results' && location.hash.includes('fs'));
  app.classList.toggle('wide', view === 'results');

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
        <span class="ico">🗳️</span>
        <h2>Ääntenlasku</h2>
        <p>Klikkaa ehdokasta, vahvista ääni erikseen ja kirjaa se. Vahinkoäänet estetään vahvistuksella ja voit kumota viimeisimmän.</p>
      </a>
      <a class="home-card" href="#/results">
        <span class="ico">📊</span>
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
        <button class="btn btn-ghost" id="undoBtn" ${totalVotes() ? '' : 'disabled'}>↩︎ Kumoa viimeisin</button>
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
function renderResults() {
  const c = counts();
  const total = totalVotes();
  const ranked = [...state.candidates].sort((a, b) => c[b.id] - c[a.id]);
  const maxCount = Math.max(1, ...state.candidates.map(x => c[x.id]));
  const leaderCount = ranked.length ? c[ranked[0].id] : 0;
  const isFs = location.hash.includes('fs');

  app.innerHTML = `
    <div class="results-head">
      <div>
        <h1>${esc(state.title)}</h1>
        <div class="sub">Ennakoimaton tulos · äänet päivittyvät reaaliajassa</div>
      </div>
      <div style="display:flex; align-items:flex-end; gap:22px;">
        <div class="results-total">
          <div class="num">${total}</div>
          <div class="lbl">Ääntä laskettu</div>
        </div>
        <button class="btn btn-ghost" id="fsBtn">${isFs ? '✕ Poistu koko&shy;näytöstä' : '⛶ Koko näyttö'}</button>
      </div>
    </div>
    ${total === 0 ? `<div class="empty-note"><h3>Ei vielä ääniä</h3>Kun laskenta alkaa, pylväät kasvavat tähän reaaliajassa.</div>` : ''}
    <div class="chart">
      <div class="bars">
        ${ranked.map(cand => {
          const n = c[cand.id];
          const h = (n / maxCount) * 100;
          const isLeader = n > 0 && n === leaderCount;
          return `
            <div class="bar-col ${isLeader ? 'leader' : ''}">
              <div class="bar-figures">
                <div class="bar-pct" style="color:${cand.color}">${fmtPct(pct(n, total))}</div>
                <div class="bar-count">${n} ääntä</div>
              </div>
              <div class="bar-track">
                <div class="bar" style="--c:${cand.color}; height:${h}%"></div>
              </div>
              <div class="bar-foot">
                ${avatarHTML(cand, 'bar-avatar')}
                <div class="bar-name">${isLeader ? '<span class="bar-crown">👑</span> ' : ''}${esc(cand.name)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  app.querySelector('#fsBtn').addEventListener('click', () => {
    if (isFs) { location.hash = '#/results'; }
    else {
      location.hash = '#/results?fs';
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  });
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
          ${c.photo ? `<img src="${c.photo}" alt="">` : '<span class="ph">📷</span>'}
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
    // Säilytä vain niiden äänet, jotka ovat yhä olemassa
    const ids = new Set(cleaned.map(c => c.id));
    state.title = title;
    state.candidates = cleaned;
    state.log = state.log.filter(v => ids.has(v.id));
    persist();
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
window.addEventListener('hashchange', render);
render();

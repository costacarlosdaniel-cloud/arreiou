/* ============================================================
   Karta · Retail Intelligence — UI Module
   ============================================================ */

/* ── Formatters ─────────────────────────────────────────────── */
export const Fmt = {
  n: (v, d=0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-AO', { minimumFractionDigits: d, maximumFractionDigits: d }),
  kz: v => {
    if (v == null || isNaN(v)) return '—';
    if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(2) + ' B Kz';
    if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1) + ' M Kz';
    if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(0) + ' k Kz';
    return Math.round(v).toLocaleString('pt-AO') + ' Kz';
  },
  pct: (v, d=1) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%',
  pctAbs: (v, d=2) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d) + '%',
  date: (v, fmt='medium') => {
    if (!v) return '—';
    const d = v?.toDate ? v.toDate() : new Date(v);
    if (fmt === 'short')     return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
    if (fmt === 'medium')    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
    if (fmt === 'long')      return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    if (fmt === 'monthYear') return d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    return d.toLocaleDateString('pt-PT');
  },
  delta: (cur, prev) => (!prev || prev === 0) ? null : ((cur - prev) / prev) * 100,
  time: t => t || '—',
};

/* ── Badge helpers ───────────────────────────────────────────── */
export const bdg = (t, cls) => `<span class="bdg ${cls}">${t}</span>`;
export const pctBdg = v => v >= .9 ? bdg(Fmt.pctAbs(v*100) + '%', 'b-g') : v >= .7 ? bdg(Fmt.pctAbs(v*100) + '%', 'b-a') : bdg(Fmt.pctAbs(v*100) + '%', 'b-r');
export const rutBdg = v => v == null ? '—' : v <= 1.5 ? bdg(Fmt.pctAbs(v) + '%', 'b-g') : v <= 3 ? bdg(Fmt.pctAbs(v) + '%', 'b-a') : bdg(Fmt.pctAbs(v) + '%', 'b-r');
export const dlBdg  = v => v === 0 ? bdg('0h', 'b-g') : v < 20 ? bdg(v + 'h', 'b-a') : bdg(v + 'h', 'b-r');
export const dpBdg  = v => v === 0 ? bdg('0h', 'b-g') : v < 50 ? bdg(v + 'h', 'b-a') : bdg(v + 'h', 'b-r');

/* ── aCard (análise card com barra de cor) ───────────────────── */
export function aCard(label, value, sub, colorClass) {
  return `<div class="acard ${colorClass||''}">
    <div class="acl">${label}</div>
    <div class="acv">${value}</div>
    ${sub ? `<div class="acs">${sub}</div>` : ''}
  </div>`;
}

/* ── bRow (barra horizontal em panels) ──────────────────────── */
export function bRow(lbl, val, max, color, valStr, wide) {
  const pct = max > 0 ? Math.max(1, val/max*100) : 0;
  return `<div class="brow">
    <div class="blbl${wide?' w':''}" title="${lbl}">${lbl}</div>
    <div class="btrack"><div class="bfill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
    <div class="bval">${valStr}</div>
  </div>`;
}

/* ── Toast ───────────────────────────────────────────────────── */
let _toastContainer;
function _getToasts() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById('toast-container');
    if (!_toastContainer) { _toastContainer = document.createElement('div'); _toastContainer.id = 'toast-container'; document.body.appendChild(_toastContainer); }
  }
  return _toastContainer;
}

const _ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

export const Toast = {
  show(msg, type='info', duration=4000) {
    const c = _getToasts();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${_ICONS[type]||_ICONS.info}</span><span class="toast-msg">${msg}</span><button class="toast-x" onclick="this.parentElement.remove()">✕</button>`;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast-in'));
    if (duration > 0) setTimeout(() => { t.classList.remove('toast-in'); setTimeout(() => t.remove(), 320); }, duration);
    return t;
  },
  success: (m,d) => Toast.show(m,'success',d),
  error:   (m,d) => Toast.show(m,'error',d),
  warning: (m,d) => Toast.show(m,'warning',d),
  info:    (m,d) => Toast.show(m,'info',d),
};

/* ── Loading ─────────────────────────────────────────────────── */
export const Loading = {
  show(el, msg='A carregar…') {
    if (!el) return;
    el.innerHTML = `<div class="empty"><div class="loading-spin"></div><p>${msg}</p></div>`;
  },
  showOverlay(msg='A processar…') {
    let o = document.getElementById('loading-overlay');
    if (!o) { o = document.createElement('div'); o.id='loading-overlay'; o.innerHTML=`<div class="loading-inner"><div class="loading-spin lg"></div><p id="loading-msg"></p></div>`; document.body.appendChild(o); }
    document.getElementById('loading-msg').textContent = msg;
    o.classList.add('active');
  },
  hideOverlay() { document.getElementById('loading-overlay')?.classList.remove('active'); },
  showError(el, msg='Erro ao carregar.', onRetry) {
    if (!el) return;
    el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" width="32" fill="none" stroke="var(--red)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p style="color:var(--t2)">${msg}</p>${onRetry?`<button class="bsave" style="margin-top:8px" onclick="(${onRetry.toString()})()">Tentar novamente</button>`:''}</div>`;
  },
  showEmpty(el, msg='Sem dados.') {
    if (!el) return;
    el.innerHTML = `<div class="empty"><p style="color:var(--t3)">${msg}</p></div>`;
  },
};

/* ── Modal ───────────────────────────────────────────────────── */
export const Modal = {
  open(id) {
    const m = document.getElementById(id); if (!m) return;
    m.style.display = 'flex';
    requestAnimationFrame(() => m.classList.add('modal-in'));
    document.body.classList.add('modal-open');
    m.addEventListener('click', e => { if (e.target === m) Modal.close(id); }, { once: true });
  },
  close(id) {
    const m = id ? document.getElementById(id) : document.querySelector('.modal-overlay.modal-in');
    if (!m) return;
    m.classList.remove('modal-in');
    setTimeout(() => { m.style.display = ''; document.body.classList.remove('modal-open'); }, 200);
  },
  confirm(title, msg, onOk) {
    let m = document.getElementById('modal-confirm');
    if (!m) {
      m = document.createElement('div'); m.id='modal-confirm'; m.className='modal-overlay';
      m.innerHTML=`<div class="modal-box modal-sm"><div class="modal-hdr"><h3 id="mc-title"></h3></div><div class="modal-body"><p id="mc-msg"></p></div><div class="modal-ftr"><button class="btn-up" id="mc-cancel">Cancelar</button><button class="bsave" style="background:var(--red)" id="mc-ok">Confirmar</button></div></div>`;
      document.body.appendChild(m);
    }
    document.getElementById('mc-title').textContent = title;
    document.getElementById('mc-msg').textContent = msg;
    document.getElementById('mc-ok').onclick = () => { Modal.close('modal-confirm'); onOk?.(); };
    document.getElementById('mc-cancel').onclick = () => Modal.close('modal-confirm');
    Modal.open('modal-confirm');
  },
};

/* ── Table filter ─────────────────────────────────────────────── */
export function filterTable(tableEl, q) {
  if (!tableEl) return;
  const ql = (q||'').toLowerCase().trim();
  tableEl.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.classList.contains('pend-loja-row')) { tr.style.display=''; return; }
    tr.style.display = !ql || tr.textContent.toLowerCase().includes(ql) ? '' : 'none';
  });
}

/* ── Export CSV ───────────────────────────────────────────────── */
export function exportCSV(data, filename='export') {
  if (!data?.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(';'), ...data.map(r => keys.map(k => {
    let v = r[k] ?? ''; if (typeof v === 'string' && v.includes(';')) v = `"${v}"`;
    return v;
  }).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' }));
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

/* ── Debounce ─────────────────────────────────────────────────── */
export function debounce(fn, ms=400) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── PWA install prompt ───────────────────────────────────────── */
export function setupInstallPrompt() {
  let deferred;
  const btn = document.getElementById('btn-install');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    if (btn) { btn.style.display='flex'; btn.onclick = async () => { deferred.prompt(); const {outcome}=await deferred.userChoice; if(outcome==='accepted') btn.style.display='none'; deferred=null; }; }
  });
  window.addEventListener('appinstalled', () => { if(btn) btn.style.display='none'; Toast.success('App instalada!'); });
}

/* ── Novo deploy banner ────────────────────────────────────────── */
export function setupUpdateBanner() {
  window.addEventListener('message', e => {
    if (e.data?.type === 'NEW_VERSION') {
      const b = document.createElement('div');
      b.className = 'update-banner';
      b.innerHTML = `<span>Nova versão disponível!</span><button onclick="window.location.reload()">Atualizar</button>`;
      document.body.appendChild(b);
    }
  });
}

/* ── Offline banner ─────────────────────────────────────────────── */
export function setupOfflineBanner() {
  const show = () => {
    if (document.getElementById('offline-banner')) return;
    const b = document.createElement('div'); b.id='offline-banner'; b.className='offline-banner';
    b.textContent='Sem ligação — modo offline';
    document.body.appendChild(b);
  };
  const hide = () => { document.getElementById('offline-banner')?.remove(); };
  if (!navigator.onLine) show();
  window.addEventListener('online',  () => { hide(); Toast.success('Ligação restabelecida'); });
  window.addEventListener('offline', () => { show(); Toast.warning('Sem ligação à internet'); });
}

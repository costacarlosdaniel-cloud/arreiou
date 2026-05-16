/* ============================================================
   Karta · Retail Intelligence — UI Module
   ============================================================
   - Toast notifications
   - Loading states
   - Modal system
   - Format utilities
   - Chart helpers
   ============================================================ */

/* ============================================================
   FORMAT UTILITIES
   ============================================================ */
export const Fmt = {
  currency(value, currency = 'AOA') {
    if (value == null || isNaN(value)) return '—';
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M Kz`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(0)}K Kz`;
    }
    return `${Math.round(value).toLocaleString('pt-AO')} Kz`;
  },

  number(value, decimals = 0) {
    if (value == null || isNaN(value)) return '—';
    return Number(value).toLocaleString('pt-PT', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  },

  percent(value, decimals = 1) {
    if (value == null || isNaN(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${Number(value).toFixed(decimals)}%`;
  },

  date(date, format = 'short') {
    if (!date) return '—';
    const d = date?.toDate ? date.toDate() : new Date(date);
    if (format === 'short') return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
    if (format === 'medium') return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
    if (format === 'long') return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    if (format === 'monthYear') return d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    return d.toLocaleDateString('pt-PT');
  },

  dateInput(date) {
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toISOString().split('T')[0];
  },

  relativeDelta(current, previous) {
    if (!previous || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }
};

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
let toastContainer;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

export const Toast = {
  show(message, type = 'info', duration = 4000) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 350);
      }, duration);
    }

    return toast;
  },

  success: (msg, d) => Toast.show(msg, 'success', d),
  error: (msg, d) => Toast.show(msg, 'error', d),
  warning: (msg, d) => Toast.show(msg, 'warning', d),
  info: (msg, d) => Toast.show(msg, 'info', d),
};

/* ============================================================
   LOADING STATES
   ============================================================ */
export const Loading = {
  show(container, message = 'A carregar...') {
    if (!container) return;
    container.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${message}</p>
      </div>
    `;
  },

  showOverlay(message = 'A processar...') {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.innerHTML = `
        <div class="loading-overlay-inner">
          <div class="loading-spinner loading-spinner-lg"></div>
          <p id="loading-overlay-msg">${message}</p>
        </div>
      `;
      document.body.appendChild(overlay);
    } else {
      document.getElementById('loading-overlay-msg').textContent = message;
    }
    overlay.classList.add('active');
  },

  hideOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('active');
  },

  showError(container, message = 'Erro ao carregar dados.', onRetry) {
    if (!container) return;
    container.innerHTML = `
      <div class="error-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>${message}</p>
        ${onRetry ? `<button class="btn btn-sm btn-outline" onclick="(${onRetry.toString()})()">Tentar novamente</button>` : ''}
      </div>
    `;
  },

  showEmpty(container, message = 'Sem dados disponíveis.', icon = '') {
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state">
        ${icon ? `<div class="empty-icon">${icon}</div>` : ''}
        <p>${message}</p>
      </div>
    `;
  }
};

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
export const Modal = {
  activeModal: null,

  open(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('modal-active');
    document.body.classList.add('modal-open');
    Modal.activeModal = modal;

    // Fechar ao clicar fora
    modal.addEventListener('click', (e) => {
      if (e.target === modal) Modal.close(id);
    }, { once: true });
  },

  close(id) {
    const modal = id ? document.getElementById(id) : Modal.activeModal;
    if (!modal) return;
    modal.classList.remove('modal-active');
    document.body.classList.remove('modal-open');
    Modal.activeModal = null;
  },

  confirm(title, message, onConfirm, onCancel) {
    let modal = document.getElementById('modal-confirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-confirm';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-box modal-sm">
          <div class="modal-header">
            <h3 id="modal-confirm-title"></h3>
          </div>
          <div class="modal-body">
            <p id="modal-confirm-msg"></p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" id="modal-confirm-cancel">Cancelar</button>
            <button class="btn btn-danger" id="modal-confirm-ok">Confirmar</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('modal-confirm-title').textContent = title;
    document.getElementById('modal-confirm-msg').textContent = message;

    const btnOk = document.getElementById('modal-confirm-ok');
    const btnCancel = document.getElementById('modal-confirm-cancel');

    const cleanup = () => Modal.close('modal-confirm');
    btnOk.onclick = () => { cleanup(); onConfirm?.(); };
    btnCancel.onclick = () => { cleanup(); onCancel?.(); };

    Modal.open('modal-confirm');
  }
};

/* ============================================================
   KPI CARD BUILDER
   ============================================================ */
export function buildKPICard({ label, value, sub, trend, trendPositive, icon, color = 'blue' }) {
  const trendClass = trend != null ? (trendPositive ? 'trend-up' : 'trend-down') : '';
  const trendIcon = trendPositive
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;

  return `
    <div class="kpi-card kpi-card-${color}">
      <div class="kpi-header">
        <span class="kpi-label">${label}</span>
        ${icon ? `<span class="kpi-icon">${icon}</span>` : ''}
      </div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-footer">
        ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
        ${trend != null ? `
          <span class="kpi-trend ${trendClass}">
            ${trendIcon}
            ${Math.abs(trend).toFixed(1)}%
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

/* ============================================================
   MINI SPARKLINE (SVG)
   ============================================================ */
export function buildSparkline(data, color = '#0070F3', height = 40, width = 120) {
  if (!data?.length) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${fillPoints}" fill="url(#spark-grad)"/>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/* ============================================================
   PROGRESS BAR
   ============================================================ */
export function buildProgressBar(value, max, label, color = '#0070F3') {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const cls = pct >= 100 ? 'progress-success' : pct >= 80 ? 'progress-warning' : 'progress-danger';
  return `
    <div class="progress-wrap">
      ${label ? `<div class="progress-label"><span>${label}</span><span>${pct}%</span></div>` : ''}
      <div class="progress-bar-track">
        <div class="progress-bar-fill ${cls}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

/* ============================================================
   TABLE BUILDER
   ============================================================ */
export function buildTable({ columns, rows, onRowClick, emptyMsg = 'Sem dados' }) {
  if (!rows?.length) {
    return `<div class="table-empty">${emptyMsg}</div>`;
  }

  const headers = columns.map(c => `<th>${c.label}</th>`).join('');
  const bodyRows = rows.map((row, i) => {
    const cells = columns.map(c => {
      const val = typeof c.render === 'function' ? c.render(row[c.key], row) : (row[c.key] ?? '—');
      return `<td>${val}</td>`;
    }).join('');
    return `<tr class="${onRowClick ? 'tr-clickable' : ''}" data-row="${i}">${cells}</tr>`;
  }).join('');

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   DEBOUNCE
   ============================================================ */
export function debounce(fn, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ============================================================
   EXPORT TO EXCEL (CSV)
   ============================================================ */
export function exportToCSV(data, filename = 'export') {
  if (!data?.length) return;
  const keys = Object.keys(data[0]);
  const header = keys.join(';');
  const rows = data.map(row => keys.map(k => {
    let val = row[k] ?? '';
    if (typeof val === 'string' && val.includes(';')) val = `"${val}"`;
    return val;
  }).join(';'));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   SEARCH FILTER
   ============================================================ */
export function filterTable(tableEl, query) {
  if (!tableEl) return;
  const rows = tableEl.querySelectorAll('tbody tr');
  const q = query.toLowerCase().trim();
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

/* ============================================================
   INSTALL PROMPT
   ============================================================ */
export function setupInstallPrompt() {
  let deferredPrompt;
  const btn = document.getElementById('btn-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) {
      btn.style.display = 'flex';
      btn.addEventListener('click', async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') btn.style.display = 'none';
        deferredPrompt = null;
      });
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btn) btn.style.display = 'none';
    Toast.success('App instalada com sucesso!');
  });
}

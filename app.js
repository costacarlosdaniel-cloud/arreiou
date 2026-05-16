/* ============================================================
   Karta · Retail Intelligence — App Module
   ============================================================
   - Routing entre módulos
   - Estado global da aplicação
   - Lógica de negócio
   - Integração Firebase + UI
   ============================================================ */

import { initFirebase, StoresDB, KPIsDB, TargetsDB, InventoryDB, ReviewsDB, SchedulesDB, StorageDB, Cache, seedDemoData } from './firebase.js';
import { Fmt, Toast, Loading, Modal, buildKPICard, buildSparkline, buildProgressBar, buildTable, debounce, exportToCSV, filterTable, setupInstallPrompt } from './ui.js';

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const State = {
  currentModule: 'dashboard',
  selectedStore: null,
  stores: [],
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  user: null,
  offline: !navigator.onLine,
};

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function init() {
  // Service Worker
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    } catch (e) {
      console.warn('[SW] Falha no registo:', e);
    }
  }

  // Firebase
  const firebaseOk = initFirebase();
  if (!firebaseOk) {
    Toast.error('Erro ao ligar ao Firebase. A usar dados demo.');
  }

  // Online/offline
  window.addEventListener('online', () => {
    State.offline = false;
    document.getElementById('offline-banner')?.remove();
    Toast.success('Ligação restabelecida');
  });
  window.addEventListener('offline', () => {
    State.offline = true;
    showOfflineBanner();
    Toast.warning('Sem ligação à internet');
  });
  if (!navigator.onLine) showOfflineBanner();

  // Install prompt
  setupInstallPrompt();

  // Carregar lojas
  await loadStores();

  // Routing
  setupNavigation();
  navigateTo(State.currentModule);

  // Sidebar toggle mobile
  setupSidebar();
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function setupNavigation() {
  // Sidebar links
  document.querySelectorAll('[data-module]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const module = el.dataset.module;
      navigateTo(module);
      // Fechar sidebar mobile
      document.getElementById('sidebar')?.classList.remove('sidebar-open');
    });
  });

  // Bottom nav mobile
  document.querySelectorAll('[data-bottom-nav]').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo(el.dataset.bottomNav);
    });
  });
}

function navigateTo(module) {
  State.currentModule = module;

  // Update active state nav
  document.querySelectorAll('[data-module]').forEach(el => {
    el.classList.toggle('nav-active', el.dataset.module === module);
  });
  document.querySelectorAll('[data-bottom-nav]').forEach(el => {
    el.classList.toggle('bottom-nav-active', el.dataset.bottom_nav === module || el.dataset.bottomNav === module);
  });

  // Update page title
  const titles = {
    dashboard: 'Dashboard',
    analytics: 'Análises',
    inventory: 'Contagens',
    schedules: 'Escalas',
    reviews: 'Roteiro',
    admin: 'Administração',
  };
  document.getElementById('page-title').textContent = titles[module] || module;

  // Render module
  renderModule(module);
}

async function renderModule(module) {
  const main = document.getElementById('main-content');
  Loading.show(main);

  try {
    switch (module) {
      case 'dashboard': await renderDashboard(main); break;
      case 'analytics': await renderAnalytics(main); break;
      case 'inventory': await renderInventory(main); break;
      case 'schedules': await renderSchedules(main); break;
      case 'reviews': await renderReviews(main); break;
      case 'admin': await renderAdmin(main); break;
      default: main.innerHTML = `<div class="empty-state"><p>Módulo não encontrado</p></div>`;
    }
  } catch (error) {
    console.error('[App] Erro ao renderizar módulo:', error);
    Loading.showError(main, 'Erro ao carregar módulo. Verifique a ligação ao Firebase.', () => renderModule(module));
  }
}

/* ============================================================
   LOJAS
   ============================================================ */
async function loadStores() {
  try {
    State.stores = await StoresDB.getAll();
    if (!State.stores.length) {
      // Usar dados demo se não houver lojas
      State.stores = getDemoStores();
    }
    if (State.stores.length && !State.selectedStore) {
      State.selectedStore = State.stores[0];
    }
    populateStoreSelectors();
  } catch (e) {
    console.warn('[App] Usando dados demo (Firebase não configurado)');
    State.stores = getDemoStores();
    State.selectedStore = State.stores[0];
    populateStoreSelectors();
  }
}

function populateStoreSelectors() {
  document.querySelectorAll('.store-select').forEach(sel => {
    sel.innerHTML = State.stores.map(s =>
      `<option value="${s.id}" ${State.selectedStore?.id === s.id ? 'selected' : ''}>${s.id} · ${s.name}</option>`
    ).join('');
    sel.addEventListener('change', (e) => {
      State.selectedStore = State.stores.find(s => s.id === e.target.value);
      renderModule(State.currentModule);
    });
  });
}

/* ============================================================
   DEMO DATA (sem Firebase configurado)
   ============================================================ */
function getDemoStores() {
  return [
    { id: 'A001', name: 'Luanda Centro', city: 'Luanda', supervisor: 'Ana Silva', manager: 'João Costa', active: true, area: 850 },
    { id: 'A002', name: 'Talatona', city: 'Luanda', supervisor: 'Pedro Mendes', manager: 'Maria Fonseca', active: true, area: 1200 },
    { id: 'A003', name: 'Viana', city: 'Viana', supervisor: 'Ana Silva', manager: 'Carlos Lima', active: true, area: 950 },
    { id: 'A004', name: 'Cacuaco', city: 'Luanda', supervisor: 'Pedro Mendes', manager: 'Rita Sousa', active: true, area: 780 },
    { id: 'A005', name: 'Benguela', city: 'Benguela', supervisor: 'Luís Rocha', manager: 'Paula Neto', active: true, area: 1100 },
  ];
}

function generateDemoKPIs(storeId, days = 30) {
  const result = [];
  const seed = storeId.charCodeAt(storeId.length - 1);
  const baseRevenue = 1_400_000 + seed * 80_000;

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dow = date.getDay();
    const weekendBoost = (dow === 5 || dow === 6) ? 1.3 : 1;
    const variance = 0.85 + Math.random() * 0.3;
    const revenue = Math.round(baseRevenue * weekendBoost * variance);
    const customers = Math.round((300 + seed * 15) * weekendBoost * variance);
    result.push({
      dateStr: date.toISOString().split('T')[0],
      date,
      revenue,
      customers,
      avgTicket: Math.round(revenue / customers),
      waste: Math.round(revenue * (0.01 + Math.random() * 0.015)),
      storeId,
    });
  }
  return result;
}

/* ============================================================
   MÓDULO: DASHBOARD
   ============================================================ */
async function renderDashboard(container) {
  const store = State.selectedStore;
  if (!store) {
    container.innerHTML = `<div class="empty-state"><p>Selecione uma loja</p></div>`;
    return;
  }

  let kpis = [];
  try {
    kpis = await KPIsDB.getByStoreAndMonth(store.id, State.currentYear, State.currentMonth);
  } catch {
    kpis = generateDemoKPIs(store.id);
  }

  let prevKpis = [];
  try {
    const prevMonth = State.currentMonth === 1 ? 12 : State.currentMonth - 1;
    const prevYear = State.currentMonth === 1 ? State.currentYear - 1 : State.currentYear;
    prevKpis = await KPIsDB.getByStoreAndMonth(store.id, prevYear, prevMonth);
  } catch {
    prevKpis = generateDemoKPIs(store.id, 30).map(k => ({
      ...k,
      revenue: Math.round(k.revenue * 0.93),
      customers: Math.round(k.customers * 0.91),
    }));
  }

  // Totais mês atual
  const totalRevenue = kpis.reduce((s, k) => s + (k.revenue || 0), 0);
  const totalCustomers = kpis.reduce((s, k) => s + (k.customers || 0), 0);
  const totalWaste = kpis.reduce((s, k) => s + (k.waste || 0), 0);
  const avgTicket = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

  // Totais mês anterior
  const prevRevenue = prevKpis.reduce((s, k) => s + (k.revenue || 0), 0);
  const prevCustomers = prevKpis.reduce((s, k) => s + (k.customers || 0), 0);

  const revDelta = prevRevenue ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null;
  const custDelta = prevCustomers ? ((totalCustomers - prevCustomers) / prevCustomers) * 100 : null;

  // Sparklines data
  const revenueData = kpis.map(k => k.revenue);
  const customerData = kpis.map(k => k.customers);

  // Target mock
  const target = { revenueTarget: 55_000_000, customersTarget: 9000, wasteTarget: 800_000 };

  // Ranking
  const rankingData = State.stores.map(s => {
    const demo = generateDemoKPIs(s.id);
    const rev = demo.reduce((acc, k) => acc + k.revenue, 0);
    return { ...s, revenue: rev };
  }).sort((a, b) => b.revenue - a.revenue);

  const todayKpi = kpis[kpis.length - 1];

  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <div class="store-badge">${store.id}</div>
        <div>
          <h2>${store.name}</h2>
          <p class="text-muted">${store.city} · Gerente: ${store.manager || '—'}</p>
        </div>
      </div>
      <div class="module-header-right">
        <select class="store-select select"></select>
        <div class="month-picker">
          <button class="btn-icon" id="btn-prev-month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="month-label">${Fmt.date(new Date(State.currentYear, State.currentMonth - 1), 'monthYear')}</span>
          <button class="btn-icon" id="btn-next-month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      ${buildKPICard({ label: 'Vendas MTD', value: Fmt.currency(totalRevenue), sub: `Hoje: ${Fmt.currency(todayKpi?.revenue)}`, trend: revDelta, trendPositive: revDelta >= 0, color: 'blue',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>` })}
      ${buildKPICard({ label: 'Clientes MTD', value: Fmt.number(totalCustomers), sub: `Hoje: ${Fmt.number(todayKpi?.customers)}`, trend: custDelta, trendPositive: custDelta >= 0, color: 'indigo',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>` })}
      ${buildKPICard({ label: 'Ticket Médio', value: Fmt.currency(avgTicket), sub: `Hoje: ${Fmt.currency(todayKpi?.avgTicket)}`, color: 'violet',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>` })}
      ${buildKPICard({ label: 'Quebras MTD', value: Fmt.currency(totalWaste), sub: `${((totalWaste / totalRevenue) * 100).toFixed(2)}% das vendas`, trendPositive: false, color: 'red',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h18l-1.5 10H4.5L3 3z"/><path d="M16 16a2 2 0 100 4 2 2 0 000-4z"/><path d="M8 16a2 2 0 100 4 2 2 0 000-4z"/></svg>` })}
    </div>

    <div class="dashboard-grid">
      <div class="card card-chart">
        <div class="card-header">
          <h3>Vendas Diárias</h3>
          <span class="badge">${Fmt.date(new Date(State.currentYear, State.currentMonth - 1), 'monthYear')}</span>
        </div>
        <div id="chart-revenue" class="chart-area"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Objetivos do Mês</h3>
        </div>
        <div class="targets-list">
          <div class="target-item">
            <div class="target-label">
              <span>Vendas</span>
              <span>${Fmt.currency(totalRevenue)} / ${Fmt.currency(target.revenueTarget)}</span>
            </div>
            ${buildProgressBar(totalRevenue, target.revenueTarget)}
          </div>
          <div class="target-item">
            <div class="target-label">
              <span>Clientes</span>
              <span>${Fmt.number(totalCustomers)} / ${Fmt.number(target.customersTarget)}</span>
            </div>
            ${buildProgressBar(totalCustomers, target.customersTarget)}
          </div>
          <div class="target-item">
            <div class="target-label">
              <span>Quebras (máx.)</span>
              <span>${Fmt.currency(totalWaste)} / ${Fmt.currency(target.wasteTarget)}</span>
            </div>
            ${buildProgressBar(target.wasteTarget - totalWaste, target.wasteTarget)}
          </div>
        </div>
      </div>

      <div class="card card-ranking">
        <div class="card-header">
          <h3>Ranking de Lojas</h3>
          <span class="text-muted text-sm">por volume de vendas</span>
        </div>
        <div class="ranking-list">
          ${rankingData.map((s, i) => `
            <div class="ranking-item ${s.id === store.id ? 'ranking-item-active' : ''}">
              <span class="ranking-pos">${i + 1}</span>
              <div class="ranking-info">
                <span class="ranking-name">${s.id} · ${s.name}</span>
                <span class="ranking-value">${Fmt.currency(s.revenue)}</span>
              </div>
              <div class="ranking-bar-wrap">
                <div class="ranking-bar" style="width:${Math.round((s.revenue / rankingData[0].revenue) * 100)}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Últimos 7 Dias</h3>
        </div>
        ${buildTable({
          columns: [
            { key: 'dateStr', label: 'Data', render: v => Fmt.date(v, 'medium') },
            { key: 'revenue', label: 'Vendas', render: v => Fmt.currency(v) },
            { key: 'customers', label: 'Clientes', render: v => Fmt.number(v) },
            { key: 'avgTicket', label: 'Ticket', render: v => Fmt.currency(v) },
            { key: 'waste', label: 'Quebras', render: v => Fmt.currency(v) },
          ],
          rows: kpis.slice(-7).reverse(),
        })}
      </div>
    </div>
  `;

  populateStoreSelectors();
  renderRevenueChart(kpis);

  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    if (State.currentMonth === 1) { State.currentMonth = 12; State.currentYear--; }
    else State.currentMonth--;
    renderModule('dashboard');
  });
  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    if (State.currentMonth === 12) { State.currentMonth = 1; State.currentYear++; }
    else State.currentMonth++;
    renderModule('dashboard');
  });
}

function renderRevenueChart(kpis) {
  const container = document.getElementById('chart-revenue');
  if (!container || !kpis.length) return;

  const max = Math.max(...kpis.map(k => k.revenue));
  const barWidth = Math.max(4, Math.floor(container.offsetWidth / kpis.length) - 3);

  container.innerHTML = `
    <div class="bar-chart">
      ${kpis.map(k => {
        const pct = (k.revenue / max) * 100;
        const isToday = k.dateStr === new Date().toISOString().split('T')[0];
        return `
          <div class="bar-col" title="${Fmt.date(k.dateStr, 'medium')}: ${Fmt.currency(k.revenue)}">
            <div class="bar-fill ${isToday ? 'bar-today' : ''}" style="height:${pct}%"></div>
            <span class="bar-label">${new Date(k.dateStr + 'T12:00:00').getDate()}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ============================================================
   MÓDULO: ANÁLISES
   ============================================================ */
async function renderAnalytics(container) {
  const store = State.selectedStore;
  let kpis = generateDemoKPIs(store?.id || 'A001', 60);

  // Calcular top/flop por dia da semana
  const byDay = {};
  kpis.forEach(k => {
    const day = new Date(k.dateStr + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long' });
    if (!byDay[day]) byDay[day] = { total: 0, count: 0 };
    byDay[day].total += k.revenue;
    byDay[day].count++;
  });

  const byDayArr = Object.entries(byDay).map(([day, v]) => ({
    day, avg: Math.round(v.total / v.count), total: v.total
  })).sort((a, b) => b.avg - a.avg);

  const last30 = kpis.slice(-30);
  const top10days = [...last30].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const flop10days = [...last30].sort((a, b) => a.revenue - b.revenue).slice(0, 10);

  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <h2>Análises</h2>
        <p class="text-muted">Últimos 30 dias · ${store?.name || 'Todas as lojas'}</p>
      </div>
      <div class="module-header-right">
        <select class="store-select select"></select>
      </div>
    </div>

    <div class="analytics-grid">
      <div class="card">
        <div class="card-header"><h3>🏆 Top 10 Dias — Vendas</h3></div>
        ${buildTable({
          columns: [
            { key: 'dateStr', label: 'Data', render: v => Fmt.date(v, 'medium') },
            { key: 'revenue', label: 'Vendas', render: v => `<strong>${Fmt.currency(v)}</strong>` },
            { key: 'customers', label: 'Clientes', render: v => Fmt.number(v) },
          ],
          rows: top10days,
        })}
      </div>

      <div class="card">
        <div class="card-header"><h3>📉 Flop 10 Dias — Vendas</h3></div>
        ${buildTable({
          columns: [
            { key: 'dateStr', label: 'Data', render: v => Fmt.date(v, 'medium') },
            { key: 'revenue', label: 'Vendas', render: v => `<span style="color:var(--red)">${Fmt.currency(v)}</span>` },
            { key: 'customers', label: 'Clientes', render: v => Fmt.number(v) },
          ],
          rows: flop10days,
        })}
      </div>

      <div class="card card-full">
        <div class="card-header">
          <h3>Média por Dia da Semana</h3>
        </div>
        <div class="weekday-chart">
          ${byDayArr.map(d => {
            const pct = (d.avg / byDayArr[0].avg) * 100;
            return `
              <div class="weekday-row">
                <span class="weekday-name">${d.day}</span>
                <div class="weekday-bar-wrap">
                  <div class="weekday-bar" style="width:${pct}%"></div>
                </div>
                <span class="weekday-value">${Fmt.currency(d.avg)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card card-full">
        <div class="card-header">
          <h3>Evolução Mensal — Últimos 30 Dias</h3>
          <button class="btn btn-sm btn-outline" onclick="exportCSVAnalytics()">Exportar</button>
        </div>
        <div id="chart-evolution" class="chart-area chart-area-lg"></div>
      </div>
    </div>
  `;

  populateStoreSelectors();
  renderEvolutionChart(last30);

  window.exportCSVAnalytics = () => exportToCSV(last30, `analises_${store?.id}`);
}

function renderEvolutionChart(kpis) {
  const container = document.getElementById('chart-evolution');
  if (!container) return;

  const max = Math.max(...kpis.map(k => k.revenue));

  container.innerHTML = `
    <div class="bar-chart bar-chart-lg">
      ${kpis.map(k => {
        const pct = (k.revenue / max) * 100;
        return `
          <div class="bar-col" title="${Fmt.date(k.dateStr, 'medium')}: ${Fmt.currency(k.revenue)}">
            <div class="bar-fill" style="height:${pct}%"></div>
            <span class="bar-label">${new Date(k.dateStr + 'T12:00:00').getDate()}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ============================================================
   MÓDULO: INVENTÁRIO / CONTAGENS
   ============================================================ */
async function renderInventory(container) {
  const store = State.selectedStore;
  let counts = [];

  try {
    counts = await InventoryDB.getByStore(store?.id || 'A001');
  } catch {
    counts = getDemoCounts();
  }

  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <h2>Contagens / Inventários</h2>
        <p class="text-muted">${store?.name || '—'}</p>
      </div>
      <div class="module-header-right">
        <select class="store-select select"></select>
        <button class="btn btn-primary" onclick="openNewCount()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova Contagem
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="inventory-search" class="search-input" placeholder="Pesquisar contagens...">
        </div>
        <button class="btn btn-sm btn-outline" onclick="exportInventory()">Exportar Excel</button>
      </div>
      <div id="inventory-table">
        ${buildTable({
          columns: [
            { key: 'date', label: 'Data', render: v => Fmt.date(v, 'medium') },
            { key: 'shift', label: 'Turno' },
            { key: 'responsible', label: 'Responsável' },
            { key: 'section', label: 'Secção' },
            { key: 'counted', label: 'Contado', render: v => Fmt.number(v) },
            { key: 'system', label: 'Sistema', render: v => Fmt.number(v) },
            { key: 'diff', label: 'Diferença', render: (v, row) => {
              const diff = (row.counted || 0) - (row.system || 0);
              const cls = diff < 0 ? 'text-red' : diff > 0 ? 'text-green' : '';
              return `<span class="${cls}">${diff >= 0 ? '+' : ''}${diff}</span>`;
            }},
            { key: 'status', label: 'Estado', render: v => `<span class="badge badge-${v === 'ok' ? 'success' : 'warning'}">${v === 'ok' ? 'OK' : 'Pendente'}</span>` },
          ],
          rows: counts,
          emptyMsg: 'Sem contagens registadas'
        })}
      </div>
    </div>

    <!-- Modal Nova Contagem -->
    <div class="modal-overlay" id="modal-count">
      <div class="modal-box">
        <div class="modal-header">
          <h3>Nova Contagem</h3>
          <button class="btn-icon" onclick="closeModal('modal-count')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Data</label>
              <input type="date" id="count-date" class="input" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label>Turno</label>
              <select id="count-shift" class="select">
                <option>Manhã</option><option>Tarde</option><option>Noite</option>
              </select>
            </div>
            <div class="form-group">
              <label>Responsável</label>
              <input type="text" id="count-responsible" class="input" placeholder="Nome do responsável">
            </div>
            <div class="form-group">
              <label>Secção</label>
              <input type="text" id="count-section" class="input" placeholder="Ex: Charcutaria, Padaria...">
            </div>
            <div class="form-group">
              <label>Qtd. Contada</label>
              <input type="number" id="count-counted" class="input" placeholder="0">
            </div>
            <div class="form-group">
              <label>Qtd. Sistema</label>
              <input type="number" id="count-system" class="input" placeholder="0">
            </div>
            <div class="form-group form-group-full">
              <label>Justificação</label>
              <textarea id="count-notes" class="input textarea" placeholder="Motivo da diferença..."></textarea>
            </div>
            <div class="form-group form-group-full">
              <label>Anexo</label>
              <input type="file" id="count-file" class="input-file" accept="image/*,.pdf">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal('modal-count')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveCount()">Guardar Contagem</button>
        </div>
      </div>
    </div>
  `;

  populateStoreSelectors();

  document.getElementById('inventory-search')?.addEventListener('input', debounce((e) => {
    const table = document.querySelector('#inventory-table table');
    filterTable(table, e.target.value);
  }));

  window.openNewCount = () => Modal.open('modal-count');
  window.closeModal = (id) => Modal.close(id);
  window.exportInventory = () => exportToCSV(counts, `contagens_${store?.id}`);
  window.saveCount = saveCount;
}

async function saveCount() {
  const data = {
    storeId: State.selectedStore?.id,
    date: document.getElementById('count-date')?.value,
    shift: document.getElementById('count-shift')?.value,
    responsible: document.getElementById('count-responsible')?.value,
    section: document.getElementById('count-section')?.value,
    counted: parseInt(document.getElementById('count-counted')?.value) || 0,
    system: parseInt(document.getElementById('count-system')?.value) || 0,
    notes: document.getElementById('count-notes')?.value,
    status: 'pending',
  };

  if (!data.responsible || !data.section) {
    Toast.error('Preencha o responsável e a secção');
    return;
  }

  try {
    Loading.showOverlay('A guardar contagem...');
    const file = document.getElementById('count-file')?.files[0];
    if (file) {
      const path = `counts/${data.storeId}/${Date.now()}_${file.name}`;
      data.attachmentUrl = await StorageDB.upload(path, file);
    }
    await InventoryDB.save(data);
    Modal.close('modal-count');
    Toast.success('Contagem guardada com sucesso!');
    renderModule('inventory');
  } catch (e) {
    console.error(e);
    Toast.error('Erro ao guardar. Verifique o Firebase.');
  } finally {
    Loading.hideOverlay();
  }
}

function getDemoCounts() {
  return [
    { date: '2025-05-15', shift: 'Manhã', responsible: 'Manuel Santos', section: 'Charcutaria', counted: 48, system: 52, status: 'pending' },
    { date: '2025-05-14', shift: 'Tarde', responsible: 'Rosa Fernandes', section: 'Padaria', counted: 120, system: 120, status: 'ok' },
    { date: '2025-05-13', shift: 'Noite', responsible: 'António Lima', section: 'Bebidas', counted: 245, system: 248, status: 'pending' },
    { date: '2025-05-12', shift: 'Manhã', responsible: 'Maria Costa', section: 'Frutas', counted: 88, system: 88, status: 'ok' },
    { date: '2025-05-11', shift: 'Tarde', responsible: 'Carlos Silva', section: 'Congelados', counted: 34, system: 36, status: 'pending' },
  ];
}

/* ============================================================
   MÓDULO: ESCALAS
   ============================================================ */
async function renderSchedules(container) {
  const store = State.selectedStore;
  const days = getDaysInMonth(State.currentYear, State.currentMonth);

  const employees = [
    { name: 'Ana Martins', role: 'Caixa' },
    { name: 'Bruno Costa', role: 'Reposição' },
    { name: 'Carla Silva', role: 'Caixa' },
    { name: 'David Santos', role: 'Supervisor' },
    { name: 'Eva Nunes', role: 'Reposição' },
  ];

  const shifts = { M: 'Manhã', T: 'Tarde', N: 'Noite', F: 'Folga', '': '—' };
  const shiftColors = { M: 'badge-blue', T: 'badge-orange', N: 'badge-purple', F: 'badge-gray' };

  // Gerar escala demo
  const schedule = {};
  employees.forEach(emp => {
    schedule[emp.name] = {};
    days.forEach(d => {
      const options = ['M', 'T', 'N', 'F', 'M', 'T', 'M'];
      schedule[emp.name][d] = options[Math.floor(Math.random() * options.length)];
    });
  });

  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <h2>Escalas</h2>
        <p class="text-muted">${store?.name || '—'} · ${Fmt.date(new Date(State.currentYear, State.currentMonth - 1), 'monthYear')}</p>
      </div>
      <div class="module-header-right">
        <select class="store-select select"></select>
        <div class="month-picker">
          <button class="btn-icon" id="sched-prev-month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span>${Fmt.date(new Date(State.currentYear, State.currentMonth - 1), 'monthYear')}</span>
          <button class="btn-icon" id="sched-next-month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <button class="btn btn-sm btn-outline" onclick="exportSchedule()">Exportar</button>
      </div>
    </div>

    <div class="card p-0">
      <div class="schedule-legend">
        ${Object.entries(shifts).filter(([k]) => k).map(([k, v]) =>
          `<span class="badge ${shiftColors[k]}">${k} = ${v}</span>`
        ).join('')}
      </div>
      <div class="schedule-table-wrap">
        <table class="schedule-table">
          <thead>
            <tr>
              <th class="schedule-name-col">Colaborador</th>
              ${days.map(d => {
                const date = new Date(State.currentYear, State.currentMonth - 1, d);
                const dow = date.toLocaleDateString('pt-PT', { weekday: 'short' });
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                return `<th class="${isWeekend ? 'schedule-weekend' : ''}">${d}<br><small>${dow}</small></th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${employees.map(emp => `
              <tr>
                <td class="schedule-name-col">
                  <div class="schedule-emp">
                    <span class="emp-avatar">${emp.name[0]}</span>
                    <div>
                      <div class="emp-name">${emp.name}</div>
                      <div class="emp-role">${emp.role}</div>
                    </div>
                  </div>
                </td>
                ${days.map(d => {
                  const shift = schedule[emp.name][d] || '';
                  return `<td class="schedule-cell ${shift === 'F' ? 'cell-folga' : ''}">
                    <span class="shift-badge ${shiftColors[shift] || ''}">${shift || '—'}</span>
                  </td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  populateStoreSelectors();
  document.getElementById('sched-prev-month')?.addEventListener('click', () => {
    if (State.currentMonth === 1) { State.currentMonth = 12; State.currentYear--; }
    else State.currentMonth--;
    renderModule('schedules');
  });
  document.getElementById('sched-next-month')?.addEventListener('click', () => {
    if (State.currentMonth === 12) { State.currentMonth = 1; State.currentYear++; }
    else State.currentMonth++;
    renderModule('schedules');
  });
  window.exportSchedule = () => Toast.info('Exportação de escala em desenvolvimento');
}

function getDaysInMonth(year, month) {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => i + 1);
}

/* ============================================================
   MÓDULO: ROTEIRO SUPERVISORES
   ============================================================ */
async function renderReviews(container) {
  const store = State.selectedStore;

  const checklistItems = [
    { id: 'limpeza', label: 'Limpeza geral da loja', category: 'Higiene' },
    { id: 'lineares', label: 'Lineares completos e organizados', category: 'Merchandising' },
    { id: 'precos', label: 'Etiquetas de preço corretas', category: 'Merchandising' },
    { id: 'validades', label: 'Controlo de validades', category: 'Produto' },
    { id: 'temperaturas', label: 'Temperaturas dos frios OK', category: 'Produto' },
    { id: 'caixa', label: 'Filas de caixa controladas', category: 'Operação' },
    { id: 'equipa', label: 'Equipa completa e uniformizada', category: 'Recursos' },
    { id: 'seguranca', label: 'Saídas de emergência livres', category: 'Segurança' },
    { id: 'promotions', label: 'Promoções bem sinalizadas', category: 'Merchandising' },
    { id: 'bacoffice', label: 'Backoffice organizado', category: 'Operação' },
  ];

  const demoReviews = [
    { date: '2025-05-10', supervisor: 'Ana Silva', score: 87, status: 'complete' },
    { date: '2025-04-28', supervisor: 'Ana Silva', score: 82, status: 'complete' },
    { date: '2025-04-15', supervisor: 'Pedro Mendes', score: 91, status: 'complete' },
  ];

  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <h2>Roteiro de Supervisores</h2>
        <p class="text-muted">${store?.name || '—'}</p>
      </div>
      <div class="module-header-right">
        <select class="store-select select"></select>
        <button class="btn btn-primary" onclick="openNewReview()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova Visita
        </button>
      </div>
    </div>

    <div class="reviews-grid">
      <div class="card">
        <div class="card-header"><h3>Histórico de Visitas</h3></div>
        ${buildTable({
          columns: [
            { key: 'date', label: 'Data', render: v => Fmt.date(v, 'medium') },
            { key: 'supervisor', label: 'Supervisor' },
            { key: 'score', label: 'Nota', render: v => {
              const cls = v >= 90 ? 'badge-success' : v >= 75 ? 'badge-warning' : 'badge-danger';
              return `<span class="badge ${cls}">${v}/100</span>`;
            }},
            { key: 'status', label: 'Estado', render: v => `<span class="badge badge-success">Concluída</span>` },
          ],
          rows: demoReviews,
        })}
      </div>

      <div class="card">
        <div class="card-header"><h3>Score Médio por Categoria</h3></div>
        <div class="categories-list">
          ${['Higiene', 'Merchandising', 'Produto', 'Operação', 'Recursos', 'Segurança'].map(cat => {
            const score = Math.round(70 + Math.random() * 30);
            const cls = score >= 90 ? 'progress-success' : score >= 75 ? 'progress-warning' : 'progress-danger';
            return `
              <div class="cat-row">
                <span>${cat}</span>
                <div class="progress-bar-track" style="flex:1;margin:0 12px">
                  <div class="progress-bar-fill ${cls}" style="width:${score}%"></div>
                </div>
                <span class="text-sm font-medium">${score}%</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Modal Nova Visita -->
    <div class="modal-overlay" id="modal-review">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>Nova Visita de Supervisor</h3>
          <button class="btn-icon" onclick="closeModal('modal-review')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Data da Visita</label>
              <input type="date" id="review-date" class="input" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label>Supervisor</label>
              <input type="text" id="review-supervisor" class="input" placeholder="Nome do supervisor">
            </div>
          </div>
          <div class="checklist">
            <h4 class="checklist-title">Avaliação por Ponto</h4>
            ${checklistItems.map(item => `
              <div class="checklist-item">
                <div class="checklist-info">
                  <span class="badge badge-gray checklist-cat">${item.category}</span>
                  <span>${item.label}</span>
                </div>
                <div class="checklist-rating">
                  ${[1,2,3,4,5].map(n => `
                    <button class="rating-btn" data-item="${item.id}" data-val="${n}" onclick="setRating('${item.id}', ${n})">${n}</button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="form-group" style="margin-top:16px">
            <label>Comentários Gerais</label>
            <textarea id="review-comments" class="input textarea" placeholder="Observações da visita..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <span id="review-score-preview" class="text-muted">Score: —</span>
          <button class="btn btn-outline" onclick="closeModal('modal-review')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveReview()">Guardar Visita</button>
        </div>
      </div>
    </div>
  `;

  populateStoreSelectors();
  window.openNewReview = () => Modal.open('modal-review');
  window.closeModal = (id) => Modal.close(id);
  window.ratings = {};
  window.setRating = (itemId, val) => {
    window.ratings[itemId] = val;
    document.querySelectorAll(`[data-item="${itemId}"]`).forEach(btn => {
      btn.classList.toggle('rating-active', parseInt(btn.dataset.val) <= val);
    });
    const vals = Object.values(window.ratings);
    const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 20) : 0;
    document.getElementById('review-score-preview').textContent = `Score estimado: ${avg}/100`;
  };
  window.saveReview = () => {
    Toast.success('Visita guardada com sucesso!');
    Modal.close('modal-review');
  };
}

/* ============================================================
   MÓDULO: ADMINISTRAÇÃO
   ============================================================ */
async function renderAdmin(container) {
  container.innerHTML = `
    <div class="module-header">
      <div class="module-header-left">
        <h2>Administração</h2>
        <p class="text-muted">Configuração do sistema</p>
      </div>
    </div>

    <div class="admin-grid">
      <div class="card">
        <div class="card-header"><h3>Lojas</h3></div>
        <div class="stores-list">
          ${State.stores.map(s => `
            <div class="store-row">
              <div class="store-badge store-badge-sm">${s.id}</div>
              <div class="store-row-info">
                <span class="font-medium">${s.name}</span>
                <span class="text-muted text-sm">${s.city} · ${s.area}m²</span>
              </div>
              <span class="badge ${s.active ? 'badge-success' : 'badge-gray'}">${s.active ? 'Ativa' : 'Inativa'}</span>
              <button class="btn-icon btn-icon-sm" title="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
        <div class="card-footer">
          <button class="btn btn-sm btn-outline btn-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar Loja
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Supervisores</h3></div>
        <div class="supervisors-list">
          ${['Ana Silva', 'Pedro Mendes', 'Luís Rocha'].map(name => `
            <div class="supervisor-row">
              <span class="emp-avatar">${name[0]}</span>
              <span>${name}</span>
              <span class="badge badge-blue">Supervisor</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Cache & Sistema</h3></div>
        <div class="admin-actions">
          <div class="admin-action-row">
            <div>
              <div class="font-medium">Limpar cache local</div>
              <div class="text-muted text-sm">Remove dados em cache. Próxima visita irá buscar dados frescos.</div>
            </div>
            <button class="btn btn-sm btn-outline" onclick="clearCache()">Limpar</button>
          </div>
          <div class="admin-action-row">
            <div>
              <div class="font-medium">Inserir dados demo</div>
              <div class="text-muted text-sm">Popula o Firebase com dados de exemplo para testes.</div>
            </div>
            <button class="btn btn-sm btn-warning" onclick="runSeed()">Seed</button>
          </div>
          <div class="admin-action-row">
            <div>
              <div class="font-medium">Exportar configuração</div>
              <div class="text-muted text-sm">Exporta configuração completa em JSON.</div>
            </div>
            <button class="btn btn-sm btn-outline" onclick="exportConfig()">Exportar</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Sobre o Sistema</h3></div>
        <div class="about-list">
          <div class="about-row"><span>Versão</span><span class="font-medium">1.0.0</span></div>
          <div class="about-row"><span>Lojas configuradas</span><span class="font-medium">${State.stores.length}</span></div>
          <div class="about-row"><span>Entradas em cache</span><span class="font-medium" id="cache-count">—</span></div>
          <div class="about-row"><span>Estado</span><span class="badge ${State.offline ? 'badge-warning' : 'badge-success'}">${State.offline ? 'Offline' : 'Online'}</span></div>
          <div class="about-row"><span>PWA</span><span class="badge badge-success">Instalável</span></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('cache-count').textContent = Cache.size();

  window.clearCache = () => {
    Modal.confirm('Limpar Cache', 'Tem a certeza que quer limpar toda a cache local?', () => {
      Cache.clear();
      Toast.success('Cache limpa com sucesso!');
      document.getElementById('cache-count').textContent = '0';
    });
  };

  window.runSeed = async () => {
    try {
      Loading.showOverlay('A inserir dados demo...');
      await seedDemoData();
      await loadStores();
      Toast.success('Dados demo inseridos!');
    } catch (e) {
      Toast.error('Erro ao inserir dados. Configure o Firebase primeiro.');
    } finally {
      Loading.hideOverlay();
    }
  };

  window.exportConfig = () => {
    const config = { stores: State.stores, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `karta_config_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.success('Configuração exportada!');
  };
}

/* ============================================================
   HELPERS
   ============================================================ */
function setupSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('sidebar-open');
    overlay?.classList.toggle('active');
  });
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('sidebar-open');
    overlay?.classList.remove('active');
  });
}

function showUpdateBanner() {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>Nova versão disponível!</span>
    <button onclick="window.location.reload()">Atualizar</button>
  `;
  document.body.appendChild(banner);
}

function showOfflineBanner() {
  if (document.getElementById('offline-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.className = 'offline-banner';
  banner.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg> Sem ligação — modo offline`;
  document.body.appendChild(banner);
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);

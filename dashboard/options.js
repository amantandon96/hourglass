// dashboard/options.js
import { storage } from '../shared/storage/index.js';
import {
  getCategoryForDomain,
  computeCategorySeconds,
  formatDuration,
  localDateStr,
  daysAgo,
} from '../shared/tracker.js';
import {
  categoryStyle,
  categoryColors,
  nextFreeSlot,
  isDarkMode,
} from '../shared/palette.js';
import { icon, escapeHtml } from '../shared/icons.js';
import { DEFAULT_SETTINGS } from '../shared/constants.js';

let settings = null;
let weeklyUsage = null; // { 'YYYY-MM-DD': { domain: seconds } }
let weeklyChart = null;

const SECTIONS = ['overview', 'history', 'sites', 'categories', 'settings'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });

function dayLabel(dateStr) {
  if (dateStr === localDateStr()) return 'Today';
  if (dateStr === daysAgo(1)) return 'Yesterday';
  return dayLong.format(parseLocalDate(dateStr));
}

function sumValues(obj) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

function categoryChip(cat) {
  const categories = settings.categories;
  return `<span class="cat-chip has-cat" style="${categoryStyle(cat, categories)}"><span class="cat-dot"></span>${escapeHtml(cat.name)}</span>`;
}

function assignSelect(domain) {
  const categories = settings.categories ?? [];
  if (!categories.length) return '<span class="no-cat">None</span>';
  return `
    <select class="select select-sm assign-select" data-domain="${escapeHtml(domain)}" aria-label="Assign ${escapeHtml(domain)} to a category">
      <option value="">Assign category</option>
      ${categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
    </select>`;
}

async function assignDomain(domain, catId) {
  const cat = settings.categories.find((c) => c.id === catId);
  if (!cat) return;
  for (const c of settings.categories) c.domains = c.domains.filter((d) => d !== domain);
  cat.domains.push(domain);
  await storage.saveSettings(settings);
  showToast(`${domain} added to ${cat.name}`);
  await renderAll();
}

// One delegated listener covers every assign dropdown on the page.
document.getElementById('main').addEventListener('change', (e) => {
  const sel = e.target.closest('.assign-select');
  if (sel && sel.value) assignDomain(sel.dataset.domain, sel.value);
});

// ---------------------------------------------------------------------------
// Navigation (hash-based, so reloads and popup links land on a section)
// ---------------------------------------------------------------------------
function showSection(name) {
  if (!SECTIONS.includes(name)) name = 'overview';
  for (const s of SECTIONS) {
    document.getElementById(`section-${s}`).hidden = s !== name;
  }
  document.querySelectorAll('.nav-item').forEach((item) => {
    if (item.dataset.section === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (name === 'overview' && weeklyChart) weeklyChart.resize();
}

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    history.replaceState(null, '', `#${item.dataset.section}`);
    showSection(item.dataset.section);
  });
});
window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadData() {
  settings = (await storage.getSettings()) ?? structuredClone(DEFAULT_SETTINGS);
  settings.categories ??= [];
  weeklyUsage = await storage.getUsageRange(daysAgo(6), localDateStr());
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderChart() {
  const categories = settings.categories;
  const dates = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
  const mode = isDarkMode() ? 'dark' : 'light';

  const minutesFor = (fn) => dates.map((d) => Math.round(fn(weeklyUsage[d] ?? {}) / 60));

  const datasets = categories.map((cat) => ({
    label: cat.name,
    data: minutesFor((u) => computeCategorySeconds(u, cat)),
    backgroundColor: categoryColors(cat, categories)[mode],
  }));

  const uncategorized = minutesFor((u) =>
    Object.entries(u)
      .filter(([d]) => !getCategoryForDomain(d, categories))
      .reduce((s, [, v]) => s + v, 0));
  if (uncategorized.some((v) => v > 0) || !datasets.length) {
    datasets.push({
      label: 'Uncategorized',
      data: uncategorized,
      backgroundColor: mode === 'dark' ? '#4a4e55' : '#c9ccd1',
    });
  }

  const surface = cssVar('--canvas');
  const ink2 = cssVar('--ink-2');
  const ink3 = cssVar('--ink-3');
  const grid = cssVar('--line-soft');

  for (const ds of datasets) {
    Object.assign(ds, {
      stack: 'day',
      // 2px surface-colored gap between stacked segments
      borderColor: surface,
      borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
      borderSkipped: 'start',
      // round only the topmost visible segment of each bar
      borderRadius: (ctx) => {
        const later = ctx.chart.data.datasets.slice(ctx.datasetIndex + 1);
        const isTop = later.every((d, j) =>
          !d.data[ctx.dataIndex] || !ctx.chart.isDatasetVisible(ctx.datasetIndex + 1 + j));
        return isTop ? { topLeft: 4, topRight: 4 } : 0;
      },
      maxBarThickness: 44,
    });
  }

  const fmtMin = (m) => formatDuration(m * 60);
  // Tick spacing in whole, readable units (15m, 30m, 1h, 2h...) for about 4 gridlines.
  const niceStep = (sets) => {
    const max = Math.max(1, ...dates.map((_, i) => sets.reduce((s, d) => s + d.data[i], 0)));
    return [5, 10, 15, 30, 60, 120, 180, 240, 360].find((s) => max / s <= 5) ?? 480;
  };

  Chart.defaults.font.family = cssVar('--font');
  Chart.defaults.font.size = 12;

  if (weeklyChart) weeklyChart.destroy();
  weeklyChart = new Chart(document.getElementById('weekly-chart'), {
    type: 'bar',
    data: { labels: dates.map((d) => (d === localDateStr() ? 'Today' : dayShort.format(parseLocalDate(d)))), datasets },
    options: {
      maintainAspectRatio: false,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { color: ink2, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 },
        },
        tooltip: {
          backgroundColor: cssVar('--ink'),
          titleColor: surface,
          bodyColor: surface,
          footerColor: surface,
          padding: 10,
          cornerRadius: 6,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          filter: (item) => item.raw > 0,
          callbacks: {
            label: (item) => ` ${item.dataset.label}: ${fmtMin(item.raw)}`,
            footer: (items) => `Total: ${fmtMin(items.reduce((s, i) => s + i.raw, 0))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: ink3 },
          grid: { display: false },
          border: { color: cssVar('--line') },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: ink3, stepSize: niceStep(datasets), callback: (v) => (v === 0 ? '0' : fmtMin(v)) },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
}

function renderOverview() {
  const today = localDateStr();
  const todayUsage = weeklyUsage[today] ?? {};
  const categories = settings.categories;

  document.getElementById('overview-date').textContent = dayLong.format(new Date());

  const todaySec = sumValues(todayUsage);
  const weekSec = Object.values(weeklyUsage).reduce((s, u) => s + sumValues(u), 0);
  const activeDays = Object.values(weeklyUsage).filter((u) => sumValues(u) > 0).length;
  const avgSec = activeDays ? weekSec / activeDays : 0;

  document.getElementById('overview-summary').innerHTML = `
    <div><dt>Today</dt><dd>${formatDuration(todaySec)}</dd></div>
    <div><dt>Last 7 days</dt><dd>${formatDuration(weekSec)}</dd></div>
    <div><dt>Daily average</dt><dd>${formatDuration(avgSec)}</dd></div>`;

  renderChart();

  const rows = Object.entries(todayUsage).sort(([, a], [, b]) => b - a);
  document.getElementById('overview-site-tbody').innerHTML = rows.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    return `<tr>
      <td class="t-domain">${escapeHtml(domain)}</td>
      <td>${cat ? categoryChip(cat) : assignSelect(domain)}</td>
      <td class="t-num">${formatDuration(sec)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="t-empty">Nothing tracked yet today. Browse as usual and sites will appear here.</td></tr>';
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function renderHistory() {
  const container = document.getElementById('history-list');
  const categories = settings.categories;
  const days = Object.keys(weeklyUsage).filter((d) => sumValues(weeklyUsage[d]) > 0).sort().reverse();

  if (!days.length) {
    container.innerHTML = '<p class="list-empty">No history yet. Each day you browse gets its own breakdown here.</p>';
    return;
  }

  container.innerHTML = days.map((dateStr) => {
    const usage = weeklyUsage[dateStr];
    const groups = new Map();
    for (const [domain, sec] of Object.entries(usage)) {
      const cat = getCategoryForDomain(domain, categories);
      const key = cat ? cat.id : '';
      if (!groups.has(key)) groups.set(key, { cat, entries: [] });
      groups.get(key).entries.push([domain, sec]);
    }

    // Categories in their configured order, uncategorized last
    const ordered = [...groups.values()].sort((a, b) => {
      if (!a.cat) return 1;
      if (!b.cat) return -1;
      return categories.indexOf(a.cat) - categories.indexOf(b.cat);
    });

    const body = ordered.map(({ cat, entries }) => {
      const groupSec = entries.reduce((s, [, v]) => s + v, 0);
      const label = cat
        ? `<span class="group-label has-cat" style="${categoryStyle(cat, categories)}"><span class="cat-dot"></span>${escapeHtml(cat.name)}</span>`
        : '<span class="group-label">Uncategorized</span>';
      return `
        <tr class="group-row"><td>${label}</td><td class="t-num">${formatDuration(groupSec)}</td></tr>
        ${entries.sort(([, a], [, b]) => b - a).map(([d, s]) => `
          <tr>
            <td><div class="site-cell"><span>${escapeHtml(d)}</span>${cat ? '' : assignSelect(d)}</div></td>
            <td class="t-num">${formatDuration(s)}</td>
          </tr>`).join('')}`;
    }).join('');

    return `
      <section class="day" aria-label="${escapeHtml(dayLabel(dateStr))}">
        <div class="panel-head">
          <h2>${escapeHtml(dayLabel(dateStr))}</h2>
          <span class="panel-meta num">${formatDuration(sumValues(usage))} total</span>
        </div>
        <table class="data"><tbody>${body}</tbody></table>
      </section>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------
function renderSites() {
  const categories = settings.categories;
  const totals = {};
  for (const usage of Object.values(weeklyUsage)) {
    for (const [domain, sec] of Object.entries(usage)) totals[domain] = (totals[domain] ?? 0) + sec;
  }

  const rows = Object.entries(totals).sort(([, a], [, b]) => b - a);
  document.getElementById('sites-tbody').innerHTML = rows.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    return `<tr>
      <td class="t-domain">${escapeHtml(domain)}</td>
      <td>${cat ? categoryChip(cat) : assignSelect(domain)}</td>
      <td class="t-num">${formatDuration(sec)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="t-empty">No sites tracked in the last 7 days.</td></tr>';
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const openCategories = new Set();

function budgetText(min) {
  return `${formatDuration(min * 60)} a day`;
}

function renderCategories() {
  const list = document.getElementById('categories-table-container');
  const categories = settings.categories;

  if (!categories.length) {
    list.innerHTML = '<li class="list-empty">No categories yet. Add one above, then assign sites to it from here or from the Sites page.</li>';
    return;
  }

  list.innerHTML = categories.map((cat) => {
    const id = escapeHtml(cat.id);
    const open = openCategories.has(cat.id);
    const n = cat.domains.length;
    return `
      <li class="cat-item" data-cat="${id}">
        <div class="cat-row">
          <div class="cat-title has-cat" style="${categoryStyle(cat, categories)}">
            <span class="cat-dot"></span><strong>${escapeHtml(cat.name)}</strong>
          </div>
          <span class="cat-meta num" data-role="budget-view">${budgetText(cat.budgetMinutes)}</span>
          <form class="budget-edit" data-role="budget-edit" hidden>
            <label class="visually-hidden" for="budget-${id}">Minutes per day for ${escapeHtml(cat.name)}</label>
            <input class="input num" type="number" id="budget-${id}" value="${cat.budgetMinutes}" min="1" max="1440">
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-budget">Cancel</button>
          </form>
          <div class="cat-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="edit-budget">Edit budget</button>
            <button type="button" class="btn btn-ghost btn-sm disclosure" data-action="toggle"
                    aria-expanded="${open}" aria-controls="cat-body-${id}">
              ${n} ${n === 1 ? 'site' : 'sites'}${icon('chevron')}
            </button>
            <button type="button" class="btn btn-ghost btn-danger btn-sm btn-icon" data-action="delete"
                    aria-label="Delete ${escapeHtml(cat.name)}" title="Delete category">${icon('x')}</button>
          </div>
        </div>
        <div class="cat-body" id="cat-body-${id}" ${open ? '' : 'hidden'}>
          ${n ? `<ul class="domain-list">${cat.domains.map((d) => `
            <li class="domain-row">
              <span>${escapeHtml(d)}</span>
              <button type="button" class="btn btn-ghost btn-danger btn-sm btn-icon" data-action="remove-domain"
                      data-domain="${escapeHtml(d)}" aria-label="Remove ${escapeHtml(d)}" title="Remove site">${icon('x')}</button>
            </li>`).join('')}</ul>`
            : '<p class="domain-empty">No sites in this category yet.</p>'}
          <form class="add-domain" data-role="add-domain">
            <label class="visually-hidden" for="add-domain-${id}">Add a site to ${escapeHtml(cat.name)}</label>
            <input class="input" type="text" id="add-domain-${id}" placeholder="example.com" autocomplete="off">
            <button type="submit" class="btn btn-sm">Add site</button>
          </form>
          <div class="conflict" data-role="conflict" hidden></div>
        </div>
      </li>`;
  }).join('');
}

function setBudgetEditing(item, editing) {
  item.querySelector('[data-role="budget-view"]').hidden = editing;
  item.querySelector('[data-action="edit-budget"]').hidden = editing;
  item.querySelector('[data-role="budget-edit"]').hidden = !editing;
  if (editing) item.querySelector('[data-role="budget-edit"] input').select();
}

const catList = document.getElementById('categories-table-container');

catList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const item = btn.closest('.cat-item');
  const cat = settings.categories.find((c) => c.id === item.dataset.cat);
  if (!cat) return;

  switch (btn.dataset.action) {
    case 'toggle': {
      const body = item.querySelector('.cat-body');
      body.hidden = !body.hidden;
      btn.setAttribute('aria-expanded', String(!body.hidden));
      if (body.hidden) openCategories.delete(cat.id);
      else openCategories.add(cat.id);
      break;
    }
    case 'edit-budget':
      setBudgetEditing(item, true);
      break;
    case 'cancel-budget':
      setBudgetEditing(item, false);
      break;
    case 'delete': {
      const msg = cat.domains.length
        ? `Delete ${cat.name}? Its ${cat.domains.length} ${cat.domains.length === 1 ? 'site becomes' : 'sites become'} uncategorized. Tracked time is kept.`
        : `Delete ${cat.name}?`;
      if (!confirm(msg)) return;
      settings.categories = settings.categories.filter((c) => c !== cat);
      openCategories.delete(cat.id);
      await storage.saveSettings(settings);
      showToast(`Deleted ${cat.name}`);
      await renderAll();
      break;
    }
    case 'remove-domain':
      cat.domains = cat.domains.filter((d) => d !== btn.dataset.domain);
      await storage.saveSettings(settings);
      showToast(`Removed ${btn.dataset.domain} from ${cat.name}`);
      await renderAll();
      break;
  }
});

catList.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest('[data-role="budget-edit"]')) {
    setBudgetEditing(e.target.closest('.cat-item'), false);
  }
});

catList.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const item = form.closest('.cat-item');
  const cat = settings.categories.find((c) => c.id === item.dataset.cat);
  if (!cat) return;

  if (form.dataset.role === 'budget-edit') {
    const input = form.querySelector('input');
    const minutes = parseInt(input.value, 10);
    if (!minutes || minutes < 1 || minutes > 1440) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    if (minutes > cat.budgetMinutes &&
        !confirm(`Raise ${cat.name} from ${budgetText(cat.budgetMinutes)} to ${budgetText(minutes)}?`)) return;
    cat.budgetMinutes = minutes;
    await storage.saveSettings(settings);
    showToast(`${cat.name}: ${budgetText(minutes)}`);
    await renderAll();
  }

  if (form.dataset.role === 'add-domain') await addDomainToCategory(cat, item);
});

async function addDomainToCategory(cat, item) {
  const input = item.querySelector('[data-role="add-domain"] input');
  const conflict = item.querySelector('[data-role="conflict"]');
  const domain = input.value.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  conflict.hidden = true;
  if (!domain) return;

  const other = settings.categories.find((c) => c !== cat && c.domains.includes(domain));
  if (other) {
    conflict.innerHTML = `
      <span>${escapeHtml(domain)} is already in ${escapeHtml(other.name)}.</span>
      <button type="button" class="btn btn-sm">Move to ${escapeHtml(cat.name)}</button>`;
    conflict.hidden = false;
    conflict.querySelector('button').addEventListener('click', async () => {
      other.domains = other.domains.filter((d) => d !== domain);
      cat.domains.push(domain);
      await storage.saveSettings(settings);
      showToast(`Moved ${domain} to ${cat.name}`);
      await renderAll();
    });
    return;
  }

  if (!cat.domains.includes(domain)) {
    cat.domains.push(domain);
    await storage.saveSettings(settings);
    showToast(`Added ${domain} to ${cat.name}`);
  }
  await renderAll();
  document.getElementById(`add-domain-${cat.id}`)?.focus();
}

document.getElementById('add-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('add-cat-name');
  const budgetInput = document.getElementById('add-cat-budget');
  const error = document.getElementById('add-cat-error');
  const name = nameInput.value.trim();
  const budget = parseInt(budgetInput.value, 10);

  nameInput.removeAttribute('aria-invalid');
  budgetInput.removeAttribute('aria-invalid');
  error.textContent = '';

  if (!name) {
    nameInput.setAttribute('aria-invalid', 'true');
    error.textContent = 'Give the category a name.';
    nameInput.focus();
    return;
  }
  if (!budget || budget < 1 || budget > 1440) {
    budgetInput.setAttribute('aria-invalid', 'true');
    error.textContent = 'Enter a daily budget between 1 and 1440 minutes.';
    budgetInput.focus();
    return;
  }
  if (settings.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    nameInput.setAttribute('aria-invalid', 'true');
    error.textContent = `There's already a category called ${name}.`;
    nameInput.focus();
    return;
  }

  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const id = slug && !settings.categories.some((c) => c.id === slug) ? slug : `cat-${Date.now()}`;

  settings.categories.push({
    id,
    name,
    budgetMinutes: budget,
    domains: [],
    colorSlot: nextFreeSlot(settings.categories),
  });
  await storage.saveSettings(settings);
  nameInput.value = '';
  budgetInput.value = '';
  openCategories.add(id);
  showToast(`Added ${name}`);
  await renderAll();
  document.getElementById(`add-domain-${id}`)?.focus();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  document.getElementById('notify-at-input').value = (settings.notifyAt ?? [80, 100]).join(', ');
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('notify-at-input');
  const error = document.getElementById('notify-error');
  const values = input.value.split(',').map((v) => v.trim()).filter(Boolean);
  const notifyAt = [...new Set(values.map((v) => parseInt(v, 10)))].sort((a, b) => a - b);

  if (!values.length || notifyAt.some((v) => isNaN(v) || v < 1 || v > 100)) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = 'Use whole numbers from 1 to 100, separated by commas.';
    return;
  }
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  settings.notifyAt = notifyAt;
  input.value = notifyAt.join(', ');
  await storage.saveSettings(settings);
  showToast('Notification thresholds saved');
});

document.getElementById('reset-today-btn').addEventListener('click', async () => {
  if (!confirm("Delete everything tracked today? Earlier days are kept. This can't be undone.")) return;
  await storage.deleteUsageForDate(localDateStr());
  await loadData();
  await renderAll();
  showToast("Today's data was reset");
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function renderAll() {
  renderOverview();
  renderHistory();
  renderSites();
  renderCategories();
}

async function init() {
  showSection(location.hash.slice(1));
  await Promise.all([loadData(), document.fonts.ready]);
  await renderAll();
  renderSettings();
  // Chart colors come from theme tokens; redraw when the OS theme flips.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChart);
}

init();

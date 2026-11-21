// dashboard/options.js
import { storage } from '../shared/storage/index.js';
import {
  getCategoryForDomain,
  computeCategorySeconds,
  formatDuration,
  localDateStr,
  daysAgo,
  parseLocalDate,
  datesBetween,
} from '../shared/tracker.js';
import {
  categoryStyle,
  categoryColors,
  nextFreeSlot,
  isDarkMode,
} from '../shared/palette.js';
import { icon, escapeHtml } from '../shared/icons.js';
import { DEFAULT_SETTINGS, PRUNE_DAYS } from '../shared/constants.js';
import { wireThemeToggle, THEME_TOGGLE_HTML } from '../shared/theme-toggle.js';

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

const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

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
  await loadRangeUsage();
}

// ---------------------------------------------------------------------------
// Overview time frame
// ---------------------------------------------------------------------------
const RANGE_KEY = 'hourglass-overview-range';
const PRESETS = ['1', '7', '30', '90'];
const SITE_ROWS = 25;

let range = loadRange(); // { preset: '1'|'7'|'30'|'90'|'custom', from, to } as YYYY-MM-DD
let rangeUsage = {};     // { 'YYYY-MM-DD': { domain: seconds } } for the selected range
let showAllSites = false;

function presetRange(preset) {
  return { preset, from: daysAgo(Number(preset) - 1), to: localDateStr() };
}

/** Keep a custom range inside the data we actually retain, and in order. */
function clampRange({ preset, from, to }) {
  const min = daysAgo(PRUNE_DAYS - 1);
  const max = localDateStr();
  const clamp = (d) => (d < min ? min : d > max ? max : d); // YYYY-MM-DD compares as text
  from = clamp(from);
  to = clamp(to);
  if (from > to) [from, to] = [to, from];
  return { preset, from, to };
}

function loadRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_KEY));
    if (saved?.preset === 'custom' && saved.from && saved.to) return clampRange(saved);
    if (PRESETS.includes(saved?.preset)) return presetRange(saved.preset); // recomputed: "last 7 days" moves with today
  } catch { /* fall through to default */ }
  return presetRange('7');
}

function saveRange() {
  try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)); } catch { /* per-viewer convenience only */ }
}

async function loadRangeUsage() {
  rangeUsage = await storage.getUsageRange(range.from, range.to);
}

function rangeText() {
  const { preset, from, to } = range;
  if (from === to) return from === localDateStr() ? `Today, ${dayLong.format(parseLocalDate(from))}` : dayLong.format(parseLocalDate(from));
  const span = monthDay.formatRange(parseLocalDate(from), parseLocalDate(to));
  return preset === 'custom' ? `${span} (${datesBetween(from, to).length} days)` : `Last ${preset} days, ${span}`;
}

const rangePresets = document.getElementById('range-presets');
const rangeCustom = document.getElementById('range-custom');
const rangeFrom = document.getElementById('range-from');
const rangeTo = document.getElementById('range-to');

function syncRangeControls() {
  rangePresets.querySelectorAll('input').forEach((r) => { r.checked = r.value === range.preset; });
  rangeCustom.hidden = range.preset !== 'custom';
  for (const input of [rangeFrom, rangeTo]) {
    input.min = daysAgo(PRUNE_DAYS - 1);
    input.max = localDateStr();
  }
  rangeFrom.value = range.from;
  rangeTo.value = range.to;
}

async function applyRange(next) {
  range = next;
  saveRange();
  showAllSites = false;
  syncRangeControls();
  await loadRangeUsage();
  renderOverview();
}

rangePresets.addEventListener('change', async (e) => {
  const value = e.target.value;
  if (value === 'custom') {
    // Start from whatever is showing now, then let the dates be adjusted.
    await applyRange({ ...range, preset: 'custom' });
    rangeFrom.focus();
  } else {
    await applyRange(presetRange(value));
  }
});

for (const input of [rangeFrom, rangeTo]) {
  input.addEventListener('change', () => {
    if (!rangeFrom.value || !rangeTo.value) return; // mid-edit
    applyRange(clampRange({ preset: 'custom', from: rangeFrom.value, to: rangeTo.value }));
  });
}

document.getElementById('overview-show-all').addEventListener('click', () => {
  showAllSites = true;
  renderOverview();
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Chart columns. Up to a month: one bar per day. Longer: one bar per calendar week
 * (Monday start), since 90 daily bars are too thin to read. Edge weeks may be partial;
 * their tooltip shows the real dates covered.
 */
function chartBuckets(dates) {
  const today = localDateStr();
  if (dates.length <= 31) {
    const fmt = dates.length <= 14 ? dayShort : monthDay;
    return dates.map((d) => ({
      label: d === today ? 'Today' : fmt.format(parseLocalDate(d)),
      title: dayLabel(d),
      dates: [d],
    }));
  }
  const weeks = [];
  for (const d of dates) {
    const dt = parseLocalDate(d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // back to Monday
    const key = localDateStr(dt);
    if (weeks.at(-1)?.key !== key) weeks.push({ key, dates: [] });
    weeks.at(-1).dates.push(d);
  }
  return weeks.map(({ dates: w }) => {
    const first = parseLocalDate(w[0]);
    const last = parseLocalDate(w.at(-1));
    return {
      label: monthDay.format(first),
      title: w.length === 1 ? dayLabel(w[0]) : monthDay.formatRange(first, last),
      dates: w,
    };
  });
}

function renderChart() {
  const panel = document.getElementById('overview-chart-panel');
  const dates = datesBetween(range.from, range.to);
  // One day is one bar: the summary and site table already say everything it would.
  panel.hidden = dates.length < 2;
  if (panel.hidden) {
    weeklyChart?.destroy();
    weeklyChart = null;
    return;
  }

  const categories = settings.categories;
  const buckets = chartBuckets(dates);
  const weekly = buckets.length < dates.length;
  const mode = isDarkMode() ? 'dark' : 'light';
  const partial = weekly && (buckets[0].dates.length < 7 || buckets.at(-1).dates.length < 7);
  document.getElementById('overview-chart-meta').textContent =
    !weekly ? 'Per day' : partial ? 'Per week, first or last week partial' : 'Per week';

  const minutesFor = (fn) => buckets.map((b) =>
    Math.round(b.dates.reduce((s, d) => s + fn(rangeUsage[d] ?? {}), 0) / 60));

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
        return isTop ? { topLeft: buckets.length > 40 ? 2 : 4, topRight: buckets.length > 40 ? 2 : 4 } : 0;
      },
      maxBarThickness: 44,
    });
  }

  const fmtMin = (m) => formatDuration(m * 60);
  // Tick spacing in whole, readable units (15m, 1h, 2h, 10h...) for about 4 gridlines.
  const niceStep = (sets) => {
    const max = Math.max(1, ...buckets.map((_, i) => sets.reduce((s, d) => s + d.data[i], 0)));
    return [5, 10, 15, 30, 60, 120, 180, 240, 360, 600, 900, 1200, 1800, 3000, 6000]
      .find((s) => max / s <= 5) ?? 12000;
  };

  Chart.defaults.font.family = cssVar('--font');
  Chart.defaults.font.size = 12;

  weeklyChart?.destroy();
  weeklyChart = new Chart(document.getElementById('weekly-chart'), {
    type: 'bar',
    data: { labels: buckets.map((b) => b.label), datasets },
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
            title: (items) => (items.length ? buckets[items[0].dataIndex].title : ''),
            label: (item) => ` ${item.dataset.label}: ${fmtMin(item.raw)}`,
            footer: (items) => `Total: ${fmtMin(items.reduce((s, i) => s + i.raw, 0))}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: ink3, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
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
  const categories = settings.categories;
  const dates = datesBetween(range.from, range.to);

  document.getElementById('overview-range-label').textContent = rangeText();

  const siteTotals = {};
  for (const d of dates) {
    for (const [domain, sec] of Object.entries(rangeUsage[d] ?? {})) {
      siteTotals[domain] = (siteTotals[domain] ?? 0) + sec;
    }
  }
  const totalSec = sumValues(siteTotals);
  const activeDays = dates.filter((d) => sumValues(rangeUsage[d] ?? {}) > 0).length;
  const sites = Object.entries(siteTotals).sort(([, a], [, b]) => b - a);

  document.getElementById('overview-summary').innerHTML = `
    <div><dt>${dates.length === 1 ? 'Tracked' : 'Total'}</dt><dd>${formatDuration(totalSec)}</dd></div>
    ${dates.length > 1 ? `<div><dt>Per active day</dt><dd>${formatDuration(activeDays ? totalSec / activeDays : 0)}</dd></div>
    <div><dt>Active days</dt><dd>${activeDays} of ${dates.length}</dd></div>` : ''}
    <div><dt>Sites</dt><dd>${sites.length}</dd></div>`;

  renderChart();

  document.getElementById('overview-sites-meta').textContent = sites.length
    ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}` : '';

  const shown = showAllSites ? sites : sites.slice(0, SITE_ROWS);
  document.getElementById('overview-site-tbody').innerHTML = shown.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    const share = totalSec ? (sec / totalSec) * 100 : 0;
    return `<tr>
      <td class="t-domain">${escapeHtml(domain)}</td>
      <td>${cat ? categoryChip(cat) : assignSelect(domain)}</td>
      <td class="t-num t-share">${share < 1 ? '<1' : Math.round(share)}%</td>
      <td class="t-num">${formatDuration(sec)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" class="t-empty">${
    range.to === localDateStr() && dates.length === 1
      ? 'Nothing tracked yet today. Browse as usual and sites will appear here.'
      : 'Nothing was tracked in this time frame.'}</td></tr>`;

  const more = document.getElementById('overview-show-all');
  more.hidden = showAllSites || sites.length <= SITE_ROWS;
  more.textContent = `Show all ${sites.length} sites`;
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
  syncAppearance();
  document.getElementById('notify-at-input').value = (settings.notifyAt ?? [80, 100]).join(', ');
}

// Appearance: System / Light / Dark
const appearance = document.getElementById('appearance');
function syncAppearance() {
  const pref = window.hourglassTheme.getPreference();
  appearance.querySelectorAll('input').forEach((r) => { r.checked = r.value === pref; });
}
appearance.addEventListener('change', (e) => window.hourglassTheme.set(e.target.value));
document.addEventListener('themechange', syncAppearance);

const themeToggle = document.getElementById('theme-toggle');
themeToggle.innerHTML = THEME_TOGGLE_HTML;
wireThemeToggle(themeToggle);

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
  syncRangeControls();
  await Promise.all([loadData(), document.fonts.ready]);
  await renderAll();
  renderSettings();
  // Chart colors come from theme tokens; redraw whenever the theme changes.
  document.addEventListener('themechange', renderChart);
}

init();

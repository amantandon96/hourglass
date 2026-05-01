// dashboard/options.js
import { storage } from '../shared/storage/index.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
import {
  getCategoryForDomain,
  computeCategorySeconds,
  formatDuration,
  budgetPercent,
  localDateStr,
  daysAgo,
} from '../shared/tracker.js';

let settings = null;
let weeklyUsage = null; // { dateStr: { domain: seconds } }

const CATEGORY_COLORS = [
  '#818cf8', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa', '#facc15',
];

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    item.classList.add('active');
    const sec = document.getElementById(`section-${item.dataset.section}`);
    if (sec) sec.classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadData() {
  settings = await storage.getSettings();
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  weeklyUsage = await storage.getUsageRange(sevenDaysAgo, today);
}

// ---------------------------------------------------------------------------
// Overview section
// ---------------------------------------------------------------------------
async function renderOverview() {
  const today = localDateStr();
  const todayUsage = weeklyUsage[today] ?? {};
  const categories = settings.categories ?? [];

  if (categories.length === 0) {
    document.getElementById('stat-today').textContent = '—';
    document.getElementById('stat-week').textContent = '—';
    document.getElementById('stat-remaining').textContent = '—';
    document.getElementById('stat-today-label').textContent = 'today';
    document.getElementById('stat-week-label').textContent = 'this week';
    document.getElementById('stat-remaining-label').textContent = 'budget left';
  } else {
    const cat0 = categories[0];
    const sec0Today = computeCategorySeconds(todayUsage, cat0);
    const sec0Week = Object.values(weeklyUsage).reduce(
      (sum, u) => sum + computeCategorySeconds(u, cat0), 0
    );
    const remain0 = Math.max(0, cat0.budgetMinutes * 60 - sec0Today);

    document.getElementById('stat-today').textContent = formatDuration(sec0Today);
    document.getElementById('stat-week').textContent = formatDuration(sec0Week);
    document.getElementById('stat-remaining').textContent = formatDuration(remain0);
    document.getElementById('stat-today-label').textContent = `${cat0.name} today`;
    document.getElementById('stat-week-label').textContent = `${cat0.name} this week`;
    document.getElementById('stat-remaining-label').textContent = `${cat0.name} budget left`;
  }

  // Stacked weekly bar chart
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    labels.push(daysAgo(i).slice(5)); // MM-DD
  }

  const datasets = categories.map((cat, idx) => ({
    label: cat.name,
    data: Array.from({ length: 7 }, (_, i) => {
      const d = daysAgo(6 - i);
      const dayUsage = weeklyUsage[d] ?? {};
      return Math.round(computeCategorySeconds(dayUsage, cat) / 60);
    }),
    backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
    borderRadius: idx === categories.length - 1 ? 4 : 0,
    stack: 'stack',
  }));

  const ctx = document.getElementById('weekly-chart').getContext('2d');
  if (window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: datasets.length ? datasets : [{ label: 'No data', data: Array(7).fill(0), backgroundColor: '#1e293b', stack: 'stack' }] },
    options: {
      plugins: { legend: { display: categories.length > 1 } },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: 'minutes' },
        },
      },
    },
  });

  // Today's site table with Category column
  const sorted = Object.entries(todayUsage).sort(([, a], [, b]) => b - a);
  const tbody = document.getElementById('overview-site-tbody');
  tbody.innerHTML = sorted.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    const catIdx = cat ? categories.indexOf(cat) : -1;
    const catLabel = cat
      ? `<span class="leisure-badge" style="background:${CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length]}22;color:${CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length]};border:1px solid ${CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length]}44">${escapeHtml(cat.name)}</span>`
      : '<span style="color:#475569;font-size:11px">—</span>';
    return `<tr><td>${domain}</td><td>${catLabel}</td><td>${formatDuration(sec)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:16px">No data today</td></tr>';
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------
async function renderHistory() {
  const container = document.getElementById('history-list');
  const categories = settings.categories ?? [];

  const days = Object.keys(weeklyUsage).sort().reverse();
  if (days.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af">No history yet.</p>';
    return;
  }

  // Build a <select> snippet for assigning a domain to a category
  const catOptions = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const assignSelect = (domain) => categories.length === 0 ? '' : `
    <select class="history-cat-select" data-domain="${domain}" title="Assign to category">
      <option value="">+ category</option>
      ${catOptions}
    </select>
  `;

  container.innerHTML = days.map((dateStr) => {
    const usage = weeklyUsage[dateStr];

    // Group domains by category
    const grouped = {};
    for (const [domain, sec] of Object.entries(usage)) {
      const cat = getCategoryForDomain(domain, categories);
      const key = cat ? cat.id : '_uncategorized';
      if (!grouped[key]) {
        grouped[key] = { label: cat ? escapeHtml(cat.name) : 'Uncategorized', entries: [], isUncategorized: !cat };
      }
      grouped[key].entries.push([domain, sec]);
    }

    const totalSec = Object.values(usage).reduce((a, b) => a + b, 0);

    const groupHtml = Object.values(grouped).map(({ label, entries, isUncategorized }) => {
      const sortedEntries = entries.sort(([, a], [, b]) => b - a);
      const groupSec = entries.reduce((s, [, v]) => s + v, 0);
      return `
        <tr class="history-cat-header">
          <td style="padding:4px 16px;font-size:11px;color:#94a3b8;font-weight:600">${label}</td>
          <td style="padding:4px 16px;font-size:11px;color:#94a3b8">${formatDuration(groupSec)}</td>
        </tr>
        ${sortedEntries.map(([d, s]) => `
          <tr>
            <td style="padding:3px 24px;color:#6b7280;font-size:12px">
              ${d}
              ${isUncategorized ? assignSelect(d) : ''}
            </td>
            <td style="padding:3px 16px;font-size:12px">${formatDuration(s)}</td>
          </tr>
        `).join('')}
      `;
    }).join('');

    return `
      <div class="site-table" style="margin-bottom:12px">
        <table>
          <thead><tr>
            <th>${dateStr}</th>
            <th style="color:#64748b">${formatDuration(totalSec)} total</th>
          </tr></thead>
          <tbody>${groupHtml || '<tr><td colspan="2" style="color:#9ca3af;padding:10px 16px;font-size:12px">No data</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }).join('');

  // Wire up category assign selects
  container.querySelectorAll('.history-cat-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const catId = sel.value;
      if (!catId) return;
      const domain = sel.dataset.domain;
      const cat = settings.categories.find((c) => c.id === catId);
      if (!cat) return;
      // Remove from any existing category first
      for (const c of settings.categories) {
        c.domains = c.domains.filter((d) => d !== domain);
      }
      cat.domains.push(domain);
      await storage.saveSettings(settings);
      showToast(`${domain} → ${cat.name}`);
      await renderHistory();
    });
  });
}

// ---------------------------------------------------------------------------
// Sites section
// ---------------------------------------------------------------------------
async function renderSites() {
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  const range = await storage.getUsageRange(sevenDaysAgo, today);
  const categories = settings.categories ?? [];

  const weekTotals = {};
  for (const usage of Object.values(range)) {
    for (const [domain, sec] of Object.entries(usage)) {
      weekTotals[domain] = (weekTotals[domain] ?? 0) + sec;
    }
  }

  const sorted = Object.entries(weekTotals).sort(([, a], [, b]) => b - a);
  const catOptions = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const assignSelect = (domain) => categories.length === 0 ? '' : `
    <select class="history-cat-select" data-domain="${domain}" title="Assign to category">
      <option value="">+ category</option>
      ${catOptions}
    </select>
  `;

  const tbody = document.getElementById('sites-tbody');
  tbody.innerHTML = sorted.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    const catLabel = cat
      ? `<span class="leisure-badge">${escapeHtml(cat.name)}</span>`
      : assignSelect(domain) || '<span style="color:#475569;font-size:11px">—</span>';
    return `<tr><td>${domain}</td><td>${catLabel}</td><td>${formatDuration(sec)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:16px;font-size:12px">No sites tracked this week.</td></tr>';

  // Wire up category assign selects
  tbody.querySelectorAll('.history-cat-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const catId = sel.value;
      if (!catId) return;
      const domain = sel.dataset.domain;
      const cat = settings.categories.find((c) => c.id === catId);
      if (!cat) return;
      for (const c of settings.categories) {
        c.domains = c.domains.filter((d) => d !== domain);
      }
      cat.domains.push(domain);
      await storage.saveSettings(settings);
      showToast(`${domain} → ${cat.name}`);
      await renderSites();
    });
  });
}

// ---------------------------------------------------------------------------
// Categories section
// ---------------------------------------------------------------------------
async function renderCategories() {
  const container = document.getElementById('categories-table-container');
  const categories = settings.categories ?? [];

  if (categories.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;padding:8px 0">No categories yet. Add one above.</p>';
    return;
  }

  container.innerHTML = categories.map((cat) => `
    <div class="cat-row" id="cat-row-${cat.id}">
      <div class="cat-row-header">
        <span class="cat-row-name">${escapeHtml(cat.name)}</span>
        <span class="cat-row-meta">
          <span id="cat-budget-display-${cat.id}">${cat.budgetMinutes}m/day</span>
          <button class="btn btn-sm cat-edit-budget-btn" data-cat="${cat.id}" title="Edit budget">✎</button>
          <span class="cat-budget-edit" id="cat-budget-edit-${cat.id}" style="display:none">
            <input type="number" class="cat-budget-input" id="cat-budget-input-${cat.id}" value="${cat.budgetMinutes}" min="1" max="1440" style="width:60px">
            <button class="btn btn-primary btn-sm cat-budget-save-btn" data-cat="${cat.id}">Save</button>
            <button class="btn btn-sm cat-budget-cancel-btn" data-cat="${cat.id}">Cancel</button>
          </span>
          · ${cat.domains.length} sites
        </span>
        <div class="cat-row-actions">
          <button class="btn btn-sm cat-toggle-btn" data-cat="${cat.id}">▼ Domains</button>
          <button class="btn btn-danger btn-sm cat-delete-btn" data-cat="${cat.id}">✕</button>
        </div>
      </div>
      <div class="cat-domains" id="cat-domains-${cat.id}" style="display:none">
        <div class="cat-domain-list" id="cat-domain-list-${cat.id}">
          ${cat.domains.map((d) => `
            <div class="cat-domain-row">
              <span>${d}</span>
              <button class="btn btn-danger btn-sm cat-remove-domain-btn" data-cat="${cat.id}" data-domain="${d}">✕</button>
            </div>
          `).join('') || '<div style="color:#9ca3af;font-size:12px;padding:4px 0">No domains.</div>'}
        </div>
        <div class="cat-add-domain-row">
          <input type="text" class="cat-add-domain-input" id="cat-add-domain-input-${cat.id}" placeholder="example.com">
          <button class="btn btn-primary btn-sm cat-add-domain-btn" data-cat="${cat.id}">Add</button>
        </div>
        <div class="cat-conflict-msg" id="cat-conflict-${cat.id}" style="display:none"></div>
      </div>
    </div>
  `).join('');

  // Wire up toggle buttons
  container.querySelectorAll('.cat-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const domainsEl = document.getElementById(`cat-domains-${btn.dataset.cat}`);
      const isHidden = domainsEl.style.display === 'none';
      domainsEl.style.display = isHidden ? 'block' : 'none';
      btn.textContent = isHidden ? '▲ Domains' : '▼ Domains';
    });
  });

  // Wire up budget edit buttons
  container.querySelectorAll('.cat-edit-budget-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(`cat-budget-display-${btn.dataset.cat}`).style.display = 'none';
      btn.style.display = 'none';
      document.getElementById(`cat-budget-edit-${btn.dataset.cat}`).style.display = 'inline-flex';
    });
  });

  container.querySelectorAll('.cat-budget-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(`cat-budget-display-${btn.dataset.cat}`).style.display = '';
      document.querySelector(`.cat-edit-budget-btn[data-cat="${btn.dataset.cat}"]`).style.display = '';
      document.getElementById(`cat-budget-edit-${btn.dataset.cat}`).style.display = 'none';
    });
  });

  container.querySelectorAll('.cat-budget-save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.cat;
      const cat = settings.categories.find((c) => c.id === catId);
      if (!cat) return;
      const newBudget = parseInt(document.getElementById(`cat-budget-input-${catId}`).value, 10);
      if (!newBudget || newBudget < 1) return;
      if (newBudget === cat.budgetMinutes) {
        // No change — just collapse
        document.getElementById(`cat-budget-display-${catId}`).style.display = '';
        document.querySelector(`.cat-edit-budget-btn[data-cat="${catId}"]`).style.display = '';
        document.getElementById(`cat-budget-edit-${catId}`).style.display = 'none';
        return;
      }
      const nudge = newBudget > cat.budgetMinutes
        ? `Increasing ${escapeHtml(cat.name)} budget from ${cat.budgetMinutes}m to ${newBudget}m. Are you sure you want to give yourself more time?`
        : `Decreasing ${escapeHtml(cat.name)} budget from ${cat.budgetMinutes}m to ${newBudget}m. Staying disciplined — confirm?`;
      if (!confirm(nudge)) return;
      cat.budgetMinutes = newBudget;
      await storage.saveSettings(settings);
      showToast(`${cat.name} budget updated to ${newBudget}m`);
      await renderCategories();
    });
  });

  // Wire up delete category buttons
  container.querySelectorAll('.cat-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = settings.categories.find((c) => c.id === btn.dataset.cat);
      if (!cat) return;
      const msg = cat.domains.length > 0
        ? `Delete ${cat.name}? Its ${cat.domains.length} domain(s) will become uncategorized.`
        : `Delete ${cat.name}?`;
      if (!confirm(msg)) return;
      settings.categories = settings.categories.filter((c) => c.id !== btn.dataset.cat);
      await storage.saveSettings(settings);
      showToast(`Deleted ${cat.name}`);
      await renderCategories();
    });
  });

  // Wire up remove domain buttons
  container.querySelectorAll('.cat-remove-domain-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = settings.categories.find((c) => c.id === btn.dataset.cat);
      if (!cat) return;
      cat.domains = cat.domains.filter((d) => d !== btn.dataset.domain);
      await storage.saveSettings(settings);
      showToast(`Removed ${btn.dataset.domain}`);
      await renderCategories();
    });
  });

  // Wire up add domain buttons
  container.querySelectorAll('.cat-add-domain-btn').forEach((btn) => {
    btn.addEventListener('click', () => addDomainToCategory(btn.dataset.cat));
  });
  container.querySelectorAll('.cat-add-domain-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addDomainToCategory(input.id.replace('cat-add-domain-input-', ''));
    });
  });
}

async function addDomainToCategory(catId) {
  const input = document.getElementById(`cat-add-domain-input-${catId}`);
  const conflictEl = document.getElementById(`cat-conflict-${catId}`);
  const domain = input.value.trim().replace(/^www\./, '').toLowerCase();
  if (!domain) return;

  conflictEl.style.display = 'none';

  // Check if domain already belongs to another category
  const existingCat = settings.categories.find(
    (c) => c.id !== catId && c.domains.includes(domain)
  );

  if (existingCat) {
    conflictEl.style.display = 'flex';
    conflictEl.innerHTML = `
      <span>"${escapeHtml(domain)}" is in ${escapeHtml(existingCat.name)} — move it here?</span>
      <button class="btn btn-primary btn-sm" id="cat-conflict-confirm-${catId}">Confirm</button>
    `;
    document.getElementById(`cat-conflict-confirm-${catId}`).addEventListener('click', async () => {
      existingCat.domains = existingCat.domains.filter((d) => d !== domain);
      const thisCat = settings.categories.find((c) => c.id === catId);
      if (thisCat && !thisCat.domains.includes(domain)) thisCat.domains.push(domain);
      await storage.saveSettings(settings);
      input.value = '';
      conflictEl.style.display = 'none';
      showToast(`Moved ${domain} to ${thisCat.name}`);
      await renderCategories();
    });
    return;
  }

  const thisCat = settings.categories.find((c) => c.id === catId);
  if (!thisCat) return;
  if (!thisCat.domains.includes(domain)) {
    thisCat.domains.push(domain);
    await storage.saveSettings(settings);
    showToast(`Added ${domain}`);
  }
  input.value = '';
  await renderCategories();
}

document.getElementById('add-cat-btn').addEventListener('click', async () => {
  const nameInput = document.getElementById('add-cat-name');
  const budgetInput = document.getElementById('add-cat-budget');
  const name = nameInput.value.trim();
  const budget = parseInt(budgetInput.value, 10);
  if (!name) return;
  if (!budget || budget < 1) return;

  // Generate stable slug id
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!id) return;

  if (settings.categories.find((c) => c.id === id)) {
    showToast(`Category "${name}" already exists`);
    return;
  }

  settings.categories.push({ id, name, budgetMinutes: budget, domains: [] });
  await storage.saveSettings(settings);
  nameInput.value = '';
  budgetInput.value = '';
  showToast(`Added category ${name}`);
  await renderCategories();
});

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------
async function renderSettings() {
  document.getElementById('notify-at-input').value = (settings.notifyAt ?? [80, 100]).join(', ');
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const raw = document.getElementById('notify-at-input').value;
  const notifyAt = raw
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => !isNaN(v) && v > 0 && v <= 100);
  if (notifyAt.length === 0) return;
  settings.notifyAt = notifyAt;
  await storage.saveSettings(settings);
  showToast('Settings saved.');
});

document.getElementById('reset-today-btn').addEventListener('click', async () => {
  if (!confirm("Reset all tracking data for today? This cannot be undone.")) return;
  if (!confirm("Are you sure? Today's data will be permanently deleted.")) return;
  await storage.saveUsageForDate(localDateStr(), {});
  await loadData();
  await renderOverview();
  showToast("Today's data reset.");
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  await loadData();
  await Promise.all([
    renderOverview(),
    renderHistory(),
    renderSites(),
    renderCategories(),
    renderSettings(),
  ]);
}

init();

// dashboard/options.js
import { storage } from '../shared/storage/index.js';
import {
  computeLeisureSeconds,
  budgetPercent,
  formatDuration,
  localDateStr,
  daysAgo,
} from '../shared/tracker.js';

let settings = null;
let weeklyUsage = null; // { dateStr: { domain: seconds } }

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
  const leisureSec = computeLeisureSeconds(todayUsage, settings.leisureDomains);
  const budgetSec = settings.dailyBudgetMinutes * 60;
  const remainSec = Math.max(0, budgetSec - leisureSec);

  // Weekly leisure total
  const weekLeisureSec = Object.values(weeklyUsage).reduce((sum, usage) => {
    return sum + computeLeisureSeconds(usage, settings.leisureDomains);
  }, 0);

  document.getElementById('stat-today').textContent = formatDuration(leisureSec);
  document.getElementById('stat-week').textContent = formatDuration(weekLeisureSec);
  document.getElementById('stat-remaining').textContent = formatDuration(remainSec);

  // Weekly bar chart
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i);
    const dayUsage = weeklyUsage[d] ?? {};
    labels.push(d.slice(5)); // MM-DD
    data.push(Math.round(computeLeisureSeconds(dayUsage, settings.leisureDomains) / 60));
  }

  const ctx = document.getElementById('weekly-chart').getContext('2d');
  if (window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Leisure (min)',
        data,
        backgroundColor: data.map((v) =>
          v > settings.dailyBudgetMinutes ? '#f87171' : '#a5b4fc'
        ),
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'minutes' },
        },
      },
    },
  });

  // Today's site table — all tracked domains
  const leisureSet = new Set(settings.leisureDomains);
  const sorted = Object.entries(todayUsage).sort(([, a], [, b]) => b - a);
  const tbody = document.getElementById('overview-site-tbody');
  tbody.innerHTML = sorted.map(([domain, sec]) => `
    <tr>
      <td>${domain}${leisureSet.has(domain) ? '<span class="leisure-badge">leisure</span>' : ''}</td>
      <td>${formatDuration(sec)}</td>
    </tr>
  `).join('') || '<tr><td colspan="2" style="color:#9ca3af;text-align:center;padding:16px">No data today</td></tr>';
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------
async function renderHistory() {
  const container = document.getElementById('history-list');
  const leisureSet = new Set(settings.leisureDomains);

  const days = Object.keys(weeklyUsage).sort().reverse();
  if (days.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af">No history yet.</p>';
    return;
  }

  container.innerHTML = days.map((dateStr) => {
    const usage = weeklyUsage[dateStr];
    const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
    const sorted = Object.entries(usage).sort(([, a], [, b]) => b - a);
    const rows = sorted.map(([d, s]) =>
      `<tr>
        <td style="padding:4px 16px;color:#6b7280;font-size:12px">
          ${d}${leisureSet.has(d) ? '<span class="leisure-badge">leisure</span>' : ''}
        </td>
        <td style="padding:4px 16px;font-size:12px">${formatDuration(s)}</td>
      </tr>`
    ).join('');
    return `
      <div class="site-table" style="margin-bottom:12px">
        <table>
          <thead><tr>
            <th>${dateStr}</th>
            <th style="color:#dc2626">${formatDuration(leisureSec)} leisure</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="2" style="color:#9ca3af;padding:10px 16px;font-size:12px">No data</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Sites section
// ---------------------------------------------------------------------------
async function renderSites() {
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  const range = await storage.getUsageRange(sevenDaysAgo, today);

  // Sum per domain across week
  const weekTotals = {};
  for (const usage of Object.values(range)) {
    for (const [domain, sec] of Object.entries(usage)) {
      weekTotals[domain] = (weekTotals[domain] ?? 0) + sec;
    }
  }

  const sorted = [...settings.leisureDomains].sort();
  const tbody = document.getElementById('sites-tbody');
  tbody.innerHTML = sorted.map((domain) => `
    <tr>
      <td>${domain}</td>
      <td>${formatDuration(weekTotals[domain] ?? 0)}</td>
      <td>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:11px" data-domain="${domain}">
          Remove
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:16px;font-size:12px">No leisure sites configured.</td></tr>';

  tbody.querySelectorAll('[data-domain]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      settings.leisureDomains = settings.leisureDomains.filter((d) => d !== btn.dataset.domain);
      await storage.saveSettings(settings);
      showToast(`Removed ${btn.dataset.domain}`);
      await renderSites();
    });
  });
}

document.getElementById('add-domain-btn').addEventListener('click', async () => {
  const input = document.getElementById('add-domain-input');
  const domain = input.value.trim().replace(/^www\./, '').toLowerCase();
  if (!domain) return;
  if (!settings.leisureDomains.includes(domain)) {
    settings.leisureDomains.push(domain);
    await storage.saveSettings(settings);
    showToast(`Added ${domain}`);
  }
  input.value = '';
  await renderSites();
});

// Allow pressing Enter in the input to add
document.getElementById('add-domain-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-domain-btn').click();
});

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------
async function renderSettings() {
  document.getElementById('budget-input').value = settings.dailyBudgetMinutes;
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const budget = parseInt(document.getElementById('budget-input').value, 10);
  if (!budget || budget < 1) return;
  settings.dailyBudgetMinutes = budget;
  await storage.saveSettings(settings);
  showToast('Settings saved.');
});

document.getElementById('reset-today-btn').addEventListener('click', async () => {
  if (!confirm('Reset all tracking data for today?')) return;
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
    renderSettings(),
  ]);
}

init();

// popup/popup.js
import { storage } from '../shared/storage/index.js';
import { computeLeisureSeconds, budgetPercent, formatDuration, localDateStr } from '../shared/tracker.js';

async function render() {
  const settings = await storage.getSettings();
  const today = localDateStr();
  const usage = await storage.getUsageForDate(today);

  const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const budgetSec = settings.dailyBudgetMinutes * 60;
  const pct = budgetPercent(leisureSec, settings.dailyBudgetMinutes);
  const remainSec = Math.max(0, budgetSec - leisureSec);

  // Budget bar
  document.getElementById('budget-bar').style.width = `${Math.min(pct, 100)}%`;
  document.getElementById('used-label').textContent =
    `${formatDuration(leisureSec)} used of ${settings.dailyBudgetMinutes}m`;
  document.getElementById('remaining-label').textContent = `${formatDuration(remainSec)} left`;

  // Site list — all tracked domains sorted by time desc
  const sorted = Object.entries(usage).sort(([, a], [, b]) => b - a);
  const container = document.getElementById('site-list');

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No activity tracked today.</div>';
    return;
  }

  const leisureSet = new Set(settings.leisureDomains);
  container.innerHTML = sorted.map(([domain, seconds]) => {
    const tag = leisureSet.has(domain)
      ? '<span class="leisure-tag">leisure</span>'
      : '';
    return `
      <div class="site-card">
        <span class="domain">${domain}${tag}</span>
        <span class="time">${formatDuration(seconds)}</span>
      </div>
    `;
  }).join('');
}

// Dashboard link
document.getElementById('dashboard-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();

// popup/popup.js
import { storage } from '../shared/storage/index.js';
import {
  getCategoryForDomain,
  computeCategorySeconds,
  budgetPercent,
  formatDuration,
  localDateStr,
} from '../shared/tracker.js';
import { categoryStyle } from '../shared/palette.js';
import { icon, escapeHtml } from '../shared/icons.js';
import { wireThemeToggle, THEME_TOGGLE_HTML } from '../shared/theme-toggle.js';

// Chrome caps popups at 600px tall; show fewer sites when there are more budgets.
const maxSites = (categoryCount) => Math.max(3, 7 - categoryCount);

function openDashboard(section) {
  if (section) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/options.html#${section}`) });
    window.close();
  } else {
    chrome.runtime.openOptionsPage();
  }
}

/** Threshold (in %) at which a budget is shown as running low. */
function warnAt(settings) {
  const below100 = (settings?.notifyAt ?? []).filter((v) => v < 100);
  return below100.length ? Math.min(...below100) : 80;
}

function budgetItem({ cat, sec, pct }, categories, warnPct) {
  const budgetSec = cat.budgetMinutes * 60;
  const over = sec > budgetSec;
  const state = over ? 'is-over' : pct >= warnPct ? 'is-close' : '';
  const stateText = over
    ? `${icon('alert')}<span>Over by ${formatDuration(sec - budgetSec)}</span>`
    : `<span>${formatDuration(budgetSec - sec)} left</span>`;

  return `
    <li class="budget has-cat ${state}" style="${categoryStyle(cat, categories)}">
      <div class="budget-head">
        <span class="budget-name"><span class="cat-dot"></span><span>${escapeHtml(cat.name)}</span></span>
        <span class="budget-amount num"><strong>${formatDuration(sec)}</strong> of ${formatDuration(budgetSec)}</span>
      </div>
      <div class="budget-track">
        <div class="meter" role="progressbar" aria-label="${escapeHtml(cat.name)} budget used"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}">
          <div class="meter-fill" style="width:${Math.min(pct, 100)}%"></div>
        </div>
        <p class="budget-state num">${stateText}</p>
      </div>
    </li>`;
}

async function render() {
  const settings = await storage.getSettings();
  const usage = await storage.getUsageForDate(localDateStr());
  const categories = settings?.categories ?? [];

  document.getElementById('today-label').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());

  const totalSec = Object.values(usage).reduce((a, b) => a + b, 0);
  document.getElementById('today-total').textContent = totalSec < 60 ? '0m' : formatDuration(totalSec);

  // Budgets, most-used first
  const budgets = document.getElementById('budgets');
  if (categories.length) {
    const warnPct = warnAt(settings);
    const rows = categories
      .map((cat) => {
        const sec = computeCategorySeconds(usage, cat);
        return { cat, sec, pct: budgetPercent(sec, cat.budgetMinutes) };
      })
      .sort((a, b) => b.pct - a.pct);
    document.getElementById('category-list').innerHTML =
      rows.map((r) => budgetItem(r, categories, warnPct)).join('');
    budgets.hidden = false;
  }

  // Sites not in any category
  const uncategorized = Object.entries(usage)
    .filter(([domain]) => getCategoryForDomain(domain, categories) === null)
    .sort(([, a], [, b]) => b - a);

  if (uncategorized.length) {
    document.getElementById('sites-title').textContent = categories.length ? 'Other sites' : 'Sites today';
    document.getElementById('site-list').innerHTML = uncategorized.slice(0, maxSites(categories.length)).map(([domain, sec]) => `
      <li class="site-row">
        <span class="site-domain">${escapeHtml(domain)}</span>
        <span class="site-time num">${formatDuration(sec)}</span>
      </li>`).join('');
    const extra = uncategorized.length - maxSites(categories.length);
    const more = document.getElementById('more-link');
    if (extra > 0) {
      more.textContent = `${extra} more ${extra === 1 ? 'site' : 'sites'} in the dashboard`;
      more.hidden = false;
      more.addEventListener('click', () => openDashboard('overview'));
    }
    document.getElementById('sites').hidden = false;
  }

  // Empty and first-run guidance
  const empty = document.getElementById('empty');
  if (!categories.length) {
    empty.innerHTML = `
      <p>Group sites into categories like Social or News to give each one a daily time budget.</p>
      <button type="button" class="btn btn-sm" id="create-cat">${icon('plus')}Create a category</button>`;
    empty.hidden = false;
    document.getElementById('create-cat').addEventListener('click', () => openDashboard('categories'));
  } else if (totalSec === 0) {
    empty.innerHTML = '<p>Nothing tracked yet today. Time counts while a tab is active and the window is focused.</p>';
    empty.hidden = false;
  }
}

document.getElementById('dashboard-link').addEventListener('click', () => openDashboard());

const themeToggle = document.getElementById('theme-toggle');
themeToggle.innerHTML = THEME_TOGGLE_HTML;
wireThemeToggle(themeToggle);

render();

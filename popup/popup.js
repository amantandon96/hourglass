// popup/popup.js
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
  budgetPercent,
  formatDuration,
  localDateStr,
} from '../shared/tracker.js';

// Fixed colour palette for categories (assigned by index)
const CATEGORY_COLORS = [
  '#818cf8', // indigo
  '#34d399', // emerald
  '#fb923c', // orange
  '#f472b6', // pink
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#facc15', // yellow
];

async function render() {
  const settings = await storage.getSettings();
  const today = localDateStr();
  const usage = await storage.getUsageForDate(today);

  const categories = settings?.categories ?? [];
  const categoryList = document.getElementById('category-list');
  const siteList = document.getElementById('site-list');

  if (categories.length === 0) {
    categoryList.innerHTML =
      '<div class="empty" style="padding:12px 16px;color:#9ca3af;font-size:12px">No categories yet — set them up in the dashboard.</div>';
  } else {
    // Sort by % used descending (most urgent first)
    const sorted = categories
      .map((cat, i) => {
        const sec = computeCategorySeconds(usage, cat);
        const pct = budgetPercent(sec, cat.budgetMinutes);
        return { cat, sec, pct, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] };
      })
      .sort((a, b) => b.pct - a.pct);

    categoryList.innerHTML = sorted.map(({ cat, sec, pct, color }) => {
      const budgetSec = cat.budgetMinutes * 60;
      const remainSec = Math.max(0, budgetSec - sec);
      const fillPct = Math.min(pct, 100);
      return `
        <div class="category-card">
          <div class="category-name">${escapeHtml(cat.name).toUpperCase()}</div>
          <div class="bar-wrap">
            <div class="bar-fill" style="width:${fillPct}%;background:${color}"></div>
          </div>
          <div class="category-meta">
            <span>${formatDuration(sec)} used of ${cat.budgetMinutes}m</span>
            <span class="remaining">${formatDuration(remainSec)} left</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Uncategorized domains — sorted by time desc, no budget bar
  const uncategorized = Object.entries(usage)
    .filter(([domain]) => getCategoryForDomain(domain, categories) === null)
    .sort(([, a], [, b]) => b - a);

  if (uncategorized.length === 0 && categories.length === 0) {
    siteList.innerHTML = '<div class="empty">No activity tracked today.</div>';
  } else {
    siteList.innerHTML = uncategorized.map(([domain, seconds]) => `
      <div class="site-card">
        <span class="domain">${domain}</span>
        <span class="time">${formatDuration(seconds)}</span>
      </div>
    `).join('');
  }
}

// Dashboard link
document.getElementById('dashboard-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();

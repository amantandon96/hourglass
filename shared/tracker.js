// shared/tracker.js

/**
 * Extract the registrable domain from a URL string.
 * Returns null for chrome://, about:, extension pages, and invalid URLs.
 */
export function extractDomain(url) {
  if (!url) return null;
  try {
    const { hostname, protocol } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return null;
    if (!hostname) return null;
    // Strip leading "www."
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Given a usage map { domain: seconds } and a list of leisure domains,
 * compute total leisure seconds for today.
 */
export function computeLeisureSeconds(usage, leisureDomains) {
  const set = new Set(leisureDomains);
  return Object.entries(usage).reduce((sum, [domain, seconds]) => {
    return set.has(domain) ? sum + seconds : sum;
  }, 0);
}

/**
 * Compute what percentage of the daily budget has been used.
 * Returns a number 0–N (can exceed 100).
 */
export function budgetPercent(leisureSeconds, dailyBudgetMinutes) {
  const budgetSeconds = dailyBudgetMinutes * 60;
  if (budgetSeconds === 0) return 0;
  return Math.round((leisureSeconds / budgetSeconds) * 100);
}

/**
 * Format seconds into a human-readable string: "1h 4m", "32m", "45s".
 */
export function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/**
 * Return YYYY-MM-DD for a given Date object in local time.
 */
export function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return the date string N days before the given date.
 */
export function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

/**
 * Return the Date object for the next midnight (local time).
 * Used to schedule the midnight-reset alarm.
 */
export function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d;
}

/**
 * Returns the category object whose `domains` array includes `domain`, or null.
 * @param {string} domain
 * @param {Array<{id:string, name:string, budgetMinutes:number, domains:string[]}>} categories
 */
export function getCategoryForDomain(domain, categories) {
  for (const cat of categories) {
    if (cat.domains.includes(domain)) return cat;
  }
  return null;
}

/**
 * Sums seconds for all domains that belong to `category`.
 * @param {{ [domain: string]: number }} usage  — { domain: seconds }
 * @param {{ domains: string[] }} category
 * @returns {number}
 */
export function computeCategorySeconds(usage, category) {
  const set = new Set(category.domains);
  return Object.entries(usage).reduce((sum, [domain, seconds]) => {
    return set.has(domain) ? sum + seconds : sum;
  }, 0);
}

/**
 * Returns { categoryId: seconds } for every category.
 * @param {{ [domain: string]: number }} usage
 * @param {Array<{id:string, domains:string[]}>} categories
 * @returns {{ [categoryId: string]: number }}
 */
export function computeAllCategoryUsage(usage, categories) {
  const result = {};
  for (const cat of categories) {
    result[cat.id] = computeCategorySeconds(usage, cat);
  }
  return result;
}

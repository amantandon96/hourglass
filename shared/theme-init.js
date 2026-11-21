// shared/theme-init.js
// Classic (non-module) script loaded in <head>, so the theme is applied before first
// paint. The choice lives in localStorage: it's synchronous (no flash of the wrong
// theme) and shared by every page of the extension, since they have one origin.
(() => {
  const KEY = 'hourglass-theme'; // 'light' | 'dark'; absent means follow the system
  const system = window.matchMedia('(prefers-color-scheme: dark)');

  const readPref = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };

  const apply = () => {
    const pref = readPref();
    const theme = pref === 'light' || pref === 'dark' ? pref : (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme, pref: pref ?? 'system' } }));
  };

  window.hourglassTheme = {
    /** Effective theme: 'light' or 'dark'. */
    get: () => document.documentElement.dataset.theme,
    /** Stored preference: 'light', 'dark' or 'system'. */
    getPreference: () => readPref() ?? 'system',
    set(pref) {
      try {
        if (pref === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch { /* storage unavailable: still switch for this page */ }
      // Crossfade colors for the switch only, not on every hover.
      const root = document.documentElement;
      root.classList.add('theme-switching');
      apply();
      setTimeout(() => root.classList.remove('theme-switching'), 260);
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
  };

  system.addEventListener('change', apply);
  // Another extension page (e.g. the popup) changed the theme.
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
  apply();
})();

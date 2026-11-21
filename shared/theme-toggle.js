// shared/theme-toggle.js
// Wires a .theme-toggle button to window.hourglassTheme (from theme-init.js).

export function wireThemeToggle(button) {
  const sync = () => {
    const next = window.hourglassTheme.get() === 'dark' ? 'light' : 'dark';
    const label = `Switch to ${next} theme`;
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  button.addEventListener('click', () => window.hourglassTheme.toggle());
  document.addEventListener('themechange', sync);
  sync();
}

export const THEME_TOGGLE_HTML = `
  <svg class="icon icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  <svg class="icon icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;

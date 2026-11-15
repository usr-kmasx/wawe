// Tema local de interface: não altera o estado da sala nem envia dados ao servidor.
(() => {
  const KEY = 'wawe:theme';
  const root = document.documentElement;
  const savedTheme = () => {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  };

  function apply(theme) {
    const isLight = theme === 'light';
    root.dataset.theme = isLight ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = isLight ? 'light' : 'dark';
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(isLight));
      button.setAttribute('aria-label', isLight ? 'Ativar tema escuro' : 'Ativar tema claro');
      button.title = isLight ? 'Ativar tema escuro' : 'Ativar tema claro';
    }
  }

  // Aplicar antes que o CSS renderize para evitar piscar no tema errado.
  apply(savedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    apply(savedTheme());
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      apply(theme);
      try { localStorage.setItem(KEY, theme); } catch { /* modo sem persistência */ }
    });
  });

  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) apply(savedTheme());
  });
})();

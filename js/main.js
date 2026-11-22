const themeButton = document.querySelector('[data-theme-button]');
const themeIcon = themeButton.querySelector('use');

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  themeButton.title = themeButton.getAttribute('aria-label');
  themeIcon.setAttribute('href', dark ? '#icon-sun' : '#icon-moon');
}

updateThemeButton();
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('toolvibe-theme', theme); } catch {}
  updateThemeButton();
});

const search = document.querySelector('#tool-search');
if (search) {
  const cards = [...document.querySelectorAll('[data-category]')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  let category = 'all';

  function updateDirectory() {
    const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const text = (card.textContent + ' ' + card.dataset.keywords).toLowerCase();
      card.hidden = (category !== 'all' && card.dataset.category !== category)
        || !terms.every((term) => text.includes(term));
      if (!card.hidden) count++;
    }
    document.querySelector('#tool-count').textContent = count === 1 ? '1 tool' : `${count} tools`;
    document.querySelector('#tool-empty').hidden = count !== 0;
  }

  search.addEventListener('input', updateDirectory);
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      category = filter.dataset.filter;
      for (const item of filters) item.setAttribute('aria-pressed', String(item === filter));
      updateDirectory();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey
      && !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape' && document.activeElement === search && search.value) {
      search.value = '';
      updateDirectory();
    }
  });
  updateDirectory();
}

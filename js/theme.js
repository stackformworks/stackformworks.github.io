try {
  const saved = localStorage.getItem('toolvibe-theme');
  document.documentElement.dataset.theme = saved === 'dark' || saved === 'light'
    ? saved
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

if (
  document.readyState === 'loading' &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  const root = document.documentElement;
  root.dataset.pageLoading = 'pending';

  const finishLoading = () => {
    clearTimeout(fallback);
    document.removeEventListener('DOMContentLoaded', finishLoading);
    root.dataset.pageLoading = 'ready';

    setTimeout(() => {
      delete root.dataset.pageLoading;
    }, 360);
  };

  const fallback = setTimeout(finishLoading, 2800);
  document.addEventListener('DOMContentLoaded', finishLoading, { once: true });
}

// Catalog interactivity: family chips + search over the build-time-rendered
// cards. Cards carry data-family / data-text; no framework, no fetch.
(() => {
  const cards = Array.from(document.querySelectorAll('.card'));
  const chips = Array.from(document.querySelectorAll('.chip'));
  const search = document.querySelector('.search');
  const empty = document.querySelector('.empty');
  let family = 'all';
  let query = '';

  const apply = () => {
    let shown = 0;
    for (const card of cards) {
      const okFamily = family === 'all' || card.dataset.family === family;
      const okQuery = query === '' || (card.dataset.text || '').includes(query);
      const show = okFamily && okQuery;
      card.style.display = show ? '' : 'none';
      if (show) shown += 1;
    }
    if (empty) empty.style.display = shown === 0 ? '' : 'none';
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      family = chip.dataset.family || 'all';
      for (const c of chips) c.classList.toggle('active', c === chip);
      apply();
    });
  }
  if (search) {
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      apply();
    });
  }
})();

// Store page: version tabs + screenshot lightbox. The page is fully rendered
// at build time (each version URL opens on its own tab); this only swaps tabs
// in place, keeps the address bar on the selected version's URL, and plays
// just the visible preview clip.
(() => {
  const tabs = Array.from(document.querySelectorAll('.tab[role="tab"]'));

  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (!panel) continue;
      panel.hidden = !on;
      const video = panel.querySelector('video');
      if (!video) continue;
      if (on) {
        video.preload = 'auto';
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
    if (focus) tab.focus();
    if (tab.dataset.docTitle) document.title = tab.dataset.docTitle;
    history.replaceState(null, '', tab.href);
  };

  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      select(tab);
    });
    tab.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + n) % n], true);
    });
  });

  // "What changed" headings link to a version: open its tab and bring the
  // tabs into view instead of reloading the page.
  for (const link of document.querySelectorAll('a[data-version]')) {
    link.addEventListener('click', (e) => {
      const tab = document.getElementById(`tab-${link.dataset.version}`);
      if (!tab || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      select(tab);
      tab.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tab.focus({ preventScroll: true });
    });
  }

  // Lightbox: click a screenshot to zoom; arrows step through that version's
  // shots; Escape, the close button or the backdrop closes it.
  const box = document.querySelector('.lightbox');
  if (!box) return;
  const big = box.querySelector('img');
  const prev = box.querySelector('.lb-prev');
  const next = box.querySelector('.lb-next');
  const close = box.querySelector('.lb-close');
  let list = [];
  let index = 0;
  let opener = null;

  const show = () => {
    const img = list[index].querySelector('img');
    big.src = img.src;
    big.alt = img.alt;
    prev.hidden = next.hidden = list.length < 2;
  };
  const step = (d) => {
    index = (index + d + list.length) % list.length;
    show();
  };
  const hide = () => {
    box.hidden = true;
    document.body.classList.remove('no-scroll');
    if (opener) opener.focus();
  };

  document.addEventListener('click', (e) => {
    const shot = e.target.closest('.shot');
    if (!shot) return;
    list = Array.from(shot.closest('.shots').querySelectorAll('.shot'));
    index = list.indexOf(shot);
    opener = shot;
    show();
    box.hidden = false;
    document.body.classList.add('no-scroll');
    close.focus();
  });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  close.addEventListener('click', hide);
  box.addEventListener('click', (e) => {
    if (e.target === box) hide();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusable = [prev, next, close].filter((b) => !b.hidden);
      const at = focusable.indexOf(document.activeElement);
      e.preventDefault();
      focusable[(at + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    }
  });
})();

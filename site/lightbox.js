// Store-page screenshot lightbox: click a shot to zoom, click anywhere to close.
(() => {
  const box = document.querySelector('.lightbox');
  const big = box ? box.querySelector('img') : null;
  if (!box || !big) return;
  for (const img of document.querySelectorAll('.shots img')) {
    img.addEventListener('click', () => {
      big.src = img.src;
      box.classList.add('open');
    });
  }
  box.addEventListener('click', () => box.classList.remove('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') box.classList.remove('open');
  });
})();

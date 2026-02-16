// ──────────────────────────────────────────────────────────
/** Examples carousel (infinite loop; 1 mobile, 2 desktop) */
// ──────────────────────────────────────────────────────────
function setupExamplesCarousel() {
  const grid = document.getElementById('examples-grid');
  if (!grid) return;

  const prevBtn = examplesPrevBtn;
  const nextBtn = examplesNextBtn;
  const dotsEl  = examplesDotsEl;

  // One-time state bucket
  const state = (grid._carouselState ||= {
    index: 0,          // "virtual" page index in real pages (0..realPages-1)
    perPage: 2,
    realPages: 1,
    isJumping: false,
    isSetup: false
  });

  const getPerPage = () => (window.matchMedia('(max-width: 640px)').matches ? 1 : 2);

  const safeClamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const getAllCards = () => Array.from(grid.querySelectorAll('.example'));
  const getRealCards = () => Array.from(grid.querySelectorAll('.example:not([data-clone="1"])'));

  const removeClones = () => {
    grid.querySelectorAll('.example[data-clone="1"]').forEach(el => el.remove());
  };

  const buildClones = () => {
    removeClones();

    const realCards = getRealCards();
    const per = state.perPage;

    if (realCards.length <= per) {
      // Not enough cards to loop meaningfully, just leave it as-is
      return;
    }

    const head = realCards.slice(0, per);
    const tail = realCards.slice(-per);

    // Clone tail to the front
    tail.forEach(card => {
      const c = card.cloneNode(true);
      c.setAttribute('data-clone', '1');
      grid.insertBefore(c, grid.firstChild);
    });

    // Clone head to the end
    head.forEach(card => {
      const c = card.cloneNode(true);
      c.setAttribute('data-clone', '1');
      grid.appendChild(c);
    });
  };

  const computeRealPages = () => {
    const realCards = getRealCards();
    state.realPages = Math.max(1, Math.ceil(realCards.length / state.perPage));
    state.index = safeClamp(state.index, 0, state.realPages - 1);
  };

  const pageWidth = () => Math.max(1, grid.clientWidth);

  // In the DOM we have: [clonesTail] [realPages...] [clonesHead]
  // So the "real page i" is located at scrollLeft = (i + 1) * pageWidth
  const scrollToRealIndex = (realIndex, behavior = 'smooth') => {
    const x = (realIndex + 1) * pageWidth();
    state.isJumping = (behavior === 'auto');
    grid.scrollTo({ left: x, behavior });
    // release the jump flag quickly
    if (behavior === 'auto') {
      requestAnimationFrame(() => { state.isJumping = false; });
    }
  };

  const buildDots = () => {
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    for (let i = 0; i < state.realPages; i++) {
      const d = document.createElement('span');
      d.className = 'examples-dot' + (i === state.index ? ' is-active' : '');
      d.addEventListener('click', () => {
        state.index = i;
        scrollToRealIndex(state.index, 'smooth');
        updateUI();
      });
      dotsEl.appendChild(d);
    }
  };

  const updateDots = () => {
    if (!dotsEl) return;
    const dots = dotsEl.querySelectorAll('.examples-dot');
    dots.forEach((d, i) => d.classList.toggle('is-active', i === state.index));
  };

  const updateButtons = () => {
    // Infinite means never disabled
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
  };

  const updateUI = () => {
    updateButtons();
    updateDots();
  };

  const normalizeIfOnClonePage = () => {
    // Determine which "DOM page" we're on: 0..(realPages+1)
    const w = pageWidth();
    const domPage = Math.round(grid.scrollLeft / w);

    // domPage mapping:
    // 0            => leading clone page (tail clones)
    // 1..realPages => real pages
    // realPages+1  => trailing clone page (head clones)

    if (domPage === 0) {
      // Jump to last real page (same visual position as clones)
      state.index = state.realPages - 1;
      scrollToRealIndex(state.index, 'auto');
      updateUI();
      return;
    }

    if (domPage === state.realPages + 1) {
      // Jump to first real page
      state.index = 0;
      scrollToRealIndex(state.index, 'auto');
      updateUI();
      return;
    }

    // Otherwise set state.index from real dom page
    const realIndex = safeClamp(domPage - 1, 0, state.realPages - 1);
    if (realIndex !== state.index) {
      state.index = realIndex;
      updateUI();
    }
  };

  const recompute = () => {
    state.perPage = getPerPage();
    computeRealPages();

    // Rebuild clones whenever perPage changes or items change
    buildClones();
    computeRealPages(); // recompute after cloning, just in case

    buildDots();
    updateUI();

    // Start on the first real page (domPage=1)
    scrollToRealIndex(state.index, 'auto');
  };

  const go = (dir) => {
    // Wrap index
    const next = (state.index + dir + state.realPages) % state.realPages;
    state.index = next;
    scrollToRealIndex(state.index, 'smooth');
    updateUI();
  };

  // Bind listeners once
  if (!grid._carouselBound) {
    grid._carouselBound = true;

    if (prevBtn) prevBtn.addEventListener('click', () => go(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => go(+1));

    let t;
    grid.addEventListener('scroll', () => {
      if (state.isJumping) return;
      clearTimeout(t);
      t = setTimeout(() => {
        normalizeIfOnClonePage();
      }, 80);
    });

    window.addEventListener('resize', () => recompute());
  }

  // Initial setup / refresh
  recompute();
}

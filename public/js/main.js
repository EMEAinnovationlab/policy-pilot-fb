// main.js — ES module (top-level await)
// Ensure HTML loads with:
// <script type="module" src="/js/main.js"></script>

// ──────────────────────────────────────────────────────────
// Imports (must be first)
// ──────────────────────────────────────────────────────────
import { enforceRole } from '/js/auth_guard.js';
import { injectStraplineStyles } from '/js/strapline.js';
import { openExamples, closeExamples, attachExampleFillHandlers } from '/js/examples.js';
import { injectMarkdownStyles } from '/js/markdown.js';
import { createChatController } from '/js/chatFlow.js';

// ──────────────────────────────────────────────────────────
/** Session gate: require any logged-in user (null) */
await enforceRole({ requiredRole: null });

// ──────────────────────────────────────────────────────────
/** Markdown parser: prefer window.marked (from markdown.js), fallback to CDN */
let markedRef = (typeof window !== 'undefined' && window.marked) ? window.marked : null;
if (!markedRef) {
  try {
    const { marked } = await import('https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js');
    markedRef = marked;
    if (typeof window !== 'undefined') window.marked = markedRef;
  } catch (e) {
    console.warn('Marked ESM fallback failed; rendering raw markdown.', e);
  }
}
const parseMarkdown = (md) => (markedRef ? markedRef.parse(md || '') : (md || ''));

// ──────────────────────────────────────────────────────────
/** Config */
const STRAPLINE = {
  enabled: true,
  iconUrl: '/images/brand/chat_icon.png',
  defaultText: 'POLI PILOT',
  autoStartText: 'INTRODUCTIE',
  uppercase: true,
  letterSpacing: '0.25em',
  fontSize: '12px',
  color: '#8B6A2B'
};

let DEFAULT_WELCOME_PROMPT = `
You are the assistant in a chat UI. Greet the user briefly and offer 2–3 concrete things you can do here.
Keep it concise and friendly; no emojis. Avoid generic fluff.
`;

// Load introduction prompt from backend (via Vercel /api route)
async function loadIntroPromptFromServer() {
  try {
    const res = await fetch('/api/project-settings', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to fetch settings');
    const intro = data.settings?.introduction_prompt;
    if (intro && intro.trim()) DEFAULT_WELCOME_PROMPT = intro.trim();
  } catch (err) {
    console.warn('Intro prompt fallback used:', err?.message || err);
  }
}
await loadIntroPromptFromServer();

// ──────────────────────────────────────────────────────────
/** DOM */
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const clearBtn = document.getElementById('clear');

const examplesContainer = document.getElementById('example-prompts');
const closeExamplesBtn = document.getElementById('close-examples');
const exampleCards = document.querySelectorAll('.example');
const examplesToggle = document.getElementById('toggle-examples');

// Carousel controls (must exist in your HTML)
const examplesPrevBtn = document.getElementById('examples-prev');
const examplesNextBtn = document.getElementById('examples-next');
const examplesDotsEl  = document.getElementById('examples-dots');

if (chat) {
  chat.setAttribute('role', 'log');
  chat.setAttribute('aria-live', 'polite');
  chat.setAttribute('aria-relevant', 'additions');
}

// ──────────────────────────────────────────────────────────
/** Styles */
injectMarkdownStyles();
injectStraplineStyles({
  uppercase: STRAPLINE.uppercase,
  letterSpacing: STRAPLINE.letterSpacing,
  fontSize: STRAPLINE.fontSize,
  color: STRAPLINE.color
});

// ──────────────────────────────────────────────────────────
// ✅ Retrieval rule (NO checkbox):
// - If examples panel is OPEN → retrieval ON
// - If examples panel is CLOSED → retrieval OFF
// ──────────────────────────────────────────────────────────
const isExamplesOpen = () =>
  !!examplesContainer && !examplesContainer.classList.contains('hide');

const getUseRetrieval = () => isExamplesOpen();

// ──────────────────────────────────────────────────────────
/** Examples helpers bound with our DOM */
const examples = {
  openExamples: () => openExamples(examplesContainer, examplesToggle),
  closeExamples: (opts) => closeExamples(examplesContainer, examplesToggle, opts)
};

// ──────────────────────────────────────────────────────────
/** Chat controller */
const controller = createChatController({
  dom: { chat, input, sendBtn, stopBtn, clearBtn },
  examples,
  config: { STRAPLINE, DEFAULT_WELCOME_PROMPT },
  getUseRetrieval
});

// Attach example fill handlers present at load
attachExampleFillHandlers({
  exampleCards,
  input,
  autoGrowTextarea: controller.autoGrowTextarea,
});

// Buttons / inputs
if (sendBtn) sendBtn.addEventListener('click', controller.sendMessage);
if (stopBtn) stopBtn.addEventListener('click', () => { /* Abort handled in chatFlow */ });

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (chat) chat.innerHTML = '';
    controller.resetTextareaHeight();
    examples.openExamples(); // opening examples => retrieval ON
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
}

if (input) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      controller.sendMessage();
    }
  });
  ['input','change','paste','cut','drop'].forEach(ev =>
    input.addEventListener(ev, controller.autoGrowTextarea)
  );
  controller.autoGrowTextarea();
}

// Keep examples visible on load if chat is empty
(function maybeShowExamples() {
  if (!examplesContainer || !chat) return;
  if (chat.children.length === 0) examples.openExamples(); // retrieval ON while open
})();

if (examplesToggle && examplesContainer) {
  const open = !examplesContainer.classList.contains('hide');
  examplesToggle.classList.toggle('hide', open);
}

if (closeExamplesBtn) {
  closeExamplesBtn.addEventListener('click', () =>
    examples.closeExamples({ animate: true, scroll: true })
  );
}
if (examplesToggle) {
  examplesToggle.addEventListener('click', () => {
    examples.openExamples();
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
}

// Auto-start assistant greeting
controller.setButtonsStreaming(false);
if (chat && chat.children.length === 0) {
  controller.streamAssistantFromPrompt(DEFAULT_WELCOME_PROMPT, {
    echoUser: false,
    closeExamplesOnStart: false,
    straplineText: STRAPLINE.autoStartText
  });
}

// ──────────────────────────────────────────────────────────
/** Context Pages (About / How it works / Included Data) */
// ──────────────────────────────────────────────────────────
const modal = document.getElementById('content-modal');
const modalTitle = document.getElementById('pp-modal-title');
const modalContent = document.getElementById('pp-modal-content');

const titles = { about: 'Over Poli Pilot', how: 'Hoe het werkt', data: 'Data' };
const pagesOrder = ['about', 'how', 'data'];

function setModalOpen(open) {
  if (!modal) return;
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  modal.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeModal() {
  setModalOpen(false);
  history.replaceState(null, '', location.pathname);
}
modal?.addEventListener('click', (e) => {
  if (e.target.matches('[data-close], .pp-modal__backdrop')) closeModal();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

const navContainer = document.querySelector('.pp-modal__nav');
const navButtons   = Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn'));

function setActiveNav(page) {
  navButtons.forEach(btn => {
    const isActive = btn.dataset.page === page;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });
}

navContainer?.addEventListener('click', (e) => {
  const btn = e.target.closest('.pp-navbtn');
  if (!btn) return;
  const page = btn.dataset.page;
  if (!page) return;
  history.pushState(null, '', `#${page}`);
  loadSitePage(page);
});

window.addEventListener('keydown', (e) => {
  if (modal?.getAttribute('aria-hidden') === 'true') return;
  if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;

  const current = navButtons.find(b => b.classList.contains('is-active'))?.dataset.page || pagesOrder[0];
  let idx = pagesOrder.indexOf(current);
  idx = e.key === 'ArrowRight' ? (idx + 1) % pagesOrder.length : (idx - 1 + pagesOrder.length) % pagesOrder.length;

  const page = pagesOrder[idx];
  history.pushState(null, '', `#${page}`);
  loadSitePage(page);
});

function renderIncludedDataTable(rows) {
  if (!rows || rows.length === 0) return '<p class="muted">No documents found.</p>';
  const body = rows.map(r => `
    <tr>
      <td>${(r.doc_name ?? '').toString().replace(/</g,'&lt;')}</td>
      <td>${(r.uploaded_by ?? '').toString().replace(/</g,'&lt;')}</td>
    </tr>
  `).join('');
  return `
    <table class="pp-table">
      <thead><tr><th>Bron</th><th>Data van</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

async function loadSitePage(page) {
  const lang = (navigator.language || 'en').toLowerCase();

  setActiveNav(page);
  setModalOpen(true);
  if (modalTitle) modalTitle.textContent = titles[page] || page;
  if (modalContent) modalContent.innerHTML = '<p class="muted">Loading…</p>';

  try {
    if (page === 'data') {
      const [contentRes, listRes] = await Promise.all([
        fetch(`/api/site-content?page=data&lang=${encodeURIComponent(lang)}`),
        fetch('/api/documents/list', { credentials: 'same-origin' })
      ]);
      const contentJson = await contentRes.json();
      const listJson = await listRes.json();
      if (!contentRes.ok || !contentJson?.ok) throw new Error(contentJson?.error || 'Failed to load page content');
      if (!listRes.ok || !listJson?.ok) throw new Error(listJson?.error || 'Failed to load document list');

      const introHTML = parseMarkdown(contentJson.content || '');
      const tableHTML = renderIncludedDataTable(listJson.items || []);
      modalContent.innerHTML = `<div class="pp-context-intro">${introHTML}</div>${tableHTML}`;
    } else {
      const r = await fetch(`/api/site-content?page=${encodeURIComponent(page)}&lang=${encodeURIComponent(lang)}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Failed to load ${page}`);
      modalContent.innerHTML = parseMarkdown(j.content || '');
    }
    document.querySelector('.pp-modal__nav .pp-navbtn.is-active')?.focus();
  } catch (err) {
    modalContent.innerHTML = `<p style="color:#b10000">${String(err.message || err)}</p>`;
  }
}

const linkAbout = document.querySelector('a[href="#about"]');
const linkHow   = document.querySelector('a[href="#how"]');
const linkData  = document.querySelector('a[href="#data"]');

linkAbout?.addEventListener('click', (e) => { e.preventDefault(); history.pushState(null,'','#about'); loadSitePage('about'); });
linkHow  ?.addEventListener('click',  (e) => { e.preventDefault(); history.pushState(null,'','#how');   loadSitePage('how');   });
linkData ?.addEventListener('click',  (e) => { e.preventDefault(); history.pushState(null,'','#data');  loadSitePage('data');  });

function routeFromHash() {
  const h = (location.hash || '').toLowerCase().replace('#','');
  if (['about','how','data'].includes(h)) loadSitePage(h);
}
window.addEventListener('popstate', routeFromHash);
routeFromHash();

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


// ──────────────────────────────────────────────────────────
/** Load example prompts (public read via backend → Supabase) */
// ──────────────────────────────────────────────────────────
async function loadAndRenderExamplePrompts() {
  const grid = document.getElementById('examples-grid');
  if (!grid) return;

  const preferNl = (navigator.language || '').toLowerCase().startsWith('nl');

  try {
    const res = await fetch('/api/example-prompts');
    const data = await res.json();
    if (!res.ok || !data?.ok || !Array.isArray(data.items)) throw new Error(data?.error || 'Invalid response');

    grid.innerHTML = data.items.map(row => {
      const title = preferNl
        ? row.prompt_title_nl || row.prompt_title_en || ''
        : row.prompt_title_en || row.prompt_title_nl || '';
      const full = preferNl
        ? row.prompt_full_nl || row.prompt_full_en || ''
        : row.prompt_full_en || row.prompt_full_nl || '';

      if (!full?.trim()) return '';

      const fullAttr = full
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return `
        <div class="example" data-prompt="${fullAttr}">
          <div class="example-title">${title || 'Example'}</div>
          <div class="example-text">${full}</div>
        </div>
      `;
    }).filter(Boolean).join('');

    const cards = grid.querySelectorAll('.example');
    attachExampleFillHandlers({
      exampleCards: cards,
      input,
      autoGrowTextarea: controller.autoGrowTextarea,
    });

    setupExamplesCarousel();
  } catch (err) {
    console.error('Could not load example prompts:', err);
    grid.innerHTML = `<div class="muted">Couldn’t load example prompts.</div>`;
    setupExamplesCarousel();
  }
}
await loadAndRenderExamplePrompts();

// ──────────────────────────────────────────────────────────
/** Mobile drawer */
// ──────────────────────────────────────────────────────────
(function setupMobileDrawer() {
  const drawer = document.getElementById('nav-drawer');
  const toggle = document.querySelector('.nav-toggle');
  if (!drawer || !toggle) return;

  const openDrawer = () => {
    drawer.classList.remove('hide');
    drawer.setAttribute('aria-modal', 'true');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
  };
  const closeDrawer = () => {
    drawer.classList.add('hide');
    drawer.setAttribute('aria-modal', 'false');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
  };
  const isOpen = () => !drawer.classList.contains('hide');
  const toggleDrawer = () => (isOpen() ? closeDrawer() : openDrawer());

  toggle.addEventListener('click', (e) => { e.preventDefault(); toggleDrawer(); });

  drawer.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) closeDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeDrawer();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 820 && isOpen()) closeDrawer();
  });

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const clickedInside = e.target.closest('#nav-drawer') || e.target.closest('.nav-toggle');
    if (!clickedInside) closeDrawer();
  });
})();

import { injectStraplineStyles } from '/js/strapline.js';
import { openExamples, closeExamples, attachExampleFillHandlers } from '/js/examples.js';
import { injectMarkdownStyles } from '/js/markdown.js';
import { createChatController } from '/js/chatFlow.js';

export async function initChatRuntime({ dom, config }) {
  const {
    chat,
    input,
    sendBtn,
    stopBtn,
    clearBtn,
    examplesContainer,
    closeExamplesBtn,
    examplesToggle,
    examplesGrid,
    examplesPrevBtn,
    examplesNextBtn,
    examplesDotsEl
  } = dom;

  const {
    STRAPLINE,
    DEFAULT_WELCOME_PROMPT,
    SUMMARY_PROMPT
  } = config;

  // ────────────────────────────────────────────────────────
  // Markdown parser
  // ────────────────────────────────────────────────────────
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

  // keep available for modules that rely on it
  const parseMarkdown = (md) => (markedRef ? markedRef.parse(md || '') : (md || ''));

  // optional global exposure if other modules need it later
  if (typeof window !== 'undefined') {
    window.__ppParseMarkdown = parseMarkdown;
  }

  // ────────────────────────────────────────────────────────
  // Styles
  // ────────────────────────────────────────────────────────
  injectMarkdownStyles();
  injectStraplineStyles({
    uppercase: STRAPLINE.uppercase,
    letterSpacing: STRAPLINE.letterSpacing,
    fontSize: STRAPLINE.fontSize,
    color: STRAPLINE.color
  });

  // ────────────────────────────────────────────────────────
  // Internal routing for the model
  // This is the state layer that decides whether the next
  // message uses retrieval or plain chat.
  // ────────────────────────────────────────────────────────
  const isExamplesOpen = () =>
    !!examplesContainer && !examplesContainer.classList.contains('hide');

  let retrievalArmed = false;

  const getUseRetrieval = () => isExamplesOpen() || retrievalArmed;

  const examples = {
    openExamples: () => openExamples(examplesContainer, examplesToggle),
    closeExamples: (opts) => closeExamples(examplesContainer, examplesToggle, opts)
  };

  if (examplesContainer) {
    examples.closeExamples({ animate: false, scroll: false });
  }

  if (examplesToggle && examplesContainer) {
    const open = !examplesContainer.classList.contains('hide');
    examplesToggle.classList.toggle('hide', open);
  }

  // ────────────────────────────────────────────────────────
  // Chat controller
  // ────────────────────────────────────────────────────────
  const controller = createChatController({
    dom: { chat, input, sendBtn, stopBtn, clearBtn },
    examples,
    config: { STRAPLINE, DEFAULT_WELCOME_PROMPT, SUMMARY_PROMPT },
    getUseRetrieval
  });

  const originalSendMessage = controller.sendMessage.bind(controller);
  controller.sendMessage = (...args) => {
    const wasArmed = retrievalArmed;
    const result = originalSendMessage(...args);
    if (wasArmed) retrievalArmed = false;
    return result;
  };

  attachExampleFillHandlers({
    container: examplesGrid,
    input,
    autoGrowTextarea: controller.autoGrowTextarea,
    closeExamplesFn: (opts) => examples.closeExamples(opts),
    onSelect: () => { retrievalArmed = true; }
  });

  if (sendBtn) sendBtn.addEventListener('click', controller.sendMessage);
  if (stopBtn) stopBtn.addEventListener('click', () => {});

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (chat) chat.innerHTML = '';
      controller.resetTextareaHeight();
      controller.clearConversationMemory?.();

      retrievalArmed = false;
      examples.closeExamples({ animate: true, scroll: true });

      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        controller.sendMessage();
      }
    });

    ['input', 'change', 'paste', 'cut', 'drop'].forEach((ev) => {
      input.addEventListener(ev, controller.autoGrowTextarea);
    });

    controller.autoGrowTextarea();
  }

  if (closeExamplesBtn) {
    closeExamplesBtn.addEventListener('click', () => {
      examples.closeExamples({ animate: true, scroll: true });
    });
  }

  if (examplesToggle) {
    examplesToggle.addEventListener('click', () => {
      examples.openExamples();
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  controller.setButtonsStreaming(false);
  if (chat && chat.children.length === 0) {
    controller.renderStaticAssistantMessage(DEFAULT_WELCOME_PROMPT, {
      straplineText: STRAPLINE.autoStartText
    });
  }

  await loadAndRenderExamplePrompts({
    examplesGrid,
    examplesPrevBtn,
    examplesNextBtn,
    examplesDotsEl
  });

  return {
    controller,
    getUseRetrieval
  };
}

// ──────────────────────────────────────────────────────────
// Example prompts
// ──────────────────────────────────────────────────────────
async function loadAndRenderExamplePrompts({
  examplesGrid,
  examplesPrevBtn,
  examplesNextBtn,
  examplesDotsEl
}) {
  if (!examplesGrid) return;

  const preferNl = (navigator.language || '').toLowerCase().startsWith('nl');

  try {
    const res = await fetch('/api/example-prompts');
    const data = await res.json();

    if (!res.ok || !data?.ok || !Array.isArray(data.items)) {
      throw new Error(data?.error || 'Invalid response');
    }

    examplesGrid.innerHTML = data.items.map((row) => {
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

    setupExamplesCarousel({
      grid: examplesGrid,
      prevBtn: examplesPrevBtn,
      nextBtn: examplesNextBtn,
      dotsEl: examplesDotsEl
    });
  } catch (err) {
    console.error('Could not load example prompts:', err);
    examplesGrid.innerHTML = `<div class="muted">Couldn’t load example prompts.</div>`;

    setupExamplesCarousel({
      grid: examplesGrid,
      prevBtn: examplesPrevBtn,
      nextBtn: examplesNextBtn,
      dotsEl: examplesDotsEl
    });
  }
}

// ──────────────────────────────────────────────────────────
// Carousel
// ──────────────────────────────────────────────────────────
function setupExamplesCarousel({ grid, prevBtn, nextBtn, dotsEl }) {
  if (!grid) return;

  const state = (grid._carouselState ||= {
    index: 0,
    perPage: 2,
    realPages: 1,
    isJumping: false
  });

  const getPerPage = () => (window.matchMedia('(max-width: 640px)').matches ? 1 : 2);
  const safeClamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const getRealCards = () => Array.from(grid.querySelectorAll('.example:not([data-clone="1"])'));

  const removeClones = () => {
    grid.querySelectorAll('.example[data-clone="1"]').forEach((el) => el.remove());
  };

  const buildClones = () => {
    removeClones();

    const realCards = getRealCards();
    const per = state.perPage;
    if (realCards.length <= per) return;

    const head = realCards.slice(0, per);
    const tail = realCards.slice(-per);

    tail.forEach((card) => {
      const c = card.cloneNode(true);
      c.setAttribute('data-clone', '1');
      grid.insertBefore(c, grid.firstChild);
    });

    head.forEach((card) => {
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

  const scrollToRealIndex = (realIndex, behavior = 'smooth') => {
    const x = (realIndex + 1) * pageWidth();
    state.isJumping = (behavior === 'auto');
    grid.scrollTo({ left: x, behavior });

    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        state.isJumping = false;
      });
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
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
  };

  const updateUI = () => {
    updateButtons();
    updateDots();
  };

  const normalizeIfOnClonePage = () => {
    const w = pageWidth();
    const domPage = Math.round(grid.scrollLeft / w);

    if (domPage === 0) {
      state.index = state.realPages - 1;
      scrollToRealIndex(state.index, 'auto');
      updateUI();
      return;
    }

    if (domPage === state.realPages + 1) {
      state.index = 0;
      scrollToRealIndex(state.index, 'auto');
      updateUI();
      return;
    }

    const realIndex = safeClamp(domPage - 1, 0, state.realPages - 1);
    if (realIndex !== state.index) {
      state.index = realIndex;
      updateUI();
    }
  };

  const recompute = () => {
    state.perPage = getPerPage();
    computeRealPages();
    buildClones();
    computeRealPages();
    buildDots();
    updateUI();
    scrollToRealIndex(state.index, 'auto');
  };

  const go = (dir) => {
    const next = (state.index + dir + state.realPages) % state.realPages;
    state.index = next;
    scrollToRealIndex(state.index, 'smooth');
    updateUI();
  };

  if (!grid._carouselBound) {
    grid._carouselBound = true;

    if (prevBtn) prevBtn.addEventListener('click', () => go(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => go(+1));

    let t;
    grid.addEventListener('scroll', () => {
      if (state.isJumping) return;
      clearTimeout(t);
      t = setTimeout(() => normalizeIfOnClonePage(), 80);
    });

    window.addEventListener('resize', () => recompute());
  }

  recompute();
}
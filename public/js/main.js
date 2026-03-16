// main.js
// ------------------------------------------------------------
// Main frontend entry for the analysis-first Policy Pilot flow.
//
// What this version does:
// - enforces auth
// - loads project prompts/settings
// - initializes the site/context router
// - opens/closes the analysis modal
// - runs the first analysis as a real RAG request via /chat
// - streams the response into the analysis report
// - hides the intro action row after first analysis
// - places the follow-up chat area INSIDE the analysis box
// - keeps follow-up chat as placeholder for now
// ------------------------------------------------------------

import { enforceRole } from '/js/auth_guard.js';
import { initSiteRouter } from '/js/siteRouter.js';

await enforceRole({ requiredRole: null });

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
const STRAPLINE = {
  enabled: true,
  iconUrl: '/images/brand/chat_icon.png',
  defaultText: 'POLICY PILOT',
  autoStartText: 'INTRODUCTIE',
  uppercase: true,
  letterSpacing: '0.25em',
  fontSize: '12px',
  color: '#8B6A2B'
};

let DEFAULT_WELCOME_PROMPT = `
Policy Pilot Tech Sector is een analysetool om snel inzicht te krijgen in wat er speelt
in de politiek en het publiek m.b.t technologie.
`.trim();

let SUMMARY_PROMPT = '';

async function loadProjectPromptsFromServer() {
  try {
    const res = await fetch('/api/project-settings', { credentials: 'same-origin' });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to fetch settings');
    }

    const intro = data.settings?.introduction_prompt;
    if (intro && intro.trim()) DEFAULT_WELCOME_PROMPT = intro.trim();

    const summary = data.settings?.summary_prompt;
    if (summary && summary.trim()) SUMMARY_PROMPT = summary.trim();
  } catch (err) {
    console.warn('Project prompt fallback used:', err?.message || err);
  }
}

await loadProjectPromptsFromServer();

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------
const dom = {
  modal: document.getElementById('content-modal'),
  modalTitle: document.getElementById('pp-modal-title'),
  modalContent: document.getElementById('pp-modal-content'),
  navContainer: document.querySelector('.pp-modal__nav'),
  navButtons: Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn')),
  linkAbout: document.querySelector('a[href="#about"]'),
  linkHow: document.querySelector('a[href="#how"]'),
  linkData: document.querySelector('a[href="#data"]'),

  introHero: document.getElementById('intro-hero'),
  introActions: document.querySelector('.intro-actions'),

  analysisModal: document.getElementById('analysis-modal'),
  analysisInput: document.getElementById('analysis-input'),
  analysisSend: document.getElementById('analysis-send'),
  openAnalysisModalBtn: document.getElementById('open-analysis-modal'),
  closeAnalysisModalBtn: document.getElementById('close-analysis-modal'),

  analysisFrame: document.getElementById('analysis-frame'),
  analysisRequestPill: document.getElementById('analysis-request-pill'),
  analysisStatus: document.getElementById('analysis-status'),
  analysisStatusText: document.getElementById('analysis-status-text'),
  analysisReport: document.getElementById('analysis-report'),
  analysisReportBody: document.getElementById('analysis-report-body'),
  analysisSources: document.getElementById('analysis-sources'),
  summaryBtn: document.getElementById('summary-btn'),

  chatModal: document.getElementById('chat-modal'),
  closeChatModalBtn: document.getElementById('close-chat-modal'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  analysisFollowupThread: document.getElementById('analysis-followup-thread'),

  newAnalysisSection: document.getElementById('new-analysis-section'),
  startNewAnalysisBottomBtn: document.getElementById('start-new-analysis-bottom'),

  newAnalysisNavBtn: document.getElementById('new-analysis-nav'),
  newAnalysisDrawerBtn: document.getElementById('new-analysis-drawer'),

  analysisExamplesModal: document.getElementById('analysis-examples-modal'),
  analysisExamplesList: document.getElementById('analysis-examples-list'),
  openAnalysisExamplesBtn: document.getElementById('open-analysis-examples'),
  closeAnalysisExamplesBtn: document.getElementById('close-analysis-examples'),

  chatExamplesModal: document.getElementById('chat-examples-modal'),
  chatExamplesList: document.getElementById('chat-examples-list'),
  openChatExamplesBtn: document.getElementById('open-chat-examples'),
  closeChatExamplesBtn: document.getElementById('close-chat-examples'),

  confirmModal: document.getElementById('confirm-modal'),
  modalCancelBtn: document.getElementById('modal-cancel'),
  clearBtn: document.getElementById('clear')
};

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
const appState = {
  phase: 'idle',
  activeAnalysisPrompt: '',
  activeAnalysisContent: '',
  activeAnalysisSources: [],
  followupHistory: [],
  analysisAbortController: null
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function show(el) {
  if (el) el.classList.remove('hide');
}

function hide(el) {
  if (el) el.classList.add('hide');
}

function setHtml(el, html) {
  if (el) el.innerHTML = html;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function autoGrowTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const newHeight = Math.min(textarea.scrollHeight, 220);
  textarea.style.height = `${newHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > 220 ? 'auto' : 'hidden';
}

function resetTextarea(textarea) {
  if (!textarea) return;
  textarea.value = '';
  textarea.style.height = '56px';
  textarea.style.overflowY = 'hidden';
}

function scrollIntoViewCentered(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  });
}

function parseMarkdown(md) {
  if (window.marked?.parse) {
    return window.marked.parse(md || '');
  }
  return escapeHtml(md || '').replace(/\n/g, '<br>');
}

function setAnalysisSendLoading(isLoading) {
  if (!dom.analysisSend) return;

  dom.analysisSend.disabled = isLoading;

  if (isLoading) {
    dom.analysisSend.dataset.loading = '1';
    dom.analysisInput?.setAttribute('aria-busy', 'true');
    if (dom.analysisInput) dom.analysisInput.disabled = true;
  } else {
    delete dom.analysisSend.dataset.loading;
    dom.analysisInput?.removeAttribute('aria-busy');
    if (dom.analysisInput) dom.analysisInput.disabled = false;
  }
}

function closeDrawerIfOpen() {
  window.__closePolicyPilotDrawer?.();
}

function hideIntroActions() {
  hide(dom.introActions);
}

function showIntroActions() {
  show(dom.introActions);
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------
initSiteRouter({
  modal: dom.modal,
  modalTitle: dom.modalTitle,
  modalContent: dom.modalContent,
  navContainer: dom.navContainer,
  navButtons: dom.navButtons,
  linkAbout: dom.linkAbout,
  linkHow: dom.linkHow,
  linkData: dom.linkData
});

// ------------------------------------------------------------
// Mobile drawer
// ------------------------------------------------------------
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

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    toggleDrawer();
  });

  drawer.addEventListener('click', (e) => {
    const clickedLink = e.target.closest('a, button');
    if (clickedLink) closeDrawer();
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

  window.__closePolicyPilotDrawer = closeDrawer;
})();

// ------------------------------------------------------------
// Temporary example cards
// Later: load from Supabase by example type
// ------------------------------------------------------------
const analysisExampleQuestions = [
  {
    title: 'Trust',
    text: 'Hoe verandert het vertrouwen in overheid en technologie sinds 2024?'
  },
  {
    title: 'Positionings',
    text: 'Wat zijn de belangrijkste politieke standpunten over online veiligheid en privacy?'
  },
  {
    title: 'Tech sector',
    text: 'Welke technologische thema’s spelen op dit moment het sterkst in de politiek?'
  }
];

const chatExampleQuestions = [
  {
    title: 'Samenvatting',
    text: 'Vat deze analyse samen in drie concrete punten.'
  },
  {
    title: 'Relevantie',
    text: 'Wat betekent deze analyse voor een techbedrijf in Nederland?'
  },
  {
    title: 'Nuancering',
    text: 'Welke punten in deze analyse verdienen extra nuance of verdieping?'
  }
];

function renderExampleCards(container, items, onSelect) {
  if (!container) return;

  container.innerHTML = items.map((item, index) => `
    <button
      type="button"
      class="example"
      data-index="${index}"
      data-prompt="${escapeHtml(item.text)}"
    >
      <div class="example-title">${escapeHtml(item.title)}</div>
      <div class="example-text">${escapeHtml(item.text)}</div>
    </button>
  `).join('');

  container.querySelectorAll('.example').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt') || '';
      onSelect?.(prompt);
    });
  });
}

renderExampleCards(dom.analysisExamplesList, analysisExampleQuestions, (prompt) => {
  if (dom.analysisInput) {
    dom.analysisInput.value = prompt;
    autoGrowTextarea(dom.analysisInput);
    dom.analysisInput.focus();
  }
  closeAnalysisExamplesModal();
});

renderExampleCards(dom.chatExamplesList, chatExampleQuestions, (prompt) => {
  if (dom.chatInput) {
    dom.chatInput.value = prompt;
    autoGrowTextarea(dom.chatInput);
    dom.chatInput.focus();
  }
  closeChatExamplesModal();
});

// ------------------------------------------------------------
// Modal state
// ------------------------------------------------------------
function openAnalysisModal({ reset = false } = {}) {
  if (reset) {
    resetTextarea(dom.analysisInput);
  }

  show(dom.analysisModal);

  appState.phase = 'analysis-modal-open';

  scrollIntoViewCentered(dom.analysisModal);

  requestAnimationFrame(() => {
    dom.analysisInput?.focus();
  });
}

function closeAnalysisModal() {
  hide(dom.analysisModal);

  if (appState.phase === 'analysis-modal-open') {
    appState.phase = appState.activeAnalysisContent ? 'analysis-loaded' : 'idle';
  }
}

function revealAnalysisFrame() {
  show(dom.analysisFrame);
  show(dom.newAnalysisSection);
}

function hideAnalysisFrame() {
  hide(dom.analysisFrame);
  hide(dom.newAnalysisSection);
}

function openChatModal() {
  show(dom.chatModal);
}

function closeChatModal() {
  hide(dom.chatModal);
}

// ------------------------------------------------------------
// Reset flow
// ------------------------------------------------------------
function openConfirmModal() {
  show(dom.confirmModal);
}

function closeConfirmModal() {
  hide(dom.confirmModal);
}

function hardResetAnalysisState() {
  try {
    appState.analysisAbortController?.abort();
  } catch {}

  appState.phase = 'idle';
  appState.activeAnalysisPrompt = '';
  appState.activeAnalysisContent = '';
  appState.activeAnalysisSources = [];
  appState.followupHistory = [];
  appState.analysisAbortController = null;

  showIntroActions();

  resetTextarea(dom.analysisInput);
  resetTextarea(dom.chatInput);

  hide(dom.analysisModal);
  hide(dom.analysisFrame);
  hide(dom.chatModal);
  hide(dom.newAnalysisSection);
  hide(dom.summaryBtn);

  if (dom.analysisRequestPill) {
    dom.analysisRequestPill.textContent = '';
    hide(dom.analysisRequestPill);
  }

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = '';
  }
  hide(dom.analysisStatus);

  setHtml(dom.analysisReportBody, '');
  setHtml(dom.analysisSources, '');
  setHtml(dom.analysisFollowupThread, '');

  closeAnalysisExamplesModal();
  closeChatExamplesModal();
  closeConfirmModal();
  setAnalysisSendLoading(false);

  requestAnimationFrame(() => {
    dom.introHero?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });
}

// ------------------------------------------------------------
// Analysis rendering
// ------------------------------------------------------------
function renderAnalysisLoadingState(prompt) {
  revealAnalysisFrame();

  if (dom.analysisRequestPill) {
    dom.analysisRequestPill.textContent = prompt;
    show(dom.analysisRequestPill);
  }

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Bezig met bronanalyse in politieke data en trustdata...';
  }
  show(dom.analysisStatus);

  setHtml(dom.analysisReportBody, `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>
    <h2>Analyse wordt gegenereerd...</h2>
    <p>Even wachten. Policy Pilot zoekt relevante documentfragmenten en bouwt nu een analyse op.</p>
  `);

  setHtml(dom.analysisSources, '');
  hide(dom.summaryBtn);
  hide(dom.chatModal);
}

function renderAnalysisStreamingStart() {
  setHtml(dom.analysisReportBody, `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>
    <div id="analysis-stream-content"></div>
  `);
}

function updateAnalysisStream(markdownText) {
  const streamEl = document.getElementById('analysis-stream-content');
  if (!streamEl) return;
  streamEl.innerHTML = parseMarkdown(markdownText);
}

function renderAnalysisSources(sources) {
  if (!dom.analysisSources || !Array.isArray(sources) || !sources.length) {
    setHtml(dom.analysisSources, '');
    return;
  }

  setHtml(dom.analysisSources, `
    <h3>Bronnen</h3>
    <ul class="analysis-sources__list">
      ${sources.map((src) => `
        <li class="analysis-sources__item">
          <span class="analysis-sources__n">[#${escapeHtml(src.n)}]</span>
          <span class="analysis-sources__title">${escapeHtml(src.title || 'Bron')}</span>
        </li>
      `).join('')}
    </ul>
  `);
}

function renderAnalysisDone(finalMarkdown, sources) {
  appState.activeAnalysisContent = finalMarkdown;
  appState.activeAnalysisSources = sources || [];
  appState.phase = 'analysis-loaded';

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Analyse voltooid. Je kunt nu verder vragen op basis van dit rapport.';
  }
  show(dom.analysisStatus);

  updateAnalysisStream(finalMarkdown);
  renderAnalysisSources(sources);

  show(dom.summaryBtn);
  openChatModal();
  show(dom.newAnalysisSection);

  setHtml(dom.analysisFollowupThread, '');
  scrollIntoViewCentered(dom.analysisFrame);
}

function renderAnalysisError(message) {
  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'De analyse kon niet worden voltooid.';
  }
  show(dom.analysisStatus);

  setHtml(dom.analysisReportBody, `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>
    <h2>Er ging iets mis</h2>
    <p>${escapeHtml(message || 'Onbekende fout')}</p>
  `);

  setHtml(dom.analysisSources, '');
  hide(dom.summaryBtn);
  hide(dom.chatModal);
}

// ------------------------------------------------------------
// Real RAG analysis request
// ------------------------------------------------------------
async function submitAnalysisRequest() {
  const prompt = (dom.analysisInput?.value || '').trim();
  if (!prompt) return;
  if (appState.analysisAbortController) return;

  appState.activeAnalysisPrompt = prompt;
  appState.activeAnalysisContent = '';
  appState.activeAnalysisSources = [];
  appState.followupHistory = [];
  appState.phase = 'analysis-loading';

  hideIntroActions();
  closeAnalysisModal();
  renderAnalysisLoadingState(prompt);
  setAnalysisSendLoading(true);

  const controller = new AbortController();
  appState.analysisAbortController = controller;

  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        useRetrieval: true,
        history: []
      }),
      signal: controller.signal
    });

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => '');
      throw new Error(txt || 'Failed to connect to /chat');
    }

    renderAnalysisStreamingStart();

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let sources = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload) continue;

        try {
          const evt = JSON.parse(payload);

          if (evt.type === 'token') {
            fullText += evt.text || '';
            updateAnalysisStream(fullText);
          } else if (evt.type === 'sources') {
            sources = Array.isArray(evt.items) ? evt.items : [];
          } else if (evt.type === 'error') {
            throw new Error(evt.message || 'Unknown analysis error');
          } else if (evt.type === 'done') {
            renderAnalysisDone(fullText, sources);
            return;
          }
        } catch (err) {
          if (err instanceof Error) throw err;
        }
      }
    }

    renderAnalysisDone(fullText, sources);
  } catch (err) {
    if (controller.signal.aborted) {
      renderAnalysisError('De analyse is afgebroken.');
    } else {
      renderAnalysisError(err?.message || 'Server error tijdens analyse.');
    }
  } finally {
    appState.analysisAbortController = null;
    setAnalysisSendLoading(false);
  }
}

// ------------------------------------------------------------
// Placeholder follow-up chat
// Next step: use analysis content as context
// ------------------------------------------------------------
function appendFollowupMessage(role, html) {
  if (!dom.analysisFollowupThread) return null;

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = html;
  dom.analysisFollowupThread.appendChild(div);
  dom.analysisFollowupThread.scrollTop = dom.analysisFollowupThread.scrollHeight;
  return div;
}

async function submitFollowupQuestion() {
  const prompt = (dom.chatInput?.value || '').trim();
  if (!prompt || !appState.activeAnalysisContent) return;

  appendFollowupMessage('user', `<p>${escapeHtml(prompt)}</p>`);
  resetTextarea(dom.chatInput);

  appState.followupHistory.push({
    role: 'user',
    content: prompt
  });

  appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Policy Pilot</span>
      </div>
      <p>
        De hoofd-analyse werkt nu live gekoppeld aan RAG. De vervolgvraag-flow koppelen we hierna aan dit rapport als primaire context.
      </p>
    `
  );
}

// ------------------------------------------------------------
// Example modals
// ------------------------------------------------------------
function openAnalysisExamplesModal() {
  show(dom.analysisExamplesModal);
}

function closeAnalysisExamplesModal() {
  hide(dom.analysisExamplesModal);
}

function openChatExamplesModal() {
  show(dom.chatExamplesModal);
}

function closeChatExamplesModal() {
  hide(dom.chatExamplesModal);
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
dom.openAnalysisModalBtn?.addEventListener('click', () => {
  openAnalysisModal({ reset: false });
});

dom.newAnalysisNavBtn?.addEventListener('click', () => {
  openConfirmModal();
});

dom.newAnalysisDrawerBtn?.addEventListener('click', () => {
  closeDrawerIfOpen();
  openConfirmModal();
});

dom.startNewAnalysisBottomBtn?.addEventListener('click', () => {
  openConfirmModal();
});

dom.closeAnalysisModalBtn?.addEventListener('click', () => {
  closeAnalysisModal();
});

dom.analysisSend?.addEventListener('click', submitAnalysisRequest);

dom.analysisInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAnalysisRequest();
  }
});

['input', 'change', 'paste', 'cut', 'drop'].forEach((ev) => {
  dom.analysisInput?.addEventListener(ev, () => autoGrowTextarea(dom.analysisInput));
  dom.chatInput?.addEventListener(ev, () => autoGrowTextarea(dom.chatInput));
});

dom.chatSend?.addEventListener('click', submitFollowupQuestion);

dom.chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitFollowupQuestion();
  }
});

dom.closeChatModalBtn?.addEventListener('click', () => {
  closeChatModal();
});

dom.summaryBtn?.addEventListener('click', () => {
  appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Samenvatting</span>
      </div>
      <p>
        De analyse zelf is nu live gekoppeld. De samenvattingsknop koppelen we in de volgende stap aan de echte analyse-output.
      </p>
    `
  );
});

dom.openAnalysisExamplesBtn?.addEventListener('click', () => {
  openAnalysisExamplesModal();
});

dom.closeAnalysisExamplesBtn?.addEventListener('click', () => {
  closeAnalysisExamplesModal();
});

dom.analysisExamplesModal?.querySelector('[data-close-analysis-examples]')?.addEventListener('click', () => {
  closeAnalysisExamplesModal();
});

dom.openChatExamplesBtn?.addEventListener('click', () => {
  openChatExamplesModal();
});

dom.closeChatExamplesBtn?.addEventListener('click', () => {
  closeChatExamplesModal();
});

dom.chatExamplesModal?.querySelector('[data-close-chat-examples]')?.addEventListener('click', () => {
  closeChatExamplesModal();
});

dom.modalCancelBtn?.addEventListener('click', () => {
  closeConfirmModal();
});

dom.clearBtn?.addEventListener('click', () => {
  hardResetAnalysisState();
  openAnalysisModal({ reset: true });
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  if (dom.confirmModal && !dom.confirmModal.classList.contains('hide')) {
    closeConfirmModal();
    return;
  }

  if (dom.analysisExamplesModal && !dom.analysisExamplesModal.classList.contains('hide')) {
    closeAnalysisExamplesModal();
    return;
  }

  if (dom.chatExamplesModal && !dom.chatExamplesModal.classList.contains('hide')) {
    closeChatExamplesModal();
    return;
  }

  if (dom.analysisModal && !dom.analysisModal.classList.contains('hide')) {
    closeAnalysisModal();
    return;
  }
});

// ------------------------------------------------------------
// Initial state
// ------------------------------------------------------------
hide(dom.analysisModal);
hideAnalysisFrame();
hide(dom.chatModal);
hide(dom.newAnalysisSection);
hide(dom.summaryBtn);
closeConfirmModal();
closeAnalysisExamplesModal();
closeChatExamplesModal();

resetTextarea(dom.analysisInput);
resetTextarea(dom.chatInput);
showIntroActions();
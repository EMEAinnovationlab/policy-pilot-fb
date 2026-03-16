// main.js
// ------------------------------------------------------------
// This file is the main entry point of the frontend.
//
// What it does:
// - enforces auth
// - loads project prompts/settings
// - initializes the context page router
// - controls the new analysis UI flow
// - opens/closes the analysis modal
// - reveals the analysis frame after submit
// - reveals the follow-up chat modal inside the analysis frame
// - controls example-question modals
// - controls reset / "begin opnieuw" flow
//
// Important:
// This version is the transition step from chatbot-first
// to analysis-tool-first.
// It focuses on UI states first, before reconnecting the
// full streaming chat logic.
// ------------------------------------------------------------

import { enforceRole } from '/js/auth_guard.js';
import { initSiteRouter } from '/js/siteRouter.js';

// Require logged-in user
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
    if (intro && intro.trim()) {
      DEFAULT_WELCOME_PROMPT = intro.trim();
    }

    const summary = data.settings?.summary_prompt;
    if (summary && summary.trim()) {
      SUMMARY_PROMPT = summary.trim();
    }
  } catch (err) {
    console.warn('Project prompt fallback used:', err?.message || err);
  }
}

await loadProjectPromptsFromServer();

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------
const dom = {
  // Main contextual modal
  modal: document.getElementById('content-modal'),
  modalTitle: document.getElementById('pp-modal-title'),
  modalContent: document.getElementById('pp-modal-content'),
  navContainer: document.querySelector('.pp-modal__nav'),
  navButtons: Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn')),
  linkAbout: document.querySelector('a[href="#about"]'),
  linkHow: document.querySelector('a[href="#how"]'),
  linkData: document.querySelector('a[href="#data"]'),

  // Intro / landing
  introHero: document.getElementById('intro-hero'),

  // Analysis launcher
  analysisModal: document.getElementById('analysis-modal'),
  analysisInput: document.getElementById('analysis-input'),
  analysisSend: document.getElementById('analysis-send'),
  openAnalysisModalBtn: document.getElementById('open-analysis-modal'),
  closeAnalysisModalBtn: document.getElementById('close-analysis-modal'),

  // Analysis artifact
  analysisFrame: document.getElementById('analysis-frame'),
  analysisRequestPill: document.getElementById('analysis-request-pill'),
  analysisStatus: document.getElementById('analysis-status'),
  analysisStatusText: document.getElementById('analysis-status-text'),
  analysisReport: document.getElementById('analysis-report'),
  summaryBtn: document.getElementById('summary-btn'),

  // Follow-up chat inside analysis
  chatModal: document.getElementById('chat-modal'),
  closeChatModalBtn: document.getElementById('close-chat-modal'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  analysisFollowupThread: document.getElementById('analysis-followup-thread'),

  // New analysis CTA after report
  newAnalysisSection: document.getElementById('new-analysis-section'),
  startNewAnalysisBottomBtn: document.getElementById('start-new-analysis-bottom'),

  // Header / drawer buttons
  newAnalysisNavBtn: document.getElementById('new-analysis-nav'),
  newAnalysisDrawerBtn: document.getElementById('new-analysis-drawer'),

  // Analysis examples modal
  analysisExamplesModal: document.getElementById('analysis-examples-modal'),
  analysisExamplesList: document.getElementById('analysis-examples-list'),
  openAnalysisExamplesBtn: document.getElementById('open-analysis-examples'),
  closeAnalysisExamplesBtn: document.getElementById('close-analysis-examples'),

  // Chat examples modal
  chatExamplesModal: document.getElementById('chat-examples-modal'),
  chatExamplesList: document.getElementById('chat-examples-list'),
  openChatExamplesBtn: document.getElementById('open-chat-examples'),
  closeChatExamplesBtn: document.getElementById('close-chat-examples'),

  // Confirm reset modal
  confirmModal: document.getElementById('confirm-modal'),
  modalCancelBtn: document.getElementById('modal-cancel'),
  clearBtn: document.getElementById('clear')
};

// ------------------------------------------------------------
// App state
// ------------------------------------------------------------
const appState = {
  phase: 'idle', // idle | analysis-modal-open | analysis-loading | analysis-loaded
  activeAnalysisPrompt: '',
  activeAnalysisContent: '',
  followupHistory: []
};

// Make config available for future modules if needed
window.__policyPilotConfig = {
  STRAPLINE,
  DEFAULT_WELCOME_PROMPT,
  SUMMARY_PROMPT
};

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function show(el) {
  if (!el) return;
  el.classList.remove('hide');
}

function hide(el) {
  if (!el) return;
  el.classList.add('hide');
}

function setHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
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

// ------------------------------------------------------------
// Site/context modal router
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
// Example cards
// For now these are temporary placeholders.
// Later we will load them from Supabase by type:
// - analysis_modal
// - chat_modal
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
// Analysis modal state
// ------------------------------------------------------------
function openAnalysisModal({ reset = false } = {}) {
  if (reset) {
    resetTextarea(dom.analysisInput);
  }

  show(dom.analysisModal);
  hide(dom.chatModal);

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
// Reset / restart flow
// ------------------------------------------------------------
function openConfirmModal() {
  show(dom.confirmModal);
}

function closeConfirmModal() {
  hide(dom.confirmModal);
}

function hardResetAnalysisState() {
  appState.phase = 'idle';
  appState.activeAnalysisPrompt = '';
  appState.activeAnalysisContent = '';
  appState.followupHistory = [];

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

  setHtml(dom.analysisReport, '');
  setHtml(dom.analysisFollowupThread, '');

  closeAnalysisExamplesModal();
  closeChatExamplesModal();
  closeConfirmModal();

  requestAnimationFrame(() => {
    dom.introHero?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });
}

// ------------------------------------------------------------
// Temporary analysis rendering
// This is the step before reconnecting the full backend flow.
// ------------------------------------------------------------
function renderAnalysisShell({ prompt }) {
  appState.activeAnalysisPrompt = prompt;
  appState.phase = 'analysis-loading';

  revealAnalysisFrame();

  if (dom.analysisRequestPill) {
    dom.analysisRequestPill.textContent = prompt;
    show(dom.analysisRequestPill);
  }

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Er wordt een nieuwe analyse voorbereid.';
  }
  show(dom.analysisStatus);

  setHtml(dom.analysisReport, `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>

    <h2>Analyse wordt geladen...</h2>
    <p>
      Dit is tijdelijk een placeholder-staat. In de volgende stap koppelen we dit
      weer aan de echte RAG-analyse.
    </p>
  `);

  hide(dom.summaryBtn);
  hide(dom.chatModal);
}

function renderLoadedAnalysis({ prompt }) {
  const safePrompt = escapeHtml(prompt);

  const placeholderHtml = `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>

    <h2>Analyse op basis van jouw vraag</h2>

    <p>
      Hieronder zie je tijdelijk een statische analyse-box. In de volgende stap
      verbinden we deze met de echte backend-response, zodat de analyse live in
      dit frame wordt geladen.
    </p>

    <p><strong>Vraag:</strong> ${safePrompt}</p>

    <p>
      Deze box wordt de hoofdcontext van de verdere interactie. Vervolgvragen zullen
      later niet meer als algemene chatbot-flow werken, maar als vragen die
      expliciet gebaseerd zijn op deze analyse.
    </p>
  `;

  appState.activeAnalysisContent = placeholderHtml;
  appState.phase = 'analysis-loaded';

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Er is relevante informatie gevonden voor deze analyse.';
  }
  show(dom.analysisStatus);

  setHtml(dom.analysisReport, placeholderHtml);
  show(dom.summaryBtn);
  openChatModal();
  show(dom.newAnalysisSection);

  setHtml(dom.analysisFollowupThread, '');
  scrollIntoViewCentered(dom.analysisFrame);
}

async function submitAnalysisRequest() {
  const prompt = (dom.analysisInput?.value || '').trim();
  if (!prompt) return;

  closeAnalysisModal();
  renderAnalysisShell({ prompt });

  // Temporary fake loading step.
  // Later this will call the real /chat endpoint in analysis mode.
  await new Promise((resolve) => setTimeout(resolve, 450));

  renderLoadedAnalysis({ prompt });
}

// ------------------------------------------------------------
// Follow-up chat rendering
// For now this is local placeholder behavior.
// Later this will use analysisContext + followup history.
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

  await new Promise((resolve) => setTimeout(resolve, 220));

  appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Policy Pilot</span>
      </div>
      <p>
        Dit is tijdelijk een placeholder-antwoord binnen de <strong>chat-modal</strong>.
        In de volgende stap koppelen we deze vervolgvraag aan de actieve analyse als context,
        zodat de gebruiker echt “in gesprek met het rapport” is.
      </p>
    `
  );

  appState.followupHistory.push({
    role: 'assistant',
    content: 'Temporary placeholder follow-up answer.'
  });

  scrollIntoViewCentered(dom.chatModal);
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

// Open analysis entry
dom.openAnalysisModalBtn?.addEventListener('click', () => {
  openAnalysisModal({ reset: false });
});

dom.newAnalysisNavBtn?.addEventListener('click', () => {
  openConfirmModal();
});

dom.newAnalysisDrawerBtn?.addEventListener('click', () => {
  window.__closePolicyPilotDrawer?.();
  openConfirmModal();
});

dom.startNewAnalysisBottomBtn?.addEventListener('click', () => {
  openConfirmModal();
});

// Close analysis launcher
dom.closeAnalysisModalBtn?.addEventListener('click', () => {
  closeAnalysisModal();
});

// Submit new analysis
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

// Follow-up chat
dom.chatSend?.addEventListener('click', submitFollowupQuestion);

dom.chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitFollowupQuestion();
  }
});

// Close follow-up modal
dom.closeChatModalBtn?.addEventListener('click', () => {
  closeChatModal();
});

// Summary placeholder
dom.summaryBtn?.addEventListener('click', async () => {
  if (!SUMMARY_PROMPT) {
    appendFollowupMessage(
      'assistant',
      `<p>Er is nog geen summary prompt ingesteld in de project settings.</p>`
    );
    return;
  }

  appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Samenvatting</span>
      </div>
      <p>
        De samenvattingsfunctie is structureel voorbereid. In de volgende stap
        koppelen we deze knop aan de echte analyse-output en backend-flow.
      </p>
    `
  );
});

// Analysis examples
dom.openAnalysisExamplesBtn?.addEventListener('click', () => {
  openAnalysisExamplesModal();
});

dom.closeAnalysisExamplesBtn?.addEventListener('click', () => {
  closeAnalysisExamplesModal();
});

dom.analysisExamplesModal?.querySelector('[data-close-analysis-examples]')?.addEventListener('click', () => {
  closeAnalysisExamplesModal();
});

// Chat examples
dom.openChatExamplesBtn?.addEventListener('click', () => {
  openChatExamplesModal();
});

dom.closeChatExamplesBtn?.addEventListener('click', () => {
  closeChatExamplesModal();
});

dom.chatExamplesModal?.querySelector('[data-close-chat-examples]')?.addEventListener('click', () => {
  closeChatExamplesModal();
});

// Confirm modal
dom.modalCancelBtn?.addEventListener('click', () => {
  closeConfirmModal();
});

dom.clearBtn?.addEventListener('click', () => {
  hardResetAnalysisState();
  openAnalysisModal({ reset: true });
});

// Escape handling
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
// Initial UI state
// ------------------------------------------------------------
hide(dom.analysisModal);
hide(dom.analysisFrame);
hide(dom.chatModal);
hide(dom.newAnalysisSection);
hide(dom.summaryBtn);
closeConfirmModal();
closeAnalysisExamplesModal();
closeChatExamplesModal();

resetTextarea(dom.analysisInput);
resetTextarea(dom.chatInput);
// main.js
// ------------------------------------------------------------
// Policy Pilot main controller
//
// Keeps:
// - auth gate
// - site/context modal routing
// - mobile drawer
// - confirm reset modal
// - analysis-first RAG flow
// - 5-minute browser session restore
// - chat-with-analysis inside the analysis box
//
// Updated:
// - intro action buttons disappear when the analysis modal opens
// - if the user closes the analysis modal without an active analysis,
//   the intro action buttons come back
// - intro action buttons no longer reappear after pressing send
//   while an analysis is loading or already active
// - follow-up chat now works against the generated report
// - summary button now generates a real summary based on the report
// - when a new message/block appears, the UI scrolls to the start
//   of that new block to guide reading from the top
// - scroll-to-bottom button only appears after an analysis is loaded
// - scroll-to-bottom button fades in only while the user is scrolling
// - scroll-to-bottom button fades away shortly after scrolling stops
// - intro hero and intro buttons now animate in softly as if generated
// ------------------------------------------------------------

import { enforceRole } from '/js/auth_guard.js';
import { initSiteRouter } from '/js/siteRouter.js';
import {
  saveAnalysisSession,
  loadAnalysisSession,
  clearAnalysisSession
} from '/js/analysisSession.js';

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

let SUMMARY_PROMPT = '';

async function loadProjectPromptsFromServer() {
  try {
    const res = await fetch('/api/project-settings', { credentials: 'same-origin' });
    const data = await res.json();

    if (!res.ok || !data?.ok) return;

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
  // Context modal
  modal: document.getElementById('content-modal'),
  modalTitle: document.getElementById('pp-modal-title'),
  modalContent: document.getElementById('pp-modal-content'),
  navContainer: document.querySelector('.pp-modal__nav'),
  navButtons: Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn')),
  linkAbout: document.querySelector('a[href="#about"]'),
  linkHow: document.querySelector('a[href="#how"]'),
  linkData: document.querySelector('a[href="#data"]'),

  // Header / drawer
  navDrawer: document.getElementById('nav-drawer'),
  navToggle: document.querySelector('.nav-toggle'),
  newAnalysisNavBtn: document.getElementById('new-analysis-nav'),
  newAnalysisDrawerBtn: document.getElementById('new-analysis-drawer'),

  // Intro
  introHero: document.getElementById('intro-hero'),
  introActions: document.querySelector('.intro-actions'),
  introRevealEls: Array.from(document.querySelectorAll('.intro-reveal')),

  // App shell / real scroll root candidate
  appShell: document.querySelector('.app-shell'),

  // Scroll CTA
  scrollToBottomBtn: document.getElementById('scroll-to-bottom-btn'),

  // Analysis launcher
  analysisModal: document.getElementById('analysis-modal'),
  analysisInput: document.getElementById('analysis-input'),
  analysisSend: document.getElementById('analysis-send'),
  openAnalysisModalBtn: document.getElementById('open-analysis-modal'),
  closeAnalysisModalBtn: document.getElementById('close-analysis-modal'),

  // Analysis frame
  analysisFrame: document.getElementById('analysis-frame'),
  analysisRequestPill: document.getElementById('analysis-request-pill'),
  analysisStatus: document.getElementById('analysis-status'),
  analysisStatusText: document.getElementById('analysis-status-text'),
  analysisReportBody: document.getElementById('analysis-report-body'),
  analysisSources: document.getElementById('analysis-sources'),
  summaryBtn: document.getElementById('summary-btn'),

  // Chat inside analysis
  chatModal: document.getElementById('chat-modal'),
  closeChatModalBtn: document.getElementById('close-chat-modal'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  analysisFollowupThread: document.getElementById('analysis-followup-thread'),

  // New analysis CTA below
  newAnalysisSection: document.getElementById('new-analysis-section'),
  startNewAnalysisBottomBtn: document.getElementById('start-new-analysis-bottom'),

  // Example modals
  analysisExamplesModal: document.getElementById('analysis-examples-modal'),
  analysisExamplesList: document.getElementById('analysis-examples-list'),
  openAnalysisExamplesBtn: document.getElementById('open-analysis-examples'),
  closeAnalysisExamplesBtn: document.getElementById('close-analysis-examples'),

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
// State
// ------------------------------------------------------------
const appState = {
  phase: 'idle', // idle | analysis-modal-open | analysis-loading | analysis-loaded
  activeAnalysisPrompt: '',
  activeAnalysisContent: '',
  activeAnalysisSources: [],
  followupHistory: [],
  analysisAbortController: null,
  scrollFadeTimer: null,
  isUserScrolling: false
};

// ------------------------------------------------------------
// Generic helpers
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

function parseMarkdown(md) {
  if (window.marked?.parse) return window.marked.parse(md || '');
  return escapeHtml(md || '').replace(/\n/g, '<br>');
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

function getScrollRoot() {
  if (!dom.appShell) return window;

  const style = window.getComputedStyle(dom.appShell);
  const canScrollInY = /(auto|scroll|overlay)/.test(style.overflowY || '');
  return canScrollInY ? dom.appShell : window;
}

function getScrollMetrics() {
  const root = getScrollRoot();

  if (root === window) {
    const doc = document.documentElement;
    return {
      root,
      scrollTop: window.scrollY || window.pageYOffset || 0,
      clientHeight: window.innerHeight,
      scrollHeight: doc.scrollHeight
    };
  }

  return {
    root,
    scrollTop: root.scrollTop,
    clientHeight: root.clientHeight,
    scrollHeight: root.scrollHeight
  };
}

function scrollElementIntoViewWithinRoot(el, block = 'center') {
  if (!el) return;

  requestAnimationFrame(() => {
    const root = getScrollRoot();

    if (root === window) {
      el.scrollIntoView({
        behavior: 'smooth',
        block
      });
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    let targetTop = root.scrollTop + (elRect.top - rootRect.top);

    if (block === 'center') {
      targetTop = targetTop - (root.clientHeight / 2) + (elRect.height / 2);
    }

    root.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });
  });
}

function scrollIntoViewCentered(el) {
  scrollElementIntoViewWithinRoot(el, 'center');
}

function scrollMessageToTop(messageEl) {
  scrollElementIntoViewWithinRoot(messageEl, 'start');
}

function pageCanScroll() {
  const { scrollHeight, clientHeight } = getScrollMetrics();
  return scrollHeight > clientHeight + 8;
}

function isNearBottom(offset = 24) {
  const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
  const viewportBottom = scrollTop + clientHeight;
  return viewportBottom >= scrollHeight - offset;
}

function updateScrollToBottomButton() {
  const btn = dom.scrollToBottomBtn;
  if (!btn) return;

  const analysisIsReady = appState.phase === 'analysis-loaded';
  const shouldExist = analysisIsReady && pageCanScroll() && !isNearBottom();
  const shouldBeVisible = shouldExist && appState.isUserScrolling;

  if (!shouldExist) {
    btn.classList.add('hide');
    btn.classList.remove('is-visible');
    return;
  }

  btn.classList.remove('hide');

  if (shouldBeVisible) {
    btn.classList.add('is-visible');
  } else {
    btn.classList.remove('is-visible');
  }
}

function scheduleScrollButtonUpdate() {
  requestAnimationFrame(() => {
    updateScrollToBottomButton();
  });
}

function clearScrollFadeTimer() {
  if (!appState.scrollFadeTimer) return;
  clearTimeout(appState.scrollFadeTimer);
  appState.scrollFadeTimer = null;
}

function markUserScrolling() {
  appState.isUserScrolling = true;
  updateScrollToBottomButton();

  clearScrollFadeTimer();

  appState.scrollFadeTimer = setTimeout(() => {
    appState.isUserScrolling = false;
    updateScrollToBottomButton();
  }, 700);
}

function scrollToPageBottom() {
  const { root, scrollHeight } = getScrollMetrics();

  appState.isUserScrolling = false;
  clearScrollFadeTimer();

  if (root === window) {
    window.scrollTo({
      top: scrollHeight,
      behavior: 'smooth'
    });
  } else {
    root.scrollTo({
      top: scrollHeight,
      behavior: 'smooth'
    });
  }

  setTimeout(() => {
    updateScrollToBottomButton();
  }, 350);
}

function clearIntroRevealState() {
  if (!dom.introRevealEls?.length) return;
  dom.introRevealEls.forEach((el) => el.classList.remove('is-generated'));
}

function playIntroReveal() {
  if (!dom.introRevealEls?.length) return;

  clearIntroRevealState();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dom.introRevealEls.forEach((el) => el.classList.add('is-generated'));
    });
  });
}

function hideIntroActions() {
  clearIntroRevealState();
  hide(dom.introActions);
}

function showIntroActions() {
  show(dom.introActions);
  playIntroReveal();
}

function setAnalysisSendLoading(isLoading) {
  if (!dom.analysisSend) return;

  dom.analysisSend.disabled = isLoading;

  if (isLoading) {
    dom.analysisSend.dataset.loading = '1';
    if (dom.analysisInput) {
      dom.analysisInput.disabled = true;
      dom.analysisInput.setAttribute('aria-busy', 'true');
    }
  } else {
    delete dom.analysisSend.dataset.loading;
    if (dom.analysisInput) {
      dom.analysisInput.disabled = false;
      dom.analysisInput.removeAttribute('aria-busy');
    }
  }
}

function setChatSendLoading(isLoading) {
  if (!dom.chatSend) return;

  dom.chatSend.disabled = isLoading;

  if (isLoading) {
    dom.chatSend.dataset.loading = '1';
    if (dom.chatInput) {
      dom.chatInput.disabled = true;
      dom.chatInput.setAttribute('aria-busy', 'true');
    }
  } else {
    delete dom.chatSend.dataset.loading;
    if (dom.chatInput) {
      dom.chatInput.disabled = false;
      dom.chatInput.removeAttribute('aria-busy');
    }
  }
}

function hasStartedAnalysisSession() {
  return !!(
    appState.phase === 'analysis-loading' ||
    appState.phase === 'analysis-loaded' ||
    appState.activeAnalysisPrompt ||
    appState.activeAnalysisContent ||
    (Array.isArray(appState.followupHistory) && appState.followupHistory.length > 0)
  );
}

// ------------------------------------------------------------
// Session restore helpers
// ------------------------------------------------------------
function buildSessionSnapshot() {
  return {
    phase: appState.phase,
    activeAnalysisPrompt: appState.activeAnalysisPrompt,
    activeAnalysisContent: appState.activeAnalysisContent,
    activeAnalysisSources: appState.activeAnalysisSources,
    followupHistory: appState.followupHistory
  };
}

function persistSession() {
  saveAnalysisSession(buildSessionSnapshot());
}

function clearPersistedSession() {
  clearAnalysisSession();
}

function restoreSession() {
  const saved = loadAnalysisSession();
  if (!saved) return false;
  if (!saved.activeAnalysisContent) return false;

  appState.phase = saved.phase || 'analysis-loaded';
  appState.activeAnalysisPrompt = saved.activeAnalysisPrompt || '';
  appState.activeAnalysisContent = saved.activeAnalysisContent || '';
  appState.activeAnalysisSources = Array.isArray(saved.activeAnalysisSources)
    ? saved.activeAnalysisSources
    : [];
  appState.followupHistory = Array.isArray(saved.followupHistory)
    ? saved.followupHistory
    : [];

  hideIntroActions();
  show(dom.analysisFrame);
  show(dom.newAnalysisSection);

  if (dom.analysisRequestPill && appState.activeAnalysisPrompt) {
    dom.analysisRequestPill.textContent = appState.activeAnalysisPrompt;
    show(dom.analysisRequestPill);
  }

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Hersteld na verversen. Je kunt verder met deze analyse.';
  }
  show(dom.analysisStatus);

  setHtml(dom.analysisReportBody, parseMarkdown(appState.activeAnalysisContent));
  renderSources(appState.activeAnalysisSources);

  show(dom.summaryBtn);
  show(dom.chatModal);

  setHtml(dom.analysisFollowupThread, '');
  for (const msg of appState.followupHistory) {
    if (!msg || typeof msg.content !== 'string') continue;

    if (msg.role === 'user') {
      appendFollowupMessage('user', `<p>${escapeHtml(msg.content)}</p>`, false);
    } else if (msg.role === 'assistant') {
      appendFollowupMessage(
        'assistant',
        `
          <div class="eyebrow">
            <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
            <span>Policy Pilot</span>
          </div>
          <div>${parseMarkdown(msg.content)}</div>
        `,
        false
      );
    }
  }

  scheduleScrollButtonUpdate();
  return true;
}

// ------------------------------------------------------------
// Site router
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
  const drawer = dom.navDrawer;
  const toggle = dom.navToggle;
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

function closeDrawerIfOpen() {
  window.__closePolicyPilotDrawer?.();
}

// ------------------------------------------------------------
// Example prompts
// Later: replace with Supabase typed examples
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
// Confirm modal logic
// ------------------------------------------------------------
function openConfirmModal() {
  show(dom.confirmModal);
}

function closeConfirmModal() {
  hide(dom.confirmModal);
}

function hasActiveWork() {
  return !!(
    appState.activeAnalysisContent ||
    appState.activeAnalysisPrompt ||
    (Array.isArray(appState.followupHistory) && appState.followupHistory.length)
  );
}

function requestNewConversation() {
  closeDrawerIfOpen();

  if (hasActiveWork()) {
    openConfirmModal();
    return;
  }

  hardResetAnalysisState();
  openAnalysisModal({ reset: true });
}

// ------------------------------------------------------------
// Analysis launcher / chat visibility
// ------------------------------------------------------------
function openAnalysisModal({ reset = false } = {}) {
  if (reset) resetTextarea(dom.analysisInput);

  hideIntroActions();
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

  if (!hasStartedAnalysisSession()) {
    showIntroActions();
  } else {
    hideIntroActions();
  }

  scheduleScrollButtonUpdate();
}

function openChatModal() {
  show(dom.chatModal);
  scheduleScrollButtonUpdate();
}

function closeChatModal() {
  hide(dom.chatModal);
  scheduleScrollButtonUpdate();
}

// ------------------------------------------------------------
// Reset state
// ------------------------------------------------------------
function hardResetAnalysisState() {
  try {
    appState.analysisAbortController?.abort();
  } catch {}

  clearPersistedSession();

  appState.phase = 'idle';
  appState.activeAnalysisPrompt = '';
  appState.activeAnalysisContent = '';
  appState.activeAnalysisSources = [];
  appState.followupHistory = [];
  appState.analysisAbortController = null;

  clearScrollFadeTimer();
  appState.isUserScrolling = false;

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
  setChatSendLoading(false);

  updateScrollToBottomButton();
}

// ------------------------------------------------------------
// Analysis rendering
// ------------------------------------------------------------
function renderLoading(prompt) {
  show(dom.analysisFrame);
  show(dom.newAnalysisSection);

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
    <p>Analyse wordt gegenereerd...</p>
  `);

  setHtml(dom.analysisSources, '');
  hide(dom.summaryBtn);
  hide(dom.chatModal);

  scrollMessageToTop(dom.analysisFrame);
  scheduleScrollButtonUpdate();
}

function renderStreamingStart() {
  setHtml(dom.analysisReportBody, `
    <div class="eyebrow">
      <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
      <span>Policy en trust rapport</span>
    </div>
    <div id="analysis-stream-content"></div>
  `);
  scheduleScrollButtonUpdate();
}

function updateAnalysisStream(markdownText) {
  const el = document.getElementById('analysis-stream-content');
  if (!el) return;
  el.innerHTML = parseMarkdown(markdownText);
}

function renderSources(sources) {
  if (!dom.analysisSources) return;

  if (!Array.isArray(sources) || !sources.length) {
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

function renderDone(content, sources) {
  appState.phase = 'analysis-loaded';
  appState.activeAnalysisContent = content;
  appState.activeAnalysisSources = Array.isArray(sources) ? sources : [];

  if (dom.analysisStatusText) {
    dom.analysisStatusText.textContent = 'Analyse voltooid. Je kunt nu verder vragen op basis van dit rapport.';
  }
  show(dom.analysisStatus);

  updateAnalysisStream(content);
  renderSources(appState.activeAnalysisSources);

  show(dom.summaryBtn);
  show(dom.newAnalysisSection);
  show(dom.chatModal);

  persistSession();
  scheduleScrollButtonUpdate();
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

  scheduleScrollButtonUpdate();
}

// ------------------------------------------------------------
// Stream helper
// ------------------------------------------------------------
async function streamChatToElement({
  message,
  history = [],
  useRetrieval = false,
  targetEl,
  loadingHtml = '<p>Bezig met antwoorden...</p>',
  abortController
}) {
  if (targetEl) {
    targetEl.innerHTML = loadingHtml;
  }

  scheduleScrollButtonUpdate();

  const resp = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      useRetrieval,
      history
    }),
    signal: abortController?.signal
  });

  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    throw new Error(txt || 'Failed to connect to /chat');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let text = '';
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

      const evt = JSON.parse(payload);

      if (evt.type === 'token') {
        text += evt.text || '';
        if (targetEl) {
          targetEl.innerHTML = parseMarkdown(text);
        }
        scheduleScrollButtonUpdate();
      } else if (evt.type === 'sources') {
        sources = Array.isArray(evt.items) ? evt.items : [];
      } else if (evt.type === 'error') {
        throw new Error(evt.message || 'Unknown stream error');
      } else if (evt.type === 'done') {
        scheduleScrollButtonUpdate();
        return { text, sources };
      }
    }
  }

  scheduleScrollButtonUpdate();
  return { text, sources };
}

// ------------------------------------------------------------
// First request = real RAG analysis
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

  closeAnalysisModal();
  renderLoading(prompt);
  setAnalysisSendLoading(true);

  const controller = new AbortController();
  appState.analysisAbortController = controller;

  try {
    renderStreamingStart();

    const streamEl = document.getElementById('analysis-stream-content');
    const { text, sources } = await streamChatToElement({
      message: prompt,
      history: [],
      useRetrieval: true,
      targetEl: streamEl,
      loadingHtml: '',
      abortController: controller
    });

    renderDone(text, sources);
  } catch (err) {
    if (controller.signal.aborted) {
      renderAnalysisError('De analyse is afgebroken.');
    } else {
      renderAnalysisError(err?.message || 'Server error tijdens analyse.');
    }
  } finally {
    appState.analysisAbortController = null;
    setAnalysisSendLoading(false);
    scheduleScrollButtonUpdate();
  }
}

// ------------------------------------------------------------
// Follow-up chat
// ------------------------------------------------------------
function appendFollowupMessage(role, html, shouldScroll = true) {
  if (!dom.analysisFollowupThread) return null;

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = html;
  dom.analysisFollowupThread.appendChild(div);

  if (shouldScroll) {
    scrollMessageToTop(div);
  }

  scheduleScrollButtonUpdate();
  return div;
}

async function submitFollowupQuestion() {
  const prompt = (dom.chatInput?.value || '').trim();
  if (!prompt) return;
  if (!appState.activeAnalysisContent) return;
  if (appState.analysisAbortController) return;

  appendFollowupMessage('user', `<p>${escapeHtml(prompt)}</p>`);
  resetTextarea(dom.chatInput);

  appState.followupHistory.push({
    role: 'user',
    content: prompt
  });

  const assistantDiv = appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Policy Pilot</span>
      </div>
      <div class="followup-stream-content"><p>Bezig met antwoorden...</p></div>
    `
  );

  const streamEl = assistantDiv?.querySelector('.followup-stream-content');

  const controller = new AbortController();
  appState.analysisAbortController = controller;
  setChatSendLoading(true);

  try {
    const history = [
      {
        role: 'user',
        content: appState.activeAnalysisPrompt
      },
      {
        role: 'assistant',
        content: appState.activeAnalysisContent
      },
      ...appState.followupHistory.slice(0, -1)
    ];

    const { text } = await streamChatToElement({
      message: prompt,
      history,
      useRetrieval: false,
      targetEl: streamEl,
      loadingHtml: '<p>Bezig met antwoorden...</p>',
      abortController: controller
    });

    appState.followupHistory.push({
      role: 'assistant',
      content: text
    });

    persistSession();
  } catch (err) {
    const message = controller.signal.aborted
      ? 'De follow-up is afgebroken.'
      : (err?.message || 'Server error tijdens follow-up.');

    if (streamEl) {
      streamEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
    }

    appState.followupHistory.push({
      role: 'assistant',
      content: message
    });

    persistSession();
  } finally {
    appState.analysisAbortController = null;
    setChatSendLoading(false);
    scheduleScrollButtonUpdate();
  }
}

// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------
async function generateSummary() {
  if (!appState.activeAnalysisContent) return;
  if (appState.analysisAbortController) return;

  const summaryInstruction = (SUMMARY_PROMPT || '').trim() || `
Maak een heldere samenvatting van onderstaande analyse.
Geef:
1. de hoofdconclusie
2. de 3 belangrijkste inzichten
3. de strategische relevantie in gewone taal
Houd het compact en concreet.
  `.trim();

  const sourcePrompt = appState.activeAnalysisPrompt?.trim()
    ? `Originele analysevraag:\n${appState.activeAnalysisPrompt.trim()}`
    : '';

  const reportText = `
Analyse om samen te vatten:
${appState.activeAnalysisContent}
  `.trim();

  const payload = [summaryInstruction, sourcePrompt, reportText]
    .filter(Boolean)
    .join('\n\n---\n\n');

  const assistantDiv = appendFollowupMessage(
    'assistant',
    `
      <div class="eyebrow">
        <img src="${STRAPLINE.iconUrl}" alt="" class="eyebrow-icon">
        <span>Samenvatting</span>
      </div>
      <div class="followup-stream-content"><p>Samenvatting wordt gemaakt...</p></div>
    `
  );

  const streamEl = assistantDiv?.querySelector('.followup-stream-content');

  const controller = new AbortController();
  appState.analysisAbortController = controller;
  setChatSendLoading(true);
  if (dom.summaryBtn) dom.summaryBtn.disabled = true;

  try {
    const { text } = await streamChatToElement({
      message: payload,
      history: [],
      useRetrieval: false,
      targetEl: streamEl,
      loadingHtml: '<p>Samenvatting wordt gemaakt...</p>',
      abortController: controller
    });

    appState.followupHistory.push({
      role: 'assistant',
      content: text
    });

    persistSession();
  } catch (err) {
    const message = controller.signal.aborted
      ? 'De samenvatting is afgebroken.'
      : (err?.message || 'Server error tijdens samenvatting.');

    if (streamEl) {
      streamEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
    }

    appState.followupHistory.push({
      role: 'assistant',
      content: message
    });

    persistSession();
  } finally {
    appState.analysisAbortController = null;
    setChatSendLoading(false);
    if (dom.summaryBtn) dom.summaryBtn.disabled = false;
    scheduleScrollButtonUpdate();
  }
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

// Open analysis launcher
dom.openAnalysisModalBtn?.addEventListener('click', () => {
  openAnalysisModal({ reset: false });
});

// Close analysis launcher
dom.closeAnalysisModalBtn?.addEventListener('click', () => {
  closeAnalysisModal();
});

// First analysis submit
dom.analysisSend?.addEventListener('click', submitAnalysisRequest);

dom.analysisInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAnalysisRequest();
  }
});

// Follow-up chat submit
dom.chatSend?.addEventListener('click', submitFollowupQuestion);

dom.chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitFollowupQuestion();
  }
});

// Auto-grow textareas
['input', 'change', 'paste', 'cut', 'drop'].forEach((ev) => {
  dom.analysisInput?.addEventListener(ev, () => autoGrowTextarea(dom.analysisInput));
  dom.chatInput?.addEventListener(ev, () => autoGrowTextarea(dom.chatInput));
});

// Close chat input block only
dom.closeChatModalBtn?.addEventListener('click', () => {
  closeChatModal();
});

// Summary button
dom.summaryBtn?.addEventListener('click', generateSummary);

// Scroll button
dom.scrollToBottomBtn?.addEventListener('click', () => {
  scrollToPageBottom();
});

// Keep button in sync with the real scroll surface
const scrollRoot = getScrollRoot();
const onScroll = () => {
  markUserScrolling();
};

if (scrollRoot === window) {
  window.addEventListener('scroll', onScroll, { passive: true });
} else {
  scrollRoot.addEventListener('scroll', onScroll, { passive: true });
}

window.addEventListener('resize', () => {
  markUserScrolling();
  scheduleScrollButtonUpdate();
});

// Analysis examples
dom.openAnalysisExamplesBtn?.addEventListener('click', () => {
  openAnalysisExamplesModal();
});

dom.closeAnalysisExamplesBtn?.addEventListener('click', () => {
  closeAnalysisExamplesModal();
});

dom.analysisExamplesModal
  ?.querySelector('[data-close-analysis-examples]')
  ?.addEventListener('click', () => {
    closeAnalysisExamplesModal();
  });

// Chat examples
dom.openChatExamplesBtn?.addEventListener('click', () => {
  openChatExamplesModal();
});

dom.closeChatExamplesBtn?.addEventListener('click', () => {
  closeChatExamplesModal();
});

dom.chatExamplesModal
  ?.querySelector('[data-close-chat-examples]')
  ?.addEventListener('click', () => {
    closeChatExamplesModal();
  });

// New conversation / begin opnieuw buttons show confirm
dom.newAnalysisNavBtn?.addEventListener('click', requestNewConversation);
dom.newAnalysisDrawerBtn?.addEventListener('click', requestNewConversation);
dom.startNewAnalysisBottomBtn?.addEventListener('click', requestNewConversation);

// Confirm modal actions
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
// Initial state
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

const restored = restoreSession();

if (!restored) {
  showIntroActions();
} else {
  hideIntroActions();
}

scheduleScrollButtonUpdate();
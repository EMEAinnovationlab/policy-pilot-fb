/**
 * main.js — application bootstrap (ES module)
 *
 * Responsibilities
 * - Enforce session requirements (via auth_guard)
 * - Load project prompts/settings from backend
 * - Wire DOM elements and feature modules (chat runtime, site router)
 * - Provide the analysis -> embedded-chat workflow:
 *   - renderAnalysisDone(...) builds the analysis frame (analysis-report)
 *   - injects an embedded follow-up chat composer inside the analysis
 *   - submitFollowupQuestion() sends follow-ups (currently simulated; TODO: wire to /chat)
 *
 * Notes
 * - This file is written defensively: it checks for DOM elements and falls back gracefully.
 * - Replace the simulated follow-up logic in submitFollowupQuestion with your real /chat endpoint.
 *
 * Usage
 * <script type="module" src="/js/main.js"></script>
 */

import { enforceRole } from '/js/auth_guard.js';
import { initChatRuntime } from '/js/chatRuntime.js';
import { initSiteRouter } from '/js/siteRouter.js';

// --------------------------- App state ---------------------------------
const appState = {
  phase: 'idle', // 'idle' | 'analysis-running' | 'analysis-loaded'
  activeAnalysisContent: '',
  activeAnalysisSources: [],
  activeAnalysisPrompt: '',
  followupHistory: []
};

// --------------------------- Config ------------------------------------
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
You are the assistant in a chat UI. Greet the user briefly and offer 2–3 concrete things you can do here.
Keep it concise and friendly; no emojis. Avoid generic fluff.
`;

let SUMMARY_PROMPT = '';

// --------------------- Markdown helper (marked fallback) ----------------
let markedRef = (typeof window !== 'undefined' && window.marked) ? window.marked : null;
async function ensureMarked() {
  if (markedRef) return markedRef;
  try {
    const { marked } = await import('https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js');
    markedRef = marked;
    if (typeof window !== 'undefined') window.marked = markedRef;
  } catch (err) {
    console.warn('Markdown loader failed; rendering raw markdown.', err);
  }
  return markedRef;
}
const parseMarkdown = (md) => (markedRef ? markedRef.parse(md || '') : (md || ''));

// --------------------- Small DOM helpers -------------------------------
const noop = () => {};
const setHtml = (el, html) => { if (el) el.innerHTML = html; };
const show = (el) => { if (!el) return; el.classList.remove('hide'); el.style.display = ''; };
const hide = (el) => { if (!el) return; el.classList.add('hide'); el.style.display = 'none'; };
const escapeHtml = (s = '') => s.replace(/[&<>"'`]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'})[c]);

function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.min(el.scrollHeight, 300);
  el.style.height = newHeight + 'px';
  el.style.overflowY = el.scrollHeight > 300 ? 'auto' : 'hidden';
}
function resetTextarea(el) {
  if (!el) return;
  el.value = '';
  el.style.height = '56px';
  el.style.overflowY = 'hidden';
}

// --------------------- Load project prompts from server ----------------
async function loadProjectPromptsFromServer() {
  try {
    const res = await fetch('/api/project-settings', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to fetch settings');

    const intro = data.settings?.introduction_prompt;
    if (intro && intro.trim()) DEFAULT_WELCOME_PROMPT = intro.trim();

    const summary = data.settings?.summary_prompt;
    if (summary && summary.trim()) SUMMARY_PROMPT = summary.trim();
  } catch (err) {
    console.warn('Project prompt fallback used:', err?.message || err);
  }
}

// --------------------- DOM references ---------------------------------
const dom = {
  // core chat surface
  chat: document.getElementById('chat'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('send'),
  // optional stop / clear buttons
  stopBtn: document.getElementById('stop'),
  clearBtn: document.getElementById('clear'),

  // examples panel
  examplesContainer: document.getElementById('example-prompts'),
  closeExamplesBtn: document.getElementById('close-examples'),
  examplesToggle: document.getElementById('toggle-examples'),
  examplesGrid: document.getElementById('examples-grid'),
  examplesPrevBtn: document.getElementById('examples-prev'),
  examplesNextBtn: document.getElementById('examples-next'),
  examplesDotsEl: document.getElementById('examples-dots'),

  // site modal / routing
  modal: document.getElementById('content-modal'),
  modalTitle: document.getElementById('pp-modal-title'),
  modalContent: document.getElementById('pp-modal-content'),
  navContainer: document.querySelector('.pp-modal__nav'),
  navButtons: Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn')),

  linkAbout: document.querySelector('a[href="#about"]'),
  linkHow: document.querySelector('a[href="#how"]'),
  linkData: document.querySelector('a[href="#data"]'),

  // analysis & UI anchors (these may be absent in older HTML; create fallbacks)
  analysisReport: document.getElementById('analysis-report'), // where we render the analysis box
  analysisStatus: document.getElementById('analysis-status'),
  analysisRequestPill: document.getElementById('analysis-request-pill'),
  summaryBtn: document.getElementById('summary-btn'),
  newAnalysisSection: document.getElementById('new-analysis-section'),
};

// Ensure chat log has ARIA attributes
if (dom.chat) {
  dom.chat.setAttribute('role', 'log');
  dom.chat.setAttribute('aria-live', 'polite');
  dom.chat.setAttribute('aria-relevant', 'additions');
}

// If analysisReport doesn't exist, create and append it below the chat as a safe fallback
if (!dom.analysisReport) {
  const fallback = document.createElement('div');
  fallback.id = 'analysis-report';
  // keep it unobtrusive by default — the CSS you add can style this
  fallback.className = 'analysis-report';
  // append after chat or to body
  if (dom.chat && dom.chat.parentNode) dom.chat.parentNode.insertBefore(fallback, dom.chat.nextSibling);
  else document.body.appendChild(fallback);
  dom.analysisReport = fallback;
}

// Lightweight helper to reveal the analysis frame with consistent UI updates
function revealAnalysisFrame() {
  show(dom.analysisReport);
  // Hide the top "do analysis" toggle if present
  if (dom.examplesToggle) hide(dom.examplesToggle);
  if (dom.newAnalysisSection) show(dom.newAnalysisSection);
}

// --------------------- Analysis sources renderer -----------------------
function renderAnalysisSources(sources = []) {
  if (!dom.analysisReport) return;
  const metaElId = 'analysis-sources-list';
  let metaEl = dom.analysisReport.querySelector(`#${metaElId}`);
  if (!metaEl) {
    metaEl = document.createElement('div');
    metaEl.id = metaElId;
    metaEl.className = 'analysis-sources';
    dom.analysisReport.appendChild(metaEl);
  }
  if (!sources || sources.length === 0) {
    metaEl.innerHTML = '';
    return;
  }

  const rows = sources.map(s => `<li><strong>${escapeHtml(s.title || s.doc_name || 'Bron')}</strong> — ${escapeHtml(s.snippet || s.uploaded_by || '')}</li>`).join('');
  metaEl.innerHTML = `<h4>Included sources</h4><ul>${rows}</ul>`;
}

// --------------------- Render analysis + embed chat --------------------
/**
 * Renders the analysis report and injects an embedded follow-up chat inside it.
 * finalMarkdown: markdown string (analysis content)
 * sources: array of source metadata
 */
async function renderAnalysisDone(finalMarkdown = '', sources = []) {
  await ensureMarked();
  appState.activeAnalysisContent = finalMarkdown;
  appState.activeAnalysisSources = sources || [];
  appState.phase = 'analysis-loaded';

  // Build the analysis frame HTML (minimal structure; style via CSS)
  const html = `
    <div class="analysis-frame">
      <button class="analysis-close" id="analysis-close" aria-label="Close analysis">×</button>

      <div class="analysis-header">
        <div class="analysis-eyebrow">
          <img src="${STRAPLINE.iconUrl}" alt="" class="analysis-icon" />
          <span class="analysis-eyebrow-text">Policy en trust rapport</span>
        </div>
        <h2 class="analysis-title">Analyse: ${escapeHtml(appState.activeAnalysisPrompt || '').slice(0, 80) || 'Resultaat'}</h2>
        <p class="analysis-intro">Je kunt onderaan vervolgvragen stellen die worden beantwoord op basis van dit rapport.</p>
      </div>

      <div class="analysis-body" id="analysis-main-content">
        ${parseMarkdown(finalMarkdown || '')}
      </div>

      <div class="analysis-footer" id="analysis-footer">
        <div id="analysis-followup-thread" class="analysis-followup-thread"></div>

        <div class="analysis-composer">
          <textarea id="analysis-chat-input" placeholder="Stel een vervolgvraag..." aria-label="Vervolgvraag"></textarea>
          <div class="analysis-composer-actions">
            <button id="analysis-chat-send" type="button" aria-label="Send follow-up">Verstuur</button>
            <button id="analysis-open-chat-examples" type="button">Voorbeeldvragen</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setHtml(dom.analysisReport, html);

  // Render sources (appended inside the report)
  renderAnalysisSources(sources || []);

  // Wire new controls
  const newChatInput = document.getElementById('analysis-chat-input');
  const newChatSend = document.getElementById('analysis-chat-send');
  const newExamplesBtn = document.getElementById('analysis-open-chat-examples');
  const closeBtn = document.getElementById('analysis-close');
  const followupThreadEl = document.getElementById('analysis-followup-thread');

  // store for reuse
  dom._embedded = dom._embedded || {};
  dom._embedded.chatInput = newChatInput;
  dom._embedded.chatSend = newChatSend;
  dom._embedded.followupThread = followupThreadEl;

  // Auto-grow textarea
  if (newChatInput) {
    autoGrowTextarea(newChatInput);
    newChatInput.addEventListener('input', () => autoGrowTextarea(newChatInput));
    newChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitFollowupQuestion();
      }
    });
  }

  if (newChatSend) newChatSend.addEventListener('click', submitFollowupQuestion);
  if (newExamplesBtn) newExamplesBtn.addEventListener('click', () => openExamplesFor('chat'));
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      // close analysis view (but keep new-analysis button visible)
      hide(dom.analysisReport);
      if (dom.examplesToggle) show(dom.examplesToggle);
    });
  }

  // Focus composer
  requestAnimationFrame(() => {
    newChatInput?.focus();
  });
}

// --------------------- Examples handling (two contexts) ----------------
/**
 * openExamplesFor(context)
 * - context: 'analysis' | 'chat' | undefined
 *
 * We'll reuse the same examples panel for both analysis-modal and chat-modal flows.
 * The examples click handler should fill the appropriate input element and optionally
 * arm retrieval for a single send.
 */
function openExamplesFor(context = 'analysis') {
  // ensure examples panel exists
  if (!dom.examplesContainer) return;
  // show it (your CSS controls the modal look)
  show(dom.examplesContainer);
  // mark which context to fill when an example is selected
  dom.examplesContainer.dataset.context = context;
}

/**
 * attachExampleFillHandlers(container, inputEl)
 * - Should be called by chatRuntime or here once at init to bind clicks on example cards.
 * For robustness we attach a delegated click handler to examplesGrid if present.
 */
function attachExampleFillHandlersOnce() {
  const grid = dom.examplesGrid;
  if (!grid) return;
  if (grid._examplesBound) return;
  grid._examplesBound = true;

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.example');
    if (!card) return;
    const prompt = card.dataset.prompt || card.getAttribute('data-prompt') || card.dataset.full || card.textContent || '';
    const context = dom.examplesContainer?.dataset?.context || 'analysis';

    // fill appropriate input
    if (context === 'analysis') {
      // fill the main input (for starting a new analysis)
      if (dom.input) {
        dom.input.value = prompt;
        autoGrowTextarea(dom.input);
        // optionally close examples and trigger send
      }
    } else if (context === 'chat') {
      // fill embedded chat input if present
      const embeddedInput = dom._embedded?.chatInput;
      if (embeddedInput) {
        embeddedInput.value = prompt;
        autoGrowTextarea(embeddedInput);
      } else if (dom.input) {
        // fallback to main input
        dom.input.value = prompt;
        autoGrowTextarea(dom.input);
      }
    }

    // close examples
    hide(dom.examplesContainer);
  });
}

// --------------------- Follow-up (embedded chat) -----------------------
/**
 * submitFollowupQuestion
 *
 * Current implementation: simulated reply to show the UX.
 * Replace the "simulate reply" section with a real fetch POST to /chat when ready.
 *
 * Expected request payload (example):
 * {
 *   message: prompt,
 *   useRetrieval: false,                  // follow-ups are answered from the analysis context
 *   context: appState.activeAnalysisContent,
 *   history: appState.followupHistory
 * }
 */
async function submitFollowupQuestion() {
  const inputEl = dom._embedded?.chatInput || dom.input;
  const threadEl = dom._embedded?.followupThread || document.getElementById('analysis-followup-thread') || dom.chat;

  const prompt = (inputEl?.value || '').trim();
  if (!prompt) return;
  if (!appState.activeAnalysisContent) {
    // no analysis context: signal to user (could show a toast)
    console.warn('No active analysis — start an analysis first.');
    return;
  }

  // append user message UI
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.innerHTML = `<div class="user-bubble"><p>${escapeHtml(prompt)}</p></div>`;
  threadEl.appendChild(userDiv);
  threadEl.scrollTop = threadEl.scrollHeight;

  // clear composer
  resetTextarea(inputEl);

  // record history
  appState.followupHistory.push({ role: 'user', content: prompt });

  // show assistant placeholder
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg assistant';
  const streamId = `assistant-stream-${Date.now()}`;
  assistantDiv.innerHTML = `
    <div class="assistant-header"><img src="${STRAPLINE.iconUrl}" alt="bot" class="assistant-icon"/> Policy Pilot</div>
    <div id="${streamId}" class="assistant-stream"><em>Bezig met beantwoorden op basis van het rapport…</em></div>
  `;
  threadEl.appendChild(assistantDiv);
  threadEl.scrollTop = threadEl.scrollHeight;

  // --- SIMULATED REPLY (replace with real network streaming) ---
  let streamEl = document.getElementById(streamId);
  try {
    // small artificial delay so the UX feels realistic
    await new Promise((r) => setTimeout(r, 700));

    // create a reply derived from the prompt and active analysis (very small placeholder)
    const replyText = `Korte reactie op: "${prompt}". (Beantwoord op basis van de analyse.)`;

    // render reply (in a real app you would stream tokens into this element)
    if (streamEl) streamEl.innerHTML = `<p>${escapeHtml(replyText)}</p>`;

    // persist to history
    appState.followupHistory.push({ role: 'assistant', content: replyText });
    threadEl.scrollTop = threadEl.scrollHeight;
  } catch (err) {
    if (streamEl) streamEl.innerHTML = `<p style="color:red">Er ging iets mis bij het beantwoorden.</p>`;
  }
  // --- end simulated reply ---
}

// --------------------- Init & boot ------------------------------------
async function boot() {
  // enforce role (any logged in user required by default)
  await enforceRole({ requiredRole: null });

  // load prompts/settings
  await loadProjectPromptsFromServer();
  await ensureMarked();

  // init dependent feature modules
  await initChatRuntime({
    dom,
    config: {
      STRAPLINE,
      DEFAULT_WELCOME_PROMPT,
      SUMMARY_PROMPT
    }
  });

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

  // Bind global example clicks (if examples exist)
  attachExampleFillHandlersOnce();

  // Wire main composer (start analysis flow)
  if (dom.sendBtn && dom.input) {
    dom.sendBtn.addEventListener('click', async () => {
      const prompt = (dom.input.value || '').trim();
      if (!prompt) return;

      // begin analysis: hide the top examples toggle and show working state
      appState.phase = 'analysis-running';
      appState.activeAnalysisPrompt = prompt;

      // UI: hide examples and disable the main composer while running
      hide(dom.examplesContainer);
      if (dom.sendBtn) dom.sendBtn.disabled = true;

      // Simulate an analysis request: in your real implementation you will POST to /api/new-analysis
      // Example payload (server should create RAG run and return a markdown report + sources)
      // { prompt, filters: ..., userId: ... }
      try {
        // short simulated delay while "doing analysis"
        await new Promise(r => setTimeout(r, 900));

        // Simulated markdown result — replace by server response
        const simulatedMarkdown = `# Vertrouwen in overheid en technologie sinds 2024

Dit is een samenvatting van relevante stukken uit onze dataset. De analyse identificeert drie trends:

1. Trend A — groeiende aandacht voor digitale sovereigniteit.
2. Trend B — toegenomen vraag naar transparantie in data gebruik.
3. Trend C — politiek debat rond buitenlandse invloed.

_Opmerking: dit is een demo-analyse. Vervang door echte server-output._`;

        const simulatedSources = [
          { title: 'Edelman Trust Barometer 2024', snippet: 'Trust Barometer summary', doc_name: 'edelman_2024.pdf' },
          { title: 'Policy brief — Privacy', snippet: 'Policy brief about privacy trends', doc_name: 'policy_privacy_2024.pdf' }
        ];

        // render into analysis frame (this injects the embedded chat)
        await renderAnalysisDone(simulatedMarkdown, simulatedSources);

        // After analysis: hide the "do analysis" CTA so user focuses on the report
        if (dom.examplesToggle) hide(dom.examplesToggle);

      } catch (err) {
        console.error('Analysis failed:', err);
        // show basic error to user inside main chat area
        if (dom.chat) {
          const errDiv = document.createElement('div');
          errDiv.className = 'msg assistant';
          errDiv.textContent = 'Fout bij het uitvoeren van de analyse. Probeer het opnieuw.';
          dom.chat.appendChild(errDiv);
        }
      } finally {
        if (dom.sendBtn) dom.sendBtn.disabled = false;
      }
    });
  }

  // Wire clear button (if you have one)
  if (dom.clearBtn) {
    dom.clearBtn.addEventListener('click', () => {
      if (dom.chat) dom.chat.innerHTML = '';
      if (dom.input) { dom.input.value = ''; resetTextarea(dom.input); }
      appState.phase = 'idle';
      appState.activeAnalysisContent = '';
      appState.activeAnalysisSources = [];
      appState.followupHistory = [];
      // reveal the new-analysis control
      if (dom.examplesToggle) show(dom.examplesToggle);
      hide(dom.analysisReport);
    });
  }

  // Mobile drawer (kept from your previous code)
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
    drawer.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) closeDrawer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closeDrawer(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 820 && isOpen()) closeDrawer(); });
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      const clickedInside = e.target.closest('#nav-drawer') || e.target.closest('.nav-toggle');
      if (!clickedInside) closeDrawer();
    });
  })();

  // final visibility: hide analysis until something is produced
  hide(dom.analysisReport);
}

// --------------------- Utility: open examples panel --------------------
function openExamples() {
  if (!dom.examplesContainer) return;
  show(dom.examplesContainer);
}

// --------------------- Start the app ---------------------------------
boot().catch(err => {
  console.error('Boot failed:', err);
}); 
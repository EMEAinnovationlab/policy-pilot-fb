// main.js
// ------------------------------------------------------------
// Policy Pilot main controller
//
// Responsibilities:
// - auth gate
// - load project prompts
// - run analysis with RAG
// - stream backend response
// - manage UI state
// - persist session for 5 minutes
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
  autoStartText: 'INTRODUCTIE'
};

let SUMMARY_PROMPT = '';

// ------------------------------------------------------------
// Load project settings
// ------------------------------------------------------------
async function loadProjectPromptsFromServer() {
  try {
    const res = await fetch('/api/project-settings', { credentials: 'same-origin' });
    const data = await res.json();

    if (!res.ok || !data?.ok) return;

    const summary = data.settings?.summary_prompt;
    if (summary) SUMMARY_PROMPT = summary.trim();
  } catch {}
}

await loadProjectPromptsFromServer();

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------
const dom = {
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

  analysisReportBody: document.getElementById('analysis-report-body'),
  analysisSources: document.getElementById('analysis-sources'),

  summaryBtn: document.getElementById('summary-btn'),

  chatModal: document.getElementById('chat-modal'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  analysisFollowupThread: document.getElementById('analysis-followup-thread'),

  newAnalysisSection: document.getElementById('new-analysis-section'),
  startNewAnalysisBottomBtn: document.getElementById('start-new-analysis-bottom'),

  newAnalysisNavBtn: document.getElementById('new-analysis-nav'),
  newAnalysisDrawerBtn: document.getElementById('new-analysis-drawer'),

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
  abortController: null
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

function parseMarkdown(md) {
  if (window.marked?.parse) {
    return window.marked.parse(md || '');
  }
  return md;
}

function scrollIntoViewCentered(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideIntroActions() {
  hide(dom.introActions);
}

function showIntroActions() {
  show(dom.introActions);
}

// ------------------------------------------------------------
// Session helpers
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

function restoreSession() {
  const saved = loadAnalysisSession();
  if (!saved) return false;

  appState.phase = saved.phase;
  appState.activeAnalysisPrompt = saved.activeAnalysisPrompt;
  appState.activeAnalysisContent = saved.activeAnalysisContent;
  appState.activeAnalysisSources = saved.activeAnalysisSources;
  appState.followupHistory = saved.followupHistory;

  if (!appState.activeAnalysisContent) return false;

  hideIntroActions();
  show(dom.analysisFrame);
  show(dom.newAnalysisSection);

  setHtml(dom.analysisReportBody, parseMarkdown(appState.activeAnalysisContent));
  renderSources(appState.activeAnalysisSources);

  show(dom.chatModal);

  for (const msg of appState.followupHistory) {
    appendFollowupMessage(msg.role, `<p>${escapeHtml(msg.content)}</p>`);
  }

  return true;
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function renderLoading(prompt) {
  show(dom.analysisFrame);

  dom.analysisRequestPill.textContent = prompt;
  show(dom.analysisRequestPill);

  dom.analysisStatusText.textContent = 'Bezig met bronanalyse...';
  show(dom.analysisStatus);

  setHtml(
    dom.analysisReportBody,
    `<p>Analyse wordt gegenereerd...</p>`
  );
}

function renderSources(sources) {
  if (!sources?.length) return;

  setHtml(
    dom.analysisSources,
    `
    <h3>Bronnen</h3>
    <ul>
      ${sources
        .map(
          (s) =>
            `<li>[#${escapeHtml(s.n)}] ${escapeHtml(s.title)}</li>`
        )
        .join('')}
    </ul>
  `
  );
}

function renderDone(content, sources) {
  appState.activeAnalysisContent = content;
  appState.activeAnalysisSources = sources;

  setHtml(dom.analysisReportBody, parseMarkdown(content));
  renderSources(sources);

  show(dom.chatModal);
  show(dom.newAnalysisSection);

  persistSession();
}

// ------------------------------------------------------------
// RAG Analysis Request
// ------------------------------------------------------------
async function submitAnalysisRequest() {
  const prompt = dom.analysisInput.value.trim();
  if (!prompt) return;

  hideIntroActions();
  hide(dom.analysisModal);

  renderLoading(prompt);

  const controller = new AbortController();
  appState.abortController = controller;

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

    if (!resp.body) throw new Error('No response body');

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
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload) continue;

        const evt = JSON.parse(payload);

        if (evt.type === 'token') {
          text += evt.text;
          setHtml(dom.analysisReportBody, parseMarkdown(text));
        }

        if (evt.type === 'sources') {
          sources = evt.items;
        }

        if (evt.type === 'done') {
          renderDone(text, sources);
          return;
        }
      }
    }
  } catch (err) {
    setHtml(dom.analysisReportBody, `<p>Error: ${escapeHtml(err.message)}</p>`);
  }
}

// ------------------------------------------------------------
// Follow-up Chat Placeholder
// ------------------------------------------------------------
function appendFollowupMessage(role, html) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = html;

  dom.analysisFollowupThread.appendChild(div);
}

function submitFollowupQuestion() {
  const prompt = dom.chatInput.value.trim();
  if (!prompt) return;

  appendFollowupMessage('user', `<p>${escapeHtml(prompt)}</p>`);

  dom.chatInput.value = '';

  appendFollowupMessage(
    'assistant',
    `<p>Follow-up chat wordt in de volgende stap gekoppeld aan de analysecontext.</p>`
  );

  appState.followupHistory.push({ role: 'user', content: prompt });

  persistSession();
}

// ------------------------------------------------------------
// Reset
// ------------------------------------------------------------
function resetAnalysis() {
  clearAnalysisSession();

  appState.phase = 'idle';
  appState.activeAnalysisPrompt = '';
  appState.activeAnalysisContent = '';
  appState.activeAnalysisSources = [];
  appState.followupHistory = [];

  showIntroActions();

  hide(dom.analysisFrame);
  hide(dom.chatModal);
  hide(dom.newAnalysisSection);

  setHtml(dom.analysisReportBody, '');
  setHtml(dom.analysisSources, '');
  setHtml(dom.analysisFollowupThread, '');
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
dom.openAnalysisModalBtn?.addEventListener('click', () => show(dom.analysisModal));

dom.closeAnalysisModalBtn?.addEventListener('click', () => hide(dom.analysisModal));

dom.analysisSend?.addEventListener('click', submitAnalysisRequest);

dom.chatSend?.addEventListener('click', submitFollowupQuestion);

dom.clearBtn?.addEventListener('click', resetAnalysis);

dom.newAnalysisNavBtn?.addEventListener('click', resetAnalysis);

dom.newAnalysisDrawerBtn?.addEventListener('click', resetAnalysis);

dom.startNewAnalysisBottomBtn?.addEventListener('click', resetAnalysis);

// ------------------------------------------------------------
// Restore session
// ------------------------------------------------------------
restoreSession();
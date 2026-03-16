// main.js — ES module
import { enforceRole } from '/js/auth_guard.js';
import { initChatRuntime } from '/js/chatRuntime.js';
import { initSiteRouter } from '/js/siteRouter.js';

// Require logged-in user
await enforceRole({ requiredRole: null });

// ──────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────
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

await loadProjectPromptsFromServer();

// ──────────────────────────────────────────────────────────
// DOM
// ──────────────────────────────────────────────────────────
const dom = {
  chat: document.getElementById('chat'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('send'),
  stopBtn: document.getElementById('stop'),
  clearBtn: document.getElementById('clear'),

  examplesContainer: document.getElementById('example-prompts'),
  closeExamplesBtn: document.getElementById('close-examples'),
  examplesToggle: document.getElementById('toggle-examples'),
  examplesGrid: document.getElementById('examples-grid'),
  examplesPrevBtn: document.getElementById('examples-prev'),
  examplesNextBtn: document.getElementById('examples-next'),
  examplesDotsEl: document.getElementById('examples-dots'),

  modal: document.getElementById('content-modal'),
  modalTitle: document.getElementById('pp-modal-title'),
  modalContent: document.getElementById('pp-modal-content'),
  navContainer: document.querySelector('.pp-modal__nav'),
  navButtons: Array.from(document.querySelectorAll('.pp-modal__nav .pp-navbtn')),

  linkAbout: document.querySelector('a[href="#about"]'),
  linkHow: document.querySelector('a[href="#how"]'),
  linkData: document.querySelector('a[href="#data"]')
};

if (dom.chat) {
  dom.chat.setAttribute('role', 'log');
  dom.chat.setAttribute('aria-live', 'polite');
  dom.chat.setAttribute('aria-relevant', 'additions');
}

// ──────────────────────────────────────────────────────────
// Init feature modules
// ──────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────
// Mobile drawer
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

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    toggleDrawer();
  });

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
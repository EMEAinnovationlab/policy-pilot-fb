// chatRenderer.js
// ------------------------------------------------------------
// This file owns chat DOM rendering and UI state.
//
// What it does:
// - renders user and assistant message shells
// - controls loading/spinner state
// - controls send/stop/input UI state while streaming
// - handles textarea auto-growth and reset
// - renders static assistant messages
// - adds post-action buttons under completed assistant messages
//
// Why this file exists:
// Rendering concerns change for visual reasons. That is different
// from conversation state and different from network streaming.
// By isolating rendering here, UI changes stay local.
// ------------------------------------------------------------

import {
  renderAssistantHeader,
  getOrCreateContentContainer
} from './strapline.js';
import { renderMarkdownAndFadeNew } from './markdown.js';

export function createChatRenderer({
  dom,
  examples,
  config,
  getLastAssistantText,
  onSummaryRequest
}) {
  function append(role, html = '') {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = html;
    dom.chat.appendChild(div);
    dom.chat.scrollTop = dom.chat.scrollHeight;
    return div;
  }

  const show = (el) => el && el.classList.remove('hide');
  const hide = (el) => el && el.classList.add('hide');

  function setButtonsStreaming(isStreaming) {
    if (isStreaming) {
      if (dom.sendBtn) {
        dom.sendBtn.disabled = true;
        dom.sendBtn.style.opacity = '0.6';
        dom.sendBtn.style.cursor = 'not-allowed';
        dom.sendBtn.dataset.loading = '1';
      }

      if (dom.input) {
        dom.input.disabled = true;
        dom.input.setAttribute('aria-busy', 'true');
      }

      show(dom.stopBtn);
    } else {
      if (dom.sendBtn) {
        dom.sendBtn.disabled = false;
        dom.sendBtn.style.opacity = '1';
        dom.sendBtn.style.cursor = 'pointer';
        delete dom.sendBtn.dataset.loading;
      }

      if (dom.input) {
        dom.input.disabled = false;
        dom.input.removeAttribute('aria-busy');
      }

      hide(dom.stopBtn);
    }
  }

  function showThinking(div, on = true) {
    if (on && !div._spinner) {
      const s = document.createElement('span');
      s.className = 'spinner';
      div.appendChild(s);
      div._spinner = s;
    } else if (!on && div._spinner) {
      div._spinner.remove();
      div._spinner = null;
    }
  }

  function resetTextareaHeight() {
    if (!dom.input) return;
    dom.input.value = '';
    dom.input.style.height = '56px';
    dom.input.style.overflowY = 'hidden';
  }

  function autoGrowTextarea() {
    if (!dom.input) return;
    dom.input.style.height = 'auto';
    const newHeight = Math.min(dom.input.scrollHeight, 300);
    dom.input.style.height = `${newHeight}px`;
    dom.input.style.overflowY = dom.input.scrollHeight > 300 ? 'auto' : 'hidden';
  }

  function ensureAssistantShell({
    assistantDiv,
    headerText,
    straplineShown,
    contentEl
  }) {
    let nextStraplineShown = straplineShown;
    let nextContentEl = contentEl;

    if (!nextStraplineShown) {
      renderAssistantHeader(
        assistantDiv,
        headerText,
        config.STRAPLINE.iconUrl,
        config.STRAPLINE.defaultText
      );
      nextStraplineShown = true;
      nextContentEl = getOrCreateContentContainer(assistantDiv);
    }

    return {
      straplineShown: nextStraplineShown,
      contentEl: nextContentEl
    };
  }

  function createAssistantMessageShell({ headerText }) {
    const assistantDiv = append('assistant', '');
    assistantDiv.classList.add('initializing');
    assistantDiv._rawTextBuffer = '';

    return {
      assistantDiv,
      headerText,
      straplineShown: false,
      contentEl: null
    };
  }

  function revealAssistantShell(shell) {
    const ensured = ensureAssistantShell(shell);
    requestAnimationFrame(() => {
      shell.assistantDiv.classList.add('ready');
    });
    return {
      ...shell,
      ...ensured
    };
  }

  function renderAssistantToken(shell, tokenText) {
    const ensured = ensureAssistantShell(shell);

    shell.assistantDiv._rawTextBuffer += tokenText || '';
    renderMarkdownAndFadeNew(ensured.contentEl, shell.assistantDiv._rawTextBuffer);
    dom.chat.scrollTop = dom.chat.scrollHeight;

    return {
      ...shell,
      ...ensured
    };
  }

  function renderAssistantError(shell, message) {
    const ensured = ensureAssistantShell(shell);

    const err = document.createElement('div');
    err.style.cssText = 'color:red; margin-top:6px;';
    err.textContent = message;
    shell.assistantDiv.appendChild(err);

    return {
      ...shell,
      ...ensured
    };
  }

  function addPostActions(assistantDiv, { showSummary = false } = {}) {
    if (!assistantDiv) return;
    if (assistantDiv.querySelector('.pp-post-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'pp-post-actions';

    const btnData = document.createElement('button');
    btnData.type = 'button';
    btnData.className = 'pp-post-btn';
    btnData.textContent = 'Nieuw data verzoek';
    btnData.addEventListener('click', () => {
      examples?.openExamples?.();
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
      });
    });

    actions.appendChild(btnData);

    if (showSummary) {
      const btnSummary = document.createElement('button');
      btnSummary.type = 'button';
      btnSummary.className = 'pp-post-btn';
      btnSummary.textContent = 'Maak samenvatting';
      btnSummary.addEventListener('click', async () => {
        const summaryPrompt = (config?.SUMMARY_PROMPT || '').trim();
        if (!summaryPrompt) return;

        const baseText = (getLastAssistantText?.() || '').trim();
        const payload = baseText
          ? `${summaryPrompt}\n\n---\n\n${baseText}`
          : summaryPrompt;

        await onSummaryRequest?.(payload);
      });

      actions.appendChild(btnSummary);
    }

    const content = assistantDiv.querySelector('.content') || assistantDiv;
    content.appendChild(actions);
  }

  function renderStaticAssistantMessage(markdownText, { straplineText } = {}) {
    const assistantDiv = append('assistant', '');
    assistantDiv.classList.add('initializing');

    const headerText =
      straplineText ?? config.STRAPLINE.autoStartText ?? config.STRAPLINE.defaultText;

    renderAssistantHeader(
      assistantDiv,
      headerText,
      config.STRAPLINE.iconUrl,
      config.STRAPLINE.defaultText
    );

    const contentEl = getOrCreateContentContainer(assistantDiv);
    renderMarkdownAndFadeNew(contentEl, markdownText || '');

    requestAnimationFrame(() => {
      assistantDiv.classList.add('ready');
    });

    return assistantDiv;
  }

  function renderUserMessage(prompt) {
    const html = window.marked?.parse ? window.marked.parse(prompt) : String(prompt);
    append('user', html);
    resetTextareaHeight();
  }

  return {
    append,
    setButtonsStreaming,
    showThinking,
    resetTextareaHeight,
    autoGrowTextarea,
    createAssistantMessageShell,
    revealAssistantShell,
    renderAssistantToken,
    renderAssistantError,
    renderStaticAssistantMessage,
    renderUserMessage,
    addPostActions
  };
}
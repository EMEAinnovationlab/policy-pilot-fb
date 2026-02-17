// chatFlow.js
import { renderAssistantHeader, getOrCreateContentContainer } from './strapline.js';
import { renderMarkdownAndFadeNew } from './markdown.js';

export function createChatController({
  dom,
  examples,
  config,
  getUseRetrieval
}) {
  let controller = null;
  let conversation = [];
  let lastAssistantText = '';

  function append(role, html = '') {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = html;
    dom.chat.appendChild(div);
    dom.chat.scrollTop = dom.chat.scrollHeight;
    return div;
  }

  const show = el => el && el.classList.remove('hide');
  const hide = el => el && el.classList.add('hide');

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
    dom.input.style.height = newHeight + 'px';
    dom.input.style.overflowY =
      dom.input.scrollHeight > 300 ? 'auto' : 'hidden';
  }

  function clearConversationMemory() {
    conversation = [];
    lastAssistantText = '';
  }

  // ─────────────────────────────────────────
  // Post-action buttons
  // mode:
  // true        → both buttons
  // "data-only" → only "Nieuw data verzoek"
  // false       → no buttons
  // ─────────────────────────────────────────
  function addPostActions(assistantDiv, mode = true) {
    if (!assistantDiv || !mode) return;
    if (assistantDiv.querySelector('.pp-post-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'pp-post-actions';

    // Always allowed in both modes
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

    // Only show summary button if mode === true
    if (mode === true) {
      const btnSummary = document.createElement('button');
      btnSummary.type = 'button';
      btnSummary.className = 'pp-post-btn';
      btnSummary.textContent = 'Maak samenvatting';

      btnSummary.addEventListener('click', async () => {
        const summaryPrompt = (config?.SUMMARY_PROMPT || '').trim();
        if (!summaryPrompt) return;

        const baseText = (lastAssistantText || '').trim();
        const payload = baseText
          ? `${summaryPrompt}\n\n---\n\n${baseText}`
          : summaryPrompt;

        await streamAssistantFromPrompt(payload, {
          echoUser: false,
          closeExamplesOnStart: true,
          straplineText: 'SAMENVATTING',
          showPostActions: 'data-only' // 👈 only data button after summary
        });
      });

      actions.appendChild(btnSummary);
    }

    const content = assistantDiv.querySelector('.content') || assistantDiv;
    content.appendChild(actions);
  }

  // Intro (never shows buttons)
  function renderStaticAssistantMessage(markdownText, { straplineText } = {}) {
    const assistantDiv = append('assistant', '');
    assistantDiv.classList.add('initializing');

    const headerText =
      straplineText ??
      config.STRAPLINE.autoStartText ??
      config.STRAPLINE.defaultText;

    renderAssistantHeader(
      assistantDiv,
      headerText,
      config.STRAPLINE.iconUrl,
      config.STRAPLINE.defaultText
    );

    const contentEl = getOrCreateContentContainer(assistantDiv);
    renderMarkdownAndFadeNew(contentEl, markdownText || '');
    requestAnimationFrame(() => assistantDiv.classList.add('ready'));

    if (markdownText?.trim()) {
      conversation.push({ role: 'assistant', content: markdownText });
      lastAssistantText = markdownText;
    }

    return assistantDiv;
  }

  async function streamAssistantFromPrompt(
    prompt,
    {
      echoUser = true,
      closeExamplesOnStart = true,
      straplineText,
      showPostActions = true
    } = {}
  ) {
    const useRetrievalForThisRequest =
      !!(getUseRetrieval && getUseRetrieval());

    if (closeExamplesOnStart)
      examples?.closeExamples?.({ animate: true, scroll: true });

    if (echoUser) {
      const html = window.marked?.parse
        ? window.marked.parse(prompt)
        : prompt;
      append('user', html);
      resetTextareaHeight();
    }

    const assistantDiv = append('assistant', '');
    assistantDiv.classList.add('initializing');

    showThinking(assistantDiv, true);
    controller = new AbortController();
    setButtonsStreaming(true);

    const headerText =
      straplineText ??
      (echoUser
        ? config.STRAPLINE.defaultText
        : config.STRAPLINE.autoStartText);

    let straplineShown = false;
    let contentEl = null;

    assistantDiv._rawTextBuffer = '';

    try {
      const resp = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          useRetrieval: useRetrievalForThisRequest,
          history: conversation
        }),
        signal: controller.signal
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotAnyToken = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          const evt = JSON.parse(payload);

          if (evt.type === 'token') {
            if (!gotAnyToken) {
              showThinking(assistantDiv, false);
              renderAssistantHeader(
                assistantDiv,
                headerText,
                config.STRAPLINE.iconUrl,
                config.STRAPLINE.defaultText
              );
              straplineShown = true;
              contentEl = getOrCreateContentContainer(assistantDiv);
              requestAnimationFrame(() =>
                assistantDiv.classList.add('ready')
              );
              gotAnyToken = true;
            }

            assistantDiv._rawTextBuffer += evt.text || '';
            renderMarkdownAndFadeNew(
              contentEl,
              assistantDiv._rawTextBuffer
            );
            dom.chat.scrollTop = dom.chat.scrollHeight;
          }
        }
      }

      if (echoUser)
        conversation.push({ role: 'user', content: prompt });

      if (assistantDiv._rawTextBuffer?.trim()) {
        conversation.push({
          role: 'assistant',
          content: assistantDiv._rawTextBuffer
        });
        lastAssistantText = assistantDiv._rawTextBuffer;
      }

      // 👇 Add buttons AFTER completion
      addPostActions(assistantDiv, showPostActions);

    } catch (err) {
      console.error(err);
    } finally {
      setButtonsStreaming(false);
      controller = null;
    }
  }

  async function sendMessage() {
    const text = (dom.input?.value || '').trim();
    if (!text || controller) return;

    await streamAssistantFromPrompt(text, {
      echoUser: true,
      closeExamplesOnStart: true,
      showPostActions: true
    });
  }

  return {
    sendMessage,
    streamAssistantFromPrompt,
    renderStaticAssistantMessage,
    autoGrowTextarea,
    resetTextareaHeight,
    setButtonsStreaming,
    clearConversationMemory
  };
}

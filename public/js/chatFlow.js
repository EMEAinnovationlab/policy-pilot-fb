// chatFlow.js
import { renderAssistantHeader, getOrCreateContentContainer } from './strapline.js';
import { renderMarkdownAndFadeNew } from './markdown.js';

export function createChatController({
  dom,        // { chat, input, sendBtn, stopBtn, clearBtn }
  examples,   // { closeExamples, openExamples }
  config,     // { STRAPLINE, DEFAULT_WELCOME_PROMPT, SUMMARY_PROMPT }
  getUseRetrieval
}) {
  let controller = null;

  // Client-side conversation memory (only complete turns)
  let conversation = [];

  // Latest completed assistant output (used for summary)
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
    dom.input.style.overflowY = dom.input.scrollHeight > 300 ? 'auto' : 'hidden';
  }

  function stopStreaming() {
    try { controller?.abort(); } catch {}
  }

  function clearConversationMemory() {
    conversation = [];
    lastAssistantText = '';
  }

  // Post-actions UI: mode controls which buttons to show
  // mode:
  //   true        => show both buttons (data + summary)
  //   "data-only" => only "Nieuw data verzoek"
  //   false       => none
  function addPostActions(assistantDiv, mode = true) {
    if (!assistantDiv || !mode) return;
    if (assistantDiv.querySelector('.pp-post-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'pp-post-actions';

    // "Nieuw data verzoek" (always shown when mode !== false)
    const btnData = document.createElement('button');
    btnData.type = 'button';
    btnData.className = 'pp-post-btn';
    btnData.textContent = 'Nieuw data verzoek';
    btnData.addEventListener('click', () => {
      examples?.openExamples?.();
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
    actions.appendChild(btnData);

    // "Maak samenvatting" only when mode === true
    if (mode === true) {
      const btnSummary = document.createElement('button');
      btnSummary.type = 'button';
      btnSummary.className = 'pp-post-btn';
      btnSummary.textContent = 'Maak samenvatting';

      btnSummary.addEventListener('click', async () => {
        const summaryPrompt = (config?.SUMMARY_PROMPT || '').trim();
        if (!summaryPrompt) return;

        const baseText = (lastAssistantText || '').trim();
        const payload = baseText ? `${summaryPrompt}\n\n---\n\n${baseText}` : summaryPrompt;

        // Summary output should NOT show another summary button,
        // but should still show "Nieuw data verzoek"
        await streamAssistantFromPrompt(payload, {
          echoUser: false,
          closeExamplesOnStart: true,
          straplineText: 'SAMENVATTING',
          showPostActions: 'data-only'
        });
      });

      actions.appendChild(btnSummary);
    }

    const content = assistantDiv.querySelector('.content') || assistantDiv;
    content.appendChild(actions);
  }

  // Hardcoded intro message — keep as plain text (not a backend prompt)
  // but show "Nieuw data verzoek" after rendering.
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
    requestAnimationFrame(() => assistantDiv.classList.add('ready'));

    // Seed memory locally (doesn't call backend)
    if (markdownText && String(markdownText).trim()) {
      conversation.push({ role: 'assistant', content: String(markdownText) });
      lastAssistantText = String(markdownText);
    }

    // Intro should only have "Nieuw data verzoek"
    addPostActions(assistantDiv, 'data-only');

    return assistantDiv;
  }

  async function streamAssistantFromPrompt(
    prompt,
    {
      echoUser = true,
      closeExamplesOnStart = true,
      straplineText,
      showPostActions = 'auto' // 'auto' decides based on retrieval for THIS request
    } = {}
  ) {
    // Capture retrieval state BEFORE we possibly close examples
    const useRetrievalForThisRequest = !!(getUseRetrieval && getUseRetrieval());

    if (closeExamplesOnStart) examples?.closeExamples?.({ animate: true, scroll: true });

    // UI: render user message (but DO NOT commit it to memory yet)
    if (echoUser) {
      const html = window.marked?.parse ? window.marked.parse(prompt) : String(prompt);
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
      (echoUser ? config.STRAPLINE.defaultText : config.STRAPLINE.autoStartText);

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

      if (!resp.ok || !resp.body) {
        showThinking(assistantDiv, false);
        if (!straplineShown) {
          renderAssistantHeader(
            assistantDiv,
            headerText,
            config.STRAPLINE.iconUrl,
            config.STRAPLINE.defaultText
          );
          straplineShown = true;
          contentEl = getOrCreateContentContainer(assistantDiv);
        }
        contentEl.innerHTML = '<span style="color:red">Error: failed to connect.</span>';
        assistantDiv.classList.add('ready');

        // Decide post-mode: auto -> depends on retrieval for this request
        const postMode =
          showPostActions === 'auto'
            ? (useRetrievalForThisRequest ? true : 'data-only')
            : showPostActions;

        addPostActions(assistantDiv, postMode);
        return;
      }

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

          try {
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
                requestAnimationFrame(() => assistantDiv.classList.add('ready'));
                gotAnyToken = true;
              }

              assistantDiv._rawTextBuffer += evt.text || '';
              renderMarkdownAndFadeNew(contentEl, assistantDiv._rawTextBuffer);
              dom.chat.scrollTop = dom.chat.scrollHeight;

            } else if (evt.type === 'error') {
              if (!straplineShown) {
                showThinking(assistantDiv, false);
                renderAssistantHeader(
                  assistantDiv,
                  headerText,
                  config.STRAPLINE.iconUrl,
                  config.STRAPLINE.defaultText
                );
                straplineShown = true;
                contentEl = getOrCreateContentContainer(assistantDiv);
              }
              const errEl = document.createElement('div');
              errEl.style.cssText = 'color:red; margin-top:6px;';
              try {
                errEl.textContent = String(evt.message || 'Error');
              } catch (e) {
                errEl.textContent = 'Error';
              }
              assistantDiv.appendChild(errEl);
            }
          } catch (parseError) {
            // ignore parse errors
          }
        }
      }

      // Commit full turn AFTER completion
      if (echoUser) conversation.push({ role: 'user', content: prompt });

      if (assistantDiv._rawTextBuffer && assistantDiv._rawTextBuffer.trim()) {
        const finalText = assistantDiv._rawTextBuffer;
        conversation.push({ role: 'assistant', content: finalText });
        lastAssistantText = finalText;
      }

      // Decide which buttons to show AFTER completion
      const postMode =
        showPostActions === 'auto'
          ? (useRetrievalForThisRequest ? true : 'data-only')
          : showPostActions;

      addPostActions(assistantDiv, postMode);

    } catch (error) {
      showThinking(assistantDiv, false);
      if (!straplineShown) {
        renderAssistantHeader(
          assistantDiv,
          headerText,
          config.STRAPLINE.iconUrl,
          config.STRAPLINE.defaultText
        );
        straplineShown = true;
        contentEl = getOrCreateContentContainer(assistantDiv);
      }
      const msg = controller ? '[Connection aborted]' : '[Connection error]';
      const errEl = document.createElement('div');
      errEl.style.cssText = 'color:red; margin-top:6px;';
      errEl.textContent = String(error?.message || error || msg);
      assistantDiv.appendChild(errEl);

      const postMode =
        showPostActions === 'auto'
          ? (useRetrievalForThisRequest ? true : 'data-only')
          : showPostActions;

      addPostActions(assistantDiv, postMode);
    } finally {
      setButtonsStreaming(false);
      controller = null;
    }
  }

  async function sendMessage() {
    const text = (dom.input?.value || '').trim();
    if (!text || controller) return;

    // support typed summary command
    if (text.toLowerCase() === 'maak samenvatting') {
      const summaryPrompt = (config?.SUMMARY_PROMPT || '').trim();
      if (!summaryPrompt) return;

      const baseText = (lastAssistantText || '').trim();
      const payload = baseText ? `${summaryPrompt}\n\n---\n\n${baseText}` : summaryPrompt;

      await streamAssistantFromPrompt(payload, {
        echoUser: false,
        closeExamplesOnStart: true,
        straplineText: 'SAMENVATTING',
        showPostActions: 'data-only'
      });

      resetTextareaHeight();
      return;
    }

    await streamAssistantFromPrompt(text, {
      echoUser: true,
      closeExamplesOnStart: true,
      showPostActions: 'auto'
    });
  }

  return {
    sendMessage,
    streamAssistantFromPrompt,
    renderStaticAssistantMessage,
    autoGrowTextarea,
    resetTextareaHeight,
    setButtonsStreaming,
    stopStreaming,
    clearConversationMemory
  };
}

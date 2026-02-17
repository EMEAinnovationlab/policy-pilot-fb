// chatFlow.js
import { renderAssistantHeader, getOrCreateContentContainer } from './strapline.js';
import { renderMarkdownAndFadeNew } from './markdown.js';

export function createChatController({
  dom,        // { chat, input, sendBtn, stopBtn, clearBtn }
  examples,   // { closeExamples, openExamples }
  config,     // { STRAPLINE, DEFAULT_WELCOME_PROMPT }
  getUseRetrieval
}) {
  let controller = null;

  // ✅ Client-side conversation memory that we send to the backend.
  // IMPORTANT: We only append a full turn (user+assistant) AFTER the assistant finishes,
  // so history is always "complete turns" and never half-baked.
  let conversation = [];

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

      // ✅ mark as loading (used by CSS hover rule)
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

      // ✅ remove loading marker
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

  // ✅ Stop streaming (optional to wire in main.js)
  function stopStreaming() {
    try { controller?.abort(); } catch {}
  }

  // ✅ Clear memory (call this when you start a new chat)
  function clearConversationMemory() {
    conversation = [];
  }

  async function streamAssistantFromPrompt(
    prompt,
    { echoUser = true, closeExamplesOnStart = true, straplineText } = {}
  ) {
    // ✅ Capture retrieval state BEFORE we possibly close examples
    const useRetrievalForThisRequest = !!(getUseRetrieval && getUseRetrieval());

    if (closeExamplesOnStart) examples.closeExamples({ animate: true, scroll: true });

    // UI: render user message (but DO NOT commit it to memory yet)
    if (echoUser) {
      append('user', marked.parse(prompt));
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

    // Buffer for this assistant turn
    assistantDiv._rawTextBuffer = '';

    try {
      // ✅ Send only *completed* history (previous turns)
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

              assistantDiv._rawTextBuffer += evt.text;
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
              const err = document.createElement('div');
              err.style.cssText = 'color:red; margin-top:6px;';
              err.textContent = `[Error] ${evt.message}`;
              assistantDiv.appendChild(err);
            } else if (evt.type === 'done') {
              // no-op
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      // ✅ Commit the full turn to memory (user + assistant) AFTER completion.
      if (echoUser) {
        conversation.push({ role: 'user', content: prompt });
      }
      if (assistantDiv._rawTextBuffer && assistantDiv._rawTextBuffer.trim()) {
        conversation.push({ role: 'assistant', content: assistantDiv._rawTextBuffer });
      }

    } catch {
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
      const err = document.createElement('div');
      err.style.cssText = 'color:red; margin-top:6px;';
      err.textContent = msg;
      assistantDiv.appendChild(err);
    } finally {
      setButtonsStreaming(false);
      controller = null;
    }
  }

  async function sendMessage() {
    const text = (dom.input?.value || '').trim();
    if (!text || controller) return;
    await streamAssistantFromPrompt(text, { echoUser: true, closeExamplesOnStart: true });
  }

  return {
    sendMessage,
    streamAssistantFromPrompt,
    autoGrowTextarea,
    resetTextareaHeight,
    setButtonsStreaming,
    stopStreaming,
    clearConversationMemory
  };
}

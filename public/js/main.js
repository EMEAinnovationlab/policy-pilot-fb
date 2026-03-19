// public/main.js

(() => {
  const STORAGE_KEY = 'poli_pilot_chat_state_v1';
  const STORAGE_TTL_MS = 5 * 60 * 1000;

  const state = {
    analysisStarted: false,
    isSending: false,
    useRetrieval: false,
    messages: [],
    sources: [],
    currentAssistantBubble: null,
    currentAssistantText: ''
  };

  const el = {
    chat: document.getElementById('chat'),
    composer: document.getElementById('composer'),
    input: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),

    introSection: document.getElementById('introSection'),
    introButtonsWrap: document.getElementById('introButtonsWrap'),
    startAnalysisBtn: document.getElementById('startAnalysisBtn'),
    howItWorksBtn: document.getElementById('howItWorksBtn'),

    analysisPanel: document.getElementById('analysisPanel'),
    newAnalysisBtn: document.getElementById('newAnalysisBtn'),
    retrievalToggle: document.getElementById('retrievalToggle'),

    confirmModal: document.getElementById('confirmModal'),
    confirmModalTitle: document.getElementById('confirmModalTitle'),
    confirmModalText: document.getElementById('confirmModalText'),
    confirmCancelBtn: document.getElementById('confirmCancelBtn'),
    confirmOkBtn: document.getElementById('confirmOkBtn'),
    confirmOverlay: document.getElementById('confirmOverlay')
  };

  let pendingConfirmAction = null;

  function hasRequiredElements() {
    return !!(
      el.chat &&
      el.input &&
      el.sendBtn &&
      el.introSection &&
      el.introButtonsWrap &&
      el.startAnalysisBtn &&
      el.analysisPanel &&
      el.newAnalysisBtn
    );
  }

  if (!hasRequiredElements()) {
    console.warn('main.js: missing required DOM elements');
    return;
  }

  function now() {
    return Date.now();
  }

  function saveState() {
    const payload = {
      expiresAt: now() + STORAGE_TTL_MS,
      analysisStarted: state.analysisStarted,
      useRetrieval: state.useRetrieval,
      messages: state.messages,
      sources: state.sources
    };

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Could not save session state:', err);
    }
  }

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.expiresAt || parsed.expiresAt < now()) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      state.analysisStarted = !!parsed.analysisStarted;
      state.useRetrieval = !!parsed.useRetrieval;
      state.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      state.sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    } catch (err) {
      console.warn('Could not load session state:', err);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function clearSavedState() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('Could not clear session state:', err);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatAssistantText(text) {
    const escaped = escapeHtml(text);

    return escaped
      .replace(/\n```([\s\S]*?)```/g, (_m, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  function renderMessage(msg) {
    const node = document.createElement('div');
    node.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;

    if (msg.role === 'assistant') {
      const content = document.createElement('div');
      const safeHtml = `<p>${formatAssistantText(msg.content || '')}</p>`;
      content.innerHTML = safeHtml;
      node.appendChild(content);

      if (Array.isArray(msg.sources) && msg.sources.length) {
        node.appendChild(renderSources(msg.sources));
      }
    } else {
      node.textContent = msg.content || '';
    }

    el.chat.appendChild(node);
    scrollChatToBottom();
    return node;
  }

  function renderSources(items) {
    const wrap = document.createElement('div');
    wrap.className = 'sources';

    const title = document.createElement('div');
    title.textContent = 'Sources';
    wrap.appendChild(title);

    items.forEach((item) => {
      const row = document.createElement('div');

      if (item.url) {
        const a = document.createElement('a');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `[#${item.n}] ${item.title}`;
        row.appendChild(a);
      } else {
        row.textContent = `[#${item.n}] ${item.title}`;
      }

      wrap.appendChild(row);
    });

    return wrap;
  }

  function renderAllMessages() {
    el.chat.innerHTML = '';
    for (const msg of state.messages) {
      renderMessage(msg);
    }
  }

  function addUserMessage(content) {
    const msg = { role: 'user', content };
    state.messages.push(msg);
    renderMessage(msg);
    saveState();
  }

  function beginAssistantMessage() {
    state.currentAssistantText = '';
    state.currentAssistantBubble = document.createElement('div');
    state.currentAssistantBubble.className = 'msg assistant';
    state.currentAssistantBubble.innerHTML = '<p><span class="spinner"></span></p>';
    el.chat.appendChild(state.currentAssistantBubble);
    scrollChatToBottom();
  }

  function appendAssistantToken(token) {
    state.currentAssistantText += token;

    if (!state.currentAssistantBubble) return;

    const safeHtml = `<p>${formatAssistantText(state.currentAssistantText)}</p>`;
    state.currentAssistantBubble.innerHTML = safeHtml;
    scrollChatToBottom();
  }

  function finalizeAssistantMessage(sources = []) {
    const content = state.currentAssistantText.trim();

    if (!state.currentAssistantBubble) return;

    state.currentAssistantBubble.innerHTML = `<p>${formatAssistantText(content)}</p>`;

    if (sources.length) {
      state.currentAssistantBubble.appendChild(renderSources(sources));
    }

    state.messages.push({
      role: 'assistant',
      content,
      sources
    });

    state.sources = sources;
    state.currentAssistantBubble = null;
    state.currentAssistantText = '';
    saveState();
  }

  function failAssistantMessage(errorText) {
    if (state.currentAssistantBubble) {
      state.currentAssistantBubble.innerHTML = `<p>${escapeHtml(errorText || 'Something went wrong.')}</p>`;
    }

    state.messages.push({
      role: 'assistant',
      content: errorText || 'Something went wrong.',
      sources: []
    });

    state.currentAssistantBubble = null;
    state.currentAssistantText = '';
    saveState();
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      el.chat.scrollTop = el.chat.scrollHeight;
      const main = document.querySelector('main');
      if (main) main.scrollTop = main.scrollHeight;
    });
  }

  function setSending(isSending) {
    state.isSending = isSending;
    el.sendBtn.disabled = isSending;
    el.input.disabled = isSending;
    el.startAnalysisBtn.disabled = isSending;
    el.newAnalysisBtn.disabled = isSending;
  }

  function showIntroButtons() {
    el.introButtonsWrap.hidden = false;
  }

  function hideIntroButtons() {
    el.introButtonsWrap.hidden = true;
  }

  function showAnalysisPanel() {
    el.analysisPanel.hidden = false;
  }

  function hideAnalysisPanel() {
    el.analysisPanel.hidden = true;
  }

  function updateUiFromState() {
    if (el.retrievalToggle) {
      el.retrievalToggle.checked = state.useRetrieval;
    }

    if (state.analysisStarted) {
      hideIntroButtons();
      showAnalysisPanel();
      el.introSection.classList.add('intro-collapsed');
    } else {
      showIntroButtons();
      hideAnalysisPanel();
      el.introSection.classList.remove('intro-collapsed');
    }
  }

  function startAnalysisMode() {
    state.analysisStarted = true;
    hideIntroButtons();
    showAnalysisPanel();
    el.introSection.classList.add('intro-collapsed');
    saveState();
    scrollChatToBottom();
    el.input.focus();
  }

  function hardResetConversation() {
    state.analysisStarted = false;
    state.isSending = false;
    state.messages = [];
    state.sources = [];
    state.currentAssistantBubble = null;
    state.currentAssistantText = '';

    el.chat.innerHTML = '';
    el.input.value = '';

    if (el.retrievalToggle) {
      state.useRetrieval = !!el.retrievalToggle.checked;
    }

    clearSavedState();
    updateUiFromState();
  }

  function openConfirmModal({
    title = 'Are you sure?',
    text = 'This will clear the current conversation.',
    onConfirm
  }) {
    pendingConfirmAction = onConfirm || null;

    if (el.confirmModalTitle) el.confirmModalTitle.textContent = title;
    if (el.confirmModalText) el.confirmModalText.textContent = text;

    el.confirmModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeConfirmModal() {
    el.confirmModal.hidden = true;
    document.body.classList.remove('modal-open');
    pendingConfirmAction = null;
  }

  function confirmModalOk() {
    const action = pendingConfirmAction;
    closeConfirmModal();
    if (typeof action === 'function') action();
  }

  async function sendMessage() {
    const message = el.input.value.trim();
    if (!message || state.isSending) return;

    if (!state.analysisStarted) {
      startAnalysisMode();
    }

    addUserMessage(message);
    el.input.value = '';
    setSending(true);
    beginAssistantMessage();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          useRetrieval: state.useRetrieval,
          history: state.messages
        })
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneReceived = false;
      let pendingSources = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const line = chunk
            .split('\n')
            .find((x) => x.trim().startsWith('data:'));

          if (!line) continue;

          const payload = line.replace(/^data:\s*/, '');

          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          if (parsed.type === 'token') {
            appendAssistantToken(parsed.text || '');
          }

          if (parsed.type === 'sources') {
            pendingSources = Array.isArray(parsed.items) ? parsed.items : [];
          }

          if (parsed.type === 'error') {
            throw new Error(parsed.message || 'Server error');
          }

          if (parsed.type === 'done') {
            finalizeAssistantMessage(pendingSources);
            doneReceived = true;
          }
        }
      }

      if (!doneReceived) {
        finalizeAssistantMessage([]);
      }
    } catch (err) {
      console.error('sendMessage error:', err);
      failAssistantMessage(err.message || 'Something went wrong.');
    } finally {
      setSending(false);
      saveState();
    }
  }

  function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function bindEvents() {
    el.startAnalysisBtn.addEventListener('click', () => {
      startAnalysisMode();
    });

    if (el.howItWorksBtn) {
      el.howItWorksBtn.addEventListener('click', () => {
        const info =
          'How it works:\n\n1. Click "New analysis"\n2. The analysis area opens\n3. The intro buttons disappear\n4. They stay hidden during the conversation\n5. Only a real reset brings them back';

        if (!state.analysisStarted) {
          startAnalysisMode();
        }

        addUserMessage('How does this work?');
        state.messages.push({
          role: 'assistant',
          content: info,
          sources: []
        });
        renderMessage({
          role: 'assistant',
          content: info,
          sources: []
        });
        saveState();
      });
    }

    el.newAnalysisBtn.addEventListener('click', () => {
      openConfirmModal({
        title: 'Start a new conversation?',
        text: 'This will clear the current analysis and bring back the intro buttons.',
        onConfirm: () => {
          hardResetConversation();
        }
      });
    });

    el.sendBtn.addEventListener('click', sendMessage);
    el.input.addEventListener('keydown', handleInputKeydown);

    if (el.retrievalToggle) {
      el.retrievalToggle.addEventListener('change', () => {
        state.useRetrieval = !!el.retrievalToggle.checked;
        saveState();
      });
    }

    if (el.confirmCancelBtn) {
      el.confirmCancelBtn.addEventListener('click', closeConfirmModal);
    }

    if (el.confirmOkBtn) {
      el.confirmOkBtn.addEventListener('click', confirmModalOk);
    }

    if (el.confirmOverlay) {
      el.confirmOverlay.addEventListener('click', closeConfirmModal);
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && el.confirmModal && !el.confirmModal.hidden) {
        closeConfirmModal();
      }
    });
  }

  function init() {
    loadState();
    updateUiFromState();
    renderAllMessages();
    bindEvents();
    scrollChatToBottom();
  }

  init();
})();

// chatTransport.js
// ------------------------------------------------------------
// This file owns the network transport and streaming layer.
//
// What it does:
// - sends requests to /chat
// - passes conversation history to the backend
// - reads the streaming response
// - parses SSE-style "data:" lines
// - forwards tokens/errors to callbacks
// - manages abort control for stop-streaming behavior
//
// Why this file exists:
// Transport logic changes when backend protocol or streaming
// behavior changes. That is different from rendering and
// different from memory/state concerns.
// ------------------------------------------------------------

export function createChatTransport({
  getConversation,
  getUseRetrieval
}) {
  let controller = null;

  function isStreaming() {
    return !!controller;
  }

  function stopStreaming() {
    try {
      controller?.abort();
    } catch {}
  }

  async function streamAssistantFromPrompt(prompt, handlers = {}) {
    const {
      onStart,
      onOpen,
      onToken,
      onError,
      onDone,
      onFinally
    } = handlers;

    const useRetrievalForThisRequest = !!(getUseRetrieval && getUseRetrieval());

    controller = new AbortController();

    try {
      await onStart?.({
        prompt,
        useRetrieval: useRetrievalForThisRequest,
        controller
      });

      const resp = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          useRetrieval: useRetrievalForThisRequest,
          history: getConversation()
        }),
        signal: controller.signal
      });

      if (!resp.ok || !resp.body) {
        await onError?.({
          message: 'Error: failed to connect.',
          isTransportError: true,
          useRetrieval: useRetrievalForThisRequest
        });
        return;
      }

      await onOpen?.({
        useRetrieval: useRetrievalForThisRequest
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
              await onToken?.({
                text: evt.text || '',
                useRetrieval: useRetrievalForThisRequest
              });
            } else if (evt.type === 'error') {
              await onError?.({
                message: `[Error] ${evt.message}`,
                isTransportError: false,
                useRetrieval: useRetrievalForThisRequest
              });
            } else if (evt.type === 'done') {
              await onDone?.({
                useRetrieval: useRetrievalForThisRequest,
                aborted: false
              });
              return;
            }
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }

      await onDone?.({
        useRetrieval: useRetrievalForThisRequest,
        aborted: false
      });
    } catch {
      const aborted = !!controller;
      await onError?.({
        message: aborted ? '[Connection aborted]' : '[Connection error]',
        isTransportError: true,
        aborted,
        useRetrieval: useRetrievalForThisRequest
      });
    } finally {
      controller = null;
      await onFinally?.();
    }
  }

  return {
    isStreaming,
    stopStreaming,
    streamAssistantFromPrompt
  };
}
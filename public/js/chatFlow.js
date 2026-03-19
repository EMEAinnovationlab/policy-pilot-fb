// chatFlow.js
// ------------------------------------------------------------
// This file is the orchestrator for the chat system.
//
// What it does:
// - assembles memory, renderer, and transport into one controller
// - keeps the public API stable with createChatController(...)
// - coordinates how a single prompt becomes a full chat action
// - decides when to commit completed turns to memory
// - wires summary actions back into the same streaming flow
//
// Why this file exists:
// This file is the "facade" of the chat subsystem.
// Other files each do one thing. This file composes them into
// one usable controller for the rest of the app.
// ------------------------------------------------------------

import { createChatMemory } from './chatMemory.js';
import { createChatRenderer } from './chatRenderer.js';
import { createChatTransport } from './chatTransport.js';

export function createChatController({
  dom,
  examples,
  config,
  getUseRetrieval
}) {
  const memory = createChatMemory();

  let renderer;
  let transport;

  async function streamAssistantFromPrompt(
    prompt,
    {
      echoUser = true,
      closeExamplesOnStart = true,
      straplineText,
      showPostActions = true,
      forceHideSummaryButton = false
    } = {}
  ) {
    const headerText =
      straplineText ??
      (echoUser ? config.STRAPLINE.defaultText : config.STRAPLINE.autoStartText);

    const shell = renderer.createAssistantMessageShell({ headerText });

    const isSummaryRun = String(headerText || '').trim().toUpperCase() === 'SAMENVATTING';

    let shouldShowSummaryButton = false;
    let gotAnyToken = false;
    let currentShell = shell;

    if (closeExamplesOnStart) {
      examples?.closeExamples?.({ animate: true, scroll: true });
    }

    if (echoUser) {
      renderer.renderUserMessage(prompt);
    }

    await transport.streamAssistantFromPrompt(prompt, {
      onStart: async ({ useRetrieval }) => {
        shouldShowSummaryButton =
          !!useRetrieval && !isSummaryRun && !forceHideSummaryButton;

        renderer.showThinking(currentShell.assistantDiv, true);
        renderer.setButtonsStreaming(true);
      },

      onOpen: async () => {},

      onToken: async ({ text }) => {
        if (!gotAnyToken) {
          renderer.showThinking(currentShell.assistantDiv, false);
          currentShell = renderer.revealAssistantShell(currentShell);
          gotAnyToken = true;
        }

        currentShell = renderer.renderAssistantToken(currentShell, text);
      },

      onError: async ({ message, isTransportError }) => {
        renderer.showThinking(currentShell.assistantDiv, false);

        if (!gotAnyToken) {
          currentShell = renderer.revealAssistantShell(currentShell);
        }

        if (isTransportError && currentShell.contentEl) {
          currentShell.contentEl.innerHTML = `<span style="color:red">${message}</span>`;
          currentShell.assistantDiv.classList.add('ready');
        } else {
          currentShell = renderer.renderAssistantError(currentShell, message);
        }

        if (showPostActions) {
          renderer.addPostActions(currentShell.assistantDiv, {
            showSummary: shouldShowSummaryButton
          });
        }
      },

      onDone: async () => {
        const finalText = String(currentShell.assistantDiv._rawTextBuffer || '').trim();

        memory.commitCompletedTurn({
          userPrompt: prompt,
          assistantText: finalText,
          echoUser
        });

        if (showPostActions) {
          renderer.addPostActions(currentShell.assistantDiv, {
            showSummary: shouldShowSummaryButton
          });
        }
      },

      onFinally: async () => {
        renderer.setButtonsStreaming(false);
      }
    });
  }

  renderer = createChatRenderer({
    dom,
    examples,
    config,
    getLastAssistantText: memory.getLastAssistantText,
    onSummaryRequest: async (payload) => {
      await streamAssistantFromPrompt(payload, {
        echoUser: false,
        closeExamplesOnStart: true,
        straplineText: 'SAMENVATTING',
        showPostActions: true,
        forceHideSummaryButton: true
      });
    }
  });

  transport = createChatTransport({
    getConversation: memory.getConversation,
    getUseRetrieval
  });

  function stopStreaming() {
    transport.stopStreaming();
  }

  function clearConversationMemory() {
    memory.clearConversationMemory();
  }

  function renderStaticAssistantMessage(markdownText, opts = {}) {
    const div = renderer.renderStaticAssistantMessage(markdownText, opts);
    memory.seedAssistantMessage(markdownText);
    return div;
  }

  async function sendMessage() {
    const text = (dom.input?.value || '').trim();
    if (!text || transport.isStreaming()) return;

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
    autoGrowTextarea: renderer.autoGrowTextarea,
    resetTextareaHeight: renderer.resetTextareaHeight,
    setButtonsStreaming: renderer.setButtonsStreaming,
    stopStreaming,
    clearConversationMemory
  };
}
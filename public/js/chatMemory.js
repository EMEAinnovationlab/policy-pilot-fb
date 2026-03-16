// chatMemory.js
// ------------------------------------------------------------
// This file owns the client-side conversation state.
//
// What it does:
// - stores the completed conversation history that will be sent
//   back to the backend on the next request
// - stores the latest completed assistant output
// - ensures we only commit complete turns, never half-streamed ones
// - provides a small API for other chat modules
//
// Why this file exists:
// Conversation memory is state, not rendering and not transport.
// Keeping it separate makes it easier to reason about what the
// frontend "remembers" versus how it displays or streams data.
// ------------------------------------------------------------

export function createChatMemory() {
  let conversation = [];
  let lastAssistantText = '';

  function getConversation() {
    return conversation;
  }

  function getLastAssistantText() {
    return lastAssistantText;
  }

  function clearConversationMemory() {
    conversation = [];
    lastAssistantText = '';
  }

  function seedAssistantMessage(text) {
    const clean = String(text || '').trim();
    if (!clean) return;

    conversation.push({
      role: 'assistant',
      content: clean
    });

    lastAssistantText = clean;
  }

  function commitCompletedTurn({ userPrompt, assistantText, echoUser = true }) {
    const cleanUser = String(userPrompt || '').trim();
    const cleanAssistant = String(assistantText || '').trim();

    if (echoUser && cleanUser) {
      conversation.push({
        role: 'user',
        content: cleanUser
      });
    }

    if (cleanAssistant) {
      conversation.push({
        role: 'assistant',
        content: cleanAssistant
      });
      lastAssistantText = cleanAssistant;
    }
  }

  return {
    getConversation,
    getLastAssistantText,
    clearConversationMemory,
    seedAssistantMessage,
    commitCompletedTurn
  };
}
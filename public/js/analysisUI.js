
// analysisUI.js
// ------------------------------------------------------------
// This file controls the UI state around starting a new analysis.
//
// What it does:
// - opens the analysis input box when the user clicks a
//   "new analysis" trigger
// - closes the analysis input box
// - resets the launcher state so the user can begin again
// - hides follow-up chat UI when starting a fresh analysis
//
// Why this file exists:
// The new product is no longer chatbot-first.
// Starting an analysis is now its own explicit UI state.
// ------------------------------------------------------------

export function createAnalysisUI({
  introHero,
  analysisModal,
  analysisFrame,
  chatModal,
  analysisInput
}) {
  function show(el) {
    if (!el) return;
    el.classList.remove('hide');
  }

  function hide(el) {
    if (!el) return;
    el.classList.add('hide');
  }

  function resetAnalysisLauncher() {
    if (analysisInput) {
      analysisInput.value = '';
      analysisInput.style.height = '56px';
      analysisInput.style.overflowY = 'hidden';
    }
  }

  function openAnalysisModal({ scroll = true, reset = false } = {}) {
    if (reset) {
      resetAnalysisLauncher();
    }

    // The intro can remain visible above for now.
    // We only reveal the new analysis launcher.
    show(analysisModal);

    // If there was an old follow-up chat visible, hide it.
    hide(chatModal);

    if (scroll && analysisModal) {
      requestAnimationFrame(() => {
        analysisModal.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });
    }

    if (analysisInput) {
      requestAnimationFrame(() => {
        analysisInput.focus();
      });
    }
  }

  function closeAnalysisModal() {
    hide(analysisModal);
  }

  function startNewAnalysisFlow() {
    // If there is an existing analysis frame, keep it visible for now
    // unless you want a hard reset later.
    // For this step we only reopen the analysis launcher.
    openAnalysisModal({
      scroll: true,
      reset: true
    });
  }

  function revealAnalysisFrame() {
    show(analysisFrame);
  }

  return {
    openAnalysisModal,
    closeAnalysisModal,
    startNewAnalysisFlow,
    revealAnalysisFrame,
    resetAnalysisLauncher
  };
}
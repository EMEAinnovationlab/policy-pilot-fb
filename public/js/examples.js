// examples.js

export function openExamples(examplesContainer, examplesToggle) {
  if (!examplesContainer) return;
  examplesContainer.style.removeProperty('max-height');
  examplesContainer.style.removeProperty('opacity');
  examplesContainer.style.removeProperty('overflow');
  examplesContainer.classList.remove('hide');
  if (examplesToggle) examplesToggle.classList.add('hide');
}

export function closeExamples(examplesContainer, examplesToggle, { animate = true, scroll = true } = {}) {
  if (!examplesContainer) return;

  const smoothScrollToBottom = () =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });

  if (examplesContainer.classList.contains('hide')) {
    if (examplesToggle) examplesToggle.classList.remove('hide');
    if (scroll) smoothScrollToBottom();
    return;
  }

  if (!animate) {
    examplesContainer.classList.add('hide');
    if (examplesToggle) examplesToggle.classList.remove('hide');
    if (scroll) smoothScrollToBottom();
    return;
  }

  examplesContainer.style.overflow = 'hidden';
  const startHeight = examplesContainer.scrollHeight + 'px';
  examplesContainer.style.maxHeight = startHeight;
  examplesContainer.style.opacity = '1';

  requestAnimationFrame(() => {
    examplesContainer.classList.add('is-closing');
    examplesContainer.style.maxHeight = '0px';
    examplesContainer.style.opacity = '0';
  });

  const done = () => {
    examplesContainer.classList.add('hide');
    if (examplesToggle) examplesToggle.classList.remove('hide');

    examplesContainer.classList.remove('is-closing');
    examplesContainer.style.removeProperty('max-height');
    examplesContainer.style.removeProperty('opacity');
    examplesContainer.style.removeProperty('overflow');

    examplesContainer.removeEventListener('transitionend', done);
    if (scroll) smoothScrollToBottom();
  };

  examplesContainer.addEventListener('transitionend', done);
}

/**
 * Event delegation: works for dynamically injected cards AND carousel clones.
 * Options:
 * - container: element that wraps the .example cards (e.g. #examples-grid)
 * - input: textarea
 * - autoGrowTextarea: fn
 * - closeExamplesFn: fn(opts)
 * - onSelect: fn({ text, card })  // called before closeExamplesFn
 */
export function attachExampleFillHandlers({ container, input, closeExamplesFn, autoGrowTextarea, onSelect }) {
  if (!container) return;

  // bind once
  if (container._exampleFillBound) return;
  container._exampleFillBound = true;

  container.addEventListener('click', (e) => {
    const card = e.target.closest('.example');
    if (!card || !container.contains(card)) return;

    const text = card.getAttribute('data-prompt') || '';
    if (!text.trim()) return;

    // Hook for main.js logic (e.g. arm retrieval)
    try {
      onSelect?.({ text, card });
    } catch (err) {
      console.warn('onSelect failed:', err);
    }

    if (input) {
      input.value = text;
      if (typeof autoGrowTextarea === 'function') autoGrowTextarea();
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    }

    // optional, so this can’t crash clicks ever again
    closeExamplesFn?.({ animate: true, scroll: true });
  });
}

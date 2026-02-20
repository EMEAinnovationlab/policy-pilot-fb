// markdown.js
// expects global 'marked' already loaded (as in your current setup)

const CHUNK_WORDS = 3;     // ✅ fade in per 3 words (tweak 2–5)
const CHUNK_STEP_MS = 55;  // ✅ delay between chunks
const CHUNK_FADE_MS = 420; // ✅ duration of each chunk fade

export function injectMarkdownStyles() {
  if (document.getElementById('assistant-styles-markdown')) return;

  const style = document.createElement('style');
  style.id = 'assistant-styles-markdown';
  style.textContent = `
    /* Make content able to host a shine overlay */
    .msg.assistant .content { position: relative; }

    /* Chunk fade-in */
    .msg.assistant .content span.wc {
      opacity: 0;
      filter: blur(2px);
      transform: translateY(1px);
      animation: chunkIn ${CHUNK_FADE_MS}ms cubic-bezier(.2,.9,.2,1) forwards;
      will-change: opacity, filter, transform;
    }
    @keyframes chunkIn {
      to { opacity: 1; filter: blur(0); transform: translateY(0); }
    }

    /* Slightly soften initializing to ready */
    .msg.assistant.initializing { opacity: 0.88; transition: opacity 220ms ease; }
    .msg.assistant.initializing.ready { opacity: 1; }

    /* Shine effect when ready */
    .msg.assistant.pp-shine .content::after {
      content: "";
      position: absolute;
      inset: -6px;
      pointer-events: none;
      background: linear-gradient(115deg,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,.18) 35%,
        rgba(255,255,255,.45) 50%,
        rgba(255,255,255,.18) 65%,
        rgba(255,255,255,0) 100%
      );
      transform: translateX(-120%);
      animation: ppShine 700ms ease forwards;
      mix-blend-mode: screen;
    }
    @keyframes ppShine {
      to { transform: translateX(120%); }
    }
  `;
  document.head.appendChild(style);
}

function isInsideTag(el, tagNames) {
  let n = el;
  const set = new Set(tagNames.map(t => t.toUpperCase()));
  while (n && n !== document.body) {
    if (n.nodeType === 1 && set.has(n.tagName)) return true;
    n = n.parentNode;
  }
  return false;
}

function collectTextNodes(root, out = []) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_ACCEPT;
      if (isInsideTag(node.parentNode, ['PRE', 'CODE', 'SCRIPT', 'STYLE'])) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let cur;
  while ((cur = walker.nextNode())) out.push(cur);
  return out;
}

/**
 * Wrap only the newly added portion (after prevCharCount) in fade-in spans.
 * Uses chunking so it fades in per few words instead of per word.
 */
function wrapNewPortionWithChunkFades(root, prevCharCount, delayStartMs = 0) {
  const nodes = collectTextNodes(root);
  let seen = 0;
  let chunkIndex = 0;

  for (const node of nodes) {
    const text = node.nodeValue || '';
    const len = text.length;

    if (seen + len <= prevCharCount) { seen += len; continue; }

    const startInNode = Math.max(0, prevCharCount - seen);
    const before = text.slice(0, startInNode);
    const after = text.slice(startInNode);

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    // Match "word + trailing whitespace" so we preserve spacing exactly
    const tokens = after.match(/\S+\s*/g) || [];
    let buf = '';
    let wordsInBuf = 0;

    const flush = () => {
      if (!buf) return;
      const span = document.createElement('span');
      span.className = 'wc';
      span.style.animationDelay = `${delayStartMs + chunkIndex * CHUNK_STEP_MS}ms`;
      span.textContent = buf;
      frag.appendChild(span);
      buf = '';
      wordsInBuf = 0;
      chunkIndex++;
    };

    for (const t of tokens) {
      buf += t;
      wordsInBuf++;
      if (wordsInBuf >= CHUNK_WORDS) flush();
    }
    flush();

    node.replaceWith(frag);
    seen += len;
  }
}

export function renderMarkdownAndFadeNew(contentEl, rawText) {
  const prevCharCount = contentEl._charCount || 0;

  const html = marked.parse(rawText || '');
  contentEl.innerHTML = html;

  const totalChars = (contentEl.textContent || '').length;
  const added = Math.max(0, totalChars - prevCharCount);

  if (added > 0) wrapNewPortionWithChunkFades(contentEl, prevCharCount, 0);

  contentEl._charCount = totalChars;
}

(function () {
  const infoBar = document.createElement('div');
  const cssPanel = document.createElement('div');
  const contextMenu = document.createElement('div');
  let hoveredEl = null;
  let cssTimer = null;
  let contextLock = false;
  const errorLog = [];

  // ================================
  // Make invisible/empty elements hoverable
  // ================================
  document.querySelectorAll('*').forEach(el => {
    const isEmpty = el.children.length === 0 && !el.textContent.trim();
    const isInvisible = el.offsetWidth === 0 && el.offsetHeight === 0;
    if (isEmpty && isInvisible) {
      el.style.minHeight = '10px';
      el.style.minWidth = '10px';
      el.style.display = 'inline-block';
    }
  });

  // ================================
  // Styles
  // ================================
  Object.assign(infoBar.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.9)',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: '13px',
    padding: '12px 16px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    lineHeight: '1.4',
    borderRadius: '10px',
    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
    maxWidth: '95vw',
    textAlign: 'left',
    display: 'none'
  });

  Object.assign(cssPanel.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: 'rgba(0,0,0,0.9)',
    color: '#ccc',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '12px 16px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    lineHeight: '1.3',
    borderRadius: '10px',
    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
    maxHeight: '100vh',
    overflowY: 'auto',
    maxWidth: '30vw',
    display: 'none'
  });

  Object.assign(contextMenu.style, {
    position: 'fixed',
    background: '#111',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '4px 0',
    fontFamily: 'monospace',
    fontSize: '13px',
    zIndex: '2147483648',
    display: 'none',
    boxShadow: '0 0 10px rgba(0,0,0,0.6)',
    pointerEvents: 'auto'
  });

  document.body.append(infoBar, cssPanel, contextMenu);

  // ================================
  // Error Logging
  // ================================
  const originalConsoleError = console.error;
  console.error = function (...args) {
    errorLog.push(args.join(' '));
    originalConsoleError.apply(console, args);
    if (hoveredEl) updateInfoBar();
  };

  window.addEventListener('error', e => {
    errorLog.push(e.message);
    if (hoveredEl) updateInfoBar();
  });

  // ================================
  // Helpers
  // ================================
  function describe(el) {
    if (!el) return '—';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = el.classList.length ? `.${[...el.classList].join('.')}` : '';
    return `${tag}${id}${classes}`;
  }

  function getComputedStylesText(el) {
    const styles = window.getComputedStyle(el);
    return Array.from(styles)
      .filter(prop => {
        const val = styles.getPropertyValue(prop);
        return val && val !== 'normal' && val !== 'none' && val !== '0px';
      })
      .map(prop => `${prop}: ${styles.getPropertyValue(prop)};`)
      .sort()
      .slice(0, 50)
      .join('\n');
  }

  function updateInfoBar() {
    if (!hoveredEl) return;
    const current = describe(hoveredEl);
    const parent = hoveredEl.parentElement ? describe(hoveredEl.parentElement) : '—';
    const children = [...hoveredEl.children].map(describe).join(', ') || '—';
    const errorBlock = errorLog.length
      ? `\n🚨 Console Errors:\n  - ${errorLog.slice(-3).join('\n  - ')}`
      : '';
    infoBar.textContent =
`▶️ Hovered: ${current}
   └─ Parent: ${parent}
   └─ Children: ${children}${errorBlock}`;
  }

  function clearOutlines() {
    document.querySelectorAll('*').forEach(el => {
      el.style.outline = '';
    });
  }

  function createMenuItem(text, onClick) {
    const item = document.createElement('div');
    item.textContent = text;
    Object.assign(item.style, {
      padding: '6px 12px',
      cursor: 'pointer'
    });
    item.addEventListener('mouseenter', () => item.style.background = '#333');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', () => {
      onClick();
      hideContextMenu();
    });
    return item;
  }

  function showContextMenu(x, y, el) {
    contextMenu.innerHTML = '';

    contextMenu.appendChild(createMenuItem('📋 Copy CSS', () => {
      navigator.clipboard.writeText(getComputedStylesText(el));
    }));

    contextMenu.appendChild(createMenuItem('🪲 Copy Errors', () => {
      navigator.clipboard.writeText(errorLog.join('\n') || 'No errors');
    }));

    contextMenu.appendChild(createMenuItem('💡 Copy HTML Element', () => {
      navigator.clipboard.writeText(el.outerHTML);
    }));

    contextMenu.appendChild(createMenuItem('🗑️ Delete Element', () => {
      el.remove();
      hideContextMenu();
      hoveredEl = null;
      infoBar.style.display = 'none';
      cssPanel.style.display = 'none';
    }));

    contextMenu.style.top = `${y}px`;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.display = 'block';
    contextLock = true;
  }

  function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextLock = false;
  }

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideContextMenu();
  });

  // ================================
  // Universal Hover Logic
  // ================================
  document.querySelectorAll('*').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (contextLock) return;

      clearOutlines();
      hoveredEl = el;
      el.style.outline = '2px solid red';
      updateInfoBar();
      infoBar.style.display = 'block';

      clearTimeout(cssTimer);
      cssTimer = setTimeout(() => {
        cssPanel.style.display = 'block';
        cssPanel.textContent = '🎨 Computed Styles:\n' + getComputedStylesText(el);
      }, 1000);

      hideContextMenu();
    });

    el.addEventListener('mouseleave', () => {
      if (contextLock) return;

      el.style.outline = '';
      hoveredEl = null;
      infoBar.style.display = 'none';
      cssPanel.style.display = 'none';
      cssPanel.textContent = '';
      clearTimeout(cssTimer);
    });

    el.addEventListener('contextmenu', (e) => {
      if (hoveredEl === el) {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, el);
      }
    });
  });
})();
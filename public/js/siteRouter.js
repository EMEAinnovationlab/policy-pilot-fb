export function initSiteRouter({
  modal,
  modalTitle,
  modalContent,
  navContainer,
  navButtons,
  linkAbout,
  linkHow,
  linkData
}) {
  const titles = {
    about: 'Over Poli Pilot',
    how: 'Hoe het werkt',
    data: 'Data'
  };

  const pagesOrder = ['about', 'how', 'data'];

  let markedRef = (typeof window !== 'undefined' && window.marked) ? window.marked : null;
  const parseMarkdown = (md) => (markedRef ? markedRef.parse(md || '') : (md || ''));

  function setModalOpen(open) {
    if (!modal) return;
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    modal.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeModal() {
    setModalOpen(false);
    history.replaceState(null, '', location.pathname);
  }

  function setActiveNav(page) {
    navButtons.forEach((btn) => {
      const isActive = btn.dataset.page === page;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    });
  }

  function renderIncludedDataTable(rows) {
    if (!rows || rows.length === 0) {
      return '<p class="muted">No documents found.</p>';
    }

    const fmtDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
      });
    };

    const esc = (v) => (v ?? '').toString().replace(/</g, '&lt;');

    const body = rows.map((r) => `
      <tr>
        <td>${esc(r.doc_name)}</td>
        <td>${esc(r.uploaded_by)}</td>
        <td>${esc(fmtDate(r.date_uploaded))}</td>
      </tr>
    `).join('');

    return `
      <table class="pp-table">
        <thead><tr><th>Bron</th><th>Data van</th><th>Upload datum</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  async function loadSitePage(page) {
    const lang = (navigator.language || 'en').toLowerCase();

    setActiveNav(page);
    setModalOpen(true);

    if (modalTitle) modalTitle.textContent = titles[page] || page;
    if (modalContent) modalContent.innerHTML = '<p class="muted">Loading...</p>';

    try {
      if (page === 'data') {
        const [contentRes, listRes] = await Promise.all([
          fetch(`/api/site-content?page=data&lang=${encodeURIComponent(lang)}`),
          fetch('/api/documents/list', { credentials: 'same-origin' })
        ]);

        const contentJson = await contentRes.json();
        const listJson = await listRes.json();

        if (!contentRes.ok || !contentJson?.ok) {
          throw new Error(contentJson?.error || 'Failed to load page content');
        }

        if (!listRes.ok || !listJson?.ok) {
          throw new Error(listJson?.error || 'Failed to load document list');
        }

        const introHTML = parseMarkdown(contentJson.content || '');
        const tableHTML = renderIncludedDataTable(listJson.items || []);
        modalContent.innerHTML = `<div class="pp-context-intro">${introHTML}</div>${tableHTML}`;
      } else {
        const r = await fetch(`/api/site-content?page=${encodeURIComponent(page)}&lang=${encodeURIComponent(lang)}`);
        const j = await r.json();

        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || `Failed to load ${page}`);
        }

        modalContent.innerHTML = parseMarkdown(j.content || '');
      }

      document.querySelector('.pp-modal__nav .pp-navbtn.is-active')?.focus();
    } catch (err) {
      modalContent.innerHTML = `<p style="color:#b10000">${String(err.message || err)}</p>`;
    }
  }

  function routeFromHash() {
    const h = (location.hash || '').toLowerCase().replace('#', '');
    if (['about', 'how', 'data'].includes(h)) {
      loadSitePage(h);
    }
  }

  modal?.addEventListener('click', (e) => {
    if (e.target.matches('[data-close], .pp-modal__backdrop')) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  navContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pp-navbtn');
    if (!btn) return;

    const page = btn.dataset.page;
    if (!page) return;

    history.pushState(null, '', `#${page}`);
    loadSitePage(page);
  });

  window.addEventListener('keydown', (e) => {
    if (modal?.getAttribute('aria-hidden') === 'true') return;
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    const current =
      navButtons.find((b) => b.classList.contains('is-active'))?.dataset.page || pagesOrder[0];

    let idx = pagesOrder.indexOf(current);
    idx = e.key === 'ArrowRight'
      ? (idx + 1) % pagesOrder.length
      : (idx - 1 + pagesOrder.length) % pagesOrder.length;

    const page = pagesOrder[idx];
    history.pushState(null, '', `#${page}`);
    loadSitePage(page);
  });

  linkAbout?.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', '#about');
    loadSitePage('about');
  });

  linkHow?.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', '#how');
    loadSitePage('how');
  });

  linkData?.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', '#data');
    loadSitePage('data');
  });

  window.addEventListener('popstate', routeFromHash);
  routeFromHash();

  return {
    loadSitePage,
    closeModal
  };
}
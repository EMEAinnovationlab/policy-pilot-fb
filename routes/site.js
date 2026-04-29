const express = require('express');
const { supabaseRest } = require('../lib/supabase');

const router = express.Router();

router.get('/project-settings', async (_req, res) => {
  try {
    const rows = await supabaseRest('/project_settings_fb?select=setting_name,setting_content');
    const settings = {};

    for (const row of rows) {
      settings[row.setting_name] = row.setting_content;
    }

    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/site-content', async (req, res) => {
  try {
    const page = (req.query.page || '').toLowerCase();
    const lang = (req.query.lang || 'en').toLowerCase().startsWith('nl') ? 'nl' : 'en';

    if (!page) {
      return res.status(400).json({ ok: false, error: 'Missing ?page=' });
    }

    const rows = await supabaseRest(
      `/site_content_fb?select=page,page_text_en,page_text_nl&limit=1&page=eq.${encodeURIComponent(page)}`
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'No page found' });
    }

    const row = rows[0];
    const content = lang === 'nl'
      ? row.page_text_nl || row.page_text_en || ''
      : row.page_text_en || row.page_text_nl || '';

    res.json({ ok: true, page: row.page, lang, content });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/documents/list', async (_req, res) => {
  try {
    const rows = await supabaseRest(
      '/documents_fb?select=doc_name,uploaded_by,date_uploaded&order=date_uploaded.desc,uploaded_by.asc,doc_name.asc'
    );

    const seen = new Set();
    const items = [];

    for (const row of rows) {
      const name = (row.doc_name || '').trim();
      if (!name || seen.has(name)) continue;

      seen.add(name);
      items.push({
        doc_name: name,
        uploaded_by: row.uploaded_by || '',
        date_uploaded: row.date_uploaded || null
      });
    }

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, items: [] });
  }
});

router.get('/documents/list-raw', async (_req, res) => {
  try {
    const rows = await supabaseRest('/documents_fb?select=doc_name,uploaded_by,date_uploaded,content&order=date_uploaded.desc');
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

const express = require('express');
const { supabaseRest } = require('../lib/supabase');
const { handleSpreadsheetUpload } = require('../services/uploadService');

const router = express.Router();

router.options('/admin/data/upload', (_req, res) => res.status(204).end());
router.options('/admin/ingest', (_req, res) => res.status(204).end());

router.get('/admin/data/list', async (_req, res) => {
  try {
    const rows = await supabaseRest('/documents_fb?select=doc_name,uploaded_by,created_at:date_uploaded&order=date_uploaded.desc');

    res.json({
      ok: true,
      items: rows.map(row => ({
        doc_name: row.doc_name,
        uploaded_by: row.uploaded_by || '',
        created_at: row.created_at || null
      }))
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/admin/data/:doc_name', async (req, res) => {
  try {
    const name = String(req.params.doc_name || '').trim();

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Missing doc_name' });
    }

    await supabaseRest(`/documents_fb?doc_name=eq.${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/data/upload', handleSpreadsheetUpload);
router.post('/admin/ingest', handleSpreadsheetUpload);

module.exports = router;

const express = require('express');
const { supabaseRest } = require('../lib/supabase');
const {
  fetchSystemPromptFromDB,
  setPromptValue
} = require('../services/promptService');

const router = express.Router();

router.get('/admin/settings', async (_req, res) => {
  try {
    const rows = await supabaseRest('/project_settings?select=setting_name,setting_content');
    const settings = {};

    for (const row of rows) {
      settings[row.setting_name] = row.setting_content;
    }

    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/admin/settings', async (req, res) => {
  try {
    const payload = req.body || {};
    const keys = Object.keys(payload);

    if (!keys.length) {
      return res.status(400).json({ ok: false, error: 'Empty payload' });
    }

    const updated = {};

    for (const key of keys) {
      const value = payload[key];

      let rows;
      try {
        rows = await supabaseRest(`/project_settings?setting_name=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: { setting_content: value }
        });
      } catch {
        rows = null;
      }

      let row = Array.isArray(rows) && rows[0];

      if (!row) {
        const inserted = await supabaseRest('/project_settings', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: [{ setting_name: key, setting_content: value }]
        });
        row = inserted?.[0];
      }

      if (row) {
        updated[row.setting_name] = row.setting_content;

        if (
          row.setting_name === 'system_prompt'
          || row.setting_name === 'system_prompt_no_rag'
        ) {
          setPromptValue(row.setting_name, row.setting_content);
        }
      }
    }

    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
});

router.post('/admin/reload-system-prompt', async (_req, res) => {
  try {
    await fetchSystemPromptFromDB();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/example-prompts', async (_req, res) => {
  try {
    const rows = await supabaseRest(
      '/example_prompts?select=id,prompt_title_nl,prompt_title_en,prompt_full_nl,prompt_full_en&order=id.asc'
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/example-prompts', async (req, res) => {
  try {
    const b = req.body || {};

    const inserted = await supabaseRest('/example_prompts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{
        prompt_title_en: b.prompt_title_en || '',
        prompt_full_en: b.prompt_full_en || '',
        prompt_title_nl: b.prompt_title_nl || '',
        prompt_full_nl: b.prompt_full_nl || ''
      }]
    });

    res.json({ ok: true, item: inserted?.[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/admin/example-prompts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    const updated = await supabaseRest(`/example_prompts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: req.body || {}
    });

    res.json({ ok: true, item: updated?.[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/admin/example-prompts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    await supabaseRest(`/example_prompts?id=eq.${id}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

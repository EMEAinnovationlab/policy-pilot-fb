const express = require('express');
const { supabaseRest } = require('../lib/supabase');

const router = express.Router();

router.get('/example-prompts', async (_req, res) => {
  try {
    const rows = await supabaseRest(
      '/example_prompts?select=id,prompt_title_nl,prompt_title_en,prompt_full_nl,prompt_full_en&order=id.asc'
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
const express = require('express');
const { supabaseRest } = require('../lib/supabase');

const router = express.Router();

async function usersOverviewHandler(_req, res) {
  try {
    const users = await supabaseRest('/users?select=email,role&order=email.asc');
    const memberCodes = await supabaseRest('/login_codes?select=email,code,created_at&order=created_at.desc');
    const adminCodes = await supabaseRest('/admin_login_codes?select=email,code,created_at&order=created_at.desc');

    const latestMember = new Map();
    for (const c of memberCodes) {
      const key = (c.email || '').toLowerCase();
      if (key && !latestMember.has(key)) {
        latestMember.set(key, { code: c.code, created_at: c.created_at });
      }
    }

    const latestAdmin = new Map();
    for (const c of adminCodes) {
      const key = (c.email || '').toLowerCase();
      if (key && !latestAdmin.has(key)) {
        latestAdmin.set(key, { code: c.code, created_at: c.created_at });
      }
    }

    const items = users.map(user => {
      const key = (user.email || '').toLowerCase();
      const isAdmin = (user.role || '').toLowerCase() === 'admin';
      const last = isAdmin ? (latestAdmin.get(key) || {}) : (latestMember.get(key) || {});

      return {
        email: user.email,
        role: user.role || 'member',
        code: last.code || '',
        code_created_at: last.created_at || null
      };
    });

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

router.get(/^\/admin\/users[-_]overview$/, usersOverviewHandler);

router.post('/admin/users', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const role = String(req.body?.role || 'member').trim();

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Missing email' });
    }

    const up = await supabaseRest('/users', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{ email, role }]
    });

    res.json({ ok: true, user: up?.[0] || { email, role } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/admin/users/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email || '').trim();

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Missing email' });
    }

    await supabaseRest(`/users?email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/users/:email/codes', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email || '').trim();

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Missing email' });
    }

    const users = await supabaseRest(`/users?select=email,role&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const role = (users[0].role || 'member').toLowerCase();
    const code = (req.body?.code && String(req.body.code).trim()) ||
      Math.floor(100000 + Math.random() * 900000).toString();

    const table = role === 'admin' ? 'admin_login_codes' : 'login_codes';

    const inserted = await supabaseRest(`/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{ email, code, created_at: new Date().toISOString() }]
    });

    res.json({
      ok: true,
      item: inserted?.[0] || { email, code, table }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;
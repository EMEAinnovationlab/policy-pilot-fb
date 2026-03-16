const express = require('express');
const { supabaseRest } = require('../lib/supabase');
const { signJwt, verifyJwt, parseCookies, setCookie, clearCookie } = require('../lib/auth');
const { APP_JWT_SECRET } = require('../config/env');

const router = express.Router();

router.post('/auth/admin/verify', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    const raw = (req.body?.code || '').trim();

    if (!email || !raw) {
      return res.status(400).json({ ok: false, error: 'Missing email or code' });
    }

    const users = await supabaseRest(`/users?select=email,role&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ ok: false, error: 'Email not enabled' });
    }

    const candidates = [/^\d+$/.test(raw) ? String(Number(raw)) : null, raw].filter(Boolean);
    const orParts = candidates.map(v => `code.eq.${encodeURIComponent(v)}`).join(',');
    const rows = await supabaseRest(`/admin_login_codes?select=code,email&or=(${orParts})&limit=1`);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Invalid admin code' });
    }

    const row = rows[0];
    if (row.email && String(row.email).toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ ok: false, error: 'Admin code not valid for this email' });
    }

    const token = signJwt({ sub: users[0].email, role: 'admin' }, APP_JWT_SECRET);
    setCookie(res, 'pp_session', token, { sameSite: 'Lax' });

    res.json({
      ok: true,
      user: { email: users[0].email, role: 'admin' }
    });
  } catch (e) {
    console.error('[auth/admin/verify] error:', e);
    res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
});

router.post('/auth/manual/verify', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    const raw = (req.body?.code || '').trim();

    if (!email || !raw) {
      return res.status(400).json({ ok: false, error: 'Missing email or code' });
    }

    const users = await supabaseRest(`/users?select=email,role&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(401).json({ ok: false, error: 'Email not enabled' });
    }

    const candidates = [raw, /^\d+$/.test(raw) ? String(Number(raw)) : null].filter(Boolean);
    const orParts = candidates.map(v => `code.eq.${encodeURIComponent(v)}`).join(',');
    const query = `/login_codes?select=code,email,used_at&or=(${orParts})&email=ilike.${encodeURIComponent(email)}&used_at=is.null&limit=1`;
    const rows = await supabaseRest(query);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired code' });
    }

    try {
      await supabaseRest(`/login_codes?code=eq.${encodeURIComponent(rows[0].code)}&email=ilike.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        body: { used_at: new Date().toISOString() }
      });
    } catch {}

    const role = users[0].role || 'member';
    const token = signJwt({ sub: users[0].email, role }, APP_JWT_SECRET);
    setCookie(res, 'pp_session', token, { sameSite: 'Lax' });

    res.json({
      ok: true,
      user: { email: users[0].email, role }
    });
  } catch (e) {
    console.error('[auth/manual/verify] error:', e);
    res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
});

router.get('/auth/me', (req, res) => {
  const token = parseCookies(req).pp_session;
  const payload = token ? verifyJwt(token, APP_JWT_SECRET) : null;

  if (!payload) {
    return res.status(401).json({ ok: false });
  }

  res.json({
    ok: true,
    user: { email: payload.sub, role: payload.role }
  });
});

router.post('/auth/logout', (_req, res) => {
  clearCookie(res, 'pp_session');
  res.json({ ok: true });
});

module.exports = router;
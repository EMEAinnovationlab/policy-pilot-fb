const {
  SUPABASE_REST_URL,
  SUPABASE_API_KEY,
  SUPABASE_BEARER
} = require('../config/env');

async function supabaseRest(path, { method = 'GET', body, headers = {} } = {}) {
  if (!SUPABASE_REST_URL) {
    throw new Error('Missing SUPABASE_REST_URL');
  }

  const url = `${SUPABASE_REST_URL}${path}`;

  const allHeaders = {
    'Content-Type': 'application/json',
    ...(SUPABASE_API_KEY ? { apikey: SUPABASE_API_KEY } : {}),
    ...(SUPABASE_BEARER ? { Authorization: `Bearer ${SUPABASE_BEARER}` } : {}),
    'Accept-Profile': 'public',
    'Content-Profile': 'public',
    ...headers
  };

  const response = await fetch(url, {
    method,
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!response.ok) {
    console.error(`[Supabase REST ${method}] ${url} -> ${response.status}`, json);
    throw new Error(`${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

module.exports = {
  supabaseRest
};
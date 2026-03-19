require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';
const DRY_RUN_EMBEDDINGS = String(process.env.DRY_RUN_EMBEDDINGS || '') === '1';

const SUPABASE_FUNCTIONS_URL = (process.env.SUPABASE_FUNCTIONS_URL || '').replace(/\/$/, '');
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY || '';
const SUPABASE_BEARER = process.env.SUPABASE_BEARER || '';

let SUPABASE_REST_URL = process.env.SUPABASE_REST_URL || '';
if (!SUPABASE_REST_URL && SUPABASE_FUNCTIONS_URL) {
  try {
    const u = new URL(SUPABASE_FUNCTIONS_URL);
    u.hostname = u.hostname.replace('.functions.', '.supabase.');
    u.pathname = '/rest/v1';
    SUPABASE_REST_URL = u.toString().replace(/\/$/, '');
  } catch {}
}

const APP_JWT_SECRET = process.env.APP_JWT_SECRET || 'dev_secret_change_me';

const RAG_DEFAULTS = {
  match_count: Number(process.env.RAG_MATCH_COUNT || 15),
  match_threshold: Number(process.env.RAG_MATCH_THRESHOLD || 0),
  search_mode: process.env.RAG_SEARCH_MODE || 'both',
  uploaded_by: process.env.RAG_UPLOADED_BY || null
};

const CHAT_MAX_HISTORY_MESSAGES = Number(process.env.CHAT_MAX_HISTORY_MESSAGES || 24);

module.exports = {
  OPENAI_API_KEY,
  OPENAI_MODEL,
  EMBED_MODEL,
  DRY_RUN_EMBEDDINGS,
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_API_KEY,
  SUPABASE_BEARER,
  SUPABASE_REST_URL,
  APP_JWT_SECRET,
  RAG_DEFAULTS,
  CHAT_MAX_HISTORY_MESSAGES
};
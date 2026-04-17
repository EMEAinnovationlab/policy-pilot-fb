const {
  OPENAI_API_KEY,
  OPENAI_MODEL,
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_API_KEY,
  SUPABASE_BEARER,
  RAG_DEFAULTS,
  CHAT_MAX_HISTORY_MESSAGES
} = require('../config/env');

const { sse } = require('../lib/sse');
const { getSystemPrompt } = require('./promptService');
const { routePolicyPilotRequest } = require('./routingService');

async function callRag(expandedQuery, uploadedByLabel) {
  const body = {
    query: expandedQuery,
    match_count: RAG_DEFAULTS.match_count,
    match_threshold: RAG_DEFAULTS.match_threshold,
    search_mode: RAG_DEFAULTS.search_mode
  };

  if (uploadedByLabel) {
    body.uploaded_by = uploadedByLabel;
  }

  const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/query-docs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SUPABASE_API_KEY ? { apikey: SUPABASE_API_KEY } : {}),
      ...(SUPABASE_BEARER ? { Authorization: `Bearer ${SUPABASE_BEARER}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error('[query-docs] error:', resp.status, txt);
    return { matches: [], error: `query-docs error: ${resp.status}` };
  }

  try {
    const json = await resp.json();
    return { matches: json?.matches || [], error: null };
  } catch (e) {
    console.error('[query-docs] invalid JSON:', e);
    return { matches: [], error: 'query-docs JSON parse error' };
  }
}

function sanitizeHistory(rawHistory, userMessage) {
  let safeHistory = (Array.isArray(rawHistory) ? rawHistory : [])
    .filter(m =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim()
    )
    .slice(-CHAT_MAX_HISTORY_MESSAGES)
    .map(m => ({
      role: m.role,
      content: m.content.slice(0, 8000)
    }));

  while (safeHistory.length) {
    const last = safeHistory[safeHistory.length - 1];
    if (last.role === 'user' && last.content.trim() === userMessage.trim()) {
      safeHistory.pop();
      continue;
    }
    break;
  }

  return safeHistory;
}

function buildContextFromMatches(pm, ed) {
  const allMatches = [
    ...(pm.matches || []).map(m => ({ ...m, uploaded_by: m.uploaded_by || 'Public Matters' })),
    ...(ed.matches || []).map(m => ({ ...m, uploaded_by: m.uploaded_by || 'Edelman' }))
  ];

  console.log('RAG DEBUG total matches:', allMatches.length);

  const snippets = [];
  const sources = [];
  let used = 0;
  const maxChars = 6000;

  for (const [i, m] of allMatches.entries()) {
    const src = (m.uploaded_by || '').toString().trim();
    const tag = src.toLowerCase().includes('edelman') ? '🔵 Edelman' : '🔴 Public Matters';
    const baseTitle = m.doc_name || m.naam || m.bron || `Bron #${i + 1}`;
    const title = `${tag} | ${baseTitle}`;

    const snippetText = (
      m.invloed_text ||
      m.summary ||
      m.excerpt ||
      (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''))
    ).toString().trim();

    if (!snippetText) continue;

    const block = `[#${i + 1}] ${title}\n${snippetText}\n---\n`;

    if (used + block.length > maxChars) break;

    snippets.push(block);
    used += block.length;

    sources.push({
      n: i + 1,
      title,
      url: m.url || null,
      uploaded_by: src
    });
  }

  return {
    sources,
    contextBody: snippets.join('') || '(no relevant matches found)',
    totalHits: allMatches.length,
    hitsPm: (pm.matches || []).length,
    hitsEd: (ed.matches || []).length
  };
}

function buildMessages({
  useRetrieval,
  userMessage,
  expandedQuery,
  contextBody,
  totalHits,
  hitsPm,
  hitsEd,
  safeHistory
}) {
  const activeSystemPrompt = getSystemPrompt(useRetrieval);

  const ragSystemMessages = useRetrieval
    ? [{
        role: 'system',
        content: `
You have access to a vector database with documents from:
- 🔴 Public Matters (policy, parties, issue papers)
- 🔵 Edelman (Edelman Trust Barometer reports)

The retrieval query was expanded with synonyms/related terms:
"${expandedQuery}"

RAG STATS:
- Total matches: ${totalHits}
- Public Matters matches: ${hitsPm}
- Edelman matches: ${hitsEd}

Use the CONTEXT below as your primary source of truth. If there are no relevant matches, you MUST explicitly say so.

CONTEXT DOCUMENT EXCERPTS:
${contextBody}
        `.trim()
      }]
    : [];

  return [
    { role: 'system', content: activeSystemPrompt },
    ...ragSystemMessages,
    ...safeHistory,
    { role: 'user', content: userMessage }
  ];
}

function emitBrowserDebug(res, label, payload) {
  sse(res, {
    type: 'debug',
    label,
    payload
  });
}

async function streamOpenAIChat({ messages, res, useRetrieval, sources }) {
  emitBrowserDebug(res, 'Main Prompt Payload', {
    useRetrieval,
    outputModel: OPENAI_MODEL,
    messages
  });

  const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      stream: true,
      messages
    })
  });

  if (!openaiResp.ok || !openaiResp.body) {
    const txt = await openaiResp.text().catch(() => '');
    sse(res, { type: 'error', message: `OpenAI error: ${txt}` });
    sse(res, { type: 'done' });
    return res.end();
  }

  const reader = openaiResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;

      const payload = t.slice(5).trim();

      if (payload === '[DONE]') {
        sse(res, { type: 'sources', items: useRetrieval ? sources : [] });
        sse(res, { type: 'done' });
        return res.end();
      }

      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          sse(res, { type: 'token', text: delta });
        }
      } catch {}
    }
  }
}

function streamImmediateAssistantMessage(res, text) {
  sse(res, { type: 'token', text: String(text || '') });
  sse(res, { type: 'sources', items: [] });
  sse(res, { type: 'done' });
  return res.end();
}

async function handleChat(req, res) {
  try {
    const userMessage = (req.body?.message || '').toString().slice(0, 8000);

    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing OPENAI_API_KEY' });
    }

    const useRetrieval = !!req.body?.useRetrieval;

    let expandedQuery = userMessage;
    let pm = { matches: [], error: null };
    let ed = { matches: [], error: null };
    let sources = [];
    let contextBody = '(retrieval disabled)';
    let totalHits = 0;
    let hitsPm = 0;
    let hitsEd = 0;
    let effectiveUseRetrieval = useRetrieval;

    if (useRetrieval) {
      const routing = await routePolicyPilotRequest(userMessage);

      emitBrowserDebug(res, 'Routing Debug', {
        inputPrompt: routing.debug?.inputPrompt || userMessage,
        routingPrompt: routing.debug?.routingPrompt || '',
        routingResult: {
          allowed: routing.allowed,
          route: routing.route,
          reason: routing.reason,
          userMessage: routing.userMessage,
          keywords: routing.keywords,
          expandedQuery: routing.expandedQuery
        },
        routingRawContent: routing.debug?.routingRawContent || null,
        routingRawJson: routing.debug?.routingRawJson || null
      });

      if (!routing.allowed || routing.route === 'reject') {
        const rejectText = routing.userMessage
          || 'Deze vraag valt buiten de scope van Policy Pilot. Formuleer je vraag meer richting beleid, politiek, publieke opinie of impact op de F&B-sector.';
        return streamImmediateAssistantMessage(res, rejectText);
      }

      if (routing.route === 'chat') {
        effectiveUseRetrieval = false;
      } else {
        expandedQuery = routing.expandedQuery || userMessage;
      }
    }

    if (effectiveUseRetrieval) {
      [pm, ed] = await Promise.all([
        callRag(expandedQuery, 'Public Matters'),
        callRag(expandedQuery, 'Edelman')
      ]);

      if ((pm.error && !pm.matches.length) && (ed.error && !ed.matches.length)) {
        sse(res, { type: 'error', message: 'RAG backend (query-docs) is not responding or misconfigured.' });
      }

      const context = buildContextFromMatches(pm, ed);
      sources = context.sources;
      contextBody = context.contextBody;
      totalHits = context.totalHits;
      hitsPm = context.hitsPm;
      hitsEd = context.hitsEd;
    }

    const safeHistory = sanitizeHistory(req.body?.history, userMessage);

    const messages = buildMessages({
      useRetrieval: effectiveUseRetrieval,
      userMessage,
      expandedQuery,
      contextBody,
      totalHits,
      hitsPm,
      hitsEd,
      safeHistory
    });

    await streamOpenAIChat({
      messages,
      res,
      useRetrieval: effectiveUseRetrieval,
      sources
    });
  } catch (e) {
    console.error('/chat error:', e);
    sse(res, { type: 'error', message: e.message || 'Server error in /chat' });
    sse(res, { type: 'done' });
    res.end();
  }
}

module.exports = {
  handleChat
};

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
const { routePolicyPilotRequest } = require('./routingService');
const { getSystemPrompt } = require('./promptService');

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
      url: m.url || m.link || null,
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
  routingInfo,
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

ROUTING DECISION:
- allowed: ${routingInfo?.allowed ? 'true' : 'false'}
- route: ${routingInfo?.route || 'rag'}
- reason: ${routingInfo?.reason || 'n/a'}
- keywords: ${(routingInfo?.keywords || []).join(', ') || 'none'}

The retrieval query was expanded with synonyms/related terms:
"${expandedQuery}"

RAG STATS:
- Total matches: ${totalHits}
- Public Matters matches: ${hitsPm}
- Edelman matches: ${hitsEd}

Use the CONTEXT below as your primary source of truth.
If there are no relevant matches, say that clearly.
Do not claim sources you do not have.

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

async function streamOpenAIChat({ messages, res, useRetrieval, sources }) {
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
  sse(res, { type: 'token', text });
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

    let routingInfo = {
      allowed: true,
      route: useRetrieval ? 'rag' : 'chat',
      reason: 'Retrieval not requested',
      userMessage: '',
      keywords: [],
      expandedQuery: userMessage
    };

    let expandedQuery = userMessage;
    let pm = { matches: [], error: null };
    let ed = { matches: [], error: null };
    let sources = [];
    let contextBody = '(retrieval disabled)';
    let totalHits = 0;
    let hitsPm = 0;
    let hitsEd = 0;

    if (useRetrieval) {
      routingInfo = await routePolicyPilotRequest(userMessage);

      if (!routingInfo.allowed || routingInfo.route === 'reject') {
        const rejectText =
          routingInfo.userMessage ||
          'Deze vraag past niet goed binnen Policy Pilot. Formuleer je vraag meer richting politiek, beleid, publieke opinie of impact op de technologiesector.';

        return streamImmediateAssistantMessage(res, rejectText);
      }

      if (routingInfo.route === 'chat') {
        const safeHistory = sanitizeHistory(req.body?.history, userMessage);
        const messages = buildMessages({
          useRetrieval: false,
          userMessage,
          expandedQuery: userMessage,
          routingInfo,
          contextBody: '(retrieval not used for this request)',
          totalHits: 0,
          hitsPm: 0,
          hitsEd: 0,
          safeHistory
        });

        return await streamOpenAIChat({
          messages,
          res,
          useRetrieval: false,
          sources: []
        });
      }

      expandedQuery = routingInfo.expandedQuery || userMessage;

      [pm, ed] = await Promise.all([
        callRag(expandedQuery, 'Public Matters'),
        callRag(expandedQuery, 'Edelman')
      ]);

      if ((pm.error && !pm.matches.length) && (ed.error && !ed.matches.length)) {
        sse(res, {
          type: 'error',
          message: 'RAG backend (query-docs) is not responding or misconfigured.'
        });
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
      useRetrieval,
      userMessage,
      expandedQuery,
      routingInfo,
      contextBody,
      totalHits,
      hitsPm,
      hitsEd,
      safeHistory
    });

    await streamOpenAIChat({
      messages,
      res,
      useRetrieval,
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
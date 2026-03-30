const {
  OPENAI_API_KEY,
  OPENAI_MODEL
} = require('../config/env');

function fallbackRouting(userMessage) {
  return {
    allowed: true,
    route: 'rag',
    reason: 'Fallback routing used because structured routing failed.',
    userMessage: '',
    keywords: [],
    expandedQuery: userMessage
  };
}

function normalizeRoutingResult(parsed, userMessage) {
  const allowed = !!parsed?.allowed;
  const route = ['rag', 'reject', 'chat'].includes(parsed?.route)
    ? parsed.route
    : (allowed ? 'rag' : 'reject');

  const keywords = Array.isArray(parsed?.keywords)
    ? parsed.keywords
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const expandedQuery = String(parsed?.expandedQuery || '').trim() || userMessage;
  const reason = String(parsed?.reason || '').trim();
  const userMessageOut = String(parsed?.userMessage || '').trim();

  return {
    allowed,
    route,
    reason,
    userMessage: userMessageOut,
    keywords,
    expandedQuery
  };
}

async function routePolicyPilotRequest(userMessage) {
  try {
    const prompt = `
You are the routing layer for Policy Pilot.

Policy Pilot is intended for:
- political developments
- policy analysis
- public affairs
- trust and reputation
- public sentiment
- government, parliament, regulation
- technology sector impact
- corporate impact of political or societal developments
- questions grounded in the Policy Pilot document database

Your tasks:
1. Decide whether the request is suitable for Policy Pilot retrieval.
2. If the request is not suitable, set allowed=false and route="reject".
3. If the request is suitable for retrieval, set allowed=true and route="rag".
4. If the request is conversational but should not use retrieval, set allowed=true and route="chat".
5. Extract 3 to 8 core keywords.
6. Generate an expanded query with close synonyms and related search terms for vector retrieval.
7. Return strict JSON only.

Rules:
- Return valid JSON only
- Do not wrap JSON in markdown
- Keep userMessage short and in Dutch
- For reject cases, explain briefly how the user can reformulate the question
- For rag cases, expandedQuery must start with the original user message

Required JSON schema:
{
  "allowed": true,
  "route": "rag",
  "reason": "short explanation",
  "userMessage": "",
  "keywords": ["keyword 1", "keyword 2"],
  "expandedQuery": "original query, related term 1, related term 2"
}

User request:
"${userMessage}"
    `.trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a strict JSON router for Policy Pilot.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('[routePolicyPilotRequest] OpenAI error:', resp.status, txt);
      return fallbackRouting(userMessage);
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.warn('[routePolicyPilotRequest] Empty routing response, using fallback.');
      return fallbackRouting(userMessage);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('[routePolicyPilotRequest] JSON parse error:', err, content);
      return fallbackRouting(userMessage);
    }

    const routing = normalizeRoutingResult(parsed, userMessage);

    console.group('Policy Pilot Routing');
    console.log('Original:', userMessage);
    console.log('Allowed:', routing.allowed);
    console.log('Route:', routing.route);
    console.log('Reason:', routing.reason);
    console.log('Keywords:', routing.keywords);
    console.log('Expanded query:', routing.expandedQuery);
    console.groupEnd();

    return routing;
  } catch (e) {
    console.error('[routePolicyPilotRequest] error:', e);
    return fallbackRouting(userMessage);
  }
}

module.exports = {
  routePolicyPilotRequest
};
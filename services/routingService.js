const {
  OPENAI_API_KEY,
  OPENAI_MODEL
} = require('../config/env');
const { getRoutingPrompt, refreshPromptCache } = require('./promptService');

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
        .map((value) => String(value || '').trim())
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
  let prompt = '';

  try {
    await refreshPromptCache();

    const template = getRoutingPrompt();
    if (!template || !template.trim()) {
      console.warn('[routePolicyPilotRequest] Missing routing_prompt in project_settings; using fallback routing.');
      return {
        ...fallbackRouting(userMessage),
        debug: {
          inputPrompt: userMessage,
          routingPrompt: '',
          routingPromptSource: 'missing-after-supabase-refresh',
          routingRawContent: null,
          routingRawJson: null
        }
      };
    }

    prompt = template.includes('{{userMessage}}')
      ? template.replaceAll('{{userMessage}}', userMessage)
      : `${template}\n\nUser request:\n"${userMessage}"`;

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
      return {
        ...fallbackRouting(userMessage),
        debug: {
          inputPrompt: userMessage,
          routingPrompt: prompt,
          routingPromptSource: 'supabase-refresh',
          routingRawContent: null,
          routingRawJson: null
        }
      };
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.warn('[routePolicyPilotRequest] Empty routing response, using fallback.');
      return {
        ...fallbackRouting(userMessage),
        debug: {
          inputPrompt: userMessage,
          routingPrompt: prompt,
          routingPromptSource: 'supabase-refresh',
          routingRawContent: null,
          routingRawJson: json
        }
      };
    }

    console.group('Policy Pilot Routing Raw Response');
    console.log('Original:', userMessage);
    console.log('Raw content:', content);
    console.log('Raw JSON:', json);
    console.groupEnd();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('[routePolicyPilotRequest] JSON parse error:', err, content);
      return {
        ...fallbackRouting(userMessage),
        debug: {
          inputPrompt: userMessage,
          routingPrompt: prompt,
          routingPromptSource: 'supabase-refresh',
          routingRawContent: content,
          routingRawJson: json
        }
      };
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

    return {
      ...routing,
      debug: {
        inputPrompt: userMessage,
        routingPrompt: prompt,
        routingPromptSource: 'supabase-refresh',
        routingRawContent: content,
        routingRawJson: json
      }
    };
  } catch (err) {
    console.error('[routePolicyPilotRequest] error:', err);
    return {
      ...fallbackRouting(userMessage),
      debug: {
        inputPrompt: userMessage,
        routingPrompt: prompt,
        routingPromptSource: prompt ? 'supabase-refresh' : 'missing-after-supabase-refresh',
        routingRawContent: null,
        routingRawJson: null
      }
    };
  }
}

module.exports = {
  routePolicyPilotRequest
};

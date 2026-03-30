const { supabaseRest } = require('../lib/supabase');

let SYSTEM_PROMPT = 'You are Poli Pilot, a concise assistant. Cite sources inline like [#n].';

let SYSTEM_PROMPT_NO_RAG = `You are Poli Pilot, a concise assistant.
You do NOT have access to the document database right now.
Do not invent citations or claim you searched documents.
If the user asks you to search the documents, tell them to enable “zoek in politieke data”.`;

let ROUTING_PROMPT = `You are the routing layer for Policy Pilot.

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
"{{userMessage}}"`;

async function fetchSystemPromptFromDB() {
  try {
    const rows = await supabaseRest(
      '/project_settings?select=setting_name,setting_content&setting_name=in.(system_prompt,system_prompt_no_rag,routing_prompt)'
    );

    for (const row of rows) {
      const key = String(row.setting_name || '').trim();
      const value = String(row.setting_content || '').trim();

      if (!value) continue;
      if (key === 'system_prompt') SYSTEM_PROMPT = value;
      if (key === 'system_prompt_no_rag') SYSTEM_PROMPT_NO_RAG = value;
      if (key === 'routing_prompt') ROUTING_PROMPT = value;
    }
  } catch (e) {
    console.warn('Could not fetch system prompts:', e.message || e);
  }
}

function getSystemPrompt(useRetrieval) {
  return useRetrieval ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_RAG;
}

function getRoutingPrompt() {
  return ROUTING_PROMPT;
}

function setPromptValue(key, value) {
  const clean = String(value ?? '').trim();
  if (key === 'system_prompt') SYSTEM_PROMPT = clean;
  if (key === 'system_prompt_no_rag') SYSTEM_PROMPT_NO_RAG = clean;
  if (key === 'routing_prompt') ROUTING_PROMPT = clean;
}

function startPromptRefresh() {
  fetchSystemPromptFromDB();
  setInterval(fetchSystemPromptFromDB, 60000);
}

module.exports = {
  fetchSystemPromptFromDB,
  getSystemPrompt,
  getRoutingPrompt,
  setPromptValue,
  startPromptRefresh
};

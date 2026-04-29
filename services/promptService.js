const { supabaseRest } = require('../lib/supabase');

let SYSTEM_PROMPT = 'You are Poli Pilot, a concise assistant. Cite sources inline like [#n].';

let SYSTEM_PROMPT_NO_RAG = `You are Poli Pilot, a concise assistant.
You do NOT have access to the document database right now.
Do not invent citations or claim you searched documents.
If the user asks you to search the documents, tell them to enable “zoek in politieke data”.`;

async function fetchSystemPromptFromDB() {
  try {
    const rows = await supabaseRest(
      '/project_settings_fb?select=setting_name,setting_content&setting_name=in.(system_prompt,system_prompt_no_rag)'
    );

    for (const row of rows) {
      const key = String(row.setting_name || '').trim();
      const value = String(row.setting_content || '').trim();

      if (!value) continue;
      if (key === 'system_prompt') SYSTEM_PROMPT = value;
      if (key === 'system_prompt_no_rag') SYSTEM_PROMPT_NO_RAG = value;
    }
  } catch (e) {
    console.warn('Could not fetch system prompts:', e.message || e);
  }
}

function getSystemPrompt(useRetrieval) {
  return useRetrieval ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_RAG;
}

async function refreshPromptCache() {
  await fetchSystemPromptFromDB();
}

function setPromptValue(key, value) {
  const clean = String(value ?? '').trim();
  if (key === 'system_prompt') SYSTEM_PROMPT = clean;
  if (key === 'system_prompt_no_rag') SYSTEM_PROMPT_NO_RAG = clean;
}

function startPromptRefresh() {
  fetchSystemPromptFromDB();
  setInterval(fetchSystemPromptFromDB, 60000);
}

module.exports = {
  fetchSystemPromptFromDB,
  refreshPromptCache,
  getSystemPrompt,
  setPromptValue,
  startPromptRefresh
};

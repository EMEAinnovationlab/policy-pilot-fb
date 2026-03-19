const {
  OPENAI_API_KEY,
  OPENAI_MODEL
} = require('../config/env');

async function expandQueryWithSynonyms(userMessage) {
  try {
    const prompt = `
You will be given a user query.

1. Extract the 3 to 8 most important keywords and concepts.
2. For each, generate several synonyms or very closely related terms.
3. Return a SINGLE line of text that:
   - starts with the original query
   - then adds synonyms and related terms, separated by commas.

Do NOT explain anything. Just output the enriched query line.

User query:
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
        messages: [
          {
            role: 'system',
            content: 'You expand search queries with synonyms and related terms. Output plain text only.'
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
      console.error('[expandQueryWithSynonyms] OpenAI error:', resp.status, txt);
      return userMessage;
    }

    const json = await resp.json();
    const enriched = json.choices?.[0]?.message?.content?.trim();

    if (!enriched) return userMessage;

    console.log('Query expansion:', {
      original: userMessage,
      expanded: enriched
    });

    return enriched;
  } catch (e) {
    console.error('[expandQueryWithSynonyms] error:', e);
    return userMessage;
  }
}

module.exports = {
  expandQueryWithSynonyms
};
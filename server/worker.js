// Lens explanation service — a Cloudflare Worker.
//
// Gives every Lens install a working AI engine with zero user setup,
// regardless of the user's hardware. By default it answers with Cloudflare
// Workers AI (free tier, no external account needed). If the ANTHROPIC_API_KEY
// secret is set, it answers with Claude instead.
//
// Endpoints:
//   GET  /health            -> { ok: true, engine: "workers-ai" | "claude" }
//   POST /explain           -> body { prompt: string, uid?: string }
//                              response { text: string }
//
// Configuration (wrangler.toml [vars] or dashboard):
//   MODEL              Workers AI model id (default set in wrangler.toml)
//   CLAUDE_MODEL       Anthropic model id used when ANTHROPIC_API_KEY is set
//   ALLOWED_ORIGINS    comma-separated Origin allowlist, e.g.
//                      "chrome-extension://abc123". Empty = allow any origin
//                      (fine while testing; set it before sharing the URL).
// Secrets (npx wrangler secret put ...):
//   ANTHROPIC_API_KEY  optional — switches the engine to Claude, billed to you.

const MAX_PROMPT_CHARS = 12000; // prompt template + selection + ~2.5k context
const MAX_TOKENS = 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, engine: env.ANTHROPIC_API_KEY ? 'claude' : 'workers-ai' }, 200, cors);
    }

    if (url.pathname !== '/explain' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404, cors);
    }

    if (!originAllowed(origin, env)) {
      return json({ error: 'Origin not allowed' }, 403, cors);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'Invalid JSON body' }, 400, cors); }

    const prompt = body && body.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return json({ error: 'Missing "prompt"' }, 400, cors);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: 'Prompt too long' }, 413, cors);
    }

    try {
      const text = env.ANTHROPIC_API_KEY
        ? await askClaude(env, prompt)
        : await askWorkersAI(env, prompt);
      if (typeof text !== 'string' || !text.trim()) {
        return json({ error: 'Empty response from model' }, 502, cors);
      }
      return json({ text }, 200, cors);
    } catch (e) {
      return json({ error: 'Model error: ' + (e && e.message ? e.message : String(e)) }, 502, cors);
    }
  },
};

function originAllowed(origin, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true; // open while testing
  return list.includes(origin);
}

async function askWorkersAI(env, prompt) {
  if (!env.AI) throw new Error('Workers AI binding missing — deploy with wrangler.toml from this directory.');
  const model = env.MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const out = await env.AI.run(model, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: MAX_TOKENS,
  });
  // Workers AI text models return { response: "..." }.
  return out && (out.response || out.result || '');
}

async function askClaude(env, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = (j.error && j.error.message) || JSON.stringify(j); }
    catch (e) { detail = await r.text().catch(() => ''); }
    throw new Error(`Anthropic ${r.status}: ${String(detail).slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.content || []).map((b) => b.text || '').join('').trim();
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

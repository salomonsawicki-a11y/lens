# Lens explanation service

A tiny Cloudflare Worker that gives every Lens install a working AI engine
with **zero user setup** — no API key, no hardware requirements. By default
it uses **Cloudflare Workers AI** (a free allocation is included with every
Cloudflare account, even the free plan). If you add your Anthropic API key
as a secret, it automatically upgrades to **Claude** (billed to your
Anthropic account).

## Deploy (one time, ~3 minutes)

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
   if you don't have one.
2. In this `server/` directory, run:

   ```
   npx wrangler deploy
   ```

   The first run opens a browser window to log in to Cloudflare. When it
   finishes it prints your service URL, e.g.:

   ```
   https://lens-api.<your-subdomain>.workers.dev
   ```

3. Put that URL into the extension: open `extension/background.js` and set

   ```js
   const LENS_SERVER = 'https://lens-api.<your-subdomain>.workers.dev';
   ```

   (or, for a quick test without editing code, paste the URL into the
   **Service URL** field in Lens Settings).

That's it. Verify with:

```
curl https://lens-api.<your-subdomain>.workers.dev/health
```

which should print `{"ok":true,"engine":"workers-ai"}`.

## Optional: upgrade the service to Claude

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Paste your key when prompted and redeploy. `/health` will then report
`"engine":"claude"`. Every explanation is now answered by Claude
(model set by `CLAUDE_MODEL` in `wrangler.toml`) and billed to your
Anthropic account — so consider the abuse note below first.

## Abuse & cost notes

- The Workers **free plan** includes 100,000 requests/day and a daily
  Workers AI allocation (about 10,000 "neurons"/day). When the AI quota is
  exhausted, requests fail until the next day — Lens falls back to the
  user's built-in AI or API key, and shows a clear error otherwise.
- Once your extension is published and has a stable ID, set
  `ALLOWED_ORIGINS = "chrome-extension://<id>"` in `wrangler.toml` and
  redeploy, so random websites can't call your service from a browser.
- If you set `ANTHROPIC_API_KEY`, you're paying per request — keep the
  origin allowlist on, watch usage in the Anthropic console, and consider
  Cloudflare's rate-limiting rules (dashboard → Security → WAF) for a
  hard cap.

## What it stores

Nothing. The worker keeps no logs of prompts and has no storage bindings;
it forwards the prompt to the model and returns the answer.

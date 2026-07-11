# Lens Privacy Policy

Last updated: July 11, 2026

This document describes what data Lens handles and where it goes.

## Summary

Lens has three explanation engines. In **Lens service mode** (the
default), the text you highlight is sent to the Lens explanation service
— a Cloudflare Worker operated by the Lens author — which forwards it to
a hosted AI model and returns the answer; the service stores nothing. In
**built-in mode**, the text is processed by Chrome's on-device AI model
and **never leaves your machine**. In **Claude cloud mode** (optional),
the text is sent to Anthropic's Claude API using **your own API key**.
Lens collects no analytics and does not track you.

## Lens service mode (default)

When Lens uses the Lens explanation service, triggering an explanation
sends to the service (hosted on Cloudflare Workers):

- The exact text you highlighted
- A surrounding-context excerpt (up to ~2,500 characters around your
  selection) and the page's title
- A random per-install identifier (a UUID generated once at install),
  used only for abuse/rate limiting — it is not tied to your identity,
  browsing history, or any account

The service forwards the prompt to an AI model (Cloudflare Workers AI,
or Anthropic's Claude if the operator has configured it) and returns the
answer. The service keeps **no logs of prompts or answers** and has no
data storage. The model providers' terms govern the forwarded requests
(Cloudflare: https://www.cloudflare.com/privacypolicy/, Anthropic:
https://www.anthropic.com/legal/privacy).

## Built-in mode (on-device)

When Lens uses Chrome's built-in AI, the highlighted text, its
surrounding context, and the page title are passed to the on-device model
provided by Chrome. Nothing is transmitted over the network by Lens.
Built-in AI is used automatically in Auto mode when the Lens service is
unreachable, and can be selected as the only engine if you prefer that
nothing ever leaves your device.

## Claude cloud mode (optional, requires your API key)

When you have selected cloud mode (or Auto mode with an API key saved and
built-in AI unavailable), triggering an explanation sends to
`api.anthropic.com`:

- The exact text you highlighted
- A surrounding-context excerpt (up to ~2,500 characters around your
  selection) so the explanation fits the document
- The page's title
- The model name you've chosen and a system prompt template
- (For follow-up "Ask" questions:) the prior turns in that popup

These requests go directly from your browser to Anthropic, signed with
your own API key — never through any server controlled by Lens or its
author. Anthropic's privacy policy governs those requests:
https://www.anthropic.com/legal/privacy.

## What Lens stores locally

Lens uses Chrome's `chrome.storage.local` (on your computer only):

- Your Anthropic API key, if you choose to add one
- Your settings (engine, model, service URL, tint, dark mode, popup
  width, font size, stream speed)
- The random per-install identifier described above
- Your explanation **history** and **saved** bookmarks

You can clear history and saved items at any time from the Lens toolbar
popup or the options page.

## Permissions Lens requests, and why

- `<all_urls>`: Lens injects its highlight-detection script and popup UI
  on whichever site you are reading. Passive until you highlight and click.
- `storage`: store settings, history, and (optionally) your API key locally.
- `scripting`: inject the content script for the right-click fallback path.
- `contextMenus`: the right-click "Explain with Lens" menu item.
- `webNavigation`: detect PDF navigations to redirect into the bundled
  PDF.js viewer.
- `webRequest`: read `Content-Type` headers to identify PDFs without a
  `.pdf` URL. No requests are blocked or modified.
- `https://api.anthropic.com/*`: used only in Claude cloud mode, to send
  explanation requests to Anthropic using your own API key.
- `https://*.workers.dev/*`: used in Lens service mode to send
  explanation requests to the Lens explanation service.

## What Lens does NOT do

- Lens does not transmit data to any server other than the Lens
  explanation service (default mode) or `api.anthropic.com` (cloud mode
  with your key).
- Lens has no analytics, telemetry, error reporting, or usage tracking.
- Lens does not read or transmit page text unless you highlight and trigger.
- Lens does not sell, share, or otherwise disclose any user data.

## Contact

Questions about this policy: salomon.sawicki@gmail.com

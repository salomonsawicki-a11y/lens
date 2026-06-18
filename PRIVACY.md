# Lens Privacy Policy

Last updated: May 31, 2026

This document describes what data Lens handles and where it goes.

## Summary

Lens runs locally in your browser. The only data Lens transmits is the
text you explicitly choose to explain — sent to Anthropic's Claude API
using **your own API key** that **you provide**. Lens has no backend
servers, collects no analytics, and does not track you.

## What Lens sends to Anthropic

When you trigger an explanation, Lens sends to `api.anthropic.com`:

- The exact text you highlighted
- A "surrounding context" excerpt: up to roughly 2,500 characters from the
  paragraph or page around your selection, used so the explanation is
  grounded in what the document actually says
- The page's title (`document.title`)
- The model name you've chosen and a system prompt template
- (For follow-up "Ask" questions:) the prior turns of your conversation
  within that popup

These requests are made directly from your browser to Anthropic, signed
with your own API key. They are **not** routed through any server
controlled by Lens or its author. Anthropic's privacy policy governs what
Anthropic does with those requests; see
https://www.anthropic.com/legal/privacy.

## What Lens stores locally

Lens uses Chrome's `chrome.storage.local` (on your computer only):

- Your Anthropic API key
- Your settings (model, tint, dark mode, popup width, font size, stream speed)
- Your explanation **history** and **saved** bookmarks

This local data never leaves your machine unless you trigger a fresh
explanation. You can clear it at any time from the Lens toolbar popup.

## Permissions Lens requests, and why

- `<all_urls>`: Lens injects its highlight-detection script and popup UI
  on whichever site you are reading. Passive until you highlight and click.
- `storage`: store API key, settings, and history locally.
- `scripting`: inject content script for the right-click fallback path.
- `contextMenus`: the right-click "Explain with Lens" menu item.
- `webNavigation`: detect PDF navigations to redirect into the bundled
  PDF.js viewer.
- `webRequest`: read `Content-Type` headers to identify PDFs without a
  `.pdf` URL. No requests are blocked or modified.
- `https://api.anthropic.com/*`: send explanation requests to Anthropic
  using your own API key.

## What Lens does NOT do

- Lens does not transmit data to any server other than `api.anthropic.com`.
- Lens has no analytics, telemetry, error reporting, or usage tracking.
- Lens does not read or transmit page text unless you highlight and trigger.
- Lens does not sell, share, or otherwise disclose any user data.

## Contact

Questions about this policy: salomon.sawicki@gmail.com

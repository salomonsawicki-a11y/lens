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
  grounded in the document's specific subject matter rather than a generic
  definition
- The document's page title (`document.title`)
- The model name you've chosen and a system prompt template
- (For follow-up "Ask" questions:) the prior turns of your conversation
  within that popup

These requests are made directly from your browser to Anthropic, signed
with your own API key. They are **not** routed through any server
controlled by Lens or its author. Anthropic's privacy policy governs what
Anthropic does with those requests; see
https://www.anthropic.com/legal/privacy.

## What Lens stores locally

Lens uses Chrome's `chrome.storage.local` to store the following on your
computer only:

- Your Anthropic API key
- Your settings (model choice, tint, dark mode, popup width, font size,
  streaming speed)
- Your explanation **history** (the selected text and its explanation)
- Your **saved** bookmarks

This local data never leaves your machine unless you trigger a fresh
explanation (in which case the highlighted text is sent to Anthropic as
described above). You can clear it at any time from the Lens toolbar
popup ("Clear" button).

## Permissions Lens requests, and why

- `<all_urls>` host access: Lens injects its highlight-detection script and
  popup UI on whichever site or PDF you are reading. The injection is
  passive (no requests are made) until you choose to highlight text and
  click "Explain."
- `storage`: to store your API key, settings, and history locally.
- `scripting`: to inject the content script on demand for the right-click
  fallback path.
- `contextMenus`: for the right-click "Explain with Lens" menu item.
- `webNavigation`: to detect when you open a PDF and redirect it into
  Lens's bundled PDF.js viewer.
- `webRequest`: to inspect the `Content-Type` response header so PDFs that
  don't have a `.pdf` URL extension can still be routed into the Lens
  viewer. No requests are blocked or modified.
- `clipboardRead`: only used on `docs.google.com` (Docs, Sheets, Slides),
  whose text is rendered in a canvas and is unreadable from the DOM. When
  you press ⌘E in a Google document, Lens triggers a copy of your selected
  text so it can read the selection. Used **only** when you press the
  keyboard shortcut in Google Docs.
- `https://api.anthropic.com/*`: to send your explanation requests to
  Anthropic, using your own API key.

## What Lens does NOT do

- Lens does not transmit any data to any server other than `api.anthropic.com`.
- Lens has no analytics, telemetry, error reporting, or usage tracking.
- Lens does not read or transmit any text from pages you visit unless you
  explicitly highlight it and trigger an explanation.
- Lens does not sell, share, or otherwise disclose any user data.

## Contact

Questions about this policy: salomon.sawicki@gmail.com

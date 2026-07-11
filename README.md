# Lens — AI Reading Companion

Highlight any sentence anywhere on the web and get a plain-English
explanation — grounded in what you're actually reading. Lens works on
news, blogs, documentation, Wikipedia, journal articles, PDFs, books in
the browser, and pretty much anything else with text.

## How it works

1. Install Lens (Chrome).
2. Read anything. Highlight a sentence.
3. Click the small magnifying-glass **Explain** button — or press
   ⌘E / Ctrl+E, or right-click → "Explain with Lens."
4. The popup explains it — using the surrounding paragraph or page as
   context, so the explanation fits what you're reading.

**No setup needed, on any device** — Lens uses the free Lens explanation
service by default: no account, no API key, no hardware requirements
(the service lives in `server/`, a Cloudflare Worker). Chrome's built-in
on-device AI is used as an automatic fallback and is available as a
privacy-first engine choice. For higher-quality explanations you can
optionally paste an **Anthropic API key** (from
https://console.anthropic.com) in the extension's Settings; Lens then
uses Claude instead.

### Tabs in the popup

- **Explain** — Plain English or Technical mode.
- **Define** — extracts technical terms in the document's specific sense.
- **Related** — related concepts to look up next.
- **Ask** — follow-up questions about the selection.

### History and Saved

Every explanation goes to **History**. Bookmark important ones to **Saved**.

## PDFs

Lens ships its own PDF viewer so highlight-to-explain works in PDFs the
same way it does on a regular webpage. PDF links open automatically in
the Lens viewer. For local `file://` PDFs, enable *Allow access to file
URLs* at `chrome://extensions` → Lens → Details.

## Privacy

In the default mode, the text you highlight is sent to the Lens
explanation service, which forwards it to a hosted model and stores
nothing. In built-in mode, it's processed on your own device and never
leaves your machine. With an API key saved, it goes directly to
Anthropic's API using your own key. No analytics, no tracking, no logs.
See `PRIVACY.md`.

## License

MIT (see `LICENSE`). Bundles Mozilla's PDF.js under Apache 2.0 (see
`NOTICES.md` and `pdfjs/LICENSE`).

## Issues

Found a bug or want a feature? salomon.sawicki@gmail.com

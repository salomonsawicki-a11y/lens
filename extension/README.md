# Lens — AI Reading Companion

Highlight any sentence anywhere on the web and get a plain-English
explanation — grounded in what you're actually reading. Works on news,
blogs, documentation, Wikipedia, journal articles, PDFs, and pretty much
anything else with text.

## How it works

1. Install Lens (Chrome).
2. Read anything. Highlight a sentence.
3. Click the small magnifying-glass **Explain** button — or press
   ⌘E / Ctrl+E, or right-click → "Explain with Lens."
4. The popup explains it, using the surrounding paragraph as context.

**No setup needed on supported devices.** Lens uses Chrome's built-in
on-device AI by default — free, private, no account, no API key.

### Optional: Claude cloud mode

For higher-quality explanations, open **Settings** and paste an
**Anthropic API key** (from https://console.anthropic.com). The
"Explanation engine" setting controls which mode is used:

- **Auto** (default) — built-in AI when available; Claude if a key is saved.
- **Built-in AI only** — on-device, free.
- **Claude API** — highest quality, uses your key.

If your Chrome or device doesn't support built-in AI, cloud mode with a
key is required.

### Tabs in the popup

- **Explain** — Plain English or Technical mode.
- **Define** — extracts technical terms in the document's specific sense.
- **Related** — related concepts to look up next.
- **Ask** — follow-up questions about the selection.

### History and Saved

Every explanation goes to **History**. Bookmark important ones to **Saved**.

## PDFs

Lens ships its own PDF viewer so highlight-to-explain works in PDFs. For
local `file://` PDFs, enable *Allow access to file URLs* at
`chrome://extensions` → Lens → Details.

## Privacy

In built-in mode, the text you highlight is processed **on your own
device** and never leaves your machine. In Claude cloud mode, it's sent
directly to Anthropic under your own key. Either way there's no Lens
server, no analytics, no tracking. See `PRIVACY.md`.

## License

MIT (see `LICENSE`). Bundles Mozilla's PDF.js under Apache 2.0.

## Issues

Found a bug or want a feature? salomon.sawicki@gmail.com

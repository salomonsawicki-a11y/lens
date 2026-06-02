# Lens — AI Reading Companion

Highlight any sentence anywhere on the web and get a plain-English
explanation — grounded in what you're actually reading. Lens works on
news, blogs, documentation, Wikipedia, journal articles, PDFs, books in
the browser, and pretty much anything else with text.

## How it works

1. Install Lens (Chrome).
2. Open the extension's **Settings** and paste your **Anthropic API key**.
   Get one at https://console.anthropic.com.
3. Read anything. Highlight a sentence.
4. Click the small magnifying-glass **Explain** button — or press
   ⌘E / Ctrl+E, or right-click → "Explain with Lens."
5. The popup explains it — using the surrounding paragraph or page as
   context, so the explanation fits what you're reading.

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

Lens runs entirely in your browser. The only data sent anywhere is the
text you choose to explain — sent directly to Anthropic's API using your
own key. See `PRIVACY.md`.

## License

MIT (see `LICENSE`). Bundles Mozilla's PDF.js under Apache 2.0 (see
`NOTICES.md` and `pdfjs/LICENSE`).

## Issues

Found a bug or want a feature? salomon.sawicki@gmail.com

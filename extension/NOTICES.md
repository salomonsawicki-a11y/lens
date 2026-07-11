# Third-Party Software Notices

Lens bundles the following third-party software. Their licenses travel with
the bundled code as required.

## PDF.js (Mozilla)

- **Source**: https://github.com/mozilla/pdf.js
- **License**: Apache License 2.0
- **Location in this extension**: `pdfjs/`
- **License text**: see `pdfjs/LICENSE`

PDF.js is used to render PDF documents inside Lens's own viewer page
(`pdfjs/viewer.html`) so that the selected-text popup can work over PDFs
(which Chrome's built-in PDF viewer does not allow extensions to interact
with).

No modifications were made to the bundled PDF.js files themselves; Lens
wraps them with its own minimal viewer (`pdfjs/viewer.html`,
`pdfjs/viewer.js`).

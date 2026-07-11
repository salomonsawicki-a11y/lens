# Changelog

## 2.2.0 — Built-in AI actually works everywhere it can

- Fixed built-in AI never activating on Chrome versions where the Prompt
  API isn't exposed to the extension's service worker: Lens now hosts the
  on-device model in an offscreen document when needed.
- The one-time model download now starts automatically on install, and
  Settings shows live download progress (with a manual download button
  when Chrome wants a user gesture).
- Auto engine order matches the product vision: built-in on-device AI by
  default with zero setup; saving an Anthropic API key upgrades Auto to
  Claude.
- Removed the unreleased "Lens service" proxy engine (and its per-user
  ID) — the code now matches the privacy policy: on-device by default,
  direct-to-Anthropic with your own key otherwise.
- Errors are no longer cached: once the model finishes downloading,
  re-opening the popup or toggling Plain English/Technical retries.
- Each built-in request now runs on a fresh session clone so long reading
  sessions can't overflow the on-device model's context window.

## 2.0.0 — Works out of the box: built-in AI

- Lens now uses Chrome's built-in on-device AI (Prompt API) by default —
  no account, no API key, no network. Free.
- New "Explanation engine" setting: Auto (default), Built-in only, or
  Claude API. The Anthropic key is now optional and enables cloud mode.
- In built-in mode, highlighted text never leaves the device.
- Friendlier errors that explain how to enable an engine when none is
  available.

## 1.6.0 — Google Docs support removed
## 1.5.1 — Renamed to "Lens — AI Reading Companion"
## 1.5.0 — Commercial-readiness pass
## 1.4.x — Google Docs support (removed in 1.6.0)
## 1.3.0 — Context-aware explanations
## 1.2.x — Appearance tab; visual changes don't rebuild popup
## 1.1.x — PDF viewer, magnifier icon, dark-mode tints, prose cleanup
## 1.0.x — Initial release

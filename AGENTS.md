# Slack Recent Switcher

This repository loads a small modification into the official Slack macOS app through its loopback debugging port. There is no patched app copy or custom overlay.

- Read README.md before running or changing the loader.
- Keep the implementation dependency-free and scoped to Slack’s native blank-state switcher.
- Preserve native search, history, keyboard navigation, and authentication. Never copy profile data, extract credentials, disable Electron’s sandbox, or alter app signing/integrity settings.
- `node load.mjs` reloads current Slack workspace windows. On first use, Slack must be quit before the loader can start it with the debugging flag. Do not force-kill Slack or overwrite its app/profile.
- Keep connections bound to `127.0.0.1`. The debugging port remains open until Slack quits.
- Incompatible search source must be rejected before any partial rewrite is returned. Continue the original response on failure.
- Run `npm test` after changes. Verify the actual client for rendering, eight recent entries, arrow-key/Enter alignment, Escape, and typed search. Do not send messages while testing.
- Preserve unrelated repository changes. Do not commit or push unless asked.

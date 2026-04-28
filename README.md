# SimplyComment

SimplyComment is a Chrome extension for generating one-sentence comments in your own voice.

## How it works

1. Open the extension popup.
2. Paste the post text.
3. Add a short angle, or switch to ideate mode.
4. Generate a one-sentence comment.
5. Copy and post it manually.

## Setup

1. Open Settings from the popup.
2. Paste your OpenAI API key (`sk-...`).
3. Optionally add your tone/profile context and 4 to 6 comment examples.

Your API key and profile are stored in `chrome.storage.sync`.

## Files

- `manifest.json`: extension configuration (MV3)
- `popup.html` and `popup.js`: quick-action popup UI and generation flow
- `settings.html` and `settings.js`: profile and API settings page
- `icon16.png`, `icon48.png`, `icon128.png`: extension icons

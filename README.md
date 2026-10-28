# FormFillup

A browser extension that fills job application forms from a profile stored only in your browser. It is built first for Bangladeshi government job portals on Teletalk (`*.teletalk.com.bd`) and works on other sites through generic matching plus an optional AI fallback.

- Works in Chrome, Edge, Brave and Opera (MV3), and in Firefox.
- Shows a preview of every value before anything is written. Nothing is submitted for you; captcha and the final submit stay with you.
- Your profile never leaves the browser. The AI field mapper sees only form labels, never your data. Documents go to the AI only when you click "Extract details".

## Install (load unpacked)

```bash
npm install
npm run build            # Chrome/Edge/Brave/Opera -> .output/chrome-mv3
npm run build:firefox    # Firefox -> .output/firefox-mv2
```

On WSL without Linux Node, run these through Windows, e.g. `cmd.exe /c "npm run build"`.

- **Chrome / Edge / Brave / Opera:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click "Load unpacked" and pick `.output/chrome-mv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `.output/firefox-mv2/manifest.json`.

## Set up

1. The options page opens on install (or right-click the toolbar icon, then Options).
2. **AI settings:** paste a free Gemini API key from <https://aistudio.google.com/apikey>. The default model is `gemini-flash-lite-latest`. If a model is overloaded or retired, the extension falls back to other Flash-Lite models automatically.
3. **Import from documents** (optional): drop your CV, NID, SSC/HSC certificates or marksheets (PDF or photos). Large phone photos are downscaled before upload. Review the extracted values, tick what to keep, then apply.
4. **Profile:** check everything, and add your Bangla names exactly as they appear on certificates.

## Use

1. Open the application form (on Teletalk: circular, then post, then the application page).
2. Click the FormFillup icon, then **Scan this page**. Matched fields are outlined on the page: green for confident, amber for a guess.
3. Untick anything you don't want filled, then click **Fill**.
4. Check every value, upload your photo and signature, solve the captcha, tick the declaration and submit yourself.

## Development

```bash
npm run dev          # Chrome with hot reload
npm test             # unit and engine tests (offline)
npm run compile      # type-check
```

Live AI checks (real network calls, skipped unless a key is supplied):

```bash
cmd.exe /c "set FF_LIVE_GEMINI_KEY=<your key>&& npx vitest run tests/live.gemini.test.ts"
```

Architecture, module ownership and the message protocol are in `docs/ARCHITECTURE.md`. Observed Teletalk form behaviour is in `docs/teletalk-reference.md`.

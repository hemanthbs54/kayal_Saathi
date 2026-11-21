# Notes for coding agents (Devin, Claude Code, etc.)

- Stack: Node 22+, Express 5, ES modules, vanilla JS frontend in `public/` (no build step).
- Run: `npm start` (port 3000). Test: `npm test` (forces `MOCK=1`, so no Sarvam credits are used).
- Always keep `npm test` green. Add a test in `test/api.test.js` for any new API behaviour.
- Sarvam credits are limited: develop with `MOCK=1`; only call the live API to verify a finished change.
- Sarvam API facts (verified 2026-11): STT `saaras:v4` at `/speech-to-text` (multipart `file`, `model`, `mode`, `language_code`, `keyterms`); chat `sarvam-105b` at `/v1/chat/completions`; TTS `bulbul:v3` at `/text-to-speech` (JSON `text`, `language_code`, `speaker`, returns `audios[]` base64). Auth header: `api-subscription-key`.
- Never commit `.env`, `data/` or `uploads/`.
- UI copy is bilingual: Malayalam first, English second.

# Notes for Claude

- The user writes in Serbian; answer in Serbian Cyrillic. UI text is Serbian Cyrillic.
- Source lives in `src/`; `index.html` is generated: run `node tools/build.mjs` after every change to `src/` and commit both. CI fails if they differ.
- JS files are concatenated in the order listed in `tools/build.mjs` into one inline script (shared global scope, no modules). Keep top-level names unique.
- Run `NODE_PATH=$(npm root -g) node tests/smoke.mjs` before pushing; look at the screenshots in `tests/out/` for layout problems (no horizontal page scroll at 390px width).
- Spotify Web API is used in development mode with the February 2026 rules: search `limit` ≤ 10, no batch `/tracks?ids=`, library writes via `/me/library?uris=…`, playlist items via `/playlists/{id}/items` (items carry `item`, older responses `track`).
- Android bridge is `window.AppAndroid` (see `MainActivity.Bridge`). New bridge methods need `app-native-api` meta + `WebUpdater.NATIVE_API` bumped together.
- Never commit signing keys or passwords; release signing comes from GitHub Actions secrets.

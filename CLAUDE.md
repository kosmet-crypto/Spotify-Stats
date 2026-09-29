# Notes for Claude

## The user

- Writes in Serbian; always answer in Serbian Cyrillic. All UI text is Serbian Cyrillic.
- Works from a phone, no computer at hand: give steps that work in a phone browser (direct links,
  "Desktop site" in Chrome's menu when GitHub or Spotify hide buttons), one short numbered list at a time.
- Wants to discuss ideas first when asked; when they say "уради", do it.
- Family will test the APK; Google Play maybe much later.

## The app: Слушаоница (package `app.slusaonica`)

Music listening statistics (Spotify-focused) as a web app in an Android WebView wrapper.
Data stays on the device (IndexedDB). Three sources, merged in `Store.mergePlays` (`src/js/store.js`):

1. Spotify "Extended streaming history" export (ZIP/JSON import). Wins for the time it covers:
   other sources' plays inside that time are dropped.
2. Spotify recently played (`/me/player/recently-played`, last 50 only): fetched in the app and by the
   hourly Android job `RecentJob`, which queues plays for the page (`AppAndroid.drainRecent()`).
3. Last.fm scrobbles (optional; user + API key in settings), full history with resumable backfill.

Outside the export's time, the same song within 5 minutes from two sources is one play (each source
claims a play once, so repeats stay separate). Re-imports add nothing. Names are matched across
"- Remastered", "feat.", Cyrillic/Latin (`trackKey` in `src/js/util.js`).

Screens: Преглед, Време, Топ (with bar chart race), Анализа (discoveries, obsessions, comebacks, habits,
variety, artist groups), detail pages, Wrapped for any period, Spotify tab (now playing + controls,
search, Spotify top vs. my ranks, liked songs, playlists, playlist generator with cover, library),
settings (sources, backup/restore, CSV). "Учитај пробне податке" loads a fictional demo history.

The original idea of World 100 / ExYu 100 top lists with points and rounds was dropped by the user.
Point-counter is a different app; do not touch it.

## Code

- Source in `src/`; `index.html` is generated: run `node tools/build.mjs` after every change to `src/`
  and commit both. CI fails if they differ. The Android app downloads `index.html` from `main`.
- JS files are concatenated in the order listed in `tools/build.mjs` into one inline script (shared
  global scope, no modules). Keep top-level names unique.
- Charts are hand-written SVG/HTML (`src/js/charts.js`), no libraries (works offline). Palette and mark
  rules follow the dataviz skill; colors are CSS tokens `--c1…--c8`, heat ramp `--q0…--q6`, dark and light.
- Test: `node tools/build.mjs && NODE_PATH=$(npm root -g) node tests/smoke.mjs` (Chromium, demo data, all
  screens, JSON+ZIP import, merge rules, name matching). Look at `tests/out/*.png`; no horizontal page
  scroll at 390px width.
- Android wrapper in `android/` (adapted from Point-counter): `MainActivity` (bridge `window.AppAndroid`),
  `Tokens` (Spotify tokens shared with the job, one refresh at a time), `RecentJob`, `WebUpdater`
  (over-the-air page), `ApkInstaller`. A new bridge method needs `<meta name="app-native-api">` in
  `src/index.template.html` and `WebUpdater.NATIVE_API` raised together. There is no Android SDK in the
  container: Java changes are only verified by the GitHub Actions build.

## Spotify (development mode, rules since February 2026)

- Owner needs Premium (the user has it); max 5 users, added under User Management in the dashboard.
- Search `limit` ≤ 10; no batch `/tracks?ids=` (covers fetched one by one, lazily, `Covers`);
  library writes via `/me/library?uris=…`; playlist items via `/playlists/{id}/items` (items carry
  `item`, older responses `track`); only own playlists can be read item by item; no popularity.
- Login: Authorization Code + PKCE, no client secret. Redirect URI
  `https://kosmet-crypto.github.io/Spotify-Stats/callback.html` (GitHub Pages, enabled). The page
  forwards to `slusaonica://callback` when the state starts with "a" (app), else back to the web app.
- The user must create their own app at developer.spotify.com/dashboard (Web API, the redirect URI
  above) and paste the Client ID in Подешавања → Spotify. Status: they were filling in that form
  (Save was grey: redirect URI needs "Add", terms checkbox). Real login has not been confirmed yet.

## Releases and signing

- `.github/workflows/android.yml`: builds on every push; only builds signed with the real key are
  published as releases (`v1.0.<run>`, asset `slusaonica.apk`), plus `slusaonica.aab` for Play.
- The signing key was created by `.github/workflows/signing-key.yml` ("Направи потписни кључ") and lives
  only in Actions secrets (`SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`).
  It cannot be read back; there is no copy. Never commit keys or passwords, and never replace the key
  (installed apps could no longer update). For Google Play later: let Google create its own app signing
  key; testers reinstall once (backup/restore in the app keeps their data).
- First signed release: v1.0.6. Download link:
  https://github.com/kosmet-crypto/Spotify-Stats/releases/latest/download/slusaonica.apk

## Open items

- Confirm Spotify login and the return to the app on a real phone; fix what breaks.
- Confirm the background job (`RecentJob`) runs on the user's phone (battery savers may stop it).
- Before Google Play: current `targetSdk`, privacy policy, Spotify extended quota for more than 5 users.

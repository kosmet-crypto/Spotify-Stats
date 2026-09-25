# Слушаоница

Статистика слушања музике за Android (и веб): по данима, месецима и годинама, са пуно графикона.
Подаци стижу из три извора и остају само на телефону:

| Извор | Шта даје | Како |
|---|---|---|
| **Spotify извоз** („Extended streaming history“) | свако слушање од отварања налога, са трајањем, прескакањима, shuffle, уређајем, земљом | spotify.com → Account → Privacy settings → Download your data; ZIP се увози у апликацији |
| **Spotify пријава** | слушања од сада (Spotify памти само последњих 50, апликација их преузима и у позадини), Spotify топ, лајковане песме, плејлисте, омоти, пуштање | Подешавања → Spotify |
| **Last.fm** (опционо) | цела историја скробловања | корисничко име + бесплатан API кључ |

### Дупла слушања

- За време које покрива Spotify извоз, важи само извоз (најпотпунији је).
- Ван тога, исто слушање са Spotify-ја и са Last.fm-а (иста песма у размаку до 5 минута) рачуна се једном.
- Поновни увоз истих фајлова или поновно преузимање не додају ништа.
- Песме се препознају и кад се назив разликује („- Remastered 2011“, „feat.“, ћирилица/латиница).

## Инсталација (Android)

Најновији APK: https://github.com/kosmet-crypto/Spotify-Stats/releases/latest/download/slusaonica.apk

1. Отвори линк на телефону и преузми `slusaonica.apk`.
2. Отвори фајл и дозволи инсталацију из прегледача (једном).
3. Нове верзије стижу саме: страница се ажурира при покретању, а за нови APK апликација нуди инсталацију.

Веб верзија (када се укључи GitHub Pages): https://kosmet-crypto.github.io/Spotify-Stats/

## Једнократно подешавање репозиторијума

1. **GitHub Pages** (потребно за Spotify пријаву): Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
   Spotify се после пријаве враћа на `https://kosmet-crypto.github.io/Spotify-Stats/callback.html`, а та страница прослеђује пријаву у апликацију.
2. **Потписни кључ за APK** (да би свака нова верзија могла да се инсталира преко старе, и касније за Google Play).
   Кључ никад не иде у репозиторијум, само у GitHub Secrets. Једном, на рачунару са Јавом или Android Studiom:
   ```
   keytool -genkeypair -v -keystore slusaonica-release.jks -storetype PKCS12 -alias slusaonica -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Slusaonica"
   base64 -w0 slusaonica-release.jks > keystore.txt        # Windows: certutil -encode slusaonica-release.jks keystore.txt (па обриши прву и последњу линију)
   ```
   Затим у Settings → Secrets and variables → Actions → *New repository secret* додај:
   `SIGNING_KEYSTORE_BASE64` (садржај `keystore.txt`), `SIGNING_STORE_PASSWORD` (лозинка), `SIGNING_KEY_ALIAS` = `slusaonica`.
   `keystore.txt` обриши, а `.jks` фајл и лозинку сачувај на два сигурна места (менаџер лозинки + диск): без њих нема ажурирања.
   Па Actions → *Android APK* → *Run workflow* на `main`: настаје први release.
   Без кључа APK се и даље прави (за пробу, у Actions → artifacts), али се не објављује као release.

### Google Play касније

- Исти кључ се при објављивању даје Google-у кроз *Play App Signing* („use existing app signing key“): тако и они који су APK инсталирали одавде добијају ажурирања из Play продавнице.
- Сваки потписан build прави и `slusaonica.aab` (Actions → artifacts), фајл који се шаље у Play Console.
- Пре објаве: `targetSdk` мора бити најновији који Play тражи, политика приватности (подаци остају на телефону), и Spotify „extended quota“ ако ће апликацију користити више од 5 људи.

## Spotify апликација (за пријаву)

Spotify тражи да свако направи своју бесплатну „апликацију“ на https://developer.spotify.com/dashboard:
Redirect URI `https://kosmet-crypto.github.io/Spotify-Stats/callback.html`, штиклиран Web API, па Client ID у подешавања Слушаонице.
Правила за development мод (од фебруара 2026): власник мора имати Premium, највише 5 корисника, претрага враћа до 10 резултата, нема групног дохватања песама.

## Развој

- Код је у `src/` (`src/js/*.js`, `src/css/app.css`, `src/index.template.html`). `index.html` се **прави** командом `node tools/build.mjs` и мора бити комитован (апликација га преузима са `main`). CI проверава да је ажуран.
- Тест у Chromium-у (пробни подаци, сви екрани, увоз JSON/ZIP, правила спајања): `node tools/build.mjs && NODE_PATH=$(npm root -g) node tests/smoke.mjs` (снимци екрана у `tests/out/`).
- Иконице: `NODE_PATH=$(npm root -g) node tools/icons.mjs`.
- Android омотач је у `android/` (WebView, пријава преко `slusaonica://callback`, позадинско преузимање `RecentJob`, ажурирања). Када страница почне да користи нову `AppAndroid` методу, повећај `<meta name="app-native-api">` у `src/index.template.html` и `WebUpdater.NATIVE_API`.

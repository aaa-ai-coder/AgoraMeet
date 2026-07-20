# AgoraMeet

Agora-powered video & voice conferencing web app with a native Android wrapper (Capacitor).

## Features
- Real-time video/voice calls via Agora RTC
- Secure token generation on the server (App Certificate protected)
- Built-in text chat (Agora data stream)
- Camera/mic toggle, screen share, active-speaker highlight
- Offline-bundled Agora SDK (no CDN dependency)

## Live backend
The token server is deployed on Render: `https://agorameet-server.onrender.com`

## Download the Android APK
APKs are published as GitHub Release artifacts (no local hosting needed):

**https://github.com/aaa-ai-coder/AgoraMeet/releases/tag/v1.2.0**

- `AgoraMeet-v1.2.0-debug.apk` — install as "AgoraMeet"
- `AgoraMeet2-v1.2.0-debug.apk` — install as "AgoraMeet 2" (different package ID, runs side-by-side)

> Tip: Download in **Chrome** (GitHub release links redirect; Chrome follows them). Enable "Install unknown apps" for your browser in Android Settings → Security.

## Run locally (web)
```bash
npm install
npm start          # serves on PORT (default 5000)
```

## Run locally (Android build)
Requires Android SDK. See `setup_android.sh`.
```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Deploy server (Render)
Push to the connected GitHub repo; Render auto-deploys via `render.yaml`.
Environment vars: `AGORA_APP_ID`, `AGORA_CERTIFICATE`, `PORT`.

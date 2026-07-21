// AgoraMeet backend — Cloudflare Worker (replaces the old Render Express server).
// Native Worker: no Express, no firebase-admin. Firebase is reached via REST + Web Crypto (jose).
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { SignJWT, importPKCS8, importX509, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Small helpers
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "Content-Type,Authorization",
    },
  });
}

// ---------------------------------------------------------------------------
// Firebase service-account + REST helpers (no firebase-admin)
let _sa = null;
function sa(env) {
  if (!_sa) _sa = JSON.parse(env.FB_SERVICE_ACCOUNT);
  return _sa;
}
let _at = null; // { token, exp }
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_at && _at.exp > now + 60) return _at.token;
  const account = sa(env);
  const key = await importPKCS8(account.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  _at = { token: d.access_token, exp: now + (d.expires_in || 3600) };
  return _at.token;
}
const FS = (env, path) =>
  `https://firestore.googleapis.com/v1/projects/${sa(env).project_id}/databases/(default)/documents${path}`;

function toFs(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === "boolean") f[k] = { booleanValue: v };
    else if (typeof v === "number") f[k] = { integerValue: String(v) };
    else if (v instanceof Date) f[k] = { timestampValue: v.toISOString() };
    else if (typeof v === "string") f[k] = { stringValue: v };
    else f[k] = { stringValue: JSON.stringify(v) };
  }
  return f;
}
function fromFs(fields) {
  const o = {};
  if (!fields) return o;
  for (const [k, v] of Object.entries(fields)) {
    if ("stringValue" in v) o[k] = v.stringValue;
    else if ("booleanValue" in v) o[k] = v.booleanValue;
    else if ("integerValue" in v) o[k] = Number(v.integerValue);
    else if ("doubleValue" in v) o[k] = v.doubleValue;
    else if ("timestampValue" in v) o[k] = new Date(v.timestampValue);
    else if ("nullValue" in v) o[k] = null;
    else if ("mapValue" in v) o[k] = fromFs(v.mapValue.fields);
    else o[k] = null;
  }
  return o;
}
async function fsGet(env, path) {
  const at = await getAccessToken(env);
  const r = await fetch(FS(env, path), { headers: { Authorization: `Bearer ${at}` } });
  if (r.status === 404) return null;
  const d = await r.json();
  return d.fields ? { id: d.name.split("/").pop(), ...fromFs(d.fields) } : null;
}
async function fsPatch(env, path, obj, mask) {
  const at = await getAccessToken(env);
  const url = `${FS(env, path)}?${mask.map((m) => `updateMask.fieldPaths=${m}`).join("&")}&currentDocument.exists=true`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: toFs(obj) }),
  });
  return r.ok;
}
async function fsQuery(env, field, op, value) {
  const at = await getAccessToken(env);
  const r = await fetch(`${FS(env, ":runQuery")}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } } },
        limit: 1,
      },
    }),
  });
  const rows = await r.json();
  const row = rows.find((x) => x.document);
  return row ? { id: row.document.name.split("/").pop(), ...fromFs(row.document.fields) } : null;
}

// Firebase Auth REST (uses the public Web API key, not the service account)
async function authLookup(env, phoneNumber) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FB_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: [phoneNumber] }),
  });
  const d = await r.json();
  return d.users && d.users[0] ? d.users[0] : null;
}
async function authCreate(env, phoneNumber) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FB_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber }),
  });
  const d = await r.json();
  return d.localId || null;
}
async function verifyIdToken(env, idToken) {
  const certs = await (await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com")).json();
  const { kid } = JSON.parse(atob(idToken.split(".")[0]));
  if (!certs[kid]) throw new Error("unknown signing key");
  const key = await importX509(certs[kid], "RS256");
  const { payload } = await jwtVerify(idToken, key, {
    issuer: `https://securetoken.google.com/${sa(env).project_id}`,
    audience: sa(env).project_id,
  });
  return payload;
}
async function createCustomToken(env, uid) {
  const account = sa(env);
  const key = await importPKCS8(account.private_key, "RS256");
  return await new SignJWT({ uid })
    .setProtectedHeader({ alg: "RS256", kid: account.client_email })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

// ---------------------------------------------------------------------------
// B2 secure download (private bucket, pre-signed redirect)
let _b2 = null;
async function b2Auth(env) {
  const now = Date.now();
  if (_b2 && _b2.exp > now + 60000) return _b2;
  const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
  const r = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${basic}` },
  });
  const d = await r.json();
  _b2 = {
    apiUrl: d.apiInfo.storageApi.apiUrl,
    downloadUrl: d.apiInfo.storageApi.downloadUrl,
    token: d.authorizationToken,
    exp: now + 12 * 3600 * 1000,
  };
  return _b2;
}

// ---------------------------------------------------------------------------
// Telegram
function tg(env) {
  return (method, body) =>
    fetch(`https://api.telegram.org/bot${env.VERIFY_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
}
async function confirmCode(env, code, chatId) {
  const snap = await fsQuery(env, "verifyCode", "EQUAL", code);
  if (!snap) return { ok: false, error: "code not found or already used" };
  if (snap.phoneVerified) return { ok: false, error: "code already used" };
  if (snap.codeExpires && new Date(snap.codeExpires) < new Date()) return { ok: false, error: "code expired" };
  await fsPatch(
    env,
    `/users/${snap.id}`,
    { phoneVerified: true, tgChatId: String(chatId), verifyCode: null },
    ["phoneVerified", "tgChatId", "verifyCode"]
  );
  return { ok: true, phone: snap.phone || snap.uid || "" };
}

// ---------------------------------------------------------------------------
// LiveKit access token (HS256)
async function livekitToken(env, room, identity, name) {
  const secret = new TextEncoder().encode(env.LIVEKIT_API_SECRET);
  return await new SignJWT({ video: { roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true } })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.LIVEKIT_API_KEY)
    .setSubject(identity)
    .setExpirationTime("2h")
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(secret);
}

// ---------------------------------------------------------------------------
// Router
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return corsPreflight();
    const p = url.pathname;

    try {
      if (p === "/api/health") {
        const b2 = !!(env.B2_KEY_ID && env.B2_APP_KEY);
        return json({
          status: "ok",
          agora: !!env.AGORA_CERTIFICATE,
          firebase: !!env.FB_SERVICE_ACCOUNT,
          cloudflare: !!env.CF_APP_SECRET,
          ai: !!env.NARA_API_KEY,
          b2,
          livekit: !!env.LIVEKIT_API_SECRET,
        });
      }

      if (p === "/api/firebase-config") {
        return json({
          apiKey: env.FB_API_KEY || "",
          authDomain: env.FB_AUTH_DOMAIN || "",
          projectId: env.FB_PROJECT_ID || "aaa-infinity-ai",
          storageBucket: env.FB_STORAGE_BUCKET || "",
          messagingSenderId: env.FB_MESSAGING_SENDER_ID || "",
          appId: env.FB_APP_ID || "",
        });
      }

      // Agora RTC token
      if (p === "/api/token" && request.method === "GET") {
        const channel = url.searchParams.get("channel");
        if (!channel) return json({ error: "channel required" }, 400);
        if (!env.AGORA_CERTIFICATE) return json({ error: "token service unavailable" }, 503);
        let uid = parseInt(url.searchParams.get("uid") || "0", 10);
        if (isNaN(uid)) uid = 0;
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const token = RtcTokenBuilder.buildTokenWithUid(
          env.AGORA_APP_ID, env.AGORA_CERTIFICATE, channel, uid, RtcRole.PUBLISHER, exp, exp
        );
        return json({ token, appId: env.AGORA_APP_ID, uid, channel });
      }

      // LiveKit token
      if (p === "/api/livekit/token" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (!env.LIVEKIT_API_SECRET) return json({ error: "livekit not configured" }, 503);
        const token = await livekitToken(env, b.room || "default", b.identity || "guest", b.name || "Guest");
        return json({ token, url: env.LIVEKIT_URL });
      }

      // Verify Firebase ID token
      if (p === "/api/verify" && request.method === "POST") {
        if (!env.FB_SERVICE_ACCOUNT) return json({ error: "firebase not configured" }, 503);
        const { idToken } = await request.json().catch(() => ({}));
        const d = await verifyIdToken(env, idToken);
        return json({ uid: d.uid, phone: d.phone_number || null, name: d.name || null });
      }

      // FCM push
      if (p === "/api/push" && request.method === "POST") {
        if (!env.FB_SERVICE_ACCOUNT) return json({ error: "firebase not configured" }, 503);
        const { token, title, body, data } = await request.json().catch(() => ({}));
        if (!token) return json({ error: "token required" }, 400);
        const at = await getAccessToken(env);
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa(env).project_id}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify({ message: { token, notification: { title, body }, data: data || {} } }),
        });
        const d = await r.json();
        return r.ok ? json({ ok: true, id: d.name }) : json({ error: d.error?.message || "push failed" }, 500);
      }

      // Cloudflare Realtime proxy
      if (p.startsWith("/api/cf/")) {
        if (!env.CF_APP_SECRET) return json({ error: "cf not configured" }, 503);
        const base = "https://rtc.live.cloudflare.com/v1";
        const call = async (path, method, body) => {
          const r = await fetch(`${base}/apps/${env.CF_APP_ID}${path}`, {
            method,
            headers: { "content-type": "application/json", Authorization: `Bearer ${env.CF_APP_SECRET}` },
            body: body ? JSON.stringify(body) : undefined,
          });
          return r.json();
        };
        if (p === "/api/cf/config") return json({ appId: env.CF_APP_ID, available: !!env.CF_APP_SECRET });
        if (p === "/api/cf/session/new") {
          const { sdp } = await request.json();
          return json(await call("/sessions/new", "POST", { sessionDescription: { type: "offer", sdp } }));
        }
        if (p === "/api/cf/tracks/new") {
          const { sessionId, tracks, sdp } = await request.json();
          const body = { tracks };
          if (sdp) body.sessionDescription = { type: "offer", sdp };
          return json(await call(`/sessions/${sessionId}/tracks/new`, "POST", body));
        }
        if (p === "/api/cf/tracks/renegotiate") {
          const { sessionId, sdp } = await request.json();
          return json(await call(`/sessions/${sessionId}/renegotiate`, "PUT", { sessionDescription: { type: "answer", sdp } }));
        }
      }

      // AI chat — supports multiple providers (all the keys you provided)
      const AI_PROVIDERS = {
        nara: { url: (env.NARA_BASE_URL || "https://router.bynara.id/v1") + "/chat/completions", key: env.NARA_API_KEY, def: "tencent-hy3" },
        groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY, def: "llama-3.3-70b-versatile" },
        mistral: { url: "https://api.mistral.ai/v1/chat/completions", key: env.MISTRAL_API_KEY, def: "mistral-large-latest" },
        siliconflow: { url: "https://api.siliconflow.com/v1/chat/completions", key: env.SILICONFLOW_API_KEY, def: "deepseek-ai/DeepSeek-V3" },
        arcee: { url: "https://conductor.arcee.ai/v1/chat/completions", key: env.ARCEE_API_KEY, def: "arcee-ai/arcee-blitz" },
        cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", key: env.CEREBRAS_API_KEY, def: "llama-3.3-70b" },
      };
      if (p === "/api/ai/models") {
        const list = Object.entries(AI_PROVIDERS).filter(([, v]) => v.key).map(([k, v]) => ({ provider: k, defaultModel: v.def }));
        return json({ providers: list, available: list.length > 0 });
      }
      if (p === "/api/ai/chat" && request.method === "POST") {
        const { messages, model, provider } = await request.json().catch(() => ({}));
        if (!Array.isArray(messages) || !messages.length) return json({ error: "messages required" }, 400);
        const prov = AI_PROVIDERS[provider] || AI_PROVIDERS.nara;
        if (!prov || !prov.key) return json({ error: "ai provider not configured" }, 503);
        const r = await fetch(prov.url, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${prov.key}` },
          body: JSON.stringify({ model: model || prov.def, messages, stream: false }),
        });
        const d = await r.json();
        if (!r.ok) return json({ error: d.error?.message || "ai error" }, r.status);
        return json({ reply: d.choices?.[0]?.message?.content || "", raw: d, provider });
      }
      // LiveKit voice agent token (for AI Voice calls)
      if (p === "/api/ai/voice" && request.method === "POST") {
        if (!env.LIVEKIT_API_SECRET) return json({ error: "livekit not configured" }, 503);
        const { room, identity, name } = await request.json().catch(() => ({}));
        const rk = await livekitToken(env, room || "ai-voice", identity || "user", name || "User");
        return json({ token: rk, url: env.LIVEKIT_URL, room: room || "ai-voice" });
      }

      // LinkPreview (rich link cards)
      if (p === "/api/link-preview" && request.method === "GET") {
        const q = url.searchParams.get("url");
        if (!q) return json({ error: "url required" }, 400);
        if (!env.LINKPREVIEW_KEY) return json({ error: "linkpreview not configured" }, 503);
        try {
          const r = await fetch(`https://api.linkpreview.net/?key=${env.LINKPREVIEW_KEY}&q=${encodeURIComponent(q)}`, {
            headers: { "user-agent": "Mozilla/5.0 (AgoraMeet)" },
          });
          const text = await r.text();
          try { return json(JSON.parse(text)); }
          catch { return json({ error: "linkpreview parse failed", raw: text.slice(0, 200) }, 502); }
        } catch (e) {
          return json({ error: String(e.message || e) }, 502);
        }
      }

      // Telegram phone verification
      if (p === "/api/auth/start" && request.method === "POST") {
        if (!env.FB_SERVICE_ACCOUNT) return json({ error: "firebase not configured" }, 503);
        const phone = (await request.json()).phone.replace(/[^0-9+]/g, "");
        if (!/^\+?\d{6,15}$/.test(phone)) return json({ error: "invalid phone" }, 400);
        const full = phone.startsWith("+") ? phone : "+" + phone;
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await fsPatch(
          env, `/users/${full}`,
          { phone: full, verifyCode: code, codeExpires: new Date(Date.now() + 5 * 60 * 1000), phoneVerified: false },
          ["phone", "verifyCode", "codeExpires", "phoneVerified"]
        );
        return json({ ok: true, deepLink: `https://t.me/${env.VERIFY_BOT_USERNAME || "AgoraMeet_Login_bot"}?start=${code}`, phone: full });
      }
      if (p === "/api/auth/status" && request.method === "GET") {
        if (!env.FB_SERVICE_ACCOUNT) return json({ error: "firebase not configured" }, 503);
        const phone = url.searchParams.get("phone").replace(/[^0-9+]/g, "");
        const full = phone.startsWith("+") ? phone : "+" + phone;
        const doc = await fsGet(env, `/users/${full}`);
        if (!doc || !doc.phoneVerified) return json({ verified: false });
        let uid = doc.uid;
        if (!uid) {
          const u = await authLookup(env, full);
          uid = u ? u.localId : await authCreate(env, full);
        }
        await fsPatch(env, `/users/${full}`, { uid, name: full, phone: full, online: true }, ["uid", "name", "phone", "online"]);
        const token = await createCustomToken(env, uid);
        return json({ verified: true, token, uid });
      }
      if (p === "/api/bot/confirm" && request.method === "POST") {
        const { code, chatId } = await request.json();
        if (!code) return json({ error: "code required" }, 400);
        const r = await confirmCode(env, code, chatId);
        if (!r.ok) return json({ error: r.error }, r.error === "code already used" ? 409 : 404);
        return json({ ok: true, phone: r.phone });
      }
      if (p === "/api/telegram-webhook" && request.method === "POST") {
        const u = await request.json().catch(() => ({}));
        const send = tg(env);
        if (u.message && u.message.text && u.message.text.startsWith("/start")) {
          const code = u.message.text.split(" ")[1];
          const cid = String(u.message.chat.id);
          if (code) {
            await send("sendMessage", {
              chat_id: cid,
              text: "Login code received.\n\nTap the button below to confirm you want to log in to AgoraMeet with this phone number.",
              reply_markup: { inline_keyboard: [[{ text: "✅ Confirm login", callback_data: "confirm:" + code }]] },
            });
          } else {
            await send("sendMessage", { chat_id: cid, text: "Hello! Use the button in the AgoraMeet app to start verification." });
          }
        } else if (u.callback_query) {
          const cb = u.callback_query;
          const cid = String(cb.message.chat.id);
          await send("answerCallbackQuery", { callback_query_id: cb.id });
          if (cb.data && cb.data.startsWith("confirm:")) {
            const code = cb.data.split("confirm:")[1];
            const r = await confirmCode(env, code, cid);
            await send("editMessageText", {
              chat_id: cid,
              message_id: cb.message.message_id,
              text: r.ok ? `Verified ${r.phone || "your number"} ✅\nYou can close Telegram and return to the AgoraMeet app.` : `Verification failed: ${r.error || "unknown"}`,
            });
          }
        }
        return json({ ok: true });
      }

      // APK download redirect to GitHub Releases
      if (p === "/api/apk/download" && request.method === "GET") {
        const pkg = url.searchParams.get("pkg");
        if (pkg !== "com.agorameet.app" && pkg !== "com.agorameet.app2") return json({ error: "invalid pkg" }, 400);
        const apkName = pkg === "com.agorameet.app2" ? "com.agorameet.app2-release.apk" : "com.agorameet.app-release.apk";
        const ghUrl = `https://github.com/aaa-ai-coder/aaa-ai/releases/download/v3.0.0/${apkName}`;
        return Response.redirect(ghUrl, 302);
      }

      // Client-side crash/error logging
      if (p === "/api/client-error" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        console.log("[client-error]", b.version || "", b.pkg || "", b.message || "", (b.stack || "").slice(0, 300));
        if (env.FB_SERVICE_ACCOUNT) {
          try {
            const at = await getAccessToken(env);
            await fetch(`${FS(env, "/logs/clientErrors")}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${at}`, "content-type": "application/json" },
              body: JSON.stringify({
                fields: toFs({
                  at: new Date(), version: b.version || "", pkg: b.pkg || "", ua: b.ua || "",
                  message: b.message || "", stack: b.stack || "", url: b.url || "",
                }),
              }),
            });
          } catch (e) { console.log("[client-error-store-fail]", e.message); }
        }
        return json({ ok: true });
      }

      // Static assets (index.html, js, css, icons...) served from the Worker
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500);
    }
  },
};

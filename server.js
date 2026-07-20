// server.js - AgoraMeet v2 backend
// - Serves the web app (public/)
// - Proxies Agora RTC token generation (keeps Agora cert secret)
// - Firebase Admin: verifies ID tokens, sends FCM push, optional Firestore access
// - Exposes public Firebase web config (web API keys are NOT secret)

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

const APP_ID = process.env.AGORA_APP_ID || "159c36b2c45148feaa15eb38843124cf";
const APP_CERTIFICATE = process.env.AGORA_CERTIFICATE || "04f7ae808a1d46df9858f7bc8df9f39c";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ---- Public Firebase web config (safe to expose) ----
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FB_API_KEY || "",
    authDomain: process.env.FB_AUTH_DOMAIN || "",
    projectId: process.env.FB_PROJECT_ID || "aaa-infinity-ai",
    storageBucket: process.env.FB_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FB_MESSAGING_SENDER_ID || "",
    appId: process.env.FB_APP_ID || ""
  });
});

// ---- Agora token ----
const { RtcTokenBuilder, RtcRole } = (() => {
  try { return require("agora-token"); } catch (e) { return {}; }
})();

app.get("/api/token", (req, res) => {
  const channel = req.query.channel;
  if (!channel) return res.status(400).json({ error: "channel required" });
  if (!RtcTokenBuilder) return res.status(503).json({ error: "token service unavailable" });
  let uid = parseInt(req.query.uid || "0", 10);
  if (isNaN(uid)) uid = 0;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  try {
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channel, uid, RtcRole.PUBLISHER, exp, exp);
    res.json({ token, appId: APP_ID, uid, channel });
  } catch (e) {
    res.status(500).json({ error: "token gen failed" });
  }
});

// ---- Firebase Admin (optional, only if creds present) ----
let admin = null;
try {
  admin = require("firebase-admin");
  if (process.env.FB_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FB_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: process.env.FB_DATABASE_URL || undefined });
    }
    console.log("Firebase Admin initialized");
  }
} catch (e) {
  console.log("Firebase Admin not initialized:", e.message);
}

// Verify a Firebase ID token (used by clients that want server trust)
app.post("/api/verify", async (req, res) => {
  if (!admin) return res.status(503).json({ error: "firebase not configured" });
  const { idToken } = req.body || {};
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    res.json({ uid: decoded.uid, phone: decoded.phone_number || null, name: decoded.name || null });
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
  }
});

// Send FCM push to a device token
app.post("/api/push", async (req, res) => {
  if (!admin) return res.status(503).json({ error: "firebase not configured" });
  const { token, title, body, data } = req.body || {};
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    const r = await admin.messaging().send({ token, notification: { title, body }, data: data || {} });
    res.json({ ok: true, id: r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Cloudflare Realtime (backup call transport) ----
// appSecret stays server-side; client only gets appId, server proxies session/track calls.
const CF_APP_ID = process.env.CF_APP_ID || "";
const CF_APP_SECRET = process.env.CF_APP_SECRET || "";
const CF_BASE = "https://rtc.live.cloudflare.com/v1";

app.get("/api/cf/config", (req, res) => res.json({ appId: CF_APP_ID, available: !!CF_APP_SECRET }));

async function cfRequest(path, body, method = "POST") {
  const r = await fetch(`${CF_BASE}/apps/${CF_APP_ID}${path}`, {
    method, headers: { "content-type": "application/json", Authorization: `Bearer ${CF_APP_SECRET}` }, body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

app.post("/api/cf/session/new", async (req, res) => {
  if (!CF_APP_SECRET) return res.status(503).json({ error: "cf not configured" });
  const { sdp } = req.body || {};
  const r = await cfRequest("/sessions/new", { sessionDescription: { type: "offer", sdp } });
  res.json(r);
});
app.post("/api/cf/tracks/new", async (req, res) => {
  if (!CF_APP_SECRET) return res.status(503).json({ error: "cf not configured" });
  const { sessionId, tracks, sdp } = req.body || {};
  const body = { tracks };
  if (sdp) body.sessionDescription = { type: "offer", sdp };
  const r = await cfRequest(`/sessions/${sessionId}/tracks/new`, body);
  res.json(r);
});
app.put("/api/cf/tracks/renegotiate", async (req, res) => {
  if (!CF_APP_SECRET) return res.status(503).json({ error: "cf not configured" });
  const { sessionId, sdp } = req.body || {};
  const r = await cfRequest(`/sessions/${sessionId}/renegotiate`, { sessionDescription: { type: "answer", sdp } }, "PUT");
  res.json(r);
});

// ---- NaraRouter AI proxy (keeps API key server-side) ----
const NARA_BASE = process.env.NARA_BASE_URL || "https://router.bynara.id/v1";
const NARA_KEY = process.env.NARA_API_KEY || "";

app.get("/api/ai/models", (req, res) => {
  res.json({ models: ["tencent-hy3", "mistral-medium-3-5", "mistral-large", "glm-5.2-free", "agnes-2.0-flash"], available: !!NARA_KEY });
});

app.post("/api/ai/chat", async (req, res) => {
  if (!NARA_KEY) return res.status(503).json({ error: "ai not configured" });
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "messages required" });
  try {
    const r = await fetch(`${NARA_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${NARA_KEY}` },
      body: JSON.stringify({ model: model || "tencent-hy3", messages, stream: false })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "ai error" });
    res.json({ reply: data.choices?.[0]?.message?.content || "", raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", agora: !!RtcTokenBuilder, firebase: !!admin, cloudflare: !!CF_APP_SECRET, ai: !!NARA_KEY });
});

// ---- Telegram phone verification (replaces Firebase SMS; no billing needed) ----
const VERIFY_BOT_USERNAME = process.env.VERIFY_BOT_USERNAME || "AgoraMeet_Login_bot";

// Start: app sends phone -> server makes code, returns deep link
app.post("/api/auth/start", async (req, res) => {
  if (!admin) return res.status(503).json({ error: "firebase not configured" });
  const phone = (req.body.phone || "").replace(/[^0-9+]/g, "");
  if (!/^\+?\d{6,15}$/.test(phone)) return res.status(400).json({ error: "invalid phone" });
  const full = phone.startsWith("+") ? phone : "+" + phone;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await admin.firestore().collection("users").doc(full).set({
      phone: full,
      verifyCode: code,
      codeExpires: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)),
      phoneVerified: false
    }, { merge: true });
    const deepLink = `https://t.me/${VERIFY_BOT_USERNAME}?start=${code}`;
    res.json({ ok: true, deepLink, phone: full });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Status: app polls this; returns custom token once verified
app.get("/api/auth/status", async (req, res) => {
  if (!admin) return res.status(503).json({ error: "firebase not configured" });
  const phone = (req.query.phone || "").replace(/[^0-9+]/g, "");
  const full = phone.startsWith("+") ? phone : "+" + phone;
  try {
    const doc = await admin.firestore().collection("users").doc(full).get();
    const d = doc.data() || {};
    if (!d.phoneVerified) return res.json({ verified: false });
    // find or create Firebase user by phone
    let uid;
    try {
      const u = await admin.auth().getUserByPhoneNumber(full);
      uid = u.uid;
    } catch (e) {
      const u = await admin.auth().createUser({ phoneNumber: full });
      uid = u.uid;
    }
    // make sure users doc has uid + name
    await admin.firestore().collection("users").doc(full).set({ uid, name: full, phone: full, online: true }, { merge: true });
    const token = await admin.auth().createCustomToken(uid);
    res.json({ verified: true, token, uid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Confirm: called by the verify bot after user replies YES
app.post("/api/bot/confirm", async (req, res) => {
  if (!admin) return res.status(503).json({ error: "firebase not configured" });
  const { code, chatId } = req.body || {};
  if (!code) return res.status(400).json({ error: "code required" });
  try {
    const snap = await admin.firestore().collection("users").where("verifyCode", "==", code).get();
    if (snap.empty) return res.status(404).json({ error: "code not found or already used" });
    const ref = snap.docs[0].ref;
    const d = snap.docs[0].data();
    if (d.phoneVerified) return res.status(409).json({ error: "code already used" });
    if (d.codeExpires && d.codeExpires.toDate() < new Date()) return res.status(410).json({ error: "code expired" });
    await ref.set({ phoneVerified: true, tgChatId: String(chatId), verifyCode: admin.firestore.FieldValue.delete() }, { merge: true });
    res.json({ ok: true, phone: d.phone || d.uid || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`AgoraMeet v2 server on :${PORT}`));

// bot.js - Telegram APK delivery bot for AgoraMeet
// - Captures chat ID from first message
// - On startup (and on /apk), sends the real .apk FILES (not links) fetched from GitHub
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Set BOT_TOKEN"); process.exit(1); }
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const fs = require("fs");
const os = require("os");
const path = require("path");

const APKS = [
  { url: "https://github.com/aaa-ai-coder/AgoraMeet/releases/download/v3.0.0/AgoraMeet-v3.0.0.apk", name: "AgoraMeet-v3.0.0.apk", caption: "AgoraMeet (1) - join a room name, e.g. test123" },
  { url: "https://github.com/aaa-ai-coder/AgoraMeet/releases/download/v3.0.0/AgoraMeet2-v3.0.0.apk", name: "AgoraMeet2-v3.0.0.apk", caption: "AgoraMeet 2 (2nd install) - join the SAME room as (1) to test a call" },
];

let knownChatId = 6727787768;

async function sendText(chatId, text) {
  await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
}

async function downloadTo(url, dest) {
  const r = await fetch(url, { redirect: "follow" });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// Send the real file (Buffer-based, most reliable for bots)
async function sendApkFile(chatId, a) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apk-"));
  const dest = path.join(tmp, a.name);
  try {
    const size = await downloadTo(a.url, dest);
    if (size < 100000) throw new Error("downloaded file too small");
    const data = fs.readFileSync(dest);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", a.caption || "");
    form.append("document", new Blob([data], { type: "application/vnd.android.package-archive" }), a.name);
    const r = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || "sendDocument failed");
    console.log(`Sent ${a.name} (${data.length} bytes) to chat ${chatId}`);
    return true;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

async function deliver(chatId) {
  await sendText(chatId, "Sending both AgoraMeet APKs (real files)...");
  for (const a of APKS) {
    try {
      const ok = await sendApkFile(chatId, a);
      if (!ok) await sendText(chatId, `Could not send ${a.name}. Get it: ${a.url}`);
    } catch (e) {
      await sendText(chatId, `Failed ${a.n || a.name}: ${e.message}. Link: ${a.url}`);
    }
  }
}

async function poll() {
  let off = 0;
  while (true) {
    const res = await fetch(`${API}/getUpdates?offset=${off}&timeout=30`);
    const d = await res.json();
    if (d.ok && d.result.length) {
      for (const u of d.result) {
        off = u.update_id + 1;
        const msg = u.message;
        if (!msg) continue;
        const cid = msg.chat.id;
        knownChatId = cid; // remember for auto-send
        const t = (msg.text || "").toLowerCase();
        if (t.includes("stop")) { await sendText(cid, "OK, not auto-sending."); continue; }
        // Any message triggers delivery (and first message captures chat id)
        await deliver(cid);
      }
    }
  }
}

// Keep the worker alive: restart poll on any fatal error instead of exiting.
process.on("unhandledRejection", (e) => { console.error("unhandledRejection:", e && e.message); });
process.on("uncaughtException", (e) => { console.error("uncaughtException:", e && e.message); });

// Auto-send on startup to the known admin chat (real files, no command needed)
if (knownChatId) deliver(knownChatId).catch(e => console.error("auto-send error:", e));

async function run() {
  while (true) {
    try { await poll(); }
    catch (e) { console.error("poll died, restarting:", e && e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}
run();

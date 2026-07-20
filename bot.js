// bot.js - Telegram APK delivery bot for AgoraMeet
// Fetches APKs from the GitHub release (no local storage needed) and forwards them.
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Set BOT_TOKEN"); process.exit(1); }
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const fs = require("fs");
const os = require("os");
const path = require("path");

const APKS = [
  { url: "https://github.com/aaa-ai-coder/AgoraMeet/releases/download/v1.2.0/AgoraMeet-v1.2.0-debug.apk", name: "AgoraMeet-v1.2.0.apk", caption: "AgoraMeet (1) - join a room name, e.g. test123" },
  { url: "https://github.com/aaa-ai-coder/AgoraMeet/releases/download/v1.2.0/AgoraMeet2-v1.2.0-debug.apk", name: "AgoraMeet2-v1.2.0.apk", caption: "AgoraMeet 2 (2nd install) - join the SAME room as (1) to test a call" },
];

async function download(url, dest) {
  const r = await fetch(url, { redirect: "follow" });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function sendDoc(chatId, filePath, caption) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fs.createReadStream(filePath));
  if (caption) form.append("caption", caption);
  const r = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  return r.json();
}

async function handle(msg) {
  const cid = msg.chat.id;
  const t = (msg.text || "").toLowerCase();
  if (t === "/start" || t === "/apk" || t.includes("apk") || t.includes("download")) {
    await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: "Fetching both AgoraMeet APKs from GitHub..." }) });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apk-"));
    for (const a of APKS) {
      const dest = path.join(tmp, a.name);
      try {
        const size = await download(a.url, dest);
        if (size < 100000) throw new Error("file too small, likely not an APK");
        const r = await sendDoc(cid, dest, a.caption);
        if (!r.ok) throw new Error(r.description);
      } catch (e) {
        await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: `Could not send ${a.name}: ${e.message}. Get it here: ${a.url}` }) });
      } finally {
        try { fs.unlinkSync(dest); } catch (_) {}
      }
    }
    try { fs.rmdirSync(tmp); } catch (_) {}
  } else {
    await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: "Send /apk to get AgoraMeet install files." }) });
  }
}

async function poll() {
  let off = 0;
  console.log("Bot polling...");
  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?offset=${off}&timeout=30`);
      const d = await res.json();
      if (d.ok && d.result.length) {
        for (const u of d.result) { off = u.update_id + 1; if (u.message) await handle(u.message); }
      }
    } catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
}
poll();

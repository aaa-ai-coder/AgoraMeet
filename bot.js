// bot.js - Telegram APK delivery bot for AgoraMeet
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Set BOT_TOKEN"); process.exit(1); }
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const fs = require("fs");
const path = require("path");
const APKS = [
  { p: "releases/AgoraMeet-v1.2.0.apk", n: "AgoraMeet-v1.2.0.apk", c: "AgoraMeet (1) - join a room name, e.g. test123" },
  { p: "releases/AgoraMeet2-v1.2.0.apk", n: "AgoraMeet2-v1.2.0.apk", c: "AgoraMeet 2 (2nd install) - join the SAME room as (1) to test a call" },
];
async function sendDoc(chatId, fp, cap) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fs.createReadStream(fp));
  if (cap) form.append("caption", cap);
  const r = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  return r.json();
}
async function handle(msg) {
  const cid = msg.chat.id;
  const t = (msg.text || "").toLowerCase();
  if (t === "/start" || t === "/apk" || t.includes("apk") || t.includes("download")) {
    await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: "Sending both AgoraMeet APKs..." }) });
    for (const a of APKS) {
      const full = path.join(__dirname, a.p);
      if (!fs.existsSync(full)) { await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: `Missing: ${a.n}` }) }); continue; }
      const r = await sendDoc(cid, full, a.c);
      if (!r.ok) await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: `Failed ${a.n}: ${r.description}` }) });
    }
  } else {
    await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: cid, text: "Send /apk to get AgoraMeet files." }) });
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

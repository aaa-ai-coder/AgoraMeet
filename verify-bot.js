// verify-bot.js - AgoraMeet Telegram phone-verification bot
// Receives /start <code>, asks user to reply YES, then calls the server's confirm endpoint.
const BOT_TOKEN = process.env.VERIFY_BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Set VERIFY_BOT_TOKEN"); process.exit(1); }
const SERVER = process.env.AGORAMEET_SERVER || "https://agorameet-server.onrender.com";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const pending = {}; // chatId -> code

async function sendText(chatId, text) {
  await fetch(`${API}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
}

async function confirm(code, chatId) {
  const r = await fetch(`${SERVER}/api/bot/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, chatId }) });
  const j = await r.json();
  if (j.ok) await sendText(chatId, `Verified ${j.phone || ""}. You can close Telegram and return to the AgoraMeet app.`);
  else await sendText(chatId, "Verification failed: " + (j.error || "unknown"));
}

async function poll() {
  let off = 0;
  while (true) {
    const res = await fetch(`${API}/getUpdates?offset=${off}&timeout=30`);
    const d = await res.json();
    if (d.ok && d.result.length) {
      for (const u of d.result) {
        off = u.update_id + 1;
        const msg = u.message; if (!msg) continue;
        const cid = String(msg.chat.id);
        const text = (msg.text || "").trim();
        if (text.startsWith("/start")) {
          const code = text.split(" ")[1];
          if (code) { pending[cid] = code; await sendText(cid, `Login code received.\n\nReply YES to confirm you want to log in to AgoraMeet with this phone number.`); }
          else await sendText(cid, "Hello! Use the button in the AgoraMeet app to start verification.");
        } else if (/^yes$/i.test(text) && pending[cid]) {
          const code = pending[cid]; delete pending[cid];
          await confirm(code, cid);
        }
      }
    }
  }
}

process.on("unhandledRejection", e => console.error("unhandledRejection:", e && e.message));
process.on("uncaughtException", e => console.error("uncaughtException:", e && e.message));

async function run() {
  while (true) {
    try { await poll(); }
    catch (e) { console.error("poll died, restarting:", e && e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}
run();

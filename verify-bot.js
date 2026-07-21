// verify-bot.js - AgoraMeet Telegram phone-verification bot
// Receives /start <code>, shows an inline "Confirm login" button, then calls the server's confirm endpoint.
const BOT_TOKEN = process.env.VERIFY_BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Set VERIFY_BOT_TOKEN"); process.exit(1); }
const SERVER = process.env.AGORAMEET_SERVER || "https://agorameet-server.agorameet.workers.dev";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function confirm(code, chatId) {
  const r = await fetch(`${SERVER}/api/bot/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, chatId }) });
  const j = await r.json();
  if (j.ok) await call("sendMessage", { chat_id: chatId, text: `Verified ${j.phone || "your number"} ✅\nYou can close Telegram and return to the AgoraMeet app.` });
  else await call("sendMessage", { chat_id: chatId, text: "Verification failed: " + (j.error || "unknown") });
}

async function poll() {
  let off = 0;
  while (true) {
    const res = await fetch(`${API}/getUpdates?offset=${off}&timeout=30`);
    const d = await res.json();
    if (d.ok && d.result.length) {
      for (const u of d.result) {
        off = u.update_id + 1;
        if (u.message && u.message.text && u.message.text.startsWith("/start")) {
          const code = u.message.text.split(" ")[1];
          const cid = String(u.message.chat.id);
          if (code) {
            await call("sendMessage", {
              chat_id: cid,
              text: "Login code received.\n\nTap the button below to confirm you want to log in to AgoraMeet with this phone number.",
              reply_markup: { inline_keyboard: [[{ text: "✅ Confirm login", callback_data: "confirm:" + code }]] }
            });
          } else {
            await call("sendMessage", { chat_id: cid, text: "Hello! Use the button in the AgoraMeet app to start verification." });
          }
        } else if (u.callback_query) {
          const cb = u.callback_query;
          const cid = String(cb.message.chat.id);
          await call("answerCallbackQuery", { callback_query_id: cb.id });
          if (cb.data && cb.data.startsWith("confirm:")) {
            const code = cb.data.split("confirm:")[1];
            await call("editMessageText", { chat_id: cid, message_id: cb.message.message_id, text: "Verifying…" });
            await confirm(code, cid);
          }
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

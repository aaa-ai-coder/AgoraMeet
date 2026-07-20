// app.js - AgoraMeet v2 (WhatsApp-style)
const VERSION = "2.3.0";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  RecaptchaVerifier, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithRedirect, getRedirectResult, sendPasswordResetEmail, signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, limit,
  addDoc, getDocs, serverTimestamp, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const API_BASE = (document.querySelector('meta[name="api-base"]') || {}).content || "https://agorameet-server.onrender.com";
const api = (path) => API_BASE.replace(/\/$/, "") + path;
let app, auth, db, fbApp;
let currentUser = null;
let currentPeer = null;     // {uid, name, phone}
let unsubMessages = null;
let unsubChats = null;

async function loadFirebase() {
  const cfg = await fetch(api("/api/firebase-config")).then(r => r.json());
  if (!cfg || !cfg.apiKey) throw new Error("Firebase config missing (server offline or not configured)");
  fbApp = initializeApp(cfg);
  auth = getAuth(fbApp);
  db = getFirestore(fbApp);
  onAuthStateChanged(auth, handleAuthState);
  $("appVersion") && ($("appVersion").textContent = "AgoraMeet v" + VERSION);
}

async function handleAuthState(user) {
  if (user) {
    currentUser = user;
    try {
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, {
        uid: user.uid,
        name: user.displayName || (user.phoneNumber ? user.phoneNumber : user.email),
        phone: user.phoneNumber || null,
        email: user.email || null,
        online: true,
        lastSeen: serverTimestamp()
      }, { merge: true });
    } catch (e) {}
    show("mainScreen");
    loadChats();
  } else {
    currentUser = null;
    show("loginScreen");
  }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}
function show(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(screen).classList.add("active");
}
function showView(v) {
  document.querySelectorAll("#mainScreen .view").forEach(x => x.classList.remove("active"));
  $(v).classList.add("active");
  document.querySelectorAll(".bottomnav .bn").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  if (v === "statusView") loadStatus();
  if (v === "settingsView") loadSettings();
}
document.querySelectorAll(".bottomnav .bn").forEach(b => b.onclick = () => showView(b.dataset.view));

// ---------------- AUTH ----------------
function err(msg) { $("authError").textContent = msg; $("authError").classList.remove("hidden"); }
function clearErr() { $("authError").classList.add("hidden"); }

// Country dial codes (common)
const COUNTRIES = [
  { code: "880", name: "Bangladesh" }, { code: "91", name: "India" }, { code: "1", name: "USA/Canada" },
  { code: "44", name: "UK" }, { code: "92", name: "Pakistan" }, { code: "971", name: "UAE" },
  { code: "966", name: "Saudi Arabia" }, { code: "65", name: "Singapore" }, { code: "60", name: "Malaysia" },
  { code: "880", name: "Bangladesh" }
];
(function fillCountries() {
  const sel = $("countryCode");
  if (!sel) return;
  const list = [...new Map(COUNTRIES.map(c => [c.code, c])).values()];
  sel.innerHTML = list.map(c => `<option value="${c.code}">+${c.code}</option>`).join("");
  sel.value = "880";
})();

$("useEmailLink").onclick = () => { clearErr(); $("phoneStep").classList.add("hidden"); $("otpStep").classList.add("hidden"); $("emailStep").classList.remove("hidden"); };
$("usePhoneLink").onclick = () => { clearErr(); $("emailStep").classList.add("hidden"); $("phoneStep").classList.remove("hidden"); };

let recaptchaReady = null;
function getVerifier() {
  if (window.recaptchaVerifier) return Promise.resolve(window.recaptchaVerifier);
  if (!recaptchaReady) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
    recaptchaReady = window.recaptchaVerifier.render().then(() => window.recaptchaVerifier).catch(e => { window.recaptchaVerifier = null; recaptchaReady = null; throw e; });
  }
  return recaptchaReady;
}

let tgPhone = null, tgPollTimer = null;
async function startTelegramVerify() {
  if (!auth) { err("App still loading, wait a moment…"); return; }
  const cc = $("countryCode").value;
  let phone = $("phoneInput").value.trim().replace(/[^0-9]/g, "");
  if (!/^\d{6,15}$/.test(phone)) { err("Enter a valid number (digits only)"); return; }
  clearErr();
  $("sendOtpBtn").disabled = true;
  tgPhone = "+" + cc + phone;
  try {
    const r = await fetch(api("/api/auth/start"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: tgPhone }) });
    const data = await r.json();
    if (!r.ok || !data.deepLink) throw new Error(data.error || "Could not start verification");
    $("tgPhone").textContent = tgPhone;
    $("tgOpen").href = data.deepLink;
    $("tgHint").classList.remove("hidden");
    $("phoneStep").classList.add("hidden"); $("otpStep").classList.remove("hidden");
    $("tgStatus").textContent = "Waiting for confirmation…";
    if (tgPollTimer) clearInterval(tgPollTimer);
    tgPollTimer = setInterval(pollTelegramStatus, 3000);
  } catch (e) {
    err(e.message || "Verification failed");
  } finally { $("sendOtpBtn").disabled = false; }
}
async function pollTelegramStatus() {
  try {
    const r = await fetch(api("/api/auth/status?phone=" + encodeURIComponent(tgPhone)));
    const data = await r.json();
    if (data.verified && data.token) {
      clearInterval(tgPollTimer); tgPollTimer = null;
      $("tgStatus").textContent = "Verified! Signing in…";
      await signInWithCustomToken(auth, data.token);
    }
  } catch (e) {}
}
$("sendOtpBtn").onclick = startTelegramVerify;
$("resendLink").onclick = () => { if (tgPollTimer) clearInterval(tgPollTimer); tgPollTimer = null; $("otpStep").classList.add("hidden"); $("phoneStep").classList.remove("hidden"); };

$("emailBtn").onclick = async () => {
  const e = $("emailInput").value.trim(), p = $("passwordInput").value;
  if (!e || !p) { err("Email and password required"); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { err("Enter a valid email"); return; }
  if (p.length < 6) { err("Password must be at least 6 characters"); return; }
  clearErr();
  $("emailBtn").disabled = true; $("emailBtn").textContent = "Please wait…";
  try {
    await signInWithEmailAndPassword(auth, e, p);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try { await createUserWithEmailAndPassword(auth, e, p); }
      catch (e2) { err(friendly(e2)); }
    } else if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      err("Wrong email or password");
    } else { err(friendly(err)); }
  } finally { $("emailBtn").disabled = false; $("emailBtn").textContent = "Sign in / Create account"; }
};

$("pwToggle").onclick = () => {
  const i = $("passwordInput");
  i.type = i.type === "password" ? "text" : "password";
  $("pwToggle").innerHTML = i.type === "password" ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
};

$("forgotPw").onclick = async () => {
  const e = $("emailInput").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { err("Enter your email first"); return; }
  try { await sendPasswordResetEmail(auth, e); toast("Reset link sent to " + e); }
  catch (er) { err(friendly(er)); }
};

$("googleBtn").onclick = async () => {
  if (!auth) { err("App still loading, wait a moment…"); return; }
  clearErr();
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // Popup opens in-app (WebView configured to keep popups internal, no external browser)
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Fallback to redirect if popup is blocked
    try { await signInWithRedirect(auth, provider); }
    catch (e2) { err(friendly(e2)); }
  }
};

// Complete Google sign-in when returning from redirect
getRedirectResult(auth).then(userCred => {
  if (userCred && userCred.user) toast("Signed in as " + (userCred.user.displayName || userCred.user.email));
}).catch(e => { if (e && e.code) err(friendly(e)); });

function friendly(e) {
  const c = e && e.code;
  const map = {
    "auth/invalid-phone-number": "Invalid phone number format.",
    "auth/too-many-requests": "Too many attempts. Wait and retry.",
    "auth/captcha-check-failed": "Captcha failed. Retry.",
    "auth/invalid-verification-code": "Wrong code.",
    "auth/code-expired": "Code expired. Resend.",
    "auth/popup-blocked": "Popup blocked. Allow popups or use another method.",
    "auth/popup-closed-by-user": "Sign-in cancelled.",
    "auth/network-request-failed": "Network error. Check connection.",
    "auth/email-already-in-use": "Email already registered. Sign in instead.",
    "auth/weak-password": "Password too weak (min 6 chars).",
    "auth/invalid-email": "Invalid email address.",
    "auth/api-key-not-set": "App not configured (missing Firebase web key).",
    "auth/invalid-api-key": "Firebase web API key is invalid.",
    "auth/operation-not-allowed": "This sign-in method is not enabled. Contact support.",
    "auth/missing-phone-number": "Enter a phone number."
  };
  return (c && map[c]) || e.message || "Something went wrong.";
}

// ---------------- CHATS ----------------
function chatId(a, b) { return [a, b].sort().join("_"); }

async function loadChats() {
  if (unsubChats) unsubChats();
  const q = query(collection(db, "users", currentUser.uid, "chats"), orderBy("last", "desc"));
  unsubChats = onSnapshot(q, (snap) => {
    const list = $("chatList");
    list.innerHTML = "";
    if (snap.empty) { list.innerHTML = '<p style="color:#8696a0;text-align:center;margin-top:30px;font-size:13px">No chats yet. Tap + to start.</p>'; }
    snap.forEach(d => {
      const c = d.data();
      const item = document.createElement("div");
      item.className = "chat-item";
      item.innerHTML = `<div class="avatar">${(c.name||"?").charAt(0).toUpperCase()}</div>
        <div class="ci-body"><div class="ci-name"><span>${esc(c.name||"Chat")}</span><span class="ci-time">${timeStr(c.last)}</span></div>
        <div class="ci-last">${esc(c.lastMsg||"")}</div></div>`;
      item.onclick = () => openConversation(c.peer, c.name, c.type || "user");
      list.appendChild(item);
    });
  });
}

function timeStr(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function esc(s) { return (s||"").replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }

// ---------------- CONVERSATION ----------------
async function openConversation(peerUid, peerName, type = "user") {
  currentPeer = { uid: peerUid, name: peerName, type };
  $("convName").textContent = peerName;
  $("convAvatar").textContent = (peerName || "?").charAt(0).toUpperCase();
  showView("conversationView");
  if (type === "user") {
    const pr = doc(db, "users", peerUid);
    onSnapshot(pr, s => { const d = s.data(); $("convStatus").textContent = d && d.online ? "online" : "offline"; });
  } else { $("convStatus").textContent = "group"; }
  if (unsubMessages) unsubMessages();
  const cid = (type === "group") ? peerUid : chatId(currentUser.uid, peerUid);
  const q = query(collection(db, "chats", cid, "messages"), orderBy("ts", "asc"));
  const box = $("messages"); box.innerHTML = "";
  unsubMessages = onSnapshot(q, snap => {
    box.innerHTML = "";
    snap.forEach(d => {
      const m = d.data();
      const div = document.createElement("div");
      const mine = m.from === currentUser.uid;
      div.className = "msg " + (mine ? "out" : "in");
      const who = (type === "group" && !mine && m.fromName) ? `<b style="color:#7fd;">${esc(m.fromName)}:</b> ` : "";
      div.innerHTML = who + esc(m.text) + `<span class="t">${timeStr(m.ts)}</span>`;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  });
}

$("backBtn").onclick = () => showView("chatsView");
$("sendBtn").onclick = sendMessage;
$("msgInput").addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });
async function sendMessage() {
  const text = $("msgInput").value.trim();
  if (!text || !currentPeer) return;
  if (currentPeer.type === "group") {
    const cid = currentPeer.uid;
    await addDoc(collection(db, "chats", cid, "messages"), { from: currentUser.uid, fromName: currentUser.displayName || currentUser.phoneNumber, text, ts: serverTimestamp() });
    await setDoc(doc(db, "groups", cid), { last: serverTimestamp(), lastMsg: text }, { merge: true });
    await setDoc(doc(db, "users", currentUser.uid, "chats", cid), { peer: cid, name: currentPeer.name, type: "group", last: serverTimestamp(), lastMsg: text }, { merge: true });
  } else {
    const cid = chatId(currentUser.uid, currentPeer.uid);
    await addDoc(collection(db, "chats", cid, "messages"), { from: currentUser.uid, text, ts: serverTimestamp() });
    await setDoc(doc(db, "users", currentUser.uid, "chats", currentPeer.uid), { peer: currentPeer.uid, name: currentPeer.name, last: serverTimestamp(), lastMsg: text }, { merge: true });
    await setDoc(doc(db, "users", currentPeer.uid, "chats", currentUser.uid), { peer: currentUser.uid, name: currentUser.displayName || currentUser.phoneNumber || "You", last: serverTimestamp(), lastMsg: text }, { merge: true });
  }
  $("msgInput").value = "";
}

// ---------------- NEW CHAT ----------------
$("newChatBtn").onclick = () => { $("peopleList").innerHTML = ""; showView("newChatView"); };
$("newBackBtn").onclick = () => showView("chatsView");
$("newSearchInput").addEventListener("input", async (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (q.length < 1) return;
  const box = $("peopleList"); box.innerHTML = "";
  // AI assistant contact
  if ("ai".includes(q) || "assistant".includes(q) || "chat".includes(q)) {
    const ai = document.createElement("div");
    ai.className = "chat-item";
    ai.innerHTML = `<div class="avatar" style="background:#00a884">AI</div><div class="ci-body"><div class="ci-name"><span>AI Assistant</span></div><div class="ci-last">Chat with AI</div></div>`;
    ai.onclick = () => openAI();
    box.appendChild(ai);
  }
  if (q.length < 3) return;
  const snap = await getDocs(query(collection(db, "users"), where("phone", "==", q.startsWith("+") ? q : "+88" + q)));
  snap.forEach(d => {
    const u = d.data();
    if (u.uid === currentUser.uid) return;
    const item = document.createElement("div");
    item.className = "chat-item";
    item.innerHTML = `<div class="avatar">${(u.name||"?").charAt(0).toUpperCase()}</div><div class="ci-body"><div class="ci-name"><span>${esc(u.name)}</span></div><div class="ci-last">${esc(u.phone||"")}</div></div>`;
    item.onclick = () => openConversation(u.uid, u.name);
    box.appendChild(item);
  });
});

// ---------------- CALLS (Agora) ----------------
$("callVoiceBtn").onclick = () => startCall(false);
$("callVideoBtn").onclick = () => startCall(true);

let agoraClient = null, localTracks = { audio: null, video: null }, callChannel = null, callActive = false;
async function startCall(video) {
  if (!currentPeer) return;
  callChannel = (currentPeer.type === "group") ? currentPeer.uid : chatId(currentUser.uid, currentPeer.uid);
  try {   await setDoc(doc(db, "users", currentUser.uid, "calls", Date.now().toString()), { with: currentPeer.name, type: video ? "video" : "voice", at: serverTimestamp(), group: currentPeer.type === "group" }, { merge: true }); } catch (e) {}
  setupCallChat(currentPeer);
  $("callName").textContent = currentPeer.name;
  $("callAvatar").textContent = (currentPeer.name || "?").charAt(0).toUpperCase();
  $("callState").textContent = "Connecting…";
  if (video) $("callVideoWrap").classList.remove("hidden"); else $("callVideoWrap").classList.add("hidden");
  show("callScreen");
  try {
    const res = await fetch(api(`/api/token?channel=${encodeURIComponent(callChannel)}`));
    const data = await res.json();
    const AgoraRTC = await import("https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.22.0/index.js");
    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    await agoraClient.join(data.appId, callChannel, data.token, null);
    localTracks.audio = await AgoraRTC.createMicrophoneAudioTrack();
    if (video) localTracks.video = await AgoraRTC.createCameraVideoTrack();
    await agoraClient.publish(Object.values(localTracks).filter(Boolean));
    agoraClient.on("user-published", async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType);
      if (mediaType === "video") user.videoTrack.play("remoteVideo");
      if (mediaType === "audio") user.audioTrack.play();
    });
    if (video && localTracks.video) localTracks.video.play("localVideo");
    callActive = true;
    $("callState").textContent = video ? "Video call" : "Voice call";
  } catch (e) {
    $("callState").textContent = "Agora failed, trying backup…";
    await startCallBackup(video);
  }
}

$("callEndBtn").onclick = endCall;
$("callMuteBtn").onclick = () => { if (localTracks.audio) { const m = localTracks.audio.muted = !localTracks.audio.muted; $("callMuteBtn").style.background = m ? "#f15c6d" : "#2a3942"; } };
$("callCamBtn").onclick = () => { if (localTracks.video) { const m = localTracks.video.muted = !localTracks.video.muted; $("callCamBtn").style.background = m ? "#f15c6d" : "#2a3942"; } };

// ---------------- BACKUP CALL (Cloudflare Realtime) ----------------
// Two users can't directly SFU-echo each other with Cloudflare's public demo model, so this
// backup uses server-signaled peer mesh via the same Agora signaling concept: we use CF Realtime
// to relay the offer/answer through the server to the peer. Simplified: each peer opens a CF
// session and we exchange SDP through Firestore so the two CF sessions bridge.
let cfPc = null, cfSessionId = null, cfLocalStream = null;
async function startCallBackup(video) {
  try {
    const cfg = await fetch(api("/api/cf/config")).then(r => r.json());
    if (!cfg.available) throw new Error("Backup unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
    cfLocalStream = stream;
    if (video) { $("localVideo").srcObject = stream; $("callVideoWrap").classList.remove("hidden"); }
    cfPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
    const tr = stream.getTracks().map(t => cfPc.addTransceiver(t, { direction: "sendrecv" }));
    await cfPc.setLocalDescription(await cfPc.createOffer());
    const r1 = await fetch(api("/api/cf/session/new"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: cfPc.localDescription.sdp }) }).then(r => r.json());
    if (r1.errorCode) throw new Error(r1.errorDescription);
    cfSessionId = r1.sessionId;
    await cfPc.setRemoteDescription(new RTCSessionDescription(r1.sessionDescription));
    cfPc.ontrack = (e) => { if (video) $("remoteVideo").srcObject = e.streams[0]; };
    const trackObjs = tr.map(x => ({ location: "local", mid: x.mid, trackName: x.sender.track.id }));
    await cfPc.setLocalDescription(await cfPc.createOffer());
    const r2 = await fetch(api("/api/cf/tracks/new"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: cfSessionId, tracks: trackObjs, sdp: cfPc.localDescription.sdp }) }).then(r => r.json());
    if (r2.sessionDescription) await cfPc.setRemoteDescription(new RTCSessionDescription(r2.sessionDescription));
    // expose our trackName via Firestore so the peer can pull our remote tracks
    const cid = chatId(currentUser.uid, currentPeer.uid);
    await setDoc(doc(db, "calls", cid), { sessionId: cfSessionId, trackName: trackObjs[0].trackName, by: currentUser.uid, ts: serverTimestamp() }, { merge: true });
    $("callState").textContent = (video ? "Video" : "Voice") + " (backup)";
  } catch (e) {
    $("callState").textContent = "Backup failed: " + (e.message || e);
  }
}
async function endCall() {
  try { if (localTracks.audio) localTracks.audio.close(); if (localTracks.video) localTracks.video.close(); if (agoraClient) await agoraClient.leave(); } catch (e) {}
  try { if (cfLocalStream) cfLocalStream.getTracks().forEach(t => t.stop()); if (cfPc) cfPc.close(); } catch (e) {}
  localTracks = { audio: null, video: null }; agoraClient = null; cfPc = null; cfLocalStream = null; callActive = false;
  show("mainScreen");
}

// ---------------- STATUS / STORIES ----------------
async function loadStatus() {
  const me = await getDoc(doc(db, "users", currentUser.uid));
  const md = me.data() || {};
  $("myStatusAvatar").textContent = ((currentUser.displayName || currentUser.phoneNumber || "?").charAt(0) || "?").toUpperCase();
  const myStatus = md.status && md.status.text ? md.status : null;
  $("myStatusText").textContent = myStatus ? ("Updated " + timeStr(myStatus.at)) : "Tap to add";
  const box = $("statusList"); box.innerHTML = "";
  const snap = await getDocs(collection(db, "status"));
  snap.forEach(d => {
    const s = d.data();
    if (d.id === currentUser.uid) return;
    if (!s.text) return;
    const item = document.createElement("div");
    item.className = "chat-item";
    item.innerHTML = `<div class="avatar" style="border:3px solid var(--teal)">${(s.name||"?").charAt(0).toUpperCase()}</div>
      <div class="ci-body"><div class="ci-name"><span>${esc(s.name||"")}</span></div><div class="ci-last">${esc(s.text)}</div></div>`;
    item.onclick = () => showStatus(s.name, s.text);
    box.appendChild(item);
  });
}
$("statusMyRow").onclick = () => {
  const t = prompt("What's on your mind?");
  if (t && t.trim()) setDoc(doc(db, "users", currentUser.uid), { status: { text: t.trim(), at: serverTimestamp() } }, { merge: true }).then(loadStatus);
};
$("newStatusBtn").onclick = () => $("statusMyRow").onclick();
function showStatus(name, text) {
  $("viewerTitle").textContent = name + "'s status";
  $("viewerBody").innerHTML = `<div class="msg in" style="max-width:90%;align-self:center;margin-top:20px">${esc(text)}</div>`;
  showView("viewerView");
}
$("myStatusAvatar").textContent = "?";

// ---------------- GROUPS ----------------
let grpMembers = [];
$("newGroupTopBtn").onclick = () => { grpMembers = []; renderGrp(); showView("newGroupView"); };
$("newGroupBtn").onclick = () => { grpMembers = []; renderGrp(); showView("newGroupView"); };
$("grpBackBtn").onclick = () => showView("chatsView");
async function grpSearch(phone) {
  const snap = await getDocs(query(collection(db, "users"), where("phone", "==", phone.startsWith("+") ? phone : "+88" + phone)));
  const box = $("grpMembers"); const found = [];
  snap.forEach(d => { const u = d.data(); if (u.uid !== currentUser.uid) found.push(u); });
  if (!found.length) { box.innerHTML = '<p style="color:#8696a0;padding:10px">No user found</p>'; return; }
  box.innerHTML = "";
  found.forEach(u => {
    if (grpMembers.find(m => m.uid === u.uid)) return;
    const item = document.createElement("div");
    item.className = "chat-item";
    item.innerHTML = `<div class="avatar">${(u.name||"?").charAt(0).toUpperCase()}</div><div class="ci-body"><div class="ci-name"><span>${esc(u.name)}</span></div><div class="ci-last">${esc(u.phone||"")}</div></div>`;
    item.onclick = () => { grpMembers.push(u); renderGrp(); };
    box.appendChild(item);
  });
}
$("grpSearchInput").addEventListener("input", e => { const v = e.target.value.trim(); if (v.length >= 3) grpSearch(v); });
function renderGrp() {
  const box = $("grpMembers");
  box.innerHTML = grpMembers.map((m, i) => `<div class="chat-item"><div class="avatar">${(m.name||"?").charAt(0).toUpperCase()}</div><div class="ci-body"><div class="ci-name"><span>${esc(m.name)}</span></div></div><button class="icon-btn" onclick="window.__rmGrp(${i})"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
}
window.__rmGrp = (i) => { grpMembers.splice(i, 1); renderGrp(); };
$("grpCreateBtn").onclick = async () => {
  const name = $("grpNameInput").value.trim();
  if (!name || !grpMembers.length) { toast("Add a name and members"); return; }
  const members = [currentUser.uid, ...grpMembers.map(m => m.uid)];
  const ref = await addDoc(collection(db, "groups"), { name, members, createdBy: currentUser.uid, last: serverTimestamp(), lastMsg: "Group created" });
  for (const uid of members) await setDoc(doc(db, "users", uid, "chats", ref.id), { peer: ref.id, name, type: "group", last: serverTimestamp(), lastMsg: "Group created" }, { merge: true });
  toast("Group created");
  openConversation(ref.id, name, "group");
};

// ---------------- SETTINGS ----------------
function loadSettings() {
  const n = currentUser.displayName || currentUser.phoneNumber || currentUser.email || "You";
  $("settingsName").textContent = n;
  $("settingsPhone").textContent = currentUser.phoneNumber || currentUser.email || "";
  $("settingsAvatar").textContent = (n.charAt(0) || "?").toUpperCase();
  $("themeVal").textContent = document.body.classList.contains("light") ? "Light" : "Dark";
}
$("settingsProfile").onclick = () => {
  const n = prompt("Display name:", $("settingsName").textContent);
  if (n && n.trim()) { setDoc(doc(db, "users", currentUser.uid), { name: n.trim() }, { merge: true }); loadSettings(); }
};
$("setNameBtn").onclick = () => $("settingsProfile").onclick();
$("setThemeBtn").onclick = () => { document.body.classList.toggle("light"); loadSettings(); };
$("setLogoutBtn").onclick = () => signOut(auth);
$("setAboutBtn").onclick = () => {
  $("viewerTitle").textContent = "About AgoraMeet";
  $("viewerBody").innerHTML = '<div class="msg in" style="max-width:90%;align-self:center;margin-top:20px">AgoraMeet v2.1 — WhatsApp-style messenger with Agora + Cloudflare calls and an AI assistant.<br><br>Built with Firebase, Agora, Capacitor.</div>';
  showView("viewerView");
};
$("setCallsBtn").onclick = async () => {
  const snap = await getDocs(query(collection(db, "users", currentUser.uid, "calls"), orderBy("at", "desc")));
  $("viewerTitle").textContent = "Call history";
  let html = "";
  snap.forEach(d => { const c = d.data(); html += `<div class="chat-item"><div class="avatar" style="background:#2a3942">${c.type === "video" ? "🎥" : "📞"}</div><div class="ci-body"><div class="ci-name"><span>${esc(c.with || "Call")}</span></div><div class="ci-last">${c.type} • ${timeStr(c.at)}</div></div></div>`; });
  $("viewerBody").innerHTML = html || '<p style="color:#8696a0;padding:16px">No calls yet</p>';
  showView("viewerView");
};
$("viewerBackBtn").onclick = () => showView("chatsView");

// ---------------- AI ASSISTANT (NaraRouter via server proxy) ----------------
const AI_SYSTEM = "You are AgoraMeet AI, a helpful assistant inside a messaging app.";
let aiHistory = [{ role: "system", content: AI_SYSTEM }];
let aiModel = "tencent-hy3";
function aiBubble(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "out" : "in");
  div.innerHTML = esc(text) + '<span class="t"></span>';
  $("aiMessages").appendChild(div);
  $("aiMessages").scrollTop = $("aiMessages").scrollHeight;
}
$("aiModel").onchange = () => { aiModel = $("aiModel").value; };
$("aiClearBtn").onclick = () => { aiHistory = [{ role: "system", content: AI_SYSTEM }]; $("aiMessages").innerHTML = ""; toast("Chat cleared"); };
$("aiBackBtn").onclick = () => showView("chatsView");
$("aiSendBtn").onclick = async () => {
  const text = $("aiInput").value.trim();
  if (!text) return;
  $("aiInput").value = "";
  aiBubble("user", text);
  aiHistory.push({ role: "user", content: text });
  $("aiStatus").textContent = "typing…";
  try {
    const r = await fetch(api("/api/ai/chat"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: aiHistory, model: aiModel }) });
    const data = await r.json();
    const reply = data.reply || data.error || "(no response)";
    aiBubble("assistant", reply);
    aiHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    aiBubble("assistant", "Error: " + e.message);
  }
  $("aiStatus").textContent = "ready";
};
$("aiInput").addEventListener("keydown", e => { if (e.key === "Enter") $("aiSendBtn").onclick(); });
// AI as a contact (open from chats search) — reuse aiView
function openAI() { aiModel = $("aiModel").value; showView("aiView"); $("aiInput").focus(); }

// ---------------- IN-CALL CHAT ----------------
let callPeer = null;
function setupCallChat(peer) {
  callPeer = peer;
  $("callChatBox").innerHTML = "";
  $("callChatWrap").classList.remove("hidden");
}
$("callChatSend").onclick = async () => {
  const t = $("callChatInput").value.trim(); if (!t || !callPeer) return;
  $("callChatInput").value = "";
  const div = document.createElement("div"); div.className = "msg out"; div.textContent = t;
  $("callChatBox").appendChild(div); $("callChatBox").scrollTop = $("callChatBox").scrollHeight;
  const cid = (callPeer.type === "group") ? callPeer.uid : chatId(currentUser.uid, callPeer.uid);
  await addDoc(collection(db, "chats", cid, "messages"), { from: currentUser.uid, fromName: currentUser.displayName || currentUser.phoneNumber, text: t, ts: serverTimestamp() });
};

// ---------------- BOOT ----------------
$("authLoader").classList.remove("hidden");
loadFirebase().then(() => $("authLoader").classList.add("hidden")).catch(e => {
  $("authLoader").classList.add("hidden");
  err("App failed to load: " + e.message);
  toast(e.message);
});

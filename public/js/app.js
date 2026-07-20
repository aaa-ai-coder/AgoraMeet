// app.js - AgoraMeet v2 (WhatsApp-style)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  RecaptchaVerifier, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, limit,
  addDoc, getDocs, serverTimestamp, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let app, auth, db, fbApp;
let currentUser = null;
let currentPeer = null;     // {uid, name, phone}
let unsubMessages = null;
let unsubChats = null;

async function loadFirebase() {
  const cfg = await fetch("/api/firebase-config").then(r => r.json());
  fbApp = initializeApp(cfg);
  auth = getAuth(fbApp);
  db = getFirestore(fbApp);
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
}
document.querySelectorAll(".bottomnav .bn").forEach(b => b.onclick = () => showView(b.dataset.view));
$("newChatBtn").onclick = () => { $("peopleList").innerHTML = ""; showView("newChatView"); };

// ---------------- AUTH ----------------
function err(msg) { $("authError").textContent = msg; $("authError").classList.remove("hidden"); }
function clearErr() { $("authError").classList.add("hidden"); }

$("useEmailLink").onclick = () => { clearErr(); $("phoneStep").classList.add("hidden"); $("otpStep").classList.add("hidden"); $("emailStep").classList.remove("hidden"); };
$("usePhoneLink").onclick = () => { clearErr(); $("emailStep").classList.add("hidden"); $("phoneStep").classList.remove("hidden"); };

function makeVerifier() {
  if (window.recaptchaVerifier) { try { window.recaptchaVerifier.clear(); } catch (e) {} }
  window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
  return window.recaptchaVerifier;
}

$("sendOtpBtn").onclick = async () => {
  const phone = $("phoneInput").value.trim();
  if (!/^\d{6,15}$/.test(phone)) { err("Enter a valid number (digits only)"); return; }
  clearErr();
  $("sendOtpBtn").disabled = true;
  try {
    const verifier = makeVerifier();
    const full = (phone.startsWith("+") ? phone : "+88" + phone);
    window.confirmationResult = await signInWithPhoneNumber(auth, full, verifier);
    $("phoneStep").classList.add("hidden"); $("otpStep").classList.remove("hidden");
    $("otpInput").focus();
    toast("Code sent to " + full);
  } catch (e) {
    err(friendly(e));
  } finally { $("sendOtpBtn").disabled = false; }
};

$("verifyOtpBtn").onclick = async () => {
  const code = $("otpInput").value.trim();
  if (!code) { err("Enter the code"); return; }
  clearErr();
  try {
    await window.confirmationResult.confirm(code);
  } catch (e) {
    err("Wrong or expired code. Try again.");
  }
};

$("resendLink").onclick = () => { clearErr(); $("otpStep").classList.add("hidden"); $("phoneStep").classList.remove("hidden"); };

$("emailBtn").onclick = async () => {
  const e = $("emailInput").value.trim(), p = $("passwordInput").value;
  if (!e || !p) { err("Email and password required"); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { err("Enter a valid email"); return; }
  clearErr();
  $("emailBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, e, p);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try { await createUserWithEmailAndPassword(auth, e, p); }
      catch (e2) { err(friendly(e2)); }
    } else { err(friendly(err)); }
  } finally { $("emailBtn").disabled = false; }
};

$("googleBtn").onclick = async () => {
  clearErr();
  $("googleBtn").disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    err(friendly(e));
  } finally { $("googleBtn").disabled = false; }
};

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
    "auth/invalid-api-key": "Firebase web API key is invalid."
  };
  return (c && map[c]) || e.message || "Something went wrong.";
}

$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, {
      uid: user.uid,
      name: user.displayName || (user.phoneNumber ? user.phoneNumber : user.email),
      phone: user.phoneNumber || null,
      email: user.email || null,
      online: true,
      lastSeen: serverTimestamp()
    }, { merge: true });
    show("mainScreen");
    loadChats();
  } else {
    currentUser = null;
    show("loginScreen");
  }
});

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
      item.onclick = () => openConversation(c.peer, c.name);
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
async function openConversation(peerUid, peerName) {
  currentPeer = { uid: peerUid, name: peerName };
  $("convName").textContent = peerName;
  $("convAvatar").textContent = (peerName || "?").charAt(0).toUpperCase();
  showView("conversationView");
  // peer presence
  const pr = doc(db, "users", peerUid);
  onSnapshot(pr, s => { const d = s.data(); $("convStatus").textContent = d && d.online ? "online" : "offline"; });
  // messages
  if (unsubMessages) unsubMessages();
  const cid = chatId(currentUser.uid, peerUid);
  const q = query(collection(db, "chats", cid, "messages"), orderBy("ts", "asc"));
  const box = $("messages"); box.innerHTML = "";
  unsubMessages = onSnapshot(q, snap => {
    box.innerHTML = "";
    snap.forEach(d => {
      const m = d.data();
      const div = document.createElement("div");
      div.className = "msg " + (m.from === currentUser.uid ? "out" : "in");
      div.innerHTML = esc(m.text) + `<span class="t">${timeStr(m.ts)}</span>`;
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
  const cid = chatId(currentUser.uid, currentPeer.uid);
  await addDoc(collection(db, "chats", cid, "messages"), { from: currentUser.uid, text, ts: serverTimestamp() });
  await setDoc(doc(db, "users", currentUser.uid, "chats", currentPeer.uid), { peer: currentPeer.uid, name: currentPeer.name, last: serverTimestamp(), lastMsg: text }, { merge: true });
  await setDoc(doc(db, "users", currentPeer.uid, "chats", currentUser.uid), { peer: currentUser.uid, name: currentUser.displayName || currentUser.phoneNumber || "You", last: serverTimestamp(), lastMsg: text }, { merge: true });
  $("msgInput").value = "";
}

// ---------------- NEW CHAT ----------------
$("newChatBtn").onclick = () => { $("peopleList").innerHTML = ""; showView("newChatView"); };
$("newBackBtn").onclick = () => showView("chatsView");
$("newSearchInput").addEventListener("input", async (e) => {
  const q = e.target.value.trim();
  if (q.length < 3) return;
  const snap = await getDocs(query(collection(db, "users"), where("phone", "==", q.startsWith("+") ? q : "+88" + q)));
  const box = $("peopleList"); box.innerHTML = "";
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
  callChannel = chatId(currentUser.uid, currentPeer.uid);
  $("callName").textContent = currentPeer.name;
  $("callAvatar").textContent = (currentPeer.name || "?").charAt(0).toUpperCase();
  $("callState").textContent = "Connecting…";
  if (video) $("callVideoWrap").classList.remove("hidden"); else $("callVideoWrap").classList.add("hidden");
  show("callScreen");
  try {
    const res = await fetch(`/api/token?channel=${encodeURIComponent(callChannel)}`);
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
    const cfg = await fetch("/api/cf/config").then(r => r.json());
    if (!cfg.available) throw new Error("Backup unavailable");
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
    cfLocalStream = stream;
    if (video) { $("localVideo").srcObject = stream; $("callVideoWrap").classList.remove("hidden"); }
    cfPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
    const tr = stream.getTracks().map(t => cfPc.addTransceiver(t, { direction: "sendrecv" }));
    await cfPc.setLocalDescription(await cfPc.createOffer());
    const r1 = await fetch("/api/cf/session/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: cfPc.localDescription.sdp }) }).then(r => r.json());
    if (r1.errorCode) throw new Error(r1.errorDescription);
    cfSessionId = r1.sessionId;
    await cfPc.setRemoteDescription(new RTCSessionDescription(r1.sessionDescription));
    cfPc.ontrack = (e) => { if (video) $("remoteVideo").srcObject = e.streams[0]; };
    const trackObjs = tr.map(x => ({ location: "local", mid: x.mid, trackName: x.sender.track.id }));
    await cfPc.setLocalDescription(await cfPc.createOffer());
    const r2 = await fetch("/api/cf/tracks/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: cfSessionId, tracks: trackObjs, sdp: cfPc.localDescription.sdp }) }).then(r => r.json());
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

// ---------------- AI ASSISTANT (NaraRouter via server proxy) ----------------
const aiHistory = [{ role: "system", content: "You are AgoraMeet AI, a helpful assistant inside a messaging app." }];
function aiBubble(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "out" : "in");
  div.innerHTML = esc(text) + '<span class="t"></span>';
  $("aiMessages").appendChild(div);
  $("aiMessages").scrollTop = $("aiMessages").scrollHeight;
}
$("aiSendBtn").onclick = async () => {
  const text = $("aiInput").value.trim();
  if (!text) return;
  $("aiInput").value = "";
  aiBubble("user", text);
  aiHistory.push({ role: "user", content: text });
  $("aiStatus").textContent = "typing…";
  try {
    const r = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: aiHistory }) });
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

// ---------------- BOOT ----------------
loadFirebase().catch(e => toast("Firebase load failed: " + e.message));

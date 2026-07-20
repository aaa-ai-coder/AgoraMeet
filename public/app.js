// app.js - AgoraMeet (advanced build)
// Features: share links, recent rooms, nearby discovery, connection quality,
// theme toggle, host controls (mute-all/kick/end-room), call-ended screen,
// graceful offline degradation, explicit device permissions.

let client = null;
let localTracks = { videoTrack: null, audioTrack: null };
let remoteUsers = {};
let screenTrack = null;
let isScreenSharing = false;

let appId = "";
let token = "";
let channelName = "";
let uid = null;
let displayName = "";
let isHost = true;

const API_BASE = (location.protocol === "file:") ? "https://agorameet-server.onrender.com" : "";
const FALLBACK_BASE = "https://agorameet-server.onrender.com";

let lobbyMicEnabled = true;
let lobbyCamEnabled = true;

let chatStreamId = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const deletedRooms = new Set();

const $ = (id) => document.getElementById(id);

// ---- Safe API helper: never throws, returns parsed JSON or {error} ----
async function api(path, opts) {
  const urls = [API_BASE, FALLBACK_BASE].filter(Boolean);
  for (const base of urls) {
    try {
      const r = await fetch(base + path, opts);
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) continue;
      return await r.json();
    } catch (e) { /* try next base */ }
  }
  return { error: "network" };
}

function showToast(msg, type = "info") {
  const colors = { info: "border-white/10", error: "border-red-500/40 text-red-300", success: "border-emerald-500/40 text-emerald-300" };
  const el = document.createElement("div");
  el.className = `toast ${colors[type] || colors.info}`;
  el.innerText = msg;
  $("toastContainer").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.4s"; setTimeout(() => el.remove(), 400); }, 3500);
}

function showLoading(text) { $("loadingText").innerText = text || "Please wait…"; $("loadingOverlay").style.display = "flex"; }
function hideLoading() { $("loadingOverlay").style.display = "none"; }

// ---------- Theme ----------
function applyTheme(theme) {
  if (theme === "light") { document.documentElement.classList.add("light"); $("themeToggle").innerHTML = '<i class="fa-solid fa-moon"></i>'; }
  else { document.documentElement.classList.remove("light"); $("themeToggle").innerHTML = '<i class="fa-solid fa-sun"></i>'; }
  localStorage.setItem("agorameet-theme", theme);
}
$("themeToggle") && $("themeToggle").addEventListener("click", () => {
  applyTheme(document.documentElement.classList.contains("light") ? "dark" : "light");
});

// ---------- Recent rooms ----------
function getRecentRooms() { try { return JSON.parse(localStorage.getItem("agorameet-recent") || "[]"); } catch { return []; } }
function addRecentRoom(room, name) {
  let list = getRecentRooms().filter(r => r.room !== room);
  list.unshift({ room, name: name || room, ts: Date.now() });
  list = list.slice(0, 8);
  localStorage.setItem("agorameet-recent", JSON.stringify(list));
  renderRecentRooms();
}
function renderRecentRooms() {
  const list = getRecentRooms();
  const box = $("recentRooms");
  if (!box) return;
  if (!list.length) { box.innerHTML = '<p class="text-xs text-slate-500 text-center py-2">No recent rooms yet.</p>'; return; }
  box.innerHTML = "";
  list.forEach(r => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "w-full text-left flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition";
    el.innerHTML = `<span class="text-sm truncate"><i class="fa-solid fa-clock-rotate-left text-slate-500 mr-2"></i>${escapeHTML(r.room)}</span><i class="fa-solid fa-arrow-right text-blue-400"></i>`;
    el.addEventListener("click", () => { $("roomName").value = r.room; $("displayName").focus(); });
    box.appendChild(el);
  });
}

// ---------- Share ----------
function webRoomLink() { return `${location.origin || FALLBACK_BASE}/?room=${encodeURIComponent(channelName)}`; }
async function shareRoom() {
  const link = webRoomLink();
  if (navigator.share) { try { await navigator.share({ title: "Join my AgoraMeet room", text: `Join my room: ${channelName}`, url: link }); return; } catch (e) {} }
  try { await navigator.clipboard.writeText(link); showToast("Room link copied to clipboard", "success"); }
  catch (e) { prompt("Copy this room link:", link); }
}
$("shareRoomBtn") && $("shareRoomBtn").addEventListener("click", shareRoom);

window.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem("agorameet-theme") || "dark");
  renderRecentRooms();
  const params = new URLSearchParams(location.search);
  const r = params.get("room");
  if (r) { $("roomName").value = r; $("displayName").focus(); }
  refreshNearby();
  setInterval(refreshNearby, 8000);
});

// ---------- Nearby discovery (fail-safe) ----------
async function refreshNearby() {
  const box = $("nearbyRooms");
  if (!box) return;
  const data = await api("/api/rooms");
  if (data.error || !data.rooms) {
    box.innerHTML = '<p class="text-xs text-slate-500 text-center py-2">Discovery offline — join by room name.</p>';
    return;
  }
  const rooms = data.rooms.filter(r => r.channel !== channelName || !channelName);
  if (!rooms.length) { box.innerHTML = '<p class="text-xs text-slate-500 text-center py-2">No live rooms nearby right now.</p>'; return; }
  box.innerHTML = "";
  rooms.forEach(r => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "w-full text-left flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition";
    el.innerHTML = `<span class="text-sm truncate"><i class="fa-solid fa-satellite-dish text-emerald-400 mr-2"></i>${escapeHTML(r.channel)}</span><span class="text-[10px] text-slate-400">${r.count} online</span>`;
    el.addEventListener("click", () => { $("roomName").value = r.channel; $("displayName").focus(); });
    box.appendChild(el);
  });
}

// ---------- Connection quality ----------
let statsTimer = null;
function startStats() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = setInterval(async () => {
    if (!client || !client.getRTCStats) return;
    try {
      const stats = await client.getRTCStats();
      const rtt = stats.RTT || 0;
      let label = "Excellent", cls = "text-emerald-400", dot = "bg-emerald-500";
      if (rtt > 300) { label = "Poor"; cls = "text-red-400"; dot = "bg-red-500"; }
      else if (rtt > 150) { label = "Fair"; cls = "text-amber-400"; dot = "bg-amber-500"; }
      else if (rtt > 50) { label = "Good"; cls = "text-blue-400"; dot = "bg-blue-500"; }
      $("netQuality").className = `text-xs ${cls}`;
      $("netQuality").innerHTML = `<span class="w-2 h-2 rounded-full ${dot} inline-block mr-1"></span>${label} · ${rtt}ms`;
    } catch (e) {}
  }, 2000);
}
function stopStats() { if (statsTimer) { clearInterval(statsTimer); statsTimer = null; } }

// ---------- Presence (fail-safe) ----------
async function pingPresence(action) {
  return api("/api/presence", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelName, action, host: isHost })
  });
}

// ---------- Client ----------
function initClient() { client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }); setupClientEvents(); }

function setupClientEvents() {
  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") { remoteUsers[user.uid] = user; updateVideoGrid(); updateParticipantsList(); }
    if (mediaType === "audio") user.audioTrack.play();
  });
  client.on("user-unpublished", (user, mediaType) => {
    if (mediaType === "video" && remoteUsers[user.uid]) { delete remoteUsers[user.uid]; updateVideoGrid(); updateParticipantsList(); }
  });
  client.on("user-left", (user) => { delete remoteUsers[user.uid]; updateVideoGrid(); updateParticipantsList(); });
  client.on("stream-message", (uid, data) => {
    try {
      const msg = JSON.parse(textDecoder.decode(data));
      if (msg.type === "chat") { appendChatMessage(msg.sender, msg.text, false); if ($("sidePanel").classList.contains("hidden")) $("chatDot").classList.remove("hidden"); }
      else if (msg.type === "host-mute-all") { if (localTracks.audioTrack && !localTracks.audioTrack.muted) { localTracks.audioTrack.setMuted(true); setMic(false); showToast("Host muted everyone", "info"); } }
      else if (msg.type === "host-kick" && msg.uid === uid) { showToast("You were removed by the host", "error"); leaveMeeting(true); }
      else if (msg.type === "host-end-room") { showToast("The room was ended by the host", "error"); leaveMeeting(true); }
    } catch (e) { console.error(e); }
  });
  client.enableAudioVolumeIndicator();
  client.on("volume-indicator", (volumes) => { volumes.forEach((v) => { const el = $(`video-${v.uid}`); if (el) el.classList.toggle("active-speaker", v.level > 5); }); });
  client.on("connection-state-change", (cur) => { if (cur === "DISCONNECTED" && channelName) showToast("Connection lost — reconnecting…", "error"); });
}

// ---------- Lobby toggles ----------
$("toggleLobbyMic").addEventListener("click", () => {
  lobbyMicEnabled = !lobbyMicEnabled;
  $("lobbyMicIcon").className = lobbyMicEnabled ? "fa-solid fa-microphone text-emerald-400" : "fa-solid fa-microphone-slash text-red-500";
  $("lobbyMicText").innerText = lobbyMicEnabled ? "Mic On" : "Mic Off";
});
$("toggleLobbyCam").addEventListener("click", () => {
  lobbyCamEnabled = !lobbyCamEnabled;
  $("lobbyCamIcon").className = lobbyCamEnabled ? "fa-solid fa-video text-emerald-400" : "fa-solid fa-video-slash text-red-500";
  $("lobbyCamText").innerText = lobbyCamEnabled ? "Camera On" : "Camera Off";
});

// ---------- Permissions ----------
async function ensurePermissions() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: lobbyMicEnabled, video: lobbyCamEnabled
      });
      stream.getTracks().forEach(t => t.stop()); // release; Agora will re-acquire
      return true;
    }
  } catch (e) {
    showToast("Allow microphone/camera permission to join", "error");
    return false;
  }
  return true;
}

// ---------- Join ----------
$("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  channelName = $("roomName").value.trim().toLowerCase();
  displayName = $("displayName").value.trim();
  if (!channelName || !displayName) return;

  if (deletedRooms.has(channelName)) { showToast("This room was ended by the host", "error"); return; }

  const joinBtn = $("joinBtn");
  joinBtn.disabled = true;
  joinBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>Connecting…</span>`;
  showLoading("Requesting device permission…");

  const permitted = await ensurePermissions();
  if (!permitted) { joinBtn.disabled = false; joinBtn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`; hideLoading(); return; }

  showLoading("Fetching secure token…");
  try {
    const data = await api(`/api/token?channel=${encodeURIComponent(channelName)}`);
    if (data.error || !data.token) throw new Error("Could not get token (server offline?)");
    appId = data.appId; token = data.token;

    showLoading("Joining room…");
    initClient();
    const joinedUid = await client.join(appId, channelName, token, null);
    uid = joinedUid;

    try { chatStreamId = client.createDataStream({ reliable: true, ordered: true }); } catch (e) { console.warn(e); }

    const tracks = [];
    try {
      if (lobbyMicEnabled) { localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack(); tracks.push(localTracks.audioTrack); $("localMicIndicator").className = "fa-solid fa-microphone text-emerald-400"; }
      else $("localMicIndicator").className = "fa-solid fa-microphone-slash text-red-500";
    } catch (e) { showToast("Microphone unavailable", "error"); }
    try {
      if (lobbyCamEnabled) { localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack(); tracks.push(localTracks.videoTrack); $("localAvatar").classList.add("hidden"); localTracks.videoTrack.play("localVideo"); }
      else showLocalAvatar();
    } catch (e) { showToast("Camera unavailable", "error"); showLocalAvatar(); }

    if (tracks.length) await client.publish(tracks);

    // Decide host: server returns whether room already existed
    const pres = await pingPresence("join");
    if (pres.ended) { showToast("This room was ended by the host", "error"); await leaveMeeting(true); return; }
    isHost = !pres.existed;

    addRecentRoom(channelName, displayName);
    startStats();

    $("lobbyScreen").classList.add("hidden");
    $("meetingScreen").classList.remove("hidden");
    $("endedScreen").classList.add("hidden");
    $("connectionStatus").classList.remove("hidden"); $("connectionStatus").classList.add("flex");
    $("channelBadge").classList.remove("hidden");
    $("currentRoomName").innerText = channelName;
    $("localUserBadge").innerText = `${displayName} (You)`;
    $("listLocalName").innerText = `${displayName} (You)`;
    $("listLocalAvatar").innerText = displayName.charAt(0).toUpperCase();
    $("hostBadge").style.display = isHost ? "inline-block" : "none";
    $("hostControls").classList.toggle("hidden", !isHost);

    updateVideoGrid(); updateParticipantsList();
    showToast("You joined the room", "success");
  } catch (error) {
    console.error(error);
    showToast(`Join failed: ${error.message || error}`, "error");
    joinBtn.disabled = false;
    joinBtn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
  } finally { hideLoading(); }
});

function showLocalAvatar() {
  $("localAvatar").classList.remove("hidden");
  $("localAvatarLetter").innerText = displayName ? displayName.charAt(0).toUpperCase() : "?";
}

function updateVideoGrid() {
  const grid = $("videoGrid");
  if (!$("localVideoContainer").parentElement) grid.appendChild($("localVideoContainer"));
  $("localVideoContainer").classList.remove("hidden");
  grid.querySelectorAll(".remote-video-frame").forEach((el) => el.remove());
  const remotes = Object.values(remoteUsers);
  const total = remotes.length + 1;
  grid.className = "flex-1 grid gap-4 items-center justify-center " +
    (total <= 1 ? "grid-cols-1 max-w-4xl mx-auto w-full" : total === 2 ? "grid-cols-1 md:grid-cols-2" : total <= 4 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3");
  remotes.forEach((user) => {
    const div = document.createElement("div");
    div.id = `video-${user.uid}`;
    div.className = "video-container h-full min-h-[250px] flex items-center justify-center remote-video-frame";
    const kick = isHost ? `<button class="kick-btn absolute top-3 right-3 bg-red-600/80 hover:bg-red-500 text-white text-xs px-2 py-1 rounded" data-uid="${user.uid}"><i class="fa-solid fa-user-xmark"></i></button>` : "";
    div.innerHTML = `<div id="player-${user.uid}" class="w-full h-full"></div>${kick}
      <div class="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-semibold"><span>Participant ${user.uid}</span></div>`;
    grid.appendChild(div);
    if (user.videoTrack) user.videoTrack.play(`player-${user.uid}`);
    const kb = div.querySelector(".kick-btn");
    if (kb) kb.addEventListener("click", () => hostKick(user.uid));
  });
}

function updateParticipantsList() {
  const remotes = Object.values(remoteUsers);
  $("participantCount").innerText = remotes.length + 1;
  const list = $("remoteParticipantsList");
  list.innerHTML = "";
  remotes.forEach((user) => {
    const el = document.createElement("div");
    el.className = "flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5";
    el.innerHTML = `<div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-xs">P</div>
        <span class="text-sm font-medium">Participant ${user.uid}</span></div>
      <div class="flex items-center space-x-2 text-slate-400">
        <i class="fa-solid ${user.hasAudio ? "fa-microphone text-emerald-400" : "fa-microphone-slash text-red-500"} text-xs"></i>
        <i class="fa-solid ${user.hasVideo ? "fa-video text-emerald-400" : "fa-video-slash text-red-500"} text-xs"></i>
        ${isHost ? `<button class="text-red-400 hover:text-red-300 ml-1" data-uid="${user.uid}"><i class="fa-solid fa-user-xmark"></i></button>` : ""}
      </div>`;
    const kb = el.querySelector("button[data-uid]");
    if (kb) kb.addEventListener("click", () => hostKick(user.uid));
    list.appendChild(el);
  });
}

// ---------- Host controls ----------
function hostBroadcast(type, extra = {}) {
  if (chatStreamId !== null && client) {
    try { client.sendStreamMessage(chatStreamId, textEncoder.encode(JSON.stringify({ type, ...extra }))); } catch (err) { console.error(err); }
  }
}
function hostMuteAll() {
  if (!isHost) { showToast("Only the host can mute everyone", "error"); return; }
  if (localTracks.audioTrack && !localTracks.audioTrack.muted) { localTracks.audioTrack.setMuted(true); setMic(false); }
  hostBroadcast("host-mute-all");
  showToast("Muted everyone", "success");
}
function hostKick(targetUid) {
  if (!isHost) { showToast("Only the host can remove people", "error"); return; }
  hostBroadcast("host-kick", { uid: targetUid });
  showToast(`Removed participant ${targetUid}`, "info");
}
function hostEndRoom() {
  if (!isHost) { showToast("Only the host can end the room", "error"); return; }
  if (!confirm("End this room for EVERYONE?")) return;
  hostBroadcast("host-end-room");
  api("/api/rooms/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: channelName }) });
  deletedRooms.add(channelName);
  showToast("Room ended for everyone", "success");
  leaveMeeting(true);
}
$("hostMuteAllBtn") && $("hostMuteAllBtn").addEventListener("click", hostMuteAll);
$("hostEndRoomBtn") && $("hostEndRoomBtn").addEventListener("click", hostEndRoom);

// ---------- Mic ----------
$("micControl").addEventListener("click", async () => {
  if (!localTracks.audioTrack) {
    try { localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack(); await client.publish(localTracks.audioTrack); setMic(true); }
    catch (e) { showToast("Cannot access microphone", "error"); }
    return;
  }
  if (localTracks.audioTrack.muted) { await localTracks.audioTrack.setMuted(false); setMic(true); }
  else { await localTracks.audioTrack.setMuted(true); setMic(false); }
});
function setMic(on) {
  $("micIcon").className = on ? "fa-solid fa-microphone text-lg text-white" : "fa-solid fa-microphone-slash text-lg text-red-500";
  $("micControl").className = on ? "control-btn bg-white/10 hover:bg-white/15 text-white" : "control-btn bg-red-500/20 border border-red-500/30 text-red-500";
  $("localMicIndicator").className = on ? "fa-solid fa-microphone text-emerald-400" : "fa-solid fa-microphone-slash text-red-500";
}

// ---------- Cam ----------
$("camControl").addEventListener("click", async () => {
  if (!localTracks.videoTrack) {
    try { localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack(); await client.publish(localTracks.videoTrack); $("localAvatar").classList.add("hidden"); localTracks.videoTrack.play("localVideo"); setCam(true); }
    catch (e) { showToast("Cannot access camera", "error"); }
    return;
  }
  if (localTracks.videoTrack.muted) { await localTracks.videoTrack.setMuted(false); $("localAvatar").classList.add("hidden"); setCam(true); }
  else { await localTracks.videoTrack.setMuted(true); showLocalAvatar(); setCam(false); }
});
function setCam(on) {
  $("camIcon").className = on ? "fa-solid fa-video text-lg text-white" : "fa-solid fa-video-slash text-lg text-red-500";
  $("camControl").className = on ? "control-btn bg-white/10 hover:bg-white/15 text-white" : "control-btn bg-red-500/20 border border-red-500/30 text-red-500";
}

// ---------- Screen share ----------
$("screenControl").addEventListener("click", async () => {
  if (!isScreenSharing) {
    try {
      screenTrack = await AgoraRTC.createScreenVideoTrack();
      isScreenSharing = true;
      $("screenIcon").className = "fa-solid fa-desktop text-lg text-blue-500";
      $("screenControl").className = "control-btn bg-blue-500/20 border border-blue-500/30 text-blue-500 animate-pulse";
      if (localTracks.videoTrack) await client.unpublish(localTracks.videoTrack);
      await client.publish(screenTrack);
      $("localAvatar").classList.add("hidden");
      screenTrack.play("localVideo");
      screenTrack.on("track-ended", stopScreenShare);
    } catch (e) { console.warn(e); }
  } else stopScreenShare();
});
async function stopScreenShare() {
  if (!screenTrack) return;
  isScreenSharing = false;
  $("screenIcon").className = "fa-solid fa-desktop text-lg text-white";
  $("screenControl").className = "control-btn bg-white/10 hover:bg-white/15 text-white";
  await client.unpublish(screenTrack);
  screenTrack.close(); screenTrack = null;
  if (localTracks.videoTrack) {
    await client.publish(localTracks.videoTrack);
    if (!localTracks.videoTrack.muted) { $("localAvatar").classList.add("hidden"); localTracks.videoTrack.play("localVideo"); }
    else showLocalAvatar();
  } else showLocalAvatar();
}

// ---------- Chat ----------
$("chatToggle").addEventListener("click", () => {
  if ($("sidePanel").classList.contains("hidden")) { $("sidePanel").classList.remove("hidden"); $("chatDot").classList.add("hidden"); }
  else $("sidePanel").classList.add("hidden");
});
$("chatTab").addEventListener("click", () => {
  $("chatTab").className = "flex-1 py-3 text-center text-sm font-semibold border-b-2 border-blue-500 text-white";
  $("participantsTab").className = "flex-1 py-3 text-center text-sm font-semibold text-slate-400 border-b-2 border-transparent";
  $("chatContent").classList.remove("hidden"); $("participantsContent").classList.add("hidden");
});
$("participantsTab").addEventListener("click", () => {
  $("participantsTab").className = "flex-1 py-3 text-center text-sm font-semibold border-b-2 border-blue-500 text-white";
  $("chatTab").className = "flex-1 py-3 text-center text-sm font-semibold text-slate-400 border-b-2 border-transparent";
  $("participantsContent").classList.remove("hidden"); $("chatContent").classList.add("hidden");
  updateParticipantsList();
});
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  appendChatMessage(displayName, text, true);
  if (chatStreamId !== null && client) {
    try { client.sendStreamMessage(chatStreamId, textEncoder.encode(JSON.stringify({ type: "chat", sender: displayName, text }))); } catch (err) { console.error(err); }
  }
  $("chatInput").value = "";
});
function appendChatMessage(sender, text, isSelf) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col space-y-1 fade-in";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isSelf) {
    wrap.innerHTML = `<div class="flex items-baseline justify-end space-x-2"><span class="text-[10px] text-slate-500">${time}</span><span class="text-xs font-bold text-blue-400">You</span></div>
      <div class="bg-blue-600/35 border border-blue-500/30 rounded-xl rounded-tr-none px-3 py-2 self-end max-w-[85%] break-words">${escapeHTML(text)}</div>`;
  } else {
    wrap.innerHTML = `<div class="flex items-baseline space-x-2"><span class="text-xs font-bold text-indigo-400">${escapeHTML(sender)}</span><span class="text-[10px] text-slate-500">${time}</span></div>
      <div class="bg-white/5 border border-white/10 rounded-xl rounded-tl-none px-3 py-2 self-start max-w-[85%] break-words">${escapeHTML(text)}</div>`;
  }
  const box = $("chatMessages");
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}
function escapeHTML(str) { return str.replace(/[&<>'"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[t])); }

// ---------- Leave / Ended ----------
$("leaveControl").addEventListener("click", async () => { if (confirm("Leave this meeting?")) await leaveMeeting(false); });
async function leaveMeeting(kicked) {
  stopStats();
  pingPresence("leave");
  for (let k in localTracks) { if (localTracks[k]) { localTracks[k].stop(); localTracks[k].close(); localTracks[k] = null; } }
  if (screenTrack) { screenTrack.stop(); screenTrack.close(); screenTrack = null; isScreenSharing = false; }
  setMic(true); setCam(true);
  if (client) { try { await client.leave(); } catch (e) {} }
  remoteUsers = {}; chatStreamId = null;
  $("meetingScreen").classList.add("hidden");
  $("connectionStatus").classList.remove("flex"); $("connectionStatus").classList.add("hidden");
  $("channelBadge").classList.add("hidden");
  $("endedScreen").classList.remove("hidden");
  $("endedRoomName").innerText = channelName || "";
  const btn = $("joinBtn");
  btn.disabled = false;
  btn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
  if (!kicked) showToast("You left the room", "info");
}
$("rejoinBtn") && $("rejoinBtn").addEventListener("click", () => {
  $("endedScreen").classList.add("hidden");
  $("lobbyScreen").classList.remove("hidden");
  if (channelName) $("roomName").value = channelName;
});
$("newRoomBtn") && $("newRoomBtn").addEventListener("click", () => {
  $("endedScreen").classList.add("hidden");
  channelName = "";
  $("lobbyScreen").classList.remove("hidden");
});

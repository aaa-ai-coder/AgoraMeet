// app.js

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

// API base: use the deployed Render server so the APK works standalone on any device.
// Falls back to same-origin when served from the server itself.
const API_BASE = (location.protocol === "file:") ? "https://agorameet-server.onrender.com" : "";

let lobbyMicEnabled = true;
let lobbyCamEnabled = true;

let chatStreamId = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const $ = (id) => document.getElementById(id);

function showToast(msg, type = "info") {
  const colors = { info: "border-white/10", error: "border-red-500/40 text-red-300", success: "border-emerald-500/40 text-emerald-300" };
  const el = document.createElement("div");
  el.className = `toast ${colors[type] || colors.info}`;
  el.innerText = msg;
  $("toastContainer").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.4s"; setTimeout(() => el.remove(), 400); }, 3500);
}

function showLoading(text) {
  $("loadingText").innerText = text || "Please wait…";
  $("loadingOverlay").style.display = "flex";
}
function hideLoading() { $("loadingOverlay").style.display = "none"; }

function initClient() {
  client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  setupClientEvents();
}

function setupClientEvents() {
  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") {
      remoteUsers[user.uid] = user;
      updateVideoGrid(); updateParticipantsList();
    }
    if (mediaType === "audio") user.audioTrack.play();
  });

  client.on("user-unpublished", (user, mediaType) => {
    if (mediaType === "video" && remoteUsers[user.uid]) {
      delete remoteUsers[user.uid];
      updateVideoGrid(); updateParticipantsList();
    }
  });

  client.on("user-left", (user) => {
    delete remoteUsers[user.uid];
    updateVideoGrid(); updateParticipantsList();
  });

  client.on("stream-message", (uid, data) => {
    try {
      const msg = JSON.parse(textDecoder.decode(data));
      appendChatMessage(msg.sender, msg.text, false);
      if ($("sidePanel").classList.contains("hidden")) $("chatDot").classList.remove("hidden");
    } catch (e) { console.error(e); }
  });

  client.enableAudioVolumeIndicator();
  client.on("volume-indicator", (volumes) => {
    volumes.forEach((v) => {
      const el = $(`video-${v.uid}`);
      if (el) el.classList.toggle("active-speaker", v.level > 5);
    });
  });
}

// ---- Lobby toggles ----
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

// ---- Join ----
$("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  channelName = $("roomName").value.trim().toLowerCase();
  displayName = $("displayName").value.trim();
  if (!channelName || !displayName) return;

  const joinBtn = $("joinBtn");
  joinBtn.disabled = true;
  joinBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>Connecting…</span>`;
  showLoading("Fetching secure token…");

  try {
    const res = await fetch(`${API_BASE}/api/token?channel=${encodeURIComponent(channelName)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    appId = data.appId; token = data.token;

    showLoading("Joining room…");
    initClient();
    const joinedUid = await client.join(appId, channelName, token, null);
    uid = joinedUid;

    try { chatStreamId = client.createDataStream({ reliable: true, ordered: true }); } catch (e) { console.warn(e); }

    const tracks = [];
    try {
      if (lobbyMicEnabled) {
        localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        tracks.push(localTracks.audioTrack);
        $("localMicIndicator").className = "fa-solid fa-microphone text-emerald-400";
      } else {
        $("localMicIndicator").className = "fa-solid fa-microphone-slash text-red-500";
      }
    } catch (e) { showToast("Microphone unavailable", "error"); }

    try {
      if (lobbyCamEnabled) {
        localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
        tracks.push(localTracks.videoTrack);
        $("localAvatar").classList.add("hidden");
        localTracks.videoTrack.play("localVideo");
      } else showLocalAvatar();
    } catch (e) { showToast("Camera unavailable", "error"); showLocalAvatar(); }

    if (tracks.length) await client.publish(tracks);

    $("lobbyScreen").classList.add("hidden");
    $("meetingScreen").classList.remove("hidden");
    $("connectionStatus").classList.remove("hidden"); $("connectionStatus").classList.add("flex");
    $("channelBadge").classList.remove("hidden");
    $("currentRoomName").innerText = channelName;
    $("localUserBadge").innerText = `${displayName} (You)`;
    $("listLocalName").innerText = `${displayName} (You)`;
    $("listLocalAvatar").innerText = displayName.charAt(0).toUpperCase();

    updateVideoGrid(); updateParticipantsList();
    showToast("You joined the room", "success");
  } catch (error) {
    console.error(error);
    showToast(`Join failed: ${error.message || error}`, "error");
    joinBtn.disabled = false;
    joinBtn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
  } finally {
    hideLoading();
  }
});

function showLocalAvatar() {
  $("localAvatar").classList.remove("hidden");
  $("localAvatarLetter").innerText = displayName ? displayName.charAt(0).toUpperCase() : "?";
}

function updateVideoGrid() {
  const grid = $("videoGrid");
  // Ensure local container present
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
    div.innerHTML = `<div id="player-${user.uid}" class="w-full h-full"></div>
      <div class="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-semibold"><span>Participant ${user.uid}</span></div>`;
    grid.appendChild(div);
    if (user.videoTrack) user.videoTrack.play(`player-${user.uid}`);
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
      </div>`;
    list.appendChild(el);
  });
}

// ---- Mic ----
$("micControl").addEventListener("click", async () => {
  if (!localTracks.audioTrack) {
    try {
      localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish(localTracks.audioTrack);
      setMic(true);
    } catch (e) { showToast("Cannot access microphone", "error"); }
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

// ---- Cam ----
$("camControl").addEventListener("click", async () => {
  if (!localTracks.videoTrack) {
    try {
      localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
      await client.publish(localTracks.videoTrack);
      $("localAvatar").classList.add("hidden");
      localTracks.videoTrack.play("localVideo");
      setCam(true);
    } catch (e) { showToast("Cannot access camera", "error"); }
    return;
  }
  if (localTracks.videoTrack.muted) {
    await localTracks.videoTrack.setMuted(false);
    $("localAvatar").classList.add("hidden");
    setCam(true);
  } else {
    await localTracks.videoTrack.setMuted(true);
    showLocalAvatar(); setCam(false);
  }
});
function setCam(on) {
  $("camIcon").className = on ? "fa-solid fa-video text-lg text-white" : "fa-solid fa-video-slash text-lg text-red-500";
  $("camControl").className = on ? "control-btn bg-white/10 hover:bg-white/15 text-white" : "control-btn bg-red-500/20 border border-red-500/30 text-red-500";
}

// ---- Screen share ----
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

// ---- Side panel / chat ----
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
    try { client.sendStreamMessage(chatStreamId, textEncoder.encode(JSON.stringify({ sender: displayName, text }))); }
    catch (err) { console.error(err); }
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
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[t]));
}

// ---- Leave ----
$("leaveControl").addEventListener("click", async () => {
  if (confirm("Leave this meeting?")) await leaveMeeting();
});
async function leaveMeeting() {
  for (let k in localTracks) { if (localTracks[k]) { localTracks[k].stop(); localTracks[k].close(); localTracks[k] = null; } }
  if (screenTrack) { screenTrack.stop(); screenTrack.close(); screenTrack = null; isScreenSharing = false; }
  setMic(true); setCam(true);
  if (client) await client.leave();
  remoteUsers = {}; chatStreamId = null;
  $("meetingScreen").classList.add("hidden");
  $("connectionStatus").classList.remove("flex"); $("connectionStatus").classList.add("hidden");
  $("channelBadge").classList.add("hidden");
  $("lobbyScreen").classList.remove("hidden");
  const btn = $("joinBtn");
  btn.disabled = false;
  btn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
  showToast("You left the room", "info");
}

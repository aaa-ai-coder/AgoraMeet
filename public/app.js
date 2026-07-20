// app.js

// Agora client state
let client = null;
let localTracks = {
  videoTrack: null,
  audioTrack: null
};
let remoteUsers = {};
let screenTrack = null;
let isScreenSharing = false;

// Credentials & User state
let appId = "";
let token = "";
let channelName = "";
let uid = null;
let displayName = "";

// Lobby defaults
let lobbyMicEnabled = true;
let lobbyCamEnabled = true;

// Custom Data Stream ID for real-time text chat
let chatStreamId = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Initialize Agora Client
function initClient() {
  client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  setupClientEvents();
}

// Setup Agora Client event listeners
function setupClientEvents() {
  // Remote user published video/audio
  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    console.log("Subscribed to remote user:", user.uid, mediaType);

    if (mediaType === "video") {
      remoteUsers[user.uid] = user;
      updateVideoGrid();
    }
    if (mediaType === "audio") {
      user.audioTrack.play();
    }
  });

  // Remote user unpublished video/audio
  client.on("user-unpublished", (user, mediaType) => {
    console.log("User unpublished:", user.uid, mediaType);
    if (mediaType === "video") {
      if (remoteUsers[user.uid]) {
        delete remoteUsers[user.uid];
      }
      updateVideoGrid();
    }
  });

  // Remote user left the room
  client.on("user-left", (user) => {
    console.log("User left room:", user.uid);
    delete remoteUsers[user.uid];
    updateVideoGrid();
    updateParticipantsList();
  });

  // Receive text chat message via Agora DataStream
  client.on("stream-message", (uid, data) => {
    try {
      const decodedData = textDecoder.decode(data);
      const msg = JSON.parse(decodedData);
      appendChatMessage(msg.sender, msg.text, false);
      
      // Flash the chat notification dot if chat panel is closed
      if (document.getElementById("sidePanel").classList.contains("hidden")) {
        document.getElementById("chatDot").classList.remove("hidden");
      }
    } catch (err) {
      console.error("Error parsing stream message:", err);
    }
  });

  // Handle active speaker volumes
  client.enableAudioVolumeIndicator();
  client.on("volume-indicator", (volumes) => {
    volumes.forEach((volume) => {
      const userId = volume.uid;
      const element = document.getElementById(`video-${userId}`);
      if (element) {
        if (volume.level > 5) {
          element.classList.add("active-speaker");
        } else {
          element.classList.remove("active-speaker");
        }
      }
    });
  });
}

// LOBBY INTERACTION
const toggleLobbyMicBtn = document.getElementById("toggleLobbyMic");
const toggleLobbyCamBtn = document.getElementById("toggleLobbyCam");
const lobbyMicIcon = document.getElementById("lobbyMicIcon");
const lobbyCamIcon = document.getElementById("lobbyCamIcon");
const lobbyMicText = document.getElementById("lobbyMicText");
const lobbyCamText = document.getElementById("lobbyCamText");

toggleLobbyMicBtn.addEventListener("click", () => {
  lobbyMicEnabled = !lobbyMicEnabled;
  if (lobbyMicEnabled) {
    lobbyMicIcon.className = "fa-solid fa-microphone text-emerald-400";
    lobbyMicText.innerText = "Mic On";
  } else {
    lobbyMicIcon.className = "fa-solid fa-microphone-slash text-red-500";
    lobbyMicText.innerText = "Mic Off";
  }
});

toggleLobbyCamBtn.addEventListener("click", () => {
  lobbyCamEnabled = !lobbyCamEnabled;
  if (lobbyCamEnabled) {
    lobbyCamIcon.className = "fa-solid fa-video text-emerald-400";
    lobbyCamText.innerText = "Camera On";
  } else {
    lobbyCamIcon.className = "fa-solid fa-video-slash text-red-500";
    lobbyCamText.innerText = "Camera Off";
  }
});

// JOIN FORM SUBMISSION
const joinForm = document.getElementById("joinForm");
joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  channelName = document.getElementById("roomName").value.trim().toLowerCase();
  displayName = document.getElementById("displayName").value.trim();

  if (!channelName || !displayName) return;

  const joinBtn = document.getElementById("joinBtn");
  joinBtn.disabled = true;
  joinBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>Connecting...</span>`;

  try {
    // 1. Fetch Secure Agora Token from Node.js backend
    const response = await fetch(`/api/token?channel=${encodeURIComponent(channelName)}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    appId = data.appId;
    token = data.token;
    uid = data.uid;

    // 2. Initialize Agora RTC connection
    initClient();
    
    // 3. Join the Channel
    const joinedUid = await client.join(appId, channelName, token, null);
    uid = joinedUid; // Use assigned numeric UID if auto-generated
    
    // Create custom data stream for chat channel
    try {
      chatStreamId = client.createDataStream({ reliable: true, ordered: true });
    } catch (err) {
      console.warn("Agora custom data stream creation failed:", err);
    }

    // 4. Create and Publish Local Tracks (Mic/Camera)
    const tracksToPublish = [];
    
    try {
      if (lobbyMicEnabled) {
        localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        tracksToPublish.push(localTracks.audioTrack);
        document.getElementById("localMicIndicator").className = "fa-solid fa-microphone text-emerald-400";
      } else {
        document.getElementById("localMicIndicator").className = "fa-solid fa-microphone-slash text-red-500";
      }
    } catch (e) {
      console.warn("Failed to get audio device:", e);
    }

    try {
      if (lobbyCamEnabled) {
        localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
        tracksToPublish.push(localTracks.videoTrack);
        
        // Hide local placeholder and play video
        document.getElementById("localAvatar").classList.add("hidden");
        localTracks.videoTrack.play("localVideo");
      } else {
        // Show avatar placeholder
        showLocalAvatar();
      }
    } catch (e) {
      console.warn("Failed to get video device:", e);
      showLocalAvatar();
    }

    if (tracksToPublish.length > 0) {
      await client.publish(tracksToPublish);
    }

    // 5. Update Web Interface layout
    document.getElementById("lobbyScreen").classList.add("hidden");
    document.getElementById("meetingScreen").classList.remove("hidden");
    document.getElementById("connectionStatus").classList.remove("hidden");
    document.getElementById("connectionStatus").classList.add("flex");
    document.getElementById("channelBadge").classList.remove("hidden");
    document.getElementById("currentRoomName").innerText = channelName;
    
    // Set Local user display badge
    document.getElementById("localUserBadge").innerText = `${displayName} (You)`;
    document.getElementById("listLocalName").innerText = `${displayName} (You)`;
    document.getElementById("listLocalAvatar").innerText = displayName.charAt(0).toUpperCase();

    // Trigger grid updates
    updateVideoGrid();
    updateParticipantsList();

  } catch (error) {
    console.error("Join Room Failed:", error);
    alert(`Could not join room: ${error.message || error}`);
    joinBtn.disabled = false;
    joinBtn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
  }
});

// SHOW LOCAL AVATAR PLACEHOLDER
function showLocalAvatar() {
  document.getElementById("localAvatar").classList.remove("hidden");
  document.getElementById("localAvatarLetter").innerText = displayName ? displayName.charAt(0).toUpperCase() : "?";
}

// UPDATE VIDEO LAYOUT GRID
function updateVideoGrid() {
  const videoGrid = document.getElementById("videoGrid");
  
  // Remove all existing remote frames to rebuild dynamically
  const remoteContainers = videoGrid.querySelectorAll(".remote-video-frame");
  remoteContainers.forEach(el => el.remove());

  const remoteUsersList = Object.values(remoteUsers);
  const totalParticipants = remoteUsersList.length + 1; // plus local participant

  // Adjust Grid columns dynamically based on count
  if (totalParticipants === 1) {
    videoGrid.className = "flex-1 grid grid-cols-1 max-w-4xl mx-auto w-full gap-4 items-center justify-center";
  } else if (totalParticipants === 2) {
    videoGrid.className = "flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center justify-center";
  } else if (totalParticipants <= 4) {
    videoGrid.className = "flex-1 grid grid-cols-2 gap-4 items-center justify-center";
  } else {
    videoGrid.className = "flex-1 grid grid-cols-2 lg:grid-cols-3 gap-4 items-center justify-center";
  }

  // Inject remote participant containers
  remoteUsersList.forEach(user => {
    const remoteId = `video-${user.uid}`;
    
    const container = document.createElement("div");
    container.id = remoteId;
    container.className = "video-container h-full min-h-[250px] flex items-center justify-center remote-video-frame";

    container.innerHTML = `
      <div id="player-${user.uid}" class="w-full h-full"></div>
      <div class="absolute bottom-4 left-4 bg-black/60 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-semibold flex items-center space-x-2">
        <span>Participant ${user.uid}</span>
      </div>
    `;

    videoGrid.appendChild(container);

    // Play the remote video track inside the target container
    if (user.videoTrack) {
      user.videoTrack.play(`player-${user.uid}`);
    }
  });
}

// REFRESH PARTICIPANTS PANEL LIST
function updateParticipantsList() {
  const remoteUsersList = Object.values(remoteUsers);
  const totalCount = remoteUsersList.length + 1;
  document.getElementById("participantCount").innerText = totalCount;

  const remoteListEl = document.getElementById("remoteParticipantsList");
  remoteListEl.innerHTML = "";

  remoteUsersList.forEach(user => {
    const listElement = document.createElement("div");
    listElement.className = "flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5";
    listElement.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-xs">P</div>
        <span class="text-sm font-medium">Participant ${user.uid}</span>
      </div>
      <div class="flex items-center space-x-2 text-slate-400">
        <i class="fa-solid ${user.hasAudio ? 'fa-microphone text-emerald-400' : 'fa-microphone-slash text-red-500'} text-xs"></i>
        <i class="fa-solid ${user.hasVideo ? 'fa-video text-emerald-400' : 'fa-video-slash text-red-500'} text-xs"></i>
      </div>
    `;
    remoteListEl.appendChild(listElement);
  });
}

// AUDIO CONTROL (MUTE/UNMUTE)
const micControl = document.getElementById("micControl");
const micIcon = document.getElementById("micIcon");

micControl.addEventListener("click", async () => {
  if (!localTracks.audioTrack) {
    // If no mic track was initialized, try to create it now
    try {
      localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish(localTracks.audioTrack);
      micIcon.className = "fa-solid fa-microphone text-lg text-white";
      micControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
      document.getElementById("localMicIndicator").className = "fa-solid fa-microphone text-emerald-400";
    } catch (e) {
      console.error("Could not capture microphone:", e);
    }
    return;
  }

  if (localTracks.audioTrack.muted) {
    await localTracks.audioTrack.setMuted(false);
    micIcon.className = "fa-solid fa-microphone text-lg text-white";
    micControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
    document.getElementById("localMicIndicator").className = "fa-solid fa-microphone text-emerald-400";
  } else {
    await localTracks.audioTrack.setMuted(true);
    micIcon.className = "fa-solid fa-microphone-slash text-lg text-red-500";
    micControl.className = "control-btn bg-red-500/20 border border-red-500/30 text-red-500";
    document.getElementById("localMicIndicator").className = "fa-solid fa-microphone-slash text-red-500";
  }
});

// VIDEO CONTROL (ON/OFF)
const camControl = document.getElementById("camControl");
const camIcon = document.getElementById("camIcon");

camControl.addEventListener("click", async () => {
  if (!localTracks.videoTrack) {
    // Try to initialize camera if was skipped
    try {
      localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
      await client.publish(localTracks.videoTrack);
      document.getElementById("localAvatar").classList.add("hidden");
      localTracks.videoTrack.play("localVideo");
      camIcon.className = "fa-solid fa-video text-lg text-white";
      camControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
    } catch (e) {
      console.error("Could not capture camera:", e);
    }
    return;
  }

  if (localTracks.videoTrack.muted) {
    await localTracks.videoTrack.setMuted(false);
    document.getElementById("localAvatar").classList.add("hidden");
    camIcon.className = "fa-solid fa-video text-lg text-white";
    camControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
  } else {
    await localTracks.videoTrack.setMuted(true);
    showLocalAvatar();
    camIcon.className = "fa-solid fa-video-slash text-lg text-red-500";
    camControl.className = "control-btn bg-red-500/20 border border-red-500/30 text-red-500";
  }
});

// SCREEN SHARING CONTROL
const screenControl = document.getElementById("screenControl");
const screenIcon = document.getElementById("screenIcon");

screenControl.addEventListener("click", async () => {
  if (!isScreenSharing) {
    try {
      // 1. Create screen share video track
      screenTrack = await AgoraRTC.createScreenVideoTrack();
      isScreenSharing = true;
      screenIcon.className = "fa-solid fa-desktop text-lg text-blue-500";
      screenControl.className = "control-btn bg-blue-500/20 border border-blue-500/30 text-blue-500 animate-pulse";

      // 2. If camera is running, unpublish camera video track
      if (localTracks.videoTrack) {
        await client.unpublish(localTracks.videoTrack);
      }

      // 3. Publish screen sharing track
      await client.publish(screenTrack);
      
      // Hide local camera placeholder & play screen sharing preview
      document.getElementById("localAvatar").classList.add("hidden");
      screenTrack.play("localVideo");

      // Handle user manually stopping screen share via browser bar
      screenTrack.on("track-ended", () => {
        stopScreenShare();
      });

    } catch (e) {
      console.warn("Screen share cancelled or failed:", e);
    }
  } else {
    await stopScreenShare();
  }
});

async function stopScreenShare() {
  if (!screenTrack) return;

  isScreenSharing = false;
  screenIcon.className = "fa-solid fa-desktop text-lg text-white";
  screenControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";

  // Unpublish and close screen sharing track
  await client.unpublish(screenTrack);
  screenTrack.close();
  screenTrack = null;

  // Re-publish local camera if it exists
  if (localTracks.videoTrack) {
    await client.publish(localTracks.videoTrack);
    if (!localTracks.videoTrack.muted) {
      document.getElementById("localAvatar").classList.add("hidden");
      localTracks.videoTrack.play("localVideo");
    } else {
      showLocalAvatar();
    }
  } else {
    showLocalAvatar();
  }
}

// CHAT SIDE-PANEL TOGGLE
const chatToggle = document.getElementById("chatToggle");
const sidePanel = document.getElementById("sidePanel");
const chatDot = document.getElementById("chatDot");

chatToggle.addEventListener("click", () => {
  if (sidePanel.classList.contains("hidden")) {
    sidePanel.classList.remove("hidden");
    chatDot.classList.add("hidden"); // Clear notification badge
  } else {
    sidePanel.classList.add("hidden");
  }
});

// CHAT TABS SWITCHING (Chat vs. Participants)
const chatTab = document.getElementById("chatTab");
const participantsTab = document.getElementById("participantsTab");
const chatContent = document.getElementById("chatContent");
const participantsContent = document.getElementById("participantsContent");

chatTab.addEventListener("click", () => {
  chatTab.className = "flex-1 py-3 text-center text-sm font-semibold border-b-2 border-blue-500 text-white";
  participantsTab.className = "flex-1 py-3 text-center text-sm font-semibold text-slate-400 border-b-2 border-transparent";
  chatContent.classList.remove("hidden");
  participantsContent.classList.add("hidden");
});

participantsTab.addEventListener("click", () => {
  participantsTab.className = "flex-1 py-3 text-center text-sm font-semibold border-b-2 border-blue-500 text-white";
  chatTab.className = "flex-1 py-3 text-center text-sm font-semibold text-slate-400 border-b-2 border-transparent";
  participantsContent.classList.remove("hidden");
  chatContent.classList.add("hidden");
  updateParticipantsList();
});

// SEND CHAT MESSAGE
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  // 1. Locally append
  appendChatMessage(displayName, text, true);

  // 2. Broadcast via Agora Custom DataStream to all participants
  if (chatStreamId !== null && client) {
    const payload = JSON.stringify({ sender: displayName, text: text });
    const encodedPayload = textEncoder.encode(payload);
    try {
      client.sendStreamMessage(chatStreamId, encodedPayload);
    } catch (err) {
      console.error("Failed to send custom stream message:", err);
    }
  }

  chatInput.value = "";
});

// APPEND MESSAGE TO CHAT UI
function appendChatMessage(sender, text, isSelf) {
  const chatMessages = document.getElementById("chatMessages");
  const msgContainer = document.createElement("div");
  msgContainer.className = "flex flex-col space-y-1";

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isSelf) {
    msgContainer.innerHTML = `
      <div class="flex items-baseline justify-end space-x-2">
        <span class="text-[10px] text-slate-500">${time}</span>
        <span class="text-xs font-bold text-blue-400">You</span>
      </div>
      <div class="bg-blue-600/35 border border-blue-500/30 text-white rounded-xl rounded-tr-none px-3 py-2 self-end max-w-[85%] break-words">
        ${escapeHTML(text)}
      </div>
    `;
  } else {
    msgContainer.innerHTML = `
      <div class="flex items-baseline space-x-2">
        <span class="text-xs font-bold text-indigo-400">${escapeHTML(sender)}</span>
        <span class="text-[10px] text-slate-500">${time}</span>
      </div>
      <div class="bg-white/5 border border-white/10 text-white rounded-xl rounded-tl-none px-3 py-2 self-start max-w-[85%] break-words">
        ${escapeHTML(text)}
      </div>
    `;
  }

  chatMessages.appendChild(msgContainer);
  chatMessages.scrollTop = chatMessages.scrollHeight; // Auto scroll to latest
}

// HELPER: Escape HTML to prevent XSS
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// LEAVE MEETING CONTROL
const leaveControl = document.getElementById("leaveControl");
leaveControl.addEventListener("click", async () => {
  if (confirm("Are you sure you want to leave this meeting?")) {
    await leaveMeeting();
  }
});

async function leaveMeeting() {
  // Close local video / audio tracks
  for (let trackName in localTracks) {
    if (localTracks[trackName]) {
      localTracks[trackName].stop();
      localTracks[trackName].close();
      localTracks[trackName] = null;
    }
  }

  if (screenTrack) {
    screenTrack.stop();
    screenTrack.close();
    screenTrack = null;
    isScreenSharing = false;
  }

  // Reset controls layout
  micIcon.className = "fa-solid fa-microphone text-lg text-white";
  micControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
  camIcon.className = "fa-solid fa-video text-lg text-white";
  camControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";
  screenIcon.className = "fa-solid fa-desktop text-lg text-white";
  screenControl.className = "control-btn bg-white/10 hover:bg-white/15 text-white";

  // Leave Agora Client channel
  if (client) {
    await client.leave();
  }

  // Reset variables
  remoteUsers = {};
  chatStreamId = null;

  // Toggle screens
  document.getElementById("meetingScreen").classList.add("hidden");
  document.getElementById("connectionStatus").classList.remove("flex");
  document.getElementById("connectionStatus").classList.add("hidden");
  document.getElementById("channelBadge").classList.add("hidden");
  document.getElementById("lobbyScreen").classList.remove("hidden");
  
  // Re-enable lobby Join button
  const joinBtn = document.getElementById("joinBtn");
  joinBtn.disabled = false;
  joinBtn.innerHTML = `<span>Join Meeting</span> <i class="fa-solid fa-arrow-right"></i>`;
}

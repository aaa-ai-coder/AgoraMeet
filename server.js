// server.js
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const APP_ID = process.env.AGORA_APP_ID || "159c36b2c45148feaa15eb38843124cf";
const APP_CERTIFICATE = process.env.AGORA_CERTIFICATE || "04f7ae808a1d46df9858f7bc8df9f39c";

// Support JSON bodies and serve static frontend assets
app.use(express.json());
app.use(express.static('public'));

// CORS: the APK runs in a WebView on a file:// origin, so cross-origin
// requests to this server are blocked unless we allow them explicitly.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * Endpoint to generate RTC token
 * Query params:
 *  - channel: name of the video room (required)
 *  - uid: numeric user ID (optional, defaults to 0)
 *  - role: publisher or subscriber (optional, defaults to publisher)
 */
app.get('/api/token', (req, res) => {
  const channelName = req.query.channel;
  if (!channelName) {
    return res.status(400).json({ error: 'channel query parameter is required' });
  }

  let uid = parseInt(req.query.uid || 0, 10);
  if (isNaN(uid)) {
    uid = 0;
  }

  let role = RtcRole.PUBLISHER;
  if (req.query.role === 'subscriber') {
    role = RtcRole.SUBSCRIBER;
  }

  const expirationTimeInSeconds = 3600; // 1 hour token validity
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs,
      privilegeExpiredTs
    );

    return res.json({
      token: token,
      appId: APP_ID,
      uid: uid,
      channel: channelName
    });
  } catch (error) {
    console.error('Error generating Agora token:', error);
    return res.status(500).json({ error: 'Failed to generate token' });
  }
});

// In-memory active room registry (per Render instance).
// NOTE: Render free instances sleep / restart, so this is best-effort discovery.
// We still keep it in server memory as requested; rooms self-age-out via lastSeen.
const ROOM_TTL = 10 * 60 * 1000; // 10 min with no activity -> dropped
const activeRooms = new Map(); // channel -> { channel, count, lastSeen, host }
const deletedRooms = new Set(); // channels explicitly ended by host

function touchRoom(channel, delta = 1, host = null) {
  if (!channel) return;
  if (deletedRooms.has(channel)) return; // room was ended by host
  const now = Date.now();
  const room = activeRooms.get(channel) || { channel, count: 0, lastSeen: now, host };
  room.count = Math.max(0, room.count + delta);
  room.lastSeen = now;
  if (host) room.host = host;
  if (room.count === 0) {
    // keep a short grace period so discovery can still show it briefly
    room.lastSeen = now;
    if (room.count <= 0) activeRooms.delete(channel);
  } else activeRooms.set(channel, room);
}

function cleanupRooms() {
  const now = Date.now();
  for (const [channel, room] of activeRooms) {
    if (now - room.lastSeen > ROOM_TTL) {
      activeRooms.delete(channel);
      deletedRooms.delete(channel);
    }
  }
}
setInterval(cleanupRooms, 60 * 1000);

// Called by the app to announce join/leave so discovery reflects live activity.
app.post('/api/presence', (req, res) => {
  const channel = req.body && req.body.channel;
  const action = req.body && req.body.action; // "join" | "leave"
  const host = req.body && req.body.host;
  if (!channel || (action !== 'join' && action !== 'leave')) {
    return res.status(400).json({ error: 'channel and action(join|leave) required' });
  }
  if (deletedRooms.has(channel) && action === 'join') {
    return res.status(410).json({ error: 'room-ended', ended: true, existed: false });
  }
  const existedBefore = activeRooms.has(channel);
  touchRoom(channel, action === 'join' ? 1 : -1, host);
  res.json({ ok: true, ended: deletedRooms.has(channel), existed: existedBefore });
});

// Host ends a room for everyone -> marks it deleted so late joiners are rejected.
app.post('/api/rooms/delete', (req, res) => {
  const channel = req.body && req.body.channel;
  if (!channel) return res.status(400).json({ error: 'channel required' });
  deletedRooms.add(channel);
  activeRooms.delete(channel);
  res.json({ ok: true });
});

// Discovery / "Nearby" endpoint: returns currently live rooms.
app.get('/api/rooms', (req, res) => {
  const now = Date.now();
  const rooms = [];
  for (const [channel, room] of activeRooms) {
    if (now - room.lastSeen > ROOM_TTL) { activeRooms.delete(channel); continue; }
    rooms.push({ channel: room.channel, count: room.count, lastSeen: room.lastSeen, host: !!room.host });
  }
  rooms.sort((a, b) => b.lastSeen - a.lastSeen);
  res.json({ rooms });
});

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', appIdConfigured: !!APP_ID, certificateConfigured: !!APP_CERTIFICATE, activeRooms: activeRooms.size });
});

// APK downloads are hosted on the GitHub Release (artifacts), not on this server,
// to keep the VM disk usage low. See README for the download links.

app.listen(PORT, () => {
  console.log(`AgoraMeet token server running at http://localhost:${PORT}`);
});

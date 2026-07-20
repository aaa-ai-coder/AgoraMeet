// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const APP_ID = process.env.AGORA_APP_ID || "159c36b2c45148feaa15eb38843124cf";
const APP_CERTIFICATE = process.env.AGORA_CERTIFICATE || "04f7ae808a1d46df9858f7bc8df9f39c";

// Support JSON bodies and serve static frontend assets
app.use(express.json());
app.use(express.static('public'));

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

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', appIdConfigured: !!APP_ID, certificateConfigured: !!APP_CERTIFICATE });
});

// APK download route
app.get('/download-apk', (req, res) => {
  const apkPath = path.join(__dirname, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ error: 'APK not found. Build it with: cd android && ./gradlew assembleDebug' });
  }
  res.download(apkPath, 'AgoraMeet-debug.apk');
});

app.listen(PORT, () => {
  console.log(`AgoraMeet token server running at http://localhost:${PORT}`);
});

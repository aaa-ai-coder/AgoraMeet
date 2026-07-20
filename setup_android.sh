#!/usr/bin/env bash
# setup_android.sh
# Automates downloading and configuring a minimal Android SDK in Google Cloud Shell.

set -euo pipefail

SDK_DIR="$HOME/android-sdk"
CMD_LINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

echo "=== Setting up Android SDK ==="
mkdir -p "$SDK_DIR"

if [ ! -d "$SDK_DIR/cmdline-tools/latest" ]; then
  echo "Downloading Android Command Line Tools..."
  curl -L "$CMD_LINE_TOOLS_URL" -o "$SDK_DIR/cmdline-tools.zip"

  echo "Extracting tools..."
  unzip -q "$SDK_DIR/cmdline-tools.zip" -d "$SDK_DIR/tmp_extract"
  
  mkdir -p "$SDK_DIR/cmdline-tools/latest"
  mv "$SDK_DIR/tmp_extract/cmdline-tools"/* "$SDK_DIR/cmdline-tools/latest/"
  
  # Clean up temp files
  rm -rf "$SDK_DIR/tmp_extract" "$SDK_DIR/cmdline-tools.zip"
  echo "Command line tools configured."
else
  echo "Command line tools already present."
fi

# Set environmental variables for local session
export ANDROID_HOME="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"

echo "Accepting Android Licenses..."
yes | sdkmanager --licenses > /dev/null

echo "Installing Android SDK packages: Platform 34, Build Tools 34.0.0, Platform Tools..."
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" > /dev/null

echo "=== Android SDK setup complete! ==="

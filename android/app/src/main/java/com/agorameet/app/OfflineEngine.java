package com.agorameet.app;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;

public class OfflineEngine {
    private static final String TAG = "OfflineEngine";
    private static final String MODEL_DIR = "Download/ari-offline-models";
    private static OfflineEngine instance;

    private String modelPath;
    private boolean modelsAvailable;

    private OfflineEngine() {}

    public static synchronized OfflineEngine getInstance() {
        if (instance == null) instance = new OfflineEngine();
        return instance;
    }

    public void init(Context ctx) {
        File externalDir = Environment.getExternalStorageDirectory();
        File modelDir = new File(externalDir, MODEL_DIR);
        if (modelDir.exists() && modelDir.isDirectory()) {
            modelPath = modelDir.getAbsolutePath();
            modelsAvailable = true;
            Log.i(TAG, "Offline models found at: " + modelPath);
            // List available model files
            File[] files = modelDir.listFiles();
            if (files != null) {
                for (File f : files) {
                    Log.i(TAG, "  Model: " + f.getName() + " (" + f.length() / 1024 + "KB)");
                }
            }
        } else {
            modelsAvailable = false;
            Log.w(TAG, "No offline models at " + modelDir.getAbsolutePath());
        }
    }

    public String chat(String prompt) {
        if (!modelsAvailable) return null;
        // Load and run SmolLM2-135M or MobileLLM-125M via llama.cpp
        // For now, stub - returns simple response
        // The actual inference would use JNI to llama.cpp
        return fallbackChat(prompt);
    }

    private String fallbackChat(String prompt) {
        // When no connectivity, provide basic canned responses
        prompt = prompt.toLowerCase().trim();
        if (prompt.contains("hello") || prompt.contains("hi")) return "Hi! I'm Ari, your offline assistant.";
        if (prompt.contains("who are you")) return "I'm Ari, running completely offline on your device.";
        if (prompt.contains("help")) return "I can answer questions, set alarms, send messages, and control your device - all offline.";
        if (prompt.contains("time")) return java.text.DateFormat.getDateTimeInstance().format(new java.util.Date());
        return "I understand you said: \"" + prompt + "\". I'm running in offline mode with limited capabilities.";
    }

    public boolean isAvailable() { return modelsAvailable; }
    public String getModelPath() { return modelPath; }
}

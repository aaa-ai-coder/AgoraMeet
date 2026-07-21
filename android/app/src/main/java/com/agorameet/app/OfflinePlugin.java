package com.agorameet.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "Offline")
public class OfflinePlugin extends Plugin {

    @PluginMethod
    public void checkModels(PluginCall call) {
        OfflineEngine eng = OfflineEngine.getInstance();
        eng.init(getContext());
        call.resolve(new com.getcapacitor.JSObject()
            .put("available", eng.isAvailable())
            .put("path", eng.getModelPath() != null ? eng.getModelPath() : ""));
    }

    @PluginMethod
    public void chat(PluginCall call) {
        String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("prompt required");
            return;
        }
        OfflineEngine eng = OfflineEngine.getInstance();
        if (!eng.isAvailable()) {
            call.reject("models not available");
            return;
        }
        String reply = eng.chat(prompt);
        call.resolve(new com.getcapacitor.JSObject().put("reply", reply != null ? reply : ""));
    }
}

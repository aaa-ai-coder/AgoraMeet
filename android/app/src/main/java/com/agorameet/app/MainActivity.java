package com.agorameet.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import android.webkit.WebView;
import android.webkit.WebSettings;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        Bridge bridge = this.getBridge();
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            WebSettings settings = webView.getSettings();
            // Required for WebRTC camera/microphone access inside the WebView
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setDomStorageEnabled(true);
            webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        }
    }
}

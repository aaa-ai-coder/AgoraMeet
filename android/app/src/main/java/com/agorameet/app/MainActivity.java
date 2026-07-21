package com.agorameet.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import android.Manifest;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends BridgeActivity {
    private static final String[] PERMS = {
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.MODIFY_AUDIO_SETTINGS
    };
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        for (String p : PERMS) {
            if (ContextCompat.checkSelfPermission(this, p) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, PERMS, 1);
                break;
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        Bridge bridge = this.getBridge();
        if (bridge != null) {
            WebView wv = bridge.getWebView();
            if (wv != null) {
                WebSettings ws = wv.getSettings();
                ws.setJavaScriptCanOpenWindowsAutomatically(true);
                ws.setSupportMultipleWindows(true);
                wv.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                        // Open popups in the same webview (keeps OAuth in-app, no external browser)
                        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                        transport.setWebView(view);
                        resultMsg.sendToTarget();
                        return true;
                    }
                });
            }
        }
    }
}

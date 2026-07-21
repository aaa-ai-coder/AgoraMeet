package com.agorameet.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AdMob")
public class AdMobPlugin extends Plugin {

    @PluginMethod
    public void loadAd(PluginCall call) {
        AdMobManager.getInstance().preloadAd(getActivity());
        call.resolve();
    }

    @PluginMethod
    public void showAd(PluginCall call) {
        getBridge().getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                AdMobManager.getInstance().showAd(getActivity(), new AdMobManager.RewardListener() {
                    @Override
                    public void onRewarded(int amount) {
                        call.resolve(new com.getcapacitor.JSObject()
                            .put("rewarded", true)
                            .put("amount", amount));
                    }
                    @Override
                    public void onAdFailed(String error) {
                        call.reject(error);
                    }
                    @Override
                    public void onAdDismissed() {
                        // already resolved via onRewarded if rewarded
                        if (!call.getKeepAlive()) {
                            call.resolve(new com.getcapacitor.JSObject().put("dismissed", true));
                        }
                    }
                });
            }
        });
    }

    @PluginMethod
    public void isLoaded(PluginCall call) {
        call.resolve(new com.getcapacitor.JSObject()
            .put("loaded", AdMobManager.getInstance().isAdLoaded()));
    }
}

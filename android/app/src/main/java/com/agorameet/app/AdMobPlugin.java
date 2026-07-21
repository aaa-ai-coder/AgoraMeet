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
                final boolean[] resolved = {false};
                AdMobManager.getInstance().showAd(getActivity(), new AdMobManager.RewardListener() {
                    @Override
                    public void onRewarded(int amount) {
                        resolved[0] = true;
                        call.resolve(new com.getcapacitor.JSObject()
                            .put("rewarded", true)
                            .put("amount", amount));
                    }
                    @Override
                    public void onAdFailed(String error) {
                        resolved[0] = true;
                        call.reject(error);
                    }
                    @Override
                    public void onAdDismissed() {
                        if (!resolved[0]) {
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

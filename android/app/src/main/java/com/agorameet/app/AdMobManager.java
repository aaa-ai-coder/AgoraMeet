package com.agorameet.app;

import android.app.Activity;
import androidx.annotation.NonNull;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.initialization.InitializationStatus;
import com.google.android.gms.ads.initialization.OnInitializationCompleteListener;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

public class AdMobManager {
    private static AdMobManager instance;
    private RewardedAd rewardedAd;
    private boolean isLoaded;
    private RewardListener listener;

    public interface RewardListener {
        void onRewarded(int amount);
        void onAdFailed(String error);
        void onAdDismissed();
    }

    private AdMobManager() {}

    public static synchronized AdMobManager getInstance() {
        if (instance == null) instance = new AdMobManager();
        return instance;
    }

    public void init(final Activity activity) {
        MobileAds.initialize(activity, new OnInitializationCompleteListener() {
            @Override
            public void onInitializationComplete(InitializationStatus status) {
                preloadAd(activity);
            }
        });
    }

    public void preloadAd(final Activity activity) {
        if (isLoaded) return;
        AdRequest adRequest = new AdRequest.Builder().build();
        RewardedAd.load(activity, "ca-app-pub-5356761432305414/1633443576", adRequest,
            new RewardedAdLoadCallback() {
                @Override
                public void onAdLoaded(@NonNull RewardedAd ad) {
                    rewardedAd = ad;
                    isLoaded = true;
                }
                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError err) {
                    isLoaded = false;
                }
            });
    }

    public void showAd(final Activity activity, RewardListener l) {
        this.listener = l;
        if (rewardedAd == null) {
            preloadAd(activity);
            if (l != null) l.onAdFailed("Ad not ready");
            return;
        }
        rewardedAd.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdShowedFullScreenContent() {
                isLoaded = false;
            }
            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull AdError err) {
                if (listener != null) listener.onAdFailed(err.getMessage());
            }
            @Override
            public void onAdDismissedFullScreenContent() {
                rewardedAd = null;
                preloadAd(activity);
                if (listener != null) listener.onAdDismissed();
            }
        });
        rewardedAd.show(activity, new com.google.android.gms.ads.OnUserEarnedRewardListener() {
            @Override
            public void onUserEarnedReward(@NonNull RewardItem reward) {
                if (listener != null) listener.onRewarded(200);
            }
        });
    }

    public boolean isAdLoaded() { return isLoaded; }
}

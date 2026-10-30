package com.universityadmissioninfo.pathway;

import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.database.ContentObserver;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Matching tokens.css, so the first frame Android draws is already the right paper
    private static final int DAY_PAPER = 0xFFF2F3EE;
    private static final int NIGHT_PAPER = 0xFF18212B;

    // Where the Preferences plugin keeps the theme that theme.js saves
    private static final String PREFERENCES_GROUP = "CapacitorStorage";
    private static final String THEME_KEY = "theme";

    // The event motion.js listens for, carrying Android's "Remove animations" setting
    private static final String MOTION_EVENT = "pathwayMotion";

    // Watching "Remove animations", because the WebView reads it only when Pathway starts
    private ContentObserver motionObserver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        boolean dark = startsDark();
        int paper = dark ? NIGHT_PAPER : DAY_PAPER;
        Window window = getWindow();

        // Android 15 and newer draw behind the bars on their own; older versions have to be asked
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);

        // Before Android 8 the navigation buttons cannot turn dark, so the bar keeps its own colour there
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        window.getDecorView().setBackgroundColor(paper);
        if (getBridge() != null) {
            getBridge().getWebView().setBackgroundColor(paper);
        }

        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);

        motionObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                sendMotionSetting();
            }
        };
        Uri motionSetting = Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE);
        getContentResolver().registerContentObserver(motionSetting, false, motionObserver);
    }

    // Coming back to Pathway also reports the setting, in case it changed while Pathway was away
    @Override
    public void onResume() {
        super.onResume();
        sendMotionSetting();
    }

    @Override
    public void onDestroy() {
        if (motionObserver != null) {
            getContentResolver().unregisterContentObserver(motionObserver);
            motionObserver = null;
        }
        super.onDestroy();
    }

    // "Remove animations" sets the animation scale to 0, which Chrome also reads as reduced motion
    private void sendMotionSetting() {
        if (getBridge() == null) {
            return;
        }
        String name = Settings.Global.ANIMATOR_DURATION_SCALE;
        float scale = Settings.Global.getFloat(getContentResolver(), name, 1f);
        getBridge().triggerWindowJSEvent(MOTION_EVENT, "{ \"reduced\": " + (scale == 0f) + " }");
    }

    private boolean startsDark() {
        SharedPreferences preferences = getSharedPreferences(PREFERENCES_GROUP, MODE_PRIVATE);
        String choice = preferences.getString(THEME_KEY, "system");
        if ("dark".equals(choice)) {
            return true;
        }
        if ("light".equals(choice)) {
            return false;
        }
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night == Configuration.UI_MODE_NIGHT_YES;
    }
}

package tw.ynfly.rcsim;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class MainActivity extends Activity {
    private WebView web;
    private long lastSend = 0;
    // 傳給網頁的軸順序：X,Y,Z,RX,RY,RZ,THROTTLE,RUDDER,GAS,BRAKE,HAT_X,HAT_Y
    private static final int[] AXES = {
        MotionEvent.AXIS_X, MotionEvent.AXIS_Y, MotionEvent.AXIS_Z,
        MotionEvent.AXIS_RX, MotionEvent.AXIS_RY, MotionEvent.AXIS_RZ,
        MotionEvent.AXIS_THROTTLE, MotionEvent.AXIS_RUDDER,
        MotionEvent.AXIS_GAS, MotionEvent.AXIS_BRAKE,
        MotionEvent.AXIS_HAT_X, MotionEvent.AXIS_HAT_Y
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(0xFF000000);
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        hideSystemUi();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideSystemUi();
    }

    // USB 遙控器（搖桿模式）／手把 → 傳給網頁
    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        int src = ev.getSource();
        if ((src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
                && ev.getAction() == MotionEvent.ACTION_MOVE) {
            long now = SystemClock.uptimeMillis();
            if (now - lastSend >= 8) {
                lastSend = now;
                StringBuilder sb = new StringBuilder("window.__rcAxes&&__rcAxes([");
                for (int i = 0; i < AXES.length; i++) {
                    if (i > 0) sb.append(',');
                    sb.append(String.format(java.util.Locale.US, "%.4f", ev.getAxisValue(AXES[i])));
                }
                InputDevice d = ev.getDevice();
                String name = d != null ? d.getName().replace("\\", "").replace("'", "") : "";
                sb.append("],'").append(name).append("')");
                web.evaluateJavascript(sb.toString(), null);
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(ev);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); web.evaluateJavascript("document.getElementById('bMenu')&&document.getElementById('menu').classList.contains('show')||document.getElementById('bMenu').click()", null); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); hideSystemUi(); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){var m=document.getElementById('menu');if(m.classList.contains('show'))return 'exit';document.getElementById('bMenu').click();return 'menu';})()",
            v -> { if (v != null && v.contains("exit")) finish(); });
    }
}

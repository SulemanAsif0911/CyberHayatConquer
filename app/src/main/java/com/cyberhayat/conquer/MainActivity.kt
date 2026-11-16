package com.cyberhayat.conquer

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.security.MessageDigest

/**
 * Native shell around the web UI in assets/www (same format as the Nijah / NearCall apps).
 * The page talks to it through the `AndroidNative` bridge; the shell talks back through window.onNative(...).
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var insets = intArrayOf(0, 0, 0, 0)
    private var pageReady = false
    private var view: Locator? = null          // position dot while the app is on screen

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            js("window.onPerms&&onPerms(${Perms.hasLocation(this)})")
            if (Perms.hasLocation(this)) startView()
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        root = FrameLayout(this)
        root.setBackgroundColor(0xFF0A0A0A.toInt())
        web = WebView(this)
        web.setBackgroundColor(Color.TRANSPARENT)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val bars = ins.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = ins.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val d = resources.displayMetrics.density
            v.setPadding(0, 0, 0, ime)
            val bottom = if (ime > 0) 0 else bars.bottom
            insets = intArrayOf((bars.top / d).toInt(), (bars.right / d).toInt(), (bottom / d).toInt(), (bars.left / d).toInt())
            pushInsets()
            ins
        }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
            override fun onPageFinished(view: WebView, url: String) { pageReady = true; pushInsets() }
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        web.addJavascriptInterface(Bridge(), "AndroidNative")
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.onBack&&onBack())?1:0") { r -> if (r != "1") moveTaskToBack(true) }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        Bus.sink = { s -> runOnUiThread { js("window.onNative&&onNative($s)") } }
        if (Perms.hasLocation(this)) startView()
        if (pageReady) js("window.onNativeResume&&onNativeResume()")
    }

    override fun onPause() {
        Bus.sink = null
        view?.stop(); view = null
        super.onPause()
    }

    override fun onDestroy() { web.destroy(); super.onDestroy() }

    private fun js(code: String) { web.evaluateJavascript(code, null) }
    private fun pushInsets() { if (::web.isInitialized) js("window.CH_setInsets&&CH_setInsets(${insets[0]},${insets[1]},${insets[2]},${insets[3]})") }

    private fun startView() {
        if (view != null) return
        view = Locator(this, 40f, { f ->
            Bus.send("{\"t\":\"fix\",\"lat\":${f.lat},\"lng\":${f.lng},\"acc\":${"%.1f".format(java.util.Locale.US, f.acc)}}")
        }, { on -> Bus.send("{\"t\":\"gps\",\"on\":$on}") })
        view?.start()
    }

    inner class Bridge {
        @JavascriptInterface fun getInsets(): String = insets.joinToString(",")

        @JavascriptInterface fun deviceId(): String {
            val id = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"
            return MessageDigest.getInstance("SHA-256").digest(("conquer:$id").toByteArray()).joinToString("") { "%02x".format(it) }
        }

        @JavascriptInterface fun permStatus(): String = Perms.status(this@MainActivity)
        @JavascriptInterface fun hasPerms(): Boolean = Perms.hasLocation(this@MainActivity)

        /** loc | bg | notif | battery */
        @JavascriptInterface fun requestPerm(name: String) {
            runOnUiThread {
                try {
                    when (name) {
                        "loc" -> permLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        "bg" -> if (Build.VERSION.SDK_INT >= 29) permLauncher.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                        "notif" -> if (Build.VERSION.SDK_INT >= 33) permLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                        "battery" -> startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                    }
                } catch (e: Exception) {
                    try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
                }
            }
        }

        @JavascriptInterface fun openLocationSettings() {
            runOnUiThread { try { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) } catch (_: Exception) {} }
        }

        // ---- walk recording
        @JavascriptInterface fun recStart(): Boolean {
            if (!Perms.hasLocation(this@MainActivity)) return false
            TrackService.start(this@MainActivity); return true
        }
        @JavascriptInterface fun recActive(): Boolean = TrackService.prefs(this@MainActivity).getBoolean("rec", false) && TrackService.instance != null
        @JavascriptInterface fun recPoints(from: Int): String =
            TrackService.instance?.points(from) ?: try { TrackService.file(this@MainActivity).readText() } catch (e: Exception) { "[]" }
        @JavascriptInterface fun recStop() {
            TrackService.stop(this@MainActivity)
            TrackService.prefs(this@MainActivity).edit().putBoolean("rec", false).apply()
        }
        @JavascriptInterface fun recClear() {
            if (TrackService.instance != null) TrackService.discard = true
            recStop()
            try { TrackService.file(this@MainActivity).delete() } catch (_: Exception) {}
        }
        @JavascriptInterface fun keepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }
}

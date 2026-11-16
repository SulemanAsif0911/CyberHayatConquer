package com.cyberhayat.conquer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import java.io.File

/** Receives everything the service wants the page to see while the app is open. */
object Bus {
    @Volatile var sink: ((String) -> Unit)? = null
    fun send(json: String) { sink?.invoke(json) }
}

/**
 * Foreground service that keeps recording the walk with the screen off.
 * Accepted points are kept in memory and mirrored to files/walk.json, so a killed app can resume the walk.
 * Point = [lat, lng, tSec, accuracy, mock(0/1)].
 */
class TrackService : Service() {

    companion object {
        @Volatile var instance: TrackService? = null
        @Volatile var discard = false
        private const val CH = "cq_track"
        fun start(c: Context) {
            val i = Intent(c, TrackService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }
        fun stop(c: Context) { c.stopService(Intent(c, TrackService::class.java)) }
        fun file(c: Context) = File(c.filesDir, "walk.json")
        fun prefs(c: Context) = c.getSharedPreferences("conquer", Context.MODE_PRIVATE)
    }

    private val pts = ArrayList<DoubleArray>()
    private var loc: Locator? = null
    private var wl: PowerManager.WakeLock? = null
    private var lastKept: DoubleArray? = null
    private var sinceSave = 0

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        instance = this
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CH, "Recording a walk", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Conquer")
            .setContentText("Recording your walk. Tap to open.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(1, n)
        } catch (e: Exception) {
            stopSelf(); return START_NOT_STICKY
        }
        if (wl == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "conquer:walk").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        }
        if (pts.isEmpty()) restore()
        if (loc == null) {
            loc = Locator(this, 25f, { f -> onFix(f) }, { on -> Bus.send("{\"t\":\"gps\",\"on\":$on}") })
            loc?.start()
        }
        prefs(this).edit().putBoolean("rec", true).apply()
        return START_STICKY
    }

    private fun onFix(f: Locator.Fix) {
        val last = lastKept
        if (last != null) {
            val d = FloatArray(1)
            android.location.Location.distanceBetween(last[0], last[1], f.lat, f.lng, d)
            // stand-still jitter: keep a point only after 4 m of movement or 10 s
            if (d[0] < 4f && f.tSec - last[2] < 10) return
        }
        val p = doubleArrayOf(f.lat, f.lng, f.tSec.toDouble(), f.acc.toDouble(), if (f.mock) 1.0 else 0.0)
        synchronized(pts) { pts.add(p); lastKept = p; sinceSave++; if (sinceSave >= 15) save() }
        Bus.send("{\"t\":\"pt\",\"i\":${pts.size - 1},\"p\":${arr(p)}}")
    }

    private fun arr(p: DoubleArray) = "[${p[0]},${p[1]},${p[2].toLong()},${"%.1f".format(java.util.Locale.US, p[3])},${p[4].toInt()}]"

    fun points(from: Int): String = synchronized(pts) {
        val sb = StringBuilder("[")
        for (i in from until pts.size) { if (i > from) sb.append(','); sb.append(arr(pts[i])) }
        sb.append(']').toString()
    }

    private fun save() {
        sinceSave = 0
        try { file(this).writeText(points(0)) } catch (_: Exception) {}
    }

    private fun restore() {
        try {
            val f = file(this)
            if (!f.exists()) return
            val a = JSONArray(f.readText())
            for (i in 0 until a.length()) {
                val r = a.getJSONArray(i)
                pts.add(doubleArrayOf(r.getDouble(0), r.getDouble(1), r.getDouble(2), r.getDouble(3), r.getDouble(4)))
            }
            lastKept = pts.lastOrNull()
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        loc?.stop(); loc = null
        try { wl?.release() } catch (_: Exception) {}
        wl = null
        if (!discard) synchronized(pts) { save() }
        discard = false
        instance = null
        super.onDestroy()
    }
}

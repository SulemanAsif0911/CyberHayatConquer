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
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * "Guard mode": every 20 s asks the server whether anyone is walking inside your land and shows an alert.
 * Runs as a foreground service (a small ongoing notification) so Android keeps it alive with the app closed.
 */
class GuardService : Service() {

    companion object {
        private const val CH_LOW = "cq_guard"
        private const val CH_ALERT = "cq_alert"
        fun start(c: Context) {
            val i = Intent(c, GuardService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }
        fun stop(c: Context) { c.stopService(Intent(c, GuardService::class.java)) }
    }

    private var exec: ScheduledExecutorService? = null
    private val lastTs = HashMap<String, Long>()

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CH_LOW, "Guard mode", NotificationManager.IMPORTANCE_MIN))
            nm.createNotificationChannel(NotificationChannel(CH_ALERT, "Territory alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                enableVibration(true)
            })
        }
        val n = NotificationCompat.Builder(this, CH_LOW)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Conquer guard is on")
            .setContentText("Watching your territory.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(2, n)
        } catch (e: Exception) {
            stopSelf(); return START_NOT_STICKY
        }
        if (exec == null) {
            exec = Executors.newSingleThreadScheduledExecutor().also {
                it.scheduleWithFixedDelay({ poll() }, 3, 20, TimeUnit.SECONDS)
            }
        }
        TrackService.prefs(this).edit().putBoolean("guard", true).apply()
        return START_STICKY
    }

    private fun poll() {
        try {
            if (!Net.hasSession(this)) return
            val r = Net.post(this, JSONObject().put("action", "alerts")) ?: return
            if (!r.optBoolean("ok")) return
            val items = r.optJSONArray("items") ?: return
            Bus.send("{\"t\":\"alerts\",\"items\":$items}")
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            for (k in 0 until items.length()) {
                val a = items.getJSONObject(k)
                val id = a.optString("id")
                val ts = a.optLong("ts")
                if (ts <= (lastTs[id] ?: 0L)) continue
                val first = !lastTs.containsKey(id)
                lastTs[id] = ts
                val open = PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                val approx = if (a.optInt("approx") == 1) " (approximate spot)" else ""
                val note = NotificationCompat.Builder(this, CH_ALERT)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle("Someone is breaching your territory!")
                    .setContentText(a.optString("by") + " is inside your land right now$approx. Tap to see where.")
                    .setStyle(NotificationCompat.BigTextStyle().bigText(a.optString("by") + " is walking inside your conquered land$approx. Open the map and take it back."))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setOnlyAlertOnce(!first)            // first ping makes a sound, later pings only update the same alert
                    .setAutoCancel(true)
                    .setContentIntent(open)
                    .build()
                nm.notify(1000 + (id.hashCode() and 0xfff), note)
            }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        exec?.shutdownNow(); exec = null
        super.onDestroy()
    }
}

package com.cyberhayat.conquer

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import kotlin.math.sqrt

/**
 * GPS-only position source with the accuracy work done here, before anything reaches the map:
 *  1. only the GPS chip is used (network/cell positions are 50-2000 m off),
 *  2. fixes worse than maxAcc metres are dropped,
 *  3. physically impossible jumps (> 12 m/s between fixes) are dropped as multipath spikes,
 *  4. a Kalman filter blends the fixes, weighting each by its reported accuracy,
 *  5. mock-location apps are flagged so the server can refuse the walk.
 */
class Locator(
    private val ctx: Context,
    private val maxAcc: Float,
    private val onFix: (Fix) -> Unit,
    private val onGps: (Boolean) -> Unit
) {
    class Fix(val lat: Double, val lng: Double, val tSec: Long, val acc: Float, val mock: Boolean)

    private val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var started = false
    private var kLat = 0.0
    private var kLng = 0.0
    private var kVar = -1.0
    private var kTs = 0L
    private var lastRaw: Location? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(l: Location) { handle(l) }
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) { onGps(true) }
        override fun onProviderDisabled(provider: String) { onGps(false) }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (started) return
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
            started = true
            onGps(lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
        } catch (e: Exception) {
            onGps(false)
        }
    }

    fun stop() {
        if (!started) return
        try { lm.removeUpdates(listener) } catch (_: Exception) {}
        started = false
        kVar = -1.0
        lastRaw = null
    }

    private fun isMock(l: Location): Boolean =
        if (Build.VERSION.SDK_INT >= 31) l.isMock else @Suppress("DEPRECATION") l.isFromMockProvider

    private fun handle(l: Location) {
        if (!l.hasAccuracy() || l.accuracy > maxAcc) return
        val prev = lastRaw
        if (prev != null) {
            val dt = (l.time - prev.time) / 1000.0
            if (dt <= 0.0) return
            if (prev.distanceTo(l) / dt > 12.0 && dt < 30.0) return   // spike, keep the previous fix
        }
        lastRaw = l
        val acc = maxOf(l.accuracy, 1f).toDouble()
        if (kVar < 0) {
            kLat = l.latitude; kLng = l.longitude; kVar = acc * acc; kTs = l.time
        } else {
            val dtMs = l.time - kTs
            if (dtMs > 0) { kVar += dtMs * 3.0 * 3.0 / 1000.0; kTs = l.time }   // walker may move ~3 m/s
            val k = kVar / (kVar + acc * acc)
            kLat += k * (l.latitude - kLat)
            kLng += k * (l.longitude - kLng)
            kVar = (1 - k) * kVar
        }
        onFix(Fix(kLat, kLng, l.time / 1000, sqrt(kVar).toFloat(), isMock(l)))
    }
}

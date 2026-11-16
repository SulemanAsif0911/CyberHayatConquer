package com.cyberhayat.conquer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

object Perms {
    fun has(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED
    fun hasLocation(c: Context) = has(c, Manifest.permission.ACCESS_FINE_LOCATION)
    fun hasBackground(c: Context) = Build.VERSION.SDK_INT < 29 || has(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    fun hasNotifications(c: Context) = Build.VERSION.SDK_INT < 33 || has(c, Manifest.permission.POST_NOTIFICATIONS)
    fun batteryOk(c: Context): Boolean =
        (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName)

    fun status(c: Context): String = JSONObject()
        .put("loc", hasLocation(c)).put("bg", hasBackground(c))
        .put("notif", hasNotifications(c)).put("battery", batteryOk(c))
        .put("sdk", Build.VERSION.SDK_INT).toString()
}

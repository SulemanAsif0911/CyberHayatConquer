package com.cyberhayat.conquer

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to the Apps Script database from native code, so the 20-second ping and the breach polling keep working
 * with the screen off. The page hands over the session once through AndroidNative.setSession(...).
 * Apps Script answers a POST with a redirect; HttpURLConnection follows it.
 */
object Net {
    fun saveSession(c: Context, url: String, secret: String, uid: String, token: String) {
        TrackService.prefs(c).edit().putString("url", url).putString("secret", secret).putString("uid", uid).putString("token", token).apply()
    }

    fun hasSession(c: Context): Boolean {
        val p = TrackService.prefs(c)
        return !p.getString("url", "").isNullOrEmpty() && !p.getString("uid", "").isNullOrEmpty()
    }

    fun post(c: Context, body: JSONObject): JSONObject? {
        val p = TrackService.prefs(c)
        val url = p.getString("url", "") ?: ""
        if (url.isEmpty()) return null
        return try {
            body.put("secret", p.getString("secret", "")).put("uid", p.getString("uid", "")).put("token", p.getString("token", ""))
            val con = URL(url).openConnection() as HttpURLConnection
            con.requestMethod = "POST"
            con.connectTimeout = 10000
            con.readTimeout = 20000
            con.doOutput = true
            con.setRequestProperty("Content-Type", "text/plain;charset=utf-8")
            con.outputStream.use { it.write(body.toString().toByteArray()) }
            val txt = con.inputStream.bufferedReader().use { it.readText() }
            con.disconnect()
            JSONObject(txt)
        } catch (e: Exception) {
            null
        }
    }
}

package net.aurboda

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object CredentialsManager {
    private const val TAG = "CredentialsManager"
    private const val PREFS_NAME = "AurbodaSecurePrefs"
    private const val KEY_SERVER_URL = "serverUrl"
    private const val KEY_USERNAME = "username"
    private const val KEY_AUTH_TOKEN = "authToken"

    private fun getEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    data class Credentials(
        val serverUrl: String,
        val username: String,
        val authToken: String
    )

    fun saveCredentials(context: Context, serverUrl: String, username: String, token: String) {
        Log.d(TAG, "Saving credentials for user: $username, server: $serverUrl")
        getEncryptedPrefs(context).edit().apply {
            putString(KEY_SERVER_URL, serverUrl)
            putString(KEY_USERNAME, username)
            putString(KEY_AUTH_TOKEN, token)
            apply()
        }
    }

    fun getCredentials(context: Context): Credentials? {
        val prefs = getEncryptedPrefs(context)
        val serverUrl = prefs.getString(KEY_SERVER_URL, null)
        val username = prefs.getString(KEY_USERNAME, null)
        val token = prefs.getString(KEY_AUTH_TOKEN, null)

        return if (serverUrl != null && username != null && token != null) {
            Log.d(TAG, "Loaded credentials for user: $username")
            Credentials(serverUrl, username, token)
        } else {
            Log.d(TAG, "No credentials found")
            null
        }
    }

    fun clearCredentials(context: Context) {
        Log.d(TAG, "Clearing credentials")
        getEncryptedPrefs(context).edit().clear().apply()
    }

    fun hasCredentials(context: Context): Boolean {
        return getCredentials(context) != null
    }
}

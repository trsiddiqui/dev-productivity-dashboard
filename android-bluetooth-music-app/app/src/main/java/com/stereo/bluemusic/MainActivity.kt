package com.stereo.bluemusic

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.stereo.bluemusic.data.CapturedSong
import com.stereo.bluemusic.data.SongRepository
import com.stereo.bluemusic.service.FloatingSongButtonService
import com.stereo.bluemusic.share.SongListShare

class MainActivity : ComponentActivity() {
    private var songs by mutableStateOf<List<CapturedSong>>(emptyList())
    private var hasOverlayPermission by mutableStateOf(false)
    private var hasNotificationAccess by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()

        setContent {
            MaterialTheme {
                MainScreen(
                    songs = songs,
                    hasOverlayPermission = hasOverlayPermission,
                    hasNotificationAccess = hasNotificationAccess,
                    onGrantOverlay = ::openOverlaySettings,
                    onGrantNotificationAccess = ::openNotificationListenerSettings,
                    onStartOverlay = ::startOverlayService,
                    onStopOverlay = ::stopOverlayService,
                    onOpenList = ::openSongList,
                    onShareList = { SongListShare.shareViaBluetooth(this) }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshState()
    }

    private fun refreshState() {
        songs = SongRepository.list(this)
        hasOverlayPermission = Settings.canDrawOverlays(this)
        hasNotificationAccess = notificationListenerEnabled()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_POST_NOTIFICATIONS)
    }

    private fun startOverlayService() {
        if (!Settings.canDrawOverlays(this)) {
            openOverlaySettings()
            return
        }

        val intent = Intent(this, FloatingSongButtonService::class.java)
        startForegroundService(intent)
    }

    private fun stopOverlayService() {
        stopService(Intent(this, FloatingSongButtonService::class.java))
    }

    private fun openSongList() {
        startActivity(Intent(this, SongListActivity::class.java))
    }

    private fun openOverlaySettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun openNotificationListenerSettings() {
        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun notificationListenerEnabled(): Boolean {
        val enabledListeners = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        ).orEmpty()
        return enabledListeners.contains(packageName, ignoreCase = true)
    }

    private companion object {
        const val REQUEST_POST_NOTIFICATIONS = 2001
    }
}

@Composable
private fun MainScreen(
    songs: List<CapturedSong>,
    hasOverlayPermission: Boolean,
    hasNotificationAccess: Boolean,
    onGrantOverlay: () -> Unit,
    onGrantNotificationAccess: () -> Unit,
    onStartOverlay: () -> Unit,
    onStopOverlay: () -> Unit,
    onOpenList: () -> Unit,
    onShareList: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Song Catcher Overlay", style = MaterialTheme.typography.headlineSmall)
        Text("Tap the floating button to save the current song. Hold it to open the saved list.")

        PermissionRow(
            title = "Overlay permission",
            granted = hasOverlayPermission,
            actionLabel = "Grant",
            onClick = onGrantOverlay
        )
        PermissionRow(
            title = "Song metadata access",
            granted = hasNotificationAccess,
            actionLabel = "Grant",
            onClick = onGrantNotificationAccess
        )

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onStartOverlay) { Text("Start Floating Button") }
            Button(onClick = onStopOverlay) { Text("Stop") }
            Button(onClick = onOpenList) { Text("Open List") }
            Button(onClick = onShareList) { Text("Share via Bluetooth") }
        }

        HorizontalDivider()
        Text("Captured songs (${songs.size})", style = MaterialTheme.typography.titleMedium)

        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(songs.asReversed()) { song ->
                SongRow(song)
            }
        }
    }
}

@Composable
private fun PermissionRow(
    title: String,
    granted: Boolean,
    actionLabel: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("$title: ${if (granted) "Granted" else "Needed"}")
        if (!granted) {
            Button(onClick = onClick) { Text(actionLabel) }
        }
    }
}

@Composable
private fun SongRow(song: CapturedSong) {
    Column {
        Text(song.label(), style = MaterialTheme.typography.bodyLarge)
        Text(
            listOf(song.album, song.sourcePackage).filter { it.isNotBlank() }.joinToString(" | "),
            style = MaterialTheme.typography.bodySmall
        )
    }
}

package com.stereo.bluemusic

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.stereo.bluemusic.data.Song
import com.stereo.bluemusic.service.MediaSessionBridgeService

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    private var mediaBridge: MediaSessionBridgeService? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            mediaBridge = (binder as MediaSessionBridgeService.LocalBinder).service()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            mediaBridge = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bindService(Intent(this, MediaSessionBridgeService::class.java), connection, Context.BIND_AUTO_CREATE)

        setContent {
            val ui by vm.uiState.collectAsState()
            MaterialTheme {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Text("Blue Stereo Music", style = MaterialTheme.typography.headlineSmall)
                    Text("Bluetooth: ${ui.connectedDevice}")
                    Text("Now Playing: ${ui.song.title} - ${ui.song.artist}")

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        Button(onClick = { mediaBridge?.previous() }) { Text("Prev") }
                        Button(onClick = { mediaBridge?.playPause() }) { Text("Play/Pause") }
                        Button(onClick = { mediaBridge?.next() }) { Text("Next") }
                        Button(onClick = { vm.toggleFavorite() }) { Text("Favourite") }
                        Button(onClick = { vm.addCurrentToPlaylist() }) { Text("+ Playlist") }
                    }

                    Text("Equalizer")
                    EqSlider("Bass", ui.bassBoost) { vm.setEq(bass = it) }
                    EqSlider("Mid", ui.midBoost) { vm.setEq(mid = it) }
                    EqSlider("Treble", ui.trebleBoost) { vm.setEq(treble = it) }

                    Text("Quick Play History")
                    ui.history.ifEmpty { ui.playlist.take(3) }.forEach { song ->
                        Button(
                            onClick = { vm.addToHistory(song) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("${song.title} • ${song.artist}")
                        }
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unbindService(connection)
    }
}

@androidx.compose.runtime.Composable
private fun EqSlider(title: String, value: Float, onValueChanged: (Float) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(title, modifier = Modifier.padding(end = 10.dp))
        Slider(value = value, onValueChange = onValueChanged, modifier = Modifier.weight(1f))
    }
}

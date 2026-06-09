package com.stereo.bluemusic

import android.os.Bundle
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.stereo.bluemusic.data.CapturedSong
import com.stereo.bluemusic.data.SongRepository
import com.stereo.bluemusic.share.SongListShare

class SongListActivity : ComponentActivity() {
    private var songs by mutableStateOf<List<CapturedSong>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                SongListScreen(
                    songs = songs,
                    onShare = { SongListShare.shareViaBluetooth(this) },
                    onClear = {
                        SongRepository.clear(this)
                        songs = emptyList()
                    },
                    onClose = { finish() }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        songs = SongRepository.list(this)
    }
}

@Composable
private fun SongListScreen(
    songs: List<CapturedSong>,
    onShare: () -> Unit,
    onClear: () -> Unit,
    onClose: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Saved Songs", style = MaterialTheme.typography.headlineSmall)

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onShare) { Text("Share via Bluetooth") }
            Button(onClick = onClear) { Text("Clear List") }
            Button(onClick = onClose) { Text("Close") }
        }

        HorizontalDivider()

        if (songs.isEmpty()) {
            Text("No songs captured yet.")
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(songs.asReversed()) { song ->
                    Column {
                        Text(song.label(), style = MaterialTheme.typography.titleMedium)
                        val details = listOf(song.album, song.sourcePackage)
                            .filter { it.isNotBlank() }
                            .joinToString(" | ")
                        if (details.isNotBlank()) {
                            Text(details, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

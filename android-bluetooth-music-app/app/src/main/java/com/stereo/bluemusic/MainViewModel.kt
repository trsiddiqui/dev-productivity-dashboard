package com.stereo.bluemusic

import androidx.lifecycle.ViewModel
import com.stereo.bluemusic.data.PlayerUiState
import com.stereo.bluemusic.data.Song
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(
        PlayerUiState(
            connectedDevice = "Pair your phone to stereo Bluetooth",
            playlist = demoSongs()
        )
    )
    val uiState: StateFlow<PlayerUiState> = _uiState

    fun toggleFavorite() {
        _uiState.update { state ->
            val id = state.song.id
            val updated = if (state.favorites.contains(id)) state.favorites - id else state.favorites + id
            state.copy(favorites = updated)
        }
    }

    fun addCurrentToPlaylist() {
        _uiState.update { it.copy(playlist = it.playlist + it.song) }
    }

    fun addToHistory(song: Song) {
        _uiState.update { it.copy(history = listOf(song) + it.history.take(19), song = song) }
    }

    fun setEq(bass: Float? = null, mid: Float? = null, treble: Float? = null) {
        _uiState.update {
            it.copy(
                bassBoost = bass ?: it.bassBoost,
                midBoost = mid ?: it.midBoost,
                trebleBoost = treble ?: it.trebleBoost
            )
        }
    }

    private fun demoSongs() = listOf(
        Song("1", "Drive Mode", "Road Artist", "Car Vibes", "03:24"),
        Song("2", "Night Highway", "Synth Rider", "Neon Routes", "04:08"),
        Song("3", "Traffic Flow", "Dash Beats", "Morning Ride", "02:59")
    )
}

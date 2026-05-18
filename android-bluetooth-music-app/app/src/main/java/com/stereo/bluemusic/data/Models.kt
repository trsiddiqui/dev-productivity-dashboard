package com.stereo.bluemusic.data

data class Song(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: String
)

data class PlayerUiState(
    val connectedDevice: String = "No BT device",
    val song: Song = Song("0", "Waiting for media", "Bluetooth source", "", "--:--"),
    val isPlaying: Boolean = false,
    val favorites: Set<String> = emptySet(),
    val playlist: List<Song> = emptyList(),
    val history: List<Song> = emptyList(),
    val bassBoost: Float = 0.5f,
    val trebleBoost: Float = 0.5f,
    val midBoost: Float = 0.5f
)

package com.stereo.bluemusic.data

import org.json.JSONObject

data class CapturedSong(
    val title: String,
    val artist: String,
    val album: String,
    val sourcePackage: String,
    val capturedAtEpochMillis: Long
) {
    fun label(): String = when {
        title.isBlank() && artist.isBlank() -> "Unknown song"
        artist.isBlank() -> title
        title.isBlank() -> artist
        else -> "$title - $artist"
    }

    fun toJsonLine(): String = JSONObject()
        .put("title", title)
        .put("artist", artist)
        .put("album", album)
        .put("sourcePackage", sourcePackage)
        .put("capturedAtEpochMillis", capturedAtEpochMillis)
        .toString()

    companion object {
        fun fromJsonLine(line: String): CapturedSong? = runCatching {
            val json = JSONObject(line)
            CapturedSong(
                title = json.optString("title"),
                artist = json.optString("artist"),
                album = json.optString("album"),
                sourcePackage = json.optString("sourcePackage"),
                capturedAtEpochMillis = json.optLong("capturedAtEpochMillis")
            )
        }.getOrNull()
    }
}

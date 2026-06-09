package com.stereo.bluemusic.media

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import com.stereo.bluemusic.data.CapturedSong
import com.stereo.bluemusic.service.SongNotificationListenerService

object NowPlayingReader {
    data class CaptureResult(
        val song: CapturedSong?,
        val message: String
    )

    fun capture(context: Context): CaptureResult {
        val manager = context.getSystemService(MediaSessionManager::class.java)
            ?: return CaptureResult(null, "Media session manager is unavailable")

        val listener = ComponentName(context, SongNotificationListenerService::class.java)
        val controllers = try {
            manager.getActiveSessions(listener)
        } catch (e: SecurityException) {
            return CaptureResult(null, "Grant notification access so the app can read active song metadata")
        }

        val controller = controllers.firstOrNull { it.hasUsableMetadata() && it.isActivelyPlaying() }
            ?: controllers.firstOrNull { it.hasUsableMetadata() }
            ?: return CaptureResult(null, "No active song metadata found")

        val metadata = controller.metadata
            ?: return CaptureResult(null, "No active song metadata found")

        val title = metadata.text(MediaMetadata.METADATA_KEY_TITLE)
            .ifBlank { metadata.text(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) }
            .ifBlank { metadata.description.title?.toString().orEmpty() }

        val artist = metadata.text(MediaMetadata.METADATA_KEY_ARTIST)
            .ifBlank { metadata.text(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) }
            .ifBlank { metadata.description.subtitle?.toString().orEmpty() }

        val album = metadata.text(MediaMetadata.METADATA_KEY_ALBUM)

        if (title.isBlank() && artist.isBlank()) {
            return CaptureResult(null, "The active player did not expose a readable title or artist")
        }

        val song = CapturedSong(
            title = title.ifBlank { "Unknown title" },
            artist = artist,
            album = album,
            sourcePackage = controller.packageName.orEmpty(),
            capturedAtEpochMillis = System.currentTimeMillis()
        )

        return CaptureResult(song, "Added ${song.label()}")
    }

    private fun MediaController.hasUsableMetadata(): Boolean {
        val metadata = metadata ?: return false
        return metadata.text(MediaMetadata.METADATA_KEY_TITLE).isNotBlank() ||
            metadata.text(MediaMetadata.METADATA_KEY_DISPLAY_TITLE).isNotBlank() ||
            metadata.description.title?.isNotBlank() == true
    }

    private fun MediaController.isActivelyPlaying(): Boolean {
        val state = playbackState?.state ?: return false
        return state == PlaybackState.STATE_PLAYING ||
            state == PlaybackState.STATE_BUFFERING ||
            state == PlaybackState.STATE_CONNECTING
    }

    private fun MediaMetadata.text(key: String): String = getString(key).orEmpty()
}

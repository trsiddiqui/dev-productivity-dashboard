package com.stereo.bluemusic.data

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object SongRepository {
    private const val STORE_FILE = "captured_songs.jsonl"

    fun add(context: Context, song: CapturedSong) {
        storeFile(context).appendText(song.toJsonLine() + "\n", Charsets.UTF_8)
    }

    fun list(context: Context): List<CapturedSong> {
        val file = storeFile(context)
        if (!file.exists()) return emptyList()
        return file.readLines(Charsets.UTF_8).mapNotNull(CapturedSong::fromJsonLine)
    }

    fun clear(context: Context) {
        val file = storeFile(context)
        if (file.exists()) file.delete()
    }

    fun exportTextFile(context: Context): File {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val timestamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = File(dir, "captured-songs-$timestamp.txt")
        file.writeText(formatForExport(list(context)), Charsets.UTF_8)
        return file
    }

    fun formatForExport(songs: List<CapturedSong>): String {
        if (songs.isEmpty()) return "No songs captured yet.\n"

        val capturedAtFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        return buildString {
            appendLine("Captured songs")
            appendLine()
            songs.forEachIndexed { index, song ->
                append(index + 1)
                append(". ")
                appendLine(song.label())
                if (song.album.isNotBlank()) appendLine("   Album: ${song.album}")
                if (song.sourcePackage.isNotBlank()) appendLine("   Source: ${song.sourcePackage}")
                appendLine("   Captured: ${capturedAtFormat.format(Date(song.capturedAtEpochMillis))}")
                appendLine()
            }
        }
    }

    private fun storeFile(context: Context): File = File(context.filesDir, STORE_FILE)
}

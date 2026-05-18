package com.stereo.bluemusic.service

import android.app.Service
import android.content.Intent
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.os.Binder
import android.os.IBinder

class MediaSessionBridgeService : Service() {
    private val binder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun service(): MediaSessionBridgeService = this@MediaSessionBridgeService
    }

    private fun activeController(): MediaController? {
        val manager = getSystemService(MediaSessionManager::class.java)
        return manager?.getActiveSessions(null)?.firstOrNull()
    }

    fun playPause() {
        val transport = activeController()?.transportControls ?: return
        val state = activeController()?.playbackState?.state
        if (state == android.media.session.PlaybackState.STATE_PLAYING) transport.pause() else transport.play()
    }

    fun next() = activeController()?.transportControls?.skipToNext()

    fun previous() = activeController()?.transportControls?.skipToPrevious()

    override fun onBind(intent: Intent?): IBinder = binder
}

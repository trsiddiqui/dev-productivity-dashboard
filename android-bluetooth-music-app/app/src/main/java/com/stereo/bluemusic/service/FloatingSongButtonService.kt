package com.stereo.bluemusic.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import com.stereo.bluemusic.MainActivity
import com.stereo.bluemusic.SongListActivity
import com.stereo.bluemusic.data.SongRepository
import com.stereo.bluemusic.media.NowPlayingReader
import kotlin.math.roundToInt

class FloatingSongButtonService : Service() {
    private var windowManager: WindowManager? = null
    private var buttonView: View? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, foregroundNotification())

        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Grant overlay permission to show the floating button", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }

        addFloatingButton()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        buttonView?.let { view ->
            runCatching { windowManager?.removeView(view) }
        }
        buttonView = null
        windowManager = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun addFloatingButton() {
        if (buttonView != null) return

        val size = 64.dp()
        val button = TextView(this).apply {
            text = "+"
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            contentDescription = "Save current song"
            elevation = 10.dp().toFloat()
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(25, 118, 210))
            }
            setOnClickListener { saveCurrentSong() }
            setOnLongClickListener {
                performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                openSongList()
                true
            }
        }

        val params = WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 18.dp()
            y = 120.dp()
        }

        windowManager = getSystemService(WindowManager::class.java)
        windowManager?.addView(button, params)
        buttonView = button
    }

    private fun saveCurrentSong() {
        val result = NowPlayingReader.capture(this)
        val song = result.song
        if (song == null) {
            Toast.makeText(this, result.message, Toast.LENGTH_LONG).show()
            return
        }

        SongRepository.add(this, song)
        Toast.makeText(this, result.message, Toast.LENGTH_SHORT).show()
    }

    private fun openSongList() {
        val intent = Intent(this, SongListActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(intent)
    }

    private fun foregroundNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Song Catcher Overlay",
                NotificationManager.IMPORTANCE_LOW
            )
        )

        val activityIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Song Catcher is running")
            .setContentText("Tap the floating button to save the current song.")
            .setSmallIcon(android.R.drawable.ic_menu_add)
            .setContentIntent(activityIntent)
            .setOngoing(true)
            .build()
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).roundToInt()

    private companion object {
        const val CHANNEL_ID = "song_catcher_overlay"
        const val NOTIFICATION_ID = 1001
    }
}

package com.stereo.bluemusic.share

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import androidx.core.content.FileProvider
import com.stereo.bluemusic.data.SongRepository

object SongListShare {
    fun shareViaBluetooth(activity: Activity) {
        val file = SongRepository.exportTextFile(activity)
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            file
        )

        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Captured song list")
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        val bluetoothTarget = bluetoothTarget(activity.packageManager, sendIntent)
        if (bluetoothTarget != null) {
            activity.grantUriPermission(
                bluetoothTarget.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            sendIntent.setClassName(
                bluetoothTarget.activityInfo.packageName,
                bluetoothTarget.activityInfo.name
            )
            activity.startActivity(sendIntent)
            return
        }

        activity.startActivity(Intent.createChooser(sendIntent, "Share song list"))
    }

    private fun bluetoothTarget(packageManager: PackageManager, intent: Intent): ResolveInfo? {
        return queryShareTargets(packageManager, intent).firstOrNull { target ->
            val packageName = target.activityInfo.packageName
            val label = target.loadLabel(packageManager).toString()
            packageName.contains("bluetooth", ignoreCase = true) ||
                label.contains("Bluetooth", ignoreCase = true)
        }
    }

    private fun queryShareTargets(packageManager: PackageManager, intent: Intent): List<ResolveInfo> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                intent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }
    }
}

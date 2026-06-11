package ai.ivrit.offlinehebrew

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class TranscriptionForegroundService : Service() {

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val status = intent.getStringExtra(EXTRA_STATUS) ?: "Transcribing"
                startForeground(NOTIFICATION_ID, buildNotification(status, 0))
            }
            ACTION_PROGRESS -> {
                val status = intent.getStringExtra(EXTRA_STATUS) ?: "Transcribing"
                val progress = intent.getIntExtra(EXTRA_PROGRESS, 0).coerceIn(0, 100)
                val notification = buildNotification(status, progress)
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID, notification)
            }
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }

        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Offline Transcription",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows progress for offline Hebrew transcription"
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(status: String, progress: Int): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Offline Hebrew Transcription")
            .setContentText(status)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, progress, progress <= 0)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "offline_transcription_channel"
        private const val NOTIFICATION_ID = 4011

        const val ACTION_START = "ai.ivrit.offlinehebrew.action.START"
        const val ACTION_PROGRESS = "ai.ivrit.offlinehebrew.action.PROGRESS"
        const val ACTION_STOP = "ai.ivrit.offlinehebrew.action.STOP"

        const val EXTRA_STATUS = "status"
        const val EXTRA_PROGRESS = "progress"

        fun startIntent(context: Context, status: String): Intent =
            Intent(context, TranscriptionForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_STATUS, status)
            }

        fun progressIntent(context: Context, status: String, progress: Int): Intent =
            Intent(context, TranscriptionForegroundService::class.java).apply {
                action = ACTION_PROGRESS
                putExtra(EXTRA_STATUS, status)
                putExtra(EXTRA_PROGRESS, progress)
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, TranscriptionForegroundService::class.java).apply {
                action = ACTION_STOP
            }
    }
}

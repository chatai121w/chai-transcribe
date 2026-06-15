package ai.ivrit.offlinehebrew

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

class MicRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    fun isRecording(): Boolean = recorder != null

    fun start(): File {
        check(recorder == null) { "Recorder already running" }

        val file = File(context.cacheDir, "recording-${System.currentTimeMillis()}.m4a")
        val mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        mediaRecorder.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioEncodingBitRate(128_000)
            setAudioSamplingRate(44_100)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }

        recorder = mediaRecorder
        outputFile = file
        return file
    }

    fun stop(): File {
        val r = recorder ?: error("Recorder is not running")
        try {
            r.stop()
        } finally {
            r.reset()
            r.release()
            recorder = null
        }

        return requireNotNull(outputFile).also { outputFile = null }
    }

    fun cancel() {
        val r = recorder ?: return
        try {
            r.stop()
        } catch (_: Throwable) {
            // Ignore stop error when recording is too short.
        } finally {
            r.reset()
            r.release()
            recorder = null
            outputFile?.delete()
            outputFile = null
        }
    }
}

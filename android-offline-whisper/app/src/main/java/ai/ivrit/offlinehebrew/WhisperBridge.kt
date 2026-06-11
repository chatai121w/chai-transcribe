package ai.ivrit.offlinehebrew

object WhisperBridge {
    init {
        System.loadLibrary("whisper_jni")
    }

    @Volatile
    private var progressListener: ((Int) -> Unit)? = null

    fun setProgressListener(listener: ((Int) -> Unit)?) {
        progressListener = listener
    }

    @JvmStatic
    private fun onNativeProgress(percent: Int) {
        progressListener?.invoke(percent.coerceIn(0, 100))
    }

    external fun initModel(modelPath: String): Boolean

    external fun transcribeWav(
        wavPath: String,
        language: String,
        translate: Boolean
    ): String

    external fun cancel()

    external fun release()
}

package ai.ivrit.offlinehebrew

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

class ModelManager(private val context: Context) {
    private val modelsDir: File = File(context.filesDir, "models").apply { mkdirs() }

    fun modelFile(preset: ModelPreset): File = File(modelsDir, preset.fileName)

    fun modelFileByName(fileName: String): File = File(modelsDir, fileName)

    fun isInstalled(preset: ModelPreset): Boolean = modelFile(preset).exists()

    fun installedModelFiles(): List<File> = modelsDir
        .listFiles()
        .orEmpty()
        .filter { it.isFile && it.name.endsWith(".bin", ignoreCase = true) }
        .sortedBy { it.name }

    suspend fun downloadModel(
        preset: ModelPreset,
        onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val target = modelFile(preset)
        val temp = File(modelsDir, "${preset.fileName}.part")

        val connection = URL(preset.downloadUrl).openConnection()
        connection.connect()
        val total = connection.contentLengthLong.coerceAtLeast(0L)

        connection.getInputStream().use { input ->
            temp.outputStream().use { out ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var downloaded = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    out.write(buffer, 0, read)
                    downloaded += read
                    onProgress(downloaded, total)
                }
            }
        }

        if (target.exists()) target.delete()
        temp.renameTo(target)
        target
    }

    suspend fun importModel(modelUri: Uri): File = withContext(Dispatchers.IO) {
        val docName = DocumentFile.fromSingleUri(context, modelUri)?.name
        val fallbackName = "imported-${System.currentTimeMillis()}.bin"
        val finalName = when {
            docName.isNullOrBlank() -> fallbackName
            docName.endsWith(".bin", ignoreCase = true) -> docName
            else -> "$docName.bin"
        }

        val target = modelFileByName(finalName)

        context.contentResolver.openInputStream(modelUri).use { input ->
            requireNotNull(input) { "Unable to open model Uri" }
            target.outputStream().use { output ->
                input.copyTo(output)
            }
        }

        target
    }
}

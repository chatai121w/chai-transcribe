package ai.ivrit.offlinehebrew

enum class QualityProfile {
    FAST,
    BALANCED,
    ACCURATE
}

data class ModelPreset(
    val id: String,
    val fileName: String,
    val label: String,
    val qualityProfile: QualityProfile,
    val estimatedSizeMb: Int,
    val downloadUrl: String,
    val expectedSha256: String? = null
)

object WhisperModelCatalog {
    val presets: List<ModelPreset> = listOf(
        ModelPreset(
            id = "tiny",
            fileName = "ggml-tiny.bin",
            label = "Fast (tiny)",
            qualityProfile = QualityProfile.FAST,
            estimatedSizeMb = 75,
            downloadUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
        ),
        ModelPreset(
            id = "base",
            fileName = "ggml-base.bin",
            label = "Fast/Balanced (base)",
            qualityProfile = QualityProfile.FAST,
            estimatedSizeMb = 142,
            downloadUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
        ),
        ModelPreset(
            id = "small",
            fileName = "ggml-small.bin",
            label = "Balanced (small)",
            qualityProfile = QualityProfile.BALANCED,
            estimatedSizeMb = 466,
            downloadUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
        ),
        ModelPreset(
            id = "medium",
            fileName = "ggml-medium.bin",
            label = "Accurate (medium)",
            qualityProfile = QualityProfile.ACCURATE,
            estimatedSizeMb = 1500,
            downloadUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
        ),
        ModelPreset(
            id = "large-v3",
            fileName = "ggml-large-v3.bin",
            label = "Accurate+ (large-v3)",
            qualityProfile = QualityProfile.ACCURATE,
            estimatedSizeMb = 3100,
            downloadUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"
        )
    )

    fun byId(id: String): ModelPreset? = presets.firstOrNull { it.id == id }

    fun byFileName(fileName: String): ModelPreset? = presets.firstOrNull { it.fileName == fileName }
}

data class TranscriptionSegment(
    val startMs: Long,
    val endMs: Long,
    val text: String
)

data class TranscriptionResult(
    val text: String,
    val segments: List<TranscriptionSegment>,
    val language: String,
    val canceled: Boolean
)

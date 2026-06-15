package ai.ivrit.offlinehebrew

import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class MainUiState(
    val selectedAudioUri: Uri? = null,
    val activeModelFileName: String? = null,
    val selectedPresetId: String = "small",
    val selectedQualityProfile: QualityProfile = QualityProfile.BALANCED,
    val recommendedQualityProfile: QualityProfile = QualityProfile.BALANCED,
    val blockedQualityProfiles: Set<QualityProfile> = emptySet(),
    val deviceSummary: String = "",
    val installedModels: List<String> = emptyList(),
    val transcriptText: String = "",
    val segments: List<TranscriptionSegment> = emptyList(),
    val isDownloadingModel: Boolean = false,
    val modelDownloadProgress: Int = 0,
    val isTranscribing: Boolean = false,
    val transcribeProgress: Int = 0,
    val isRecording: Boolean = false,
    val status: String = "Ready",
    val error: String? = null
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val appContext = getApplication<Application>()
    private val modelManager = ModelManager(app)
    private val preprocessor = AudioPreprocessor(app)
    private val recorder = MicRecorder(app)

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    init {
        applyDeviceProfile()
        refreshInstalledModels()
    }

    private fun applyDeviceProfile() {
        val profile = DeviceCapabilityEvaluator.detect(appContext)
        val recommendedPresetId = when (profile.recommendedQuality) {
            QualityProfile.FAST -> "base"
            QualityProfile.BALANCED -> "small"
            QualityProfile.ACCURATE -> "medium"
        }
        val recommendedPreset = WhisperModelCatalog.byId(recommendedPresetId)

        _uiState.update {
            it.copy(
                selectedQualityProfile = profile.recommendedQuality,
                selectedPresetId = recommendedPresetId,
                activeModelFileName = recommendedPreset?.fileName ?: it.activeModelFileName,
                recommendedQualityProfile = profile.recommendedQuality,
                blockedQualityProfiles = profile.blockedQualities,
                deviceSummary = "${profile.summary} (RAM ${profile.totalRamMb}MB, CPU ${profile.cpuCores} cores)"
            )
        }
    }

    private fun startForegroundTranscription(status: String) {
        val intent = TranscriptionForegroundService.startIntent(appContext, status)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            appContext.startForegroundService(intent)
        } else {
            appContext.startService(intent)
        }
    }

    private fun updateForegroundTranscription(status: String, progress: Int) {
        val intent = TranscriptionForegroundService.progressIntent(appContext, status, progress)
        appContext.startService(intent)
    }

    private fun stopForegroundTranscription() {
        appContext.startService(TranscriptionForegroundService.stopIntent(appContext))
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun setSelectedAudio(uri: Uri) {
        _uiState.update { it.copy(selectedAudioUri = uri, status = "Audio selected", error = null) }
    }

    fun setSelectedPreset(presetId: String) {
        val preset = WhisperModelCatalog.byId(presetId)
        _uiState.update {
            it.copy(
                selectedPresetId = presetId,
                selectedQualityProfile = preset?.qualityProfile ?: it.selectedQualityProfile,
                error = null
            )
        }
    }

    fun selectQualityProfile(profile: QualityProfile) {
        if (_uiState.value.blockedQualityProfiles.contains(profile)) {
            _uiState.update {
                it.copy(error = "$profile is blocked on this device due to memory/CPU limits")
            }
            return
        }

        val presetId = when (profile) {
            QualityProfile.FAST -> "base"
            QualityProfile.BALANCED -> "small"
            QualityProfile.ACCURATE -> "medium"
        }
        val preset = WhisperModelCatalog.byId(presetId)
        _uiState.update {
            it.copy(
                selectedQualityProfile = profile,
                selectedPresetId = presetId,
                activeModelFileName = preset?.fileName ?: it.activeModelFileName,
                error = null
            )
        }
    }

    fun setActiveModelFileName(fileName: String) {
        _uiState.update { it.copy(activeModelFileName = fileName, error = null) }
    }

    fun refreshInstalledModels() {
        val installed = modelManager.installedModelFiles().map(File::getName)
        _uiState.update {
            val active = it.activeModelFileName?.takeIf { name -> installed.contains(name) }
                ?: installed.firstOrNull()
            it.copy(installedModels = installed, activeModelFileName = active)
        }
    }

    fun downloadSelectedPreset() {
        val preset = WhisperModelCatalog.byId(_uiState.value.selectedPresetId)
            ?: run {
                _uiState.update { it.copy(error = "Invalid model preset") }
                return
            }

        if (_uiState.value.blockedQualityProfiles.contains(preset.qualityProfile)) {
            _uiState.update { it.copy(error = "Selected model profile is blocked on this device") }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isDownloadingModel = true,
                    modelDownloadProgress = 0,
                    status = "Downloading ${preset.fileName}",
                    error = null
                )
            }

            try {
                modelManager.downloadModel(preset) { downloaded, total ->
                    val progress = if (total > 0L) ((downloaded * 100L) / total).toInt() else 0
                    _uiState.update { st -> st.copy(modelDownloadProgress = progress.coerceIn(0, 100)) }
                }
                refreshInstalledModels()
                _uiState.update {
                    it.copy(
                        isDownloadingModel = false,
                        modelDownloadProgress = 100,
                        activeModelFileName = preset.fileName,
                        status = "Model ready: ${preset.fileName}"
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isDownloadingModel = false,
                        status = "Model download failed",
                        error = t.message ?: "Unknown download error"
                    )
                }
            }
        }
    }

    fun importModel(uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(status = "Importing model", error = null) }
            try {
                val imported = modelManager.importModel(uri)
                refreshInstalledModels()
                _uiState.update {
                    it.copy(
                        activeModelFileName = imported.name,
                        status = "Model imported: ${imported.name}"
                    )
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(error = t.message ?: "Model import failed", status = "Model import failed")
                }
            }
        }
    }

    fun startRecording() {
        try {
            recorder.start()
            _uiState.update { it.copy(isRecording = true, status = "Recording", error = null) }
        } catch (t: Throwable) {
            _uiState.update { it.copy(error = t.message ?: "Recording start failed") }
        }
    }

    fun stopRecording() {
        try {
            val file = recorder.stop()
            val uri = Uri.fromFile(file)
            _uiState.update {
                it.copy(
                    isRecording = false,
                    selectedAudioUri = uri,
                    status = "Recording captured"
                )
            }
        } catch (t: Throwable) {
            _uiState.update {
                it.copy(isRecording = false, error = t.message ?: "Recording stop failed")
            }
        }
    }

    fun cancelRecording() {
        recorder.cancel()
        _uiState.update { it.copy(isRecording = false, status = "Recording canceled") }
    }

    fun transcribeSelectedAudio() {
        val state = _uiState.value
        val inputUri = state.selectedAudioUri
            ?: run {
                _uiState.update { it.copy(error = "Select audio first") }
                return
            }
        val modelFileName = state.activeModelFileName
            ?: run {
                _uiState.update { it.copy(error = "Download or import a model first") }
                return
            }

        val modelFile = modelManager.modelFileByName(modelFileName)
        if (!modelFile.exists()) {
            _uiState.update { it.copy(error = "Selected model file is missing") }
            refreshInstalledModels()
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isTranscribing = true,
                    transcribeProgress = 0,
                    status = "Preparing audio",
                    error = null
                )
            }
            startForegroundTranscription("Preparing audio")
            updateForegroundTranscription("Preparing audio", 0)

            var wavFile: File? = null

            try {
                wavFile = preprocessor.normalizeToWhisperWav(inputUri) { stage ->
                    _uiState.update { st -> st.copy(status = stage) }
                    updateForegroundTranscription(stage, _uiState.value.transcribeProgress)
                }

                _uiState.update { it.copy(status = "Loading model") }
                updateForegroundTranscription("Loading model", 10)
                val loaded = withContext(Dispatchers.Default) {
                    WhisperBridge.initModel(modelFile.absolutePath)
                }
                if (!loaded) error("Unable to initialize whisper model")

                WhisperBridge.setProgressListener { p ->
                    _uiState.update { st -> st.copy(transcribeProgress = p) }
                    updateForegroundTranscription("Transcribing Hebrew audio", p)
                }

                _uiState.update { it.copy(status = "Transcribing Hebrew audio") }
                updateForegroundTranscription("Transcribing Hebrew audio", 20)
                val raw = withContext(Dispatchers.Default) {
                    WhisperBridge.transcribeWav(
                        wavPath = wavFile.absolutePath,
                        language = "he",
                        translate = false
                    )
                }

                val result = NativeResultParser.parse(raw)
                if (result.canceled) {
                    _uiState.update {
                        it.copy(
                            isTranscribing = false,
                            transcribeProgress = 0,
                            status = "Transcription canceled"
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            isTranscribing = false,
                            transcribeProgress = 100,
                            transcriptText = result.text,
                            segments = result.segments,
                            status = "Transcription complete"
                        )
                    }
                    updateForegroundTranscription("Transcription complete", 100)
                }
            } catch (t: Throwable) {
                _uiState.update {
                    it.copy(
                        isTranscribing = false,
                        transcribeProgress = 0,
                        status = "Transcription failed",
                        error = t.message ?: "Unknown transcription error"
                    )
                }
            } finally {
                WhisperBridge.setProgressListener(null)
                wavFile?.delete()
                stopForegroundTranscription()
            }
        }
    }

    fun cancelTranscription() {
        WhisperBridge.cancel()
        _uiState.update { it.copy(status = "Cancel requested") }
    }

    fun export(
        targetUri: Uri,
        format: ExportFormat
    ) {
        val snapshot = _uiState.value
        if (snapshot.transcriptText.isBlank()) {
            _uiState.update { it.copy(error = "No transcription to export") }
            return
        }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                val exporter = TranscriptExporter(getApplication<Application>().contentResolver)
                exporter.export(
                    targetUri = targetUri,
                    format = format,
                    result = TranscriptionResult(
                        text = snapshot.transcriptText,
                        segments = snapshot.segments,
                        language = "he",
                        canceled = false
                    )
                )
                _uiState.update { it.copy(status = "Export complete") }
            } catch (t: Throwable) {
                _uiState.update { it.copy(error = t.message ?: "Export failed") }
            }
        }
    }

    override fun onCleared() {
        WhisperBridge.cancel()
        WhisperBridge.release()
        recorder.cancel()
        super.onCleared()
    }
}

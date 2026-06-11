package ai.ivrit.offlinehebrew

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            MaterialTheme {
                OfflineHebrewScreen(viewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OfflineHebrewScreen(viewModel: MainViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val snackState = remember { SnackbarHostState() }

    val pickAudioLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let(viewModel::setSelectedAudio)
    }

    val importModelLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let(viewModel::importModel)
    }

    val recordPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            viewModel.startRecording()
        }
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) {
        viewModel.transcribeSelectedAudio()
    }

    val exportTxtLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/plain")
    ) { uri ->
        uri?.let { viewModel.export(it, ExportFormat.TXT) }
    }

    val exportSrtLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/x-subrip")
    ) { uri ->
        uri?.let { viewModel.export(it, ExportFormat.SRT) }
    }

    val exportDocxLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ) { uri ->
        uri?.let { viewModel.export(it, ExportFormat.DOCX) }
    }

    LaunchedEffect(uiState.error) {
        val message = uiState.error ?: return@LaunchedEffect
        snackState.showSnackbar(message)
        viewModel.clearError()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Professional Offline Hebrew Transcription",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            if (uiState.deviceSummary.isNotBlank()) {
                Text(
                    text = uiState.deviceSummary,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("1) Model setup", fontWeight = FontWeight.SemiBold)

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        AssistChip(
                            onClick = { viewModel.selectQualityProfile(QualityProfile.FAST) },
                            label = { Text("Fast") },
                            enabled = !uiState.blockedQualityProfiles.contains(QualityProfile.FAST)
                        )
                        AssistChip(
                            onClick = { viewModel.selectQualityProfile(QualityProfile.BALANCED) },
                            label = { Text("Balanced") },
                            enabled = !uiState.blockedQualityProfiles.contains(QualityProfile.BALANCED)
                        )
                        AssistChip(
                            onClick = { viewModel.selectQualityProfile(QualityProfile.ACCURATE) },
                            label = { Text("Accurate") },
                            enabled = !uiState.blockedQualityProfiles.contains(QualityProfile.ACCURATE)
                        )
                    }

                    Text(
                        text = "Quality profile: ${uiState.selectedQualityProfile.name} (recommended: ${uiState.recommendedQualityProfile.name})",
                        style = MaterialTheme.typography.bodySmall
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        WhisperModelCatalog.presets.forEach { preset ->
                            AssistChip(
                                onClick = {
                                    viewModel.setSelectedPreset(preset.id)
                                    viewModel.setActiveModelFileName(preset.fileName)
                                },
                                label = { Text(preset.id) }
                            )
                        }
                    }

                    Text(
                        text = "Preset: ${uiState.selectedPresetId}",
                        style = MaterialTheme.typography.bodySmall
                    )

                    Button(
                        onClick = { viewModel.downloadSelectedPreset() },
                        enabled = !uiState.isDownloadingModel
                    ) {
                        Text("Download selected model")
                    }

                    Button(
                        onClick = { importModelLauncher.launch(arrayOf("*/*")) },
                        enabled = !uiState.isDownloadingModel
                    ) {
                        Text("Import model manually (.bin)")
                    }

                    if (uiState.isDownloadingModel) {
                        LinearProgressIndicator(
                            progress = { (uiState.modelDownloadProgress / 100f).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    HorizontalDivider()

                    Text("Installed models:")
                    if (uiState.installedModels.isEmpty()) {
                        Text("No models installed yet")
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            uiState.installedModels.forEach { modelName ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(modelName, modifier = Modifier.weight(1f))
                                    TextButton(onClick = { viewModel.setActiveModelFileName(modelName) }) {
                                        Text(if (uiState.activeModelFileName == modelName) "Selected" else "Use")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("2) Audio input", fontWeight = FontWeight.SemiBold)

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            pickAudioLauncher.launch(arrayOf("audio/*", "video/*"))
                        }) {
                            Text("Pick audio/video")
                        }

                        if (!uiState.isRecording) {
                            Button(onClick = {
                                recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }) {
                                Text("Start mic recording")
                            }
                        } else {
                            Button(onClick = { viewModel.stopRecording() }) {
                                Text("Stop recording")
                            }
                            Button(onClick = { viewModel.cancelRecording() }) {
                                Text("Cancel recording")
                            }
                        }
                    }

                    Text(
                        text = "Selected audio: ${uiState.selectedAudioUri ?: "None"}",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("3) Transcribe", fontWeight = FontWeight.SemiBold)

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                if (
                                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                    ContextCompat.checkSelfPermission(
                                        viewModel.getApplication(),
                                        Manifest.permission.POST_NOTIFICATIONS
                                    ) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                } else {
                                    viewModel.transcribeSelectedAudio()
                                }
                            },
                            enabled = !uiState.isTranscribing
                        ) {
                            Text("Transcribe Hebrew offline")
                        }
                        Button(
                            onClick = { viewModel.cancelTranscription() },
                            enabled = uiState.isTranscribing
                        ) {
                            Text("Cancel")
                        }
                    }

                    if (uiState.isTranscribing) {
                        LinearProgressIndicator(
                            progress = { (uiState.transcribeProgress / 100f).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    Text("Status: ${uiState.status}")
                }
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("4) Hebrew transcript (RTL)", fontWeight = FontWeight.SemiBold)

                    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                        SelectionContainer {
                            Text(
                                text = uiState.transcriptText.ifBlank { "Transcript will appear here" },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFF5F5F5))
                                    .padding(10.dp)
                                    .height(180.dp)
                            )
                        }
                    }
                }
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("5) Export", fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                exportTxtLauncher.launch("transcript.txt")
                            },
                            enabled = uiState.transcriptText.isNotBlank()
                        ) {
                            Text("TXT")
                        }
                        Button(
                            onClick = {
                                exportSrtLauncher.launch("transcript.srt")
                            },
                            enabled = uiState.transcriptText.isNotBlank()
                        ) {
                            Text("SRT")
                        }
                        Button(
                            onClick = {
                                exportDocxLauncher.launch("transcript.docx")
                            },
                            enabled = uiState.transcriptText.isNotBlank()
                        ) {
                            Text("DOCX")
                        }
                    }
                }
            }
        }
    }
}

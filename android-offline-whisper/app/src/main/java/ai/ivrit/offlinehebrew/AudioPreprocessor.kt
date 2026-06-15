package ai.ivrit.offlinehebrew

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.roundToInt

class AudioPreprocessor(private val context: Context) {

    private data class DecodedPcm(
        val sampleRate: Int,
        val channels: Int,
        val samples: ShortArray
    )

    suspend fun normalizeToWhisperWav(
        inputUri: Uri,
        onStatus: (String) -> Unit
    ): File = withContext(Dispatchers.IO) {
        onStatus("Decoding audio")
        val decoded = decodeAudioToPcm(inputUri)

        onStatus("Resampling to 16kHz mono")
        val mono16k = toMono16k(decoded.samples, decoded.sampleRate, decoded.channels)

        onStatus("Writing WAV")
        val outFile = File(context.cacheDir, "whisper-${System.currentTimeMillis()}.wav")
        writeWav16kMono(outFile, mono16k)

        outFile
    }

    private fun decodeAudioToPcm(uri: Uri): DecodedPcm {
        val extractor = MediaExtractor()
        setExtractorDataSource(extractor, uri)

        val trackIndex = findAudioTrack(extractor)
        extractor.selectTrack(trackIndex)

        val inputFormat = extractor.getTrackFormat(trackIndex)
        val mime = requireNotNull(inputFormat.getString(MediaFormat.KEY_MIME)) {
            "Audio MIME is missing"
        }

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(inputFormat, null, null, 0)
        codec.start()

        val bufferInfo = MediaCodec.BufferInfo()
        val output = ByteArrayOutputStream()

        var sampleRate = inputFormat.getIntegerOrDefault(MediaFormat.KEY_SAMPLE_RATE, 16000)
        var channels = inputFormat.getIntegerOrDefault(MediaFormat.KEY_CHANNEL_COUNT, 1)

        var inputDone = false
        var outputDone = false

        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val inputBuffer = requireNotNull(codec.getInputBuffer(inputIndex))
                        val read = extractor.readSampleData(inputBuffer, 0)
                        if (read < 0) {
                            codec.queueInputBuffer(
                                inputIndex,
                                0,
                                0,
                                0L,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM
                            )
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime
                            codec.queueInputBuffer(inputIndex, 0, read, pts, 0)
                            extractor.advance()
                        }
                    }
                }

                when (val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        codec.outputFormat.let { format ->
                            sampleRate = format.getIntegerOrDefault(MediaFormat.KEY_SAMPLE_RATE, sampleRate)
                            channels = format.getIntegerOrDefault(MediaFormat.KEY_CHANNEL_COUNT, channels)
                        }
                    }
                    else -> {
                        if (outputIndex >= 0) {
                            val outBuffer = codec.getOutputBuffer(outputIndex)
                            if (outBuffer != null && bufferInfo.size > 0) {
                                outBuffer.position(bufferInfo.offset)
                                outBuffer.limit(bufferInfo.offset + bufferInfo.size)
                                val bytes = ByteArray(bufferInfo.size)
                                outBuffer.get(bytes)
                                output.write(bytes)
                            }
                            codec.releaseOutputBuffer(outputIndex, false)

                            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                                outputDone = true
                            }
                        }
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }

        val pcmBytes = output.toByteArray()
        val pcmShorts = bytesToShortsLittleEndian(pcmBytes)
        return DecodedPcm(sampleRate = sampleRate, channels = channels, samples = pcmShorts)
    }

    private fun setExtractorDataSource(extractor: MediaExtractor, uri: Uri) {
        if (uri.scheme == "file") {
            extractor.setDataSource(requireNotNull(uri.path) { "Invalid file Uri path" })
            return
        }

        context.contentResolver.openFileDescriptor(uri, "r").use { pfd ->
            requireNotNull(pfd) { "Unable to open audio Uri" }
            extractor.setDataSource(pfd.fileDescriptor)
        }
    }

    private fun findAudioTrack(extractor: MediaExtractor): Int {
        for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) return i
        }
        error("No audio track found in selected media")
    }

    private fun toMono16k(input: ShortArray, sourceRate: Int, sourceChannels: Int): ShortArray {
        val channels = sourceChannels.coerceAtLeast(1)
        val frames = input.size / channels
        if (frames <= 0) return ShortArray(0)

        val mono = FloatArray(frames)
        var frame = 0
        while (frame < frames) {
            var sum = 0f
            var ch = 0
            while (ch < channels) {
                sum += input[frame * channels + ch] / 32768f
                ch++
            }
            mono[frame] = sum / channels
            frame++
        }

        val srcRate = sourceRate.coerceAtLeast(1)
        if (srcRate == 16000) {
            return monoToShorts(mono)
        }

        val outFrames = ((mono.size.toDouble() * 16000.0) / srcRate.toDouble()).roundToInt().coerceAtLeast(1)
        val out = ShortArray(outFrames)

        var i = 0
        while (i < outFrames) {
            val srcPos = i.toDouble() * srcRate.toDouble() / 16000.0
            val idx0 = floor(srcPos).toInt().coerceIn(0, mono.lastIndex)
            val idx1 = (idx0 + 1).coerceAtMost(mono.lastIndex)
            val frac = (srcPos - idx0)
            val sample = (mono[idx0] * (1.0 - frac) + mono[idx1] * frac).toFloat()
            out[i] = floatToPcm16(sample)
            i++
        }

        return out
    }

    private fun monoToShorts(mono: FloatArray): ShortArray {
        val out = ShortArray(mono.size)
        for (i in mono.indices) {
            out[i] = floatToPcm16(mono[i])
        }
        return out
    }

    private fun floatToPcm16(v: Float): Short {
        val clamped = v.coerceIn(-1f, 1f)
        val scaled = (clamped * 32767f).roundToInt()
        return scaled.toShort()
    }

    private fun bytesToShortsLittleEndian(bytes: ByteArray): ShortArray {
        if (bytes.isEmpty()) return ShortArray(0)
        val shortCount = bytes.size / 2
        val result = ShortArray(shortCount)
        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until shortCount) {
            result[i] = bb.short
        }
        return result
    }

    private fun writeWav16kMono(outputFile: File, samples: ShortArray) {
        val sampleRate = 16000
        val channels = 1
        val bitsPerSample = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        val dataSize = samples.size * 2
        val chunkSize = 36 + dataSize

        DataOutputStream(FileOutputStream(outputFile)).use { out ->
            out.writeBytes("RIFF")
            out.writeIntLE(chunkSize)
            out.writeBytes("WAVE")

            out.writeBytes("fmt ")
            out.writeIntLE(16)
            out.writeShortLE(1)
            out.writeShortLE(channels.toShort())
            out.writeIntLE(sampleRate)
            out.writeIntLE(byteRate)
            out.writeShortLE(blockAlign.toShort())
            out.writeShortLE(bitsPerSample.toShort())

            out.writeBytes("data")
            out.writeIntLE(dataSize)

            for (sample in samples) {
                out.writeShortLE(sample)
            }
        }
    }

    private fun DataOutputStream.writeIntLE(value: Int) {
        write(value and 0xFF)
        write((value shr 8) and 0xFF)
        write((value shr 16) and 0xFF)
        write((value shr 24) and 0xFF)
    }

    private fun DataOutputStream.writeShortLE(value: Short) {
        val v = value.toInt()
        write(v and 0xFF)
        write((v shr 8) and 0xFF)
    }

    private fun MediaFormat.getIntegerOrDefault(key: String, default: Int): Int {
        return if (containsKey(key)) getInteger(key) else default
    }
}

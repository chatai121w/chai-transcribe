package ai.ivrit.offlinehebrew

import android.app.ActivityManager
import android.content.Context

data class DeviceCapabilityProfile(
    val totalRamMb: Int,
    val cpuCores: Int,
    val recommendedQuality: QualityProfile,
    val blockedQualities: Set<QualityProfile>,
    val summary: String
)

object DeviceCapabilityEvaluator {
    fun detect(context: Context): DeviceCapabilityProfile {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mem = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mem)

        val totalRamMb = (mem.totalMem / (1024L * 1024L)).toInt().coerceAtLeast(0)
        val cpuCores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)

        val profile = when {
            totalRamMb >= 10_000 && cpuCores >= 8 -> {
                DeviceCapabilityProfile(
                    totalRamMb = totalRamMb,
                    cpuCores = cpuCores,
                    recommendedQuality = QualityProfile.ACCURATE,
                    blockedQualities = emptySet(),
                    summary = "High-end device: full model range enabled"
                )
            }
            totalRamMb >= 6_000 && cpuCores >= 6 -> {
                DeviceCapabilityProfile(
                    totalRamMb = totalRamMb,
                    cpuCores = cpuCores,
                    recommendedQuality = QualityProfile.BALANCED,
                    blockedQualities = setOf(QualityProfile.ACCURATE),
                    summary = "Mid-range device: Accurate profile limited"
                )
            }
            else -> {
                DeviceCapabilityProfile(
                    totalRamMb = totalRamMb,
                    cpuCores = cpuCores,
                    recommendedQuality = QualityProfile.FAST,
                    blockedQualities = setOf(QualityProfile.BALANCED, QualityProfile.ACCURATE),
                    summary = "Entry device: only Fast profile is recommended"
                )
            }
        }

        return profile
    }
}

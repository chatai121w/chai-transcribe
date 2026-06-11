package ai.ivrit.offlinehebrew

import org.json.JSONArray
import org.json.JSONObject

object NativeResultParser {
    fun parse(rawJson: String): TranscriptionResult {
        val root = JSONObject(rawJson)
        val text = root.optString("text", "")
        val language = root.optString("language", "he")
        val canceled = root.optBoolean("canceled", false)

        val segmentsArray = root.optJSONArray("segments") ?: JSONArray()
        val segments = buildList {
            for (i in 0 until segmentsArray.length()) {
                val item = segmentsArray.optJSONObject(i) ?: continue
                add(
                    TranscriptionSegment(
                        startMs = item.optLong("startMs", 0L),
                        endMs = item.optLong("endMs", 0L),
                        text = item.optString("text", "").trim()
                    )
                )
            }
        }

        return TranscriptionResult(
            text = text,
            segments = segments,
            language = language,
            canceled = canceled
        )
    }
}

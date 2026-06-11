package ai.ivrit.offlinehebrew

import android.content.ContentResolver
import android.net.Uri
import java.io.OutputStreamWriter
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

enum class ExportFormat {
    TXT,
    DOCX,
    SRT
}

class TranscriptExporter(private val resolver: ContentResolver) {
    fun export(
        targetUri: Uri,
        format: ExportFormat,
        result: TranscriptionResult
    ) {
        when (format) {
            ExportFormat.TXT -> exportTxt(targetUri, result)
            ExportFormat.DOCX -> exportDocx(targetUri, result)
            ExportFormat.SRT -> exportSrt(targetUri, result)
        }
    }

    private fun exportTxt(uri: Uri, result: TranscriptionResult) {
        resolver.openOutputStream(uri).use { stream ->
            requireNotNull(stream) { "Unable to open output stream" }
            OutputStreamWriter(stream, Charsets.UTF_8).use { writer ->
                writer.appendLine(result.text)
            }
        }
    }

    private fun exportDocx(uri: Uri, result: TranscriptionResult) {
        resolver.openOutputStream(uri).use { stream ->
            requireNotNull(stream) { "Unable to open output stream" }
                        ZipOutputStream(stream).use { zip ->
                                writeZipEntry(
                                        zip,
                                        "[Content_Types].xml",
                                        """
                                        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                                        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                                            <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                                            <Default Extension="xml" ContentType="application/xml"/>
                                            <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
                                        </Types>
                                        """.trimIndent()
                                )

                                writeZipEntry(
                                        zip,
                                        "_rels/.rels",
                                        """
                                        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                                        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                                            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
                                        </Relationships>
                                        """.trimIndent()
                                )

                                val createdAt = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
                                val body = buildString {
                                        append("Hebrew Transcription")
                                        append("\n")
                                        append("Created: ")
                                        append(createdAt)
                                        append("\n\n")
                                        append(result.text)
                                }

                                writeZipEntry(
                                        zip,
                                        "word/document.xml",
                                        """
                                        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                                        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                                            <w:body>
                                                ${bodyToWordXml(body)}
                                                <w:sectPr>
                                                    <w:pgSz w:w="11906" w:h="16838"/>
                                                    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
                                                </w:sectPr>
                                            </w:body>
                                        </w:document>
                                        """.trimIndent()
                                )
                        }
        }
    }

    private fun exportSrt(uri: Uri, result: TranscriptionResult) {
        resolver.openOutputStream(uri).use { stream ->
            requireNotNull(stream) { "Unable to open output stream" }
            OutputStreamWriter(stream, Charsets.UTF_8).use { writer ->
                result.segments.forEachIndexed { index, segment ->
                    writer.appendLine((index + 1).toString())
                    writer.appendLine("${toSrtTime(segment.startMs)} --> ${toSrtTime(segment.endMs)}")
                    writer.appendLine(segment.text)
                    writer.appendLine()
                }
            }
        }
    }

    private fun toSrtTime(ms: Long): String {
        val totalSeconds = ms / 1000
        val millis = (ms % 1000).toInt()
        val seconds = (totalSeconds % 60).toInt()
        val minutes = ((totalSeconds / 60) % 60).toInt()
        val hours = (totalSeconds / 3600).toInt()

        return String.format("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
    }

    private fun writeZipEntry(zip: ZipOutputStream, name: String, content: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(content.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }

    private fun bodyToWordXml(body: String): String {
        val paragraphs = body
            .replace("\r\n", "\n")
            .replace('\r', '\n')
            .split('\n')

        return paragraphs.joinToString(separator = "") { line ->
            val escaped = line
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            "<w:p><w:r><w:t xml:space=\"preserve\">$escaped</w:t></w:r></w:p>"
        }
    }
}

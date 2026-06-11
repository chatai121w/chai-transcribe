#include <jni.h>
#include <android/log.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "whisper.h"

#define LOG_TAG "WhisperJNI"
#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {

JavaVM* g_vm = nullptr;
jclass g_bridge_class = nullptr;
jmethodID g_progress_method = nullptr;

std::mutex g_mutex;
whisper_context* g_ctx = nullptr;
std::atomic<bool> g_cancel{false};

struct WavData {
    int sample_rate = 0;
    int channels = 0;
    std::vector<float> samples;
};

static uint32_t read_u32_le(std::ifstream& in) {
    uint8_t b[4] = {0, 0, 0, 0};
    in.read(reinterpret_cast<char*>(b), 4);
    return static_cast<uint32_t>(b[0]) |
           (static_cast<uint32_t>(b[1]) << 8) |
           (static_cast<uint32_t>(b[2]) << 16) |
           (static_cast<uint32_t>(b[3]) << 24);
}

static uint16_t read_u16_le(std::ifstream& in) {
    uint8_t b[2] = {0, 0};
    in.read(reinterpret_cast<char*>(b), 2);
    return static_cast<uint16_t>(b[0]) |
           (static_cast<uint16_t>(b[1]) << 8);
}

static bool read_wav_16k_mono_pcm16(const std::string& path, WavData& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in.is_open()) {
        ALOGE("Failed to open wav file: %s", path.c_str());
        return false;
    }

    char riff[4] = {0};
    in.read(riff, 4);
    if (std::strncmp(riff, "RIFF", 4) != 0) {
        ALOGE("Not RIFF file");
        return false;
    }

    (void)read_u32_le(in);

    char wave[4] = {0};
    in.read(wave, 4);
    if (std::strncmp(wave, "WAVE", 4) != 0) {
        ALOGE("Not WAVE file");
        return false;
    }

    bool fmt_found = false;
    bool data_found = false;

    uint16_t audio_format = 0;
    uint16_t channels = 0;
    uint32_t sample_rate = 0;
    uint16_t bits_per_sample = 0;
    std::vector<int16_t> pcm16;

    while (in.good() && (!fmt_found || !data_found)) {
        char chunk_id[4] = {0};
        in.read(chunk_id, 4);
        if (in.gcount() != 4) {
            break;
        }
        uint32_t chunk_size = read_u32_le(in);

        if (std::strncmp(chunk_id, "fmt ", 4) == 0) {
            audio_format = read_u16_le(in);
            channels = read_u16_le(in);
            sample_rate = read_u32_le(in);
            (void)read_u32_le(in);
            (void)read_u16_le(in);
            bits_per_sample = read_u16_le(in);

            if (chunk_size > 16) {
                in.seekg(static_cast<std::streamoff>(chunk_size - 16), std::ios::cur);
            }
            fmt_found = true;
        } else if (std::strncmp(chunk_id, "data", 4) == 0) {
            if (chunk_size % 2 != 0) {
                ALOGE("Invalid pcm16 data chunk size");
                return false;
            }
            pcm16.resize(chunk_size / 2);
            in.read(reinterpret_cast<char*>(pcm16.data()), static_cast<std::streamsize>(chunk_size));
            data_found = true;
        } else {
            in.seekg(static_cast<std::streamoff>(chunk_size), std::ios::cur);
        }
    }

    if (!fmt_found || !data_found) {
        ALOGE("Missing fmt/data chunk");
        return false;
    }

    if (audio_format != 1 || bits_per_sample != 16 || channels != 1 || sample_rate != 16000) {
        ALOGE("Expected PCM16 mono 16kHz wav. Got format=%u ch=%u sr=%u bps=%u",
              audio_format, channels, sample_rate, bits_per_sample);
        return false;
    }

    out.channels = channels;
    out.sample_rate = static_cast<int>(sample_rate);
    out.samples.resize(pcm16.size());
    for (size_t i = 0; i < pcm16.size(); ++i) {
        out.samples[i] = static_cast<float>(pcm16[i]) / 32768.0f;
    }

    return true;
}

static std::string escape_json(const std::string& s) {
    std::ostringstream o;
    for (char c : s) {
        switch (c) {
            case '"': o << "\\\""; break;
            case '\\': o << "\\\\"; break;
            case '\b': o << "\\b"; break;
            case '\f': o << "\\f"; break;
            case '\n': o << "\\n"; break;
            case '\r': o << "\\r"; break;
            case '\t': o << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    o << "\\u"
                      << std::hex << std::uppercase
                      << static_cast<int>(c);
                } else {
                    o << c;
                }
        }
    }
    return o.str();
}

static void ensure_bridge_symbols(JNIEnv* env) {
    if (g_bridge_class != nullptr && g_progress_method != nullptr) {
        return;
    }

    jclass local_cls = env->FindClass("ai/ivrit/offlinehebrew/WhisperBridge");
    if (!local_cls) {
        ALOGE("Cannot find WhisperBridge class");
        env->ExceptionClear();
        return;
    }

    g_bridge_class = reinterpret_cast<jclass>(env->NewGlobalRef(local_cls));
    env->DeleteLocalRef(local_cls);

    if (!g_bridge_class) {
        ALOGE("Failed to create global class ref");
        return;
    }

    g_progress_method = env->GetStaticMethodID(g_bridge_class, "onNativeProgress", "(I)V");
    if (!g_progress_method) {
        ALOGE("Cannot find onNativeProgress(int)");
        env->ExceptionClear();
    }
}

static void emit_progress(int progress) {
    if (!g_vm) return;

    JNIEnv* env = nullptr;
    bool detach = false;

    const jint get_env_res = g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (get_env_res == JNI_EDETACHED) {
        if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
            return;
        }
        detach = true;
    } else if (get_env_res != JNI_OK || !env) {
        return;
    }

    ensure_bridge_symbols(env);

    if (g_bridge_class && g_progress_method) {
        env->CallStaticVoidMethod(g_bridge_class, g_progress_method, progress);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
    }

    if (detach) {
        g_vm->DetachCurrentThread();
    }
}

static bool abort_callback(void* /*user_data*/) {
    return g_cancel.load();
}

static void progress_callback(
    struct whisper_context* /*ctx*/,
    struct whisper_state* /*state*/,
    int progress,
    void* /*user_data*/
) {
    emit_progress(progress);
}

static std::string build_error_json(const std::string& message) {
    std::ostringstream out;
    out << "{\"text\":\"\",\"language\":\"he\",\"canceled\":false,\"error\":\""
        << escape_json(message) << "\",\"segments\":[]}";
    return out.str();
}

} // namespace

extern "C" JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_ai_ivrit_offlinehebrew_WhisperBridge_initModel(
    JNIEnv* env,
    jobject /*thiz*/,
    jstring model_path
) {
    std::lock_guard<std::mutex> lock(g_mutex);

    const char* model_path_chars = env->GetStringUTFChars(model_path, nullptr);
    if (!model_path_chars) return JNI_FALSE;

    std::string model_path_str(model_path_chars);
    env->ReleaseStringUTFChars(model_path, model_path_chars);

    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }

    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = true;
    cparams.flash_attn = true;

    g_ctx = whisper_init_from_file_with_params(model_path_str.c_str(), cparams);
    if (!g_ctx) {
        ALOGE("Failed to initialize whisper model: %s", model_path_str.c_str());
        return JNI_FALSE;
    }

    ALOGI("Model initialized: %s", model_path_str.c_str());
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_ai_ivrit_offlinehebrew_WhisperBridge_transcribeWav(
    JNIEnv* env,
    jobject /*thiz*/,
    jstring wav_path,
    jstring language,
    jboolean translate
) {
    std::lock_guard<std::mutex> lock(g_mutex);

    if (!g_ctx) {
        const std::string error = build_error_json("Model is not initialized");
        return env->NewStringUTF(error.c_str());
    }

    const char* wav_path_chars = env->GetStringUTFChars(wav_path, nullptr);
    const char* language_chars = env->GetStringUTFChars(language, nullptr);
    if (!wav_path_chars || !language_chars) {
        if (wav_path_chars) env->ReleaseStringUTFChars(wav_path, wav_path_chars);
        if (language_chars) env->ReleaseStringUTFChars(language, language_chars);
        const std::string error = build_error_json("Invalid JNI strings");
        return env->NewStringUTF(error.c_str());
    }

    std::string wav_path_str(wav_path_chars);
    std::string language_str(language_chars);

    env->ReleaseStringUTFChars(wav_path, wav_path_chars);
    env->ReleaseStringUTFChars(language, language_chars);

    WavData wav;
    if (!read_wav_16k_mono_pcm16(wav_path_str, wav)) {
        const std::string error = build_error_json("Input wav must be 16kHz mono PCM16");
        return env->NewStringUTF(error.c_str());
    }

    g_cancel.store(false);
    emit_progress(0);

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.translate = static_cast<bool>(translate);
    params.language = language_str.c_str();
    params.no_context = false;
    params.single_segment = false;
    params.max_len = 0;
    params.beam_search.beam_size = 5;
    params.n_threads = std::max(1, static_cast<int>(std::thread::hardware_concurrency()) - 1);
    params.abort_callback = abort_callback;
    params.progress_callback = progress_callback;

    const int rc = whisper_full(g_ctx, params, wav.samples.data(), static_cast<int>(wav.samples.size()));

    if (g_cancel.load()) {
        const std::string canceled = "{\"text\":\"\",\"language\":\"he\",\"canceled\":true,\"segments\":[]}";
        return env->NewStringUTF(canceled.c_str());
    }

    if (rc != 0) {
        const std::string error = build_error_json("whisper_full failed");
        return env->NewStringUTF(error.c_str());
    }

    std::ostringstream full_text;
    std::ostringstream segments_json;
    segments_json << "[";

    const int n_segments = whisper_full_n_segments(g_ctx);
    for (int i = 0; i < n_segments; ++i) {
        const int64_t t0 = whisper_full_get_segment_t0(g_ctx, i);
        const int64_t t1 = whisper_full_get_segment_t1(g_ctx, i);
        const char* segment_text = whisper_full_get_segment_text(g_ctx, i);
        const std::string seg = segment_text ? segment_text : "";

        full_text << seg;

        if (i > 0) segments_json << ",";
        segments_json
            << "{\"startMs\":" << (t0 * 10)
            << ",\"endMs\":" << (t1 * 10)
            << ",\"text\":\"" << escape_json(seg) << "\"}";
    }
    segments_json << "]";

    std::ostringstream result;
    result
        << "{\"text\":\"" << escape_json(full_text.str())
        << "\",\"language\":\"" << escape_json(language_str)
        << "\",\"canceled\":false,\"segments\":" << segments_json.str() << "}";

    emit_progress(100);

    return env->NewStringUTF(result.str().c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_ai_ivrit_offlinehebrew_WhisperBridge_cancel(
    JNIEnv* /*env*/,
    jobject /*thiz*/
) {
    g_cancel.store(true);
}

extern "C" JNIEXPORT void JNICALL
Java_ai_ivrit_offlinehebrew_WhisperBridge_release(
    JNIEnv* env,
    jobject /*thiz*/
) {
    std::lock_guard<std::mutex> lock(g_mutex);

    g_cancel.store(true);

    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }

    if (g_bridge_class) {
        env->DeleteGlobalRef(g_bridge_class);
        g_bridge_class = nullptr;
    }
    g_progress_method = nullptr;
}

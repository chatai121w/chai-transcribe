use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

use crate::component_manager::{self, SystemProfile};

const PYTHON_VERSION: &str = "3.12.7";
const PYTHON_EMBED_URL: &str =
    "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip";
const GET_PIP_URL: &str = "https://bootstrap.pypa.io/get-pip.py";
const MODEL_ID: &str = "ivrit-ai/whisper-large-v3-turbo-ct2";
const MODEL_REVISION: &str = "72ad623a37947395efcc3933132353790e5a12f5";

const CORE_PACKAGES: &[&str] = &[
    "faster-whisper==1.2.1",
    "ctranslate2==4.8.1",
    "Flask==3.1.3",
    "flask-cors==6.0.5",
    "Flask-Compress==1.24",
    "waitress==3.0.2",
    "huggingface-hub==0.36.2",
    "requests>=2.32,<3",
    "psutil>=5.9,<8",
];

const SERVER_RESOURCES: &[&str] = &[
    "transcribe_server.py",
    "transcript_quality.py",
    "config.py",
    "gpu_utils.py",
    "ai_enhance.py",
    "harmony_engine.py",
    "nikud_engine.py",
    "training_routes.py",
    "train_lora.py",
    "lk_data.db",
];

fn data_dir() -> PathBuf {
    dirs::data_local_dir()
        .expect("LOCALAPPDATA not found")
        .join("SmartHebrewTranscriber")
}

fn emit(app: &AppHandle, component: &str, stage: &str, percent: u32, message: &str) {
    let _ = app.emit(
        "setup-progress",
        serde_json::json!({
            "component": component,
            "stage": stage,
            "percent": percent,
            "message": message,
        }),
    );
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

async fn download_file(
    url: &str,
    dest: &Path,
    app: &AppHandle,
    component: &str,
    stage: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;
    let partial = dest.with_extension(format!(
        "{}.partial",
        dest.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
    ));
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("SmartHebrewTranscriber/0.1")
        .build()
        .map_err(|e| format!("Failed to initialize downloader: {e:#}"))?;
    let mut last_error = String::new();

    for attempt in 1..=4 {
        let existing = std::fs::metadata(&partial)
            .map(|value| value.len())
            .unwrap_or(0);
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("Request failed: {error:#}");
                emit(
                    app,
                    component,
                    stage,
                    0,
                    &format!("החיבור נקטע; ניסיון חוזר {attempt}/4..."),
                );
                tokio::time::sleep(std::time::Duration::from_secs(2_u64.pow(attempt))).await;
                continue;
            }
        };
        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            last_error = format!("Download failed with HTTP {}", response.status());
            if !response.status().is_server_error()
                && response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS
            {
                return Err(last_error);
            }
            tokio::time::sleep(std::time::Duration::from_secs(2_u64.pow(attempt))).await;
            continue;
        }

        let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut downloaded = if resumed { existing } else { 0 };
        let total = response.content_length().unwrap_or(0) + downloaded;
        let mut file = if resumed {
            OpenOptions::new()
                .append(true)
                .open(&partial)
                .map_err(|e| e.to_string())?
        } else {
            File::create(&partial).map_err(|e| e.to_string())?
        };
        let mut stream = response.bytes_stream();
        let mut stream_complete = true;
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    file.write_all(&bytes).map_err(|e| e.to_string())?;
                    downloaded += bytes.len() as u64;
                    if total > 0 {
                        emit(
                            app,
                            component,
                            stage,
                            ((downloaded * 100) / total).min(100) as u32,
                            &format!("{} / {} MB", downloaded / 1_048_576, total / 1_048_576),
                        );
                    }
                }
                Err(error) => {
                    last_error = format!("Download stream interrupted: {error:#}");
                    stream_complete = false;
                    break;
                }
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        if stream_complete {
            std::fs::rename(&partial, dest).map_err(|e| e.to_string())?;
            return Ok(());
        }
        emit(
            app,
            component,
            stage,
            0,
            &format!("ההורדה נקטעה; ממשיך מאותה נקודה ({attempt}/4)..."),
        );
        tokio::time::sleep(std::time::Duration::from_secs(2_u64.pow(attempt))).await;
    }

    Err(format!("Download failed after 4 attempts: {last_error}"))
}

fn run_cmd(command: &mut Command, label: &str) -> Result<(), String> {
    let output = command.output().map_err(|e| format!("{label}: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "{label} failed: {}{}",
        stdout.trim(),
        stderr.trim()
    ))
}

async fn run_cmd_async(mut command: Command, label: &str) -> Result<(), String> {
    let label = label.to_owned();
    let worker_label = label.clone();
    tokio::task::spawn_blocking(move || run_cmd(&mut command, &worker_label))
        .await
        .map_err(|error| format!("{label} worker failed: {error}"))?
}

async fn unzip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let archive = zip_path.to_path_buf();
    let destination = dest.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let status = hidden_command("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &format!(
                    "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                    archive.display(),
                    destination.display()
                ),
            ])
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Expand-Archive failed".into())
        }
    })
    .await
    .map_err(|error| format!("archive worker failed: {error}"))?
}

fn venv_python() -> PathBuf {
    data_dir().join("venv/Scripts/python.exe")
}

fn venv_pip() -> PathBuf {
    data_dir().join("venv/Scripts/pip.exe")
}

async fn ensure_python(app: &AppHandle) -> Result<(), String> {
    let root = data_dir();
    let python_dir = root.join("python");
    let venv_dir = root.join("venv");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    if !python_dir.join("python.exe").exists() {
        emit(
            app,
            "core-runtime",
            "python",
            0,
            "מוריד סביבת Python פרטית...",
        );
        let archive = root.join("python-embed.zip");
        download_file(PYTHON_EMBED_URL, &archive, app, "core-runtime", "python").await?;
        std::fs::create_dir_all(&python_dir).map_err(|e| e.to_string())?;
        emit(app, "core-runtime", "python", 100, "מחלץ Python...");
        unzip(&archive, &python_dir).await?;
        let _ = std::fs::remove_file(archive);
        for entry in std::fs::read_dir(&python_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("python") && name.ends_with("._pth") {
                let content = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
                std::fs::write(entry.path(), content.replace("#import site", "import site"))
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    let embedded_python = python_dir.join("python.exe");
    if !python_dir.join("Scripts/pip.exe").exists() {
        emit(app, "core-runtime", "pip", 0, "מתקין מנהל חבילות פרטי...");
        let installer = root.join("get-pip.py");
        download_file(GET_PIP_URL, &installer, app, "core-runtime", "pip").await?;
        let mut command = hidden_command(&embedded_python);
        command.arg(&installer);
        run_cmd_async(command, "install pip").await?;
        let _ = std::fs::remove_file(installer);
    }

    if !venv_python().exists() {
        emit(app, "core-runtime", "venv", 20, "יוצר סביבת מנוע מבודדת...");
        let mut install_virtualenv = hidden_command(&embedded_python);
        install_virtualenv.args(["-m", "pip", "install", "virtualenv==20.35.4"]);
        run_cmd_async(install_virtualenv, "install virtualenv").await?;
        let mut create_venv = hidden_command(&embedded_python);
        create_venv.args(["-m", "virtualenv", &venv_dir.to_string_lossy()]);
        run_cmd_async(create_venv, "create virtual environment").await?;
    }
    Ok(())
}

fn copy_server_resources(app: &AppHandle) -> Result<(), String> {
    let destination = data_dir().join("server");
    std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    for file_name in SERVER_RESOURCES {
        let resource = app
            .path()
            .resolve(
                format!("resources/server/{file_name}"),
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| e.to_string())?;
        if !resource.exists() {
            return Err(format!(
                "Bundled server resource is missing: {}",
                resource.display()
            ));
        }
        std::fs::copy(resource, destination.join(file_name)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn install_core(app: &AppHandle) -> Result<(), String> {
    ensure_python(app).await?;
    emit(
        app,
        "core-runtime",
        "dependencies",
        10,
        "מתקין מנוע תמלול מקומי...",
    );
    let mut args = vec!["install", "--disable-pip-version-check", "--no-input"];
    args.extend(CORE_PACKAGES.iter().copied());
    let mut install_packages = hidden_command(venv_pip());
    install_packages.args(args);
    run_cmd_async(install_packages, "install core packages").await?;
    emit(app, "core-runtime", "server", 85, "מעתיק קבצי שרת...");
    copy_server_resources(app)?;
    let mut verify = hidden_command(venv_python());
    verify
        .args([
            "-c",
            "import faster_whisper, ctranslate2, flask, flask_compress, transcript_quality; print('ok')",
        ])
        .current_dir(data_dir().join("server"));
    run_cmd_async(verify, "verify core runtime").await?;
    component_manager::write_marker("core-runtime", "1.0.0")?;
    emit(app, "core-runtime", "done", 100, "מנוע התמלול הותקן ואומת.");
    Ok(())
}

async fn install_cuda(app: &AppHandle, profile: &SystemProfile) -> Result<(), String> {
    if !profile.gpu.cuda_compatible {
        return Err("המחשב אינו עומד בדרישות חבילת CUDA; מצב CPU נשאר זמין.".into());
    }
    if !venv_python().exists() {
        return Err("יש להתקין תחילה את מנוע התמלול המקומי.".into());
    }
    emit(
        app,
        "cuda-runtime",
        "download",
        5,
        "מוריד ספריות CUDA מקומיות...",
    );
    let mut command = hidden_command(venv_pip());
    command.args([
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "nvidia-cublas-cu12>=12,<13",
        "nvidia-cudnn-cu12>=9,<10",
    ]);
    run_cmd_async(command, "install CUDA runtime").await?;
    component_manager::write_marker("cuda-runtime", "cuda12-cudnn9")?;
    emit(app, "cuda-runtime", "done", 100, "האצת CUDA הותקנה.");
    Ok(())
}

async fn install_model(app: &AppHandle) -> Result<(), String> {
    if !venv_python().exists() {
        return Err("יש להתקין תחילה את מנוע התמלול המקומי.".into());
    }
    let hf_home = data_dir().join("models/huggingface");
    std::fs::create_dir_all(&hf_home).map_err(|e| e.to_string())?;
    emit(
        app,
        "hebrew-model",
        "download",
        5,
        "מוריד מודל עברי מקובע לגרסה שנבדקה...",
    );
    let script = format!(
        "from huggingface_hub import snapshot_download; snapshot_download(repo_id={MODEL_ID:?}, revision={MODEL_REVISION:?}, cache_dir=r{cache:?}, max_workers=4)",
        cache = hf_home.to_string_lossy()
    );
    let mut command = hidden_command(venv_python());
    command.args(["-c", &script]);
    run_cmd_async(command, "download Hebrew model").await?;
    component_manager::write_marker("hebrew-model", MODEL_REVISION)?;
    emit(
        app,
        "hebrew-model",
        "done",
        100,
        "המודל העברי הורד ואומת על ידי Hugging Face.",
    );
    Ok(())
}

async fn install_advanced(app: &AppHandle, profile: &SystemProfile) -> Result<(), String> {
    if !venv_python().exists() {
        return Err("יש להתקין תחילה את מנוע התמלול המקומי.".into());
    }
    emit(
        app,
        "advanced-speech",
        "download",
        5,
        "מוריד PyTorch וזיהוי דוברים...",
    );
    let mut install_speech = hidden_command(venv_pip());
    install_speech.args([
        "install",
        "whisperx==3.8.6",
        "pyannote-audio==4.0.7",
        "omegaconf==2.3.1",
    ]);
    run_cmd_async(install_speech, "install advanced speech packages").await?;
    // WhisperX may replace Torch while resolving dependencies. Restore the
    // hardware-specific, validated build as the final dependency step.
    let (torch_version, index_url, marker_version) = if profile.gpu.cuda_compatible {
        (
            "2.8.0+cu128",
            "https://download.pytorch.org/whl/cu128",
            "1.0.0-cuda128",
        )
    } else {
        (
            "2.8.0+cpu",
            "https://download.pytorch.org/whl/cpu",
            "1.0.0-cpu",
        )
    };
    let torch_spec = format!("torch=={torch_version}");
    let torchaudio_spec = format!("torchaudio=={torch_version}");
    let mut install_torch = hidden_command(venv_pip());
    install_torch.args([
        "install",
        "--force-reinstall",
        "--no-deps",
        &torch_spec,
        &torchaudio_spec,
        "--index-url",
        index_url,
    ]);
    run_cmd_async(install_torch, "install hardware-specific PyTorch").await?;
    component_manager::write_marker("advanced-speech", marker_version)?;
    emit(
        app,
        "advanced-speech",
        "done",
        100,
        "חבילת זיהוי הדוברים הותקנה.",
    );
    Ok(())
}

pub async fn install_component(app: &AppHandle, component_id: &str) -> Result<String, String> {
    match component_id {
        "core-runtime" => install_core(app).await?,
        "cuda-runtime" => install_cuda(app, &component_manager::system_profile()).await?,
        "hebrew-model" => install_model(app).await?,
        "advanced-speech" => install_advanced(app, &component_manager::system_profile()).await?,
        _ => return Err(format!("Unknown component: {component_id}")),
    }
    Ok(component_id.into())
}

pub async fn run_setup(app: &AppHandle) -> Result<String, String> {
    install_core(app).await?;
    let profile = component_manager::system_profile();
    if profile.gpu.cuda_compatible {
        install_cuda(app, &profile).await?;
    }
    install_model(app).await?;
    Ok("ok".into())
}

pub fn python_version() -> &'static str {
    PYTHON_VERSION
}

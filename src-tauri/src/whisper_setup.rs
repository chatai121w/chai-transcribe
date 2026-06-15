// First-run setup: downloads Python embeddable + creates venv + installs deps
// + copies server script. Emits progress events to the frontend.

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

const PYTHON_EMBED_URL: &str =
    "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip";
const GET_PIP_URL: &str = "https://bootstrap.pypa.io/get-pip.py";

fn data_dir() -> PathBuf {
    dirs::data_local_dir()
        .expect("LOCALAPPDATA not found")
        .join("SmartHebrewTranscriber")
}

fn emit(app: &AppHandle, stage: &str, percent: u32, message: &str) {
    let _ = app.emit(
        "setup-progress",
        serde_json::json!({
            "stage": stage,
            "percent": percent,
            "message": message,
        }),
    );
}

async fn download_file(url: &str, dest: &Path, app: &AppHandle, stage: &str) -> Result<(), String> {
    use futures_util::StreamExt;
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        if total > 0 {
            let pct = ((downloaded * 100) / total) as u32;
            emit(app, stage, pct, &format!("Downloaded {} / {} bytes", downloaded, total));
        }
    }
    Ok(())
}

fn unzip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    // Use PowerShell's Expand-Archive (always available on Windows)
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &format!(
                "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                zip_path.display(),
                dest.display()
            ),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Expand-Archive failed".into());
    }
    Ok(())
}

fn run_cmd(cmd: &mut Command, label: &str) -> Result<(), String> {
    let status = cmd.status().map_err(|e| format!("{}: {}", label, e))?;
    if !status.success() {
        return Err(format!("{} failed (exit {:?})", label, status.code()));
    }
    Ok(())
}

pub async fn run_setup(app: &AppHandle) -> Result<String, String> {
    let root = data_dir();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let py_dir = root.join("python");
    let venv_dir = root.join("venv");
    let server_dir = root.join("server");

    // ---- 1. Python embeddable ----
    if !py_dir.join("python.exe").exists() {
        emit(app, "python", 0, "Downloading Python 3.12...");
        let zip = root.join("python-embed.zip");
        download_file(PYTHON_EMBED_URL, &zip, app, "python").await?;
        emit(app, "python", 100, "Extracting Python...");
        std::fs::create_dir_all(&py_dir).ok();
        unzip(&zip, &py_dir)?;
        std::fs::remove_file(&zip).ok();

        // Enable site-packages so pip works
        for entry in std::fs::read_dir(&py_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let s = name.to_string_lossy();
            if s.starts_with("python") && s.ends_with("._pth") {
                let path = entry.path();
                let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let new_content = content.replace("#import site", "import site");
                std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
            }
        }
    }

    let py_exe = py_dir.join("python.exe");

    // ---- 2. pip ----
    if !py_dir.join("Scripts").join("pip.exe").exists() {
        emit(app, "pip", 0, "Installing pip...");
        let get_pip = root.join("get-pip.py");
        download_file(GET_PIP_URL, &get_pip, app, "pip").await?;
        run_cmd(Command::new(&py_exe).arg(&get_pip), "get-pip")?;
        std::fs::remove_file(&get_pip).ok();
    }

    // ---- 3. virtualenv + venv ----
    if !venv_dir.join("Scripts").join("python.exe").exists() {
        emit(app, "venv", 0, "Creating virtual environment...");
        run_cmd(
            Command::new(&py_exe).args(["-m", "pip", "install", "virtualenv"]),
            "install virtualenv",
        )?;
        run_cmd(
            Command::new(&py_exe).args(["-m", "virtualenv", venv_dir.to_str().unwrap()]),
            "create venv",
        )?;
    }

    let venv_pip = venv_dir.join("Scripts").join("pip.exe");
    let venv_py = venv_dir.join("Scripts").join("python.exe");

    // ---- 4. PyTorch (CUDA 12.8) ----
    emit(app, "torch", 0, "Installing PyTorch with CUDA (this can take 5-10 minutes)...");
    run_cmd(
        Command::new(&venv_pip).args([
            "install",
            "torch",
            "torchaudio",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
        ]),
        "install torch",
    )?;

    // ---- 5. faster-whisper + flask ----
    emit(app, "deps", 0, "Installing faster-whisper + Flask...");
    run_cmd(
        Command::new(&venv_pip).args([
            "install",
            "faster-whisper",
            "flask",
            "flask-cors",
            "waitress",
            "requests",
        ]),
        "install whisper deps",
    )?;

    // ---- 6. Copy server script (bundled as resource) ----
    emit(app, "server", 0, "Installing server files...");
    std::fs::create_dir_all(&server_dir).ok();
    // The transcribe_server.py is bundled as a Tauri resource.
    let resource_path = app
        .path()
        .resolve("resources/transcribe_server.py", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if resource_path.exists() {
        std::fs::copy(&resource_path, server_dir.join("transcribe_server.py"))
            .map_err(|e| e.to_string())?;
    } else {
        return Err(format!(
            "Bundled server script not found at {}",
            resource_path.display()
        ));
    }

    // Sanity check
    if !venv_py.exists() {
        return Err("Setup completed but venv python missing".into());
    }

    emit(app, "done", 100, "Setup complete!");
    Ok("ok".into())
}

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

mod whisper_setup;

/// Holds the running Python whisper server process.
struct ServerState(Mutex<Option<Child>>);

/// Returns %LOCALAPPDATA%\SmartHebrewTranscriber on Windows.
fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().expect("LOCALAPPDATA not found");
    base.join("SmartHebrewTranscriber")
}

fn venv_python() -> PathBuf {
    app_data_dir().join("venv").join("Scripts").join("python.exe")
}

fn server_script() -> PathBuf {
    app_data_dir().join("server").join("transcribe_server.py")
}

#[tauri::command]
fn is_setup_complete() -> bool {
    venv_python().exists() && server_script().exists()
}

#[tauri::command]
fn get_app_data_dir() -> String {
    app_data_dir().to_string_lossy().to_string()
}

#[tauri::command]
async fn run_setup(app: tauri::AppHandle) -> Result<String, String> {
    whisper_setup::run_setup(&app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_whisper_server(state: State<'_, ServerState>) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(None) = child.try_wait() {
            return Ok("already running".into());
        }
    }

    let python = venv_python();
    let script = server_script();
    if !python.exists() {
        return Err(format!("Python not found at {}", python.display()));
    }
    if !script.exists() {
        return Err(format!("Server script not found at {}", script.display()));
    }

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--port")
        .arg("3000")
        .current_dir(app_data_dir())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok("started".into())
}

#[tauri::command]
fn stop_whisper_server(state: State<'_, ServerState>) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        return Ok("stopped".into());
    }
    Ok("not running".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(ServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            is_setup_complete,
            get_app_data_dir,
            run_setup,
            start_whisper_server,
            stop_whisper_server
        ])
        .setup(|app| {
            // Ensure data directory exists
            let _ = std::fs::create_dir_all(app_data_dir());
            // Auto-start server if setup complete
            if is_setup_complete() {
                let state: State<ServerState> = app.state();
                let _ = start_whisper_server(state);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<ServerState> = window.state();
                let _ = stop_whisper_server(state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


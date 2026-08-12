use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

mod component_manager;
mod whisper_setup;

/// Holds the running Python whisper server process.
struct ServerState(Mutex<Option<Child>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundInstallSnapshot {
    status: String,
    components: Vec<String>,
    current_component: Option<String>,
    completed_components: Vec<String>,
    error: Option<String>,
}

impl Default for BackgroundInstallSnapshot {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            components: Vec::new(),
            current_component: None,
            completed_components: Vec::new(),
            error: None,
        }
    }
}

struct BackgroundInstallState(Mutex<BackgroundInstallSnapshot>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerLaunchResult {
    status: String,
    port: u16,
    server_url: String,
}

/// Returns %LOCALAPPDATA%\SmartHebrewTranscriber on Windows.
fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().expect("LOCALAPPDATA not found");
    base.join("SmartHebrewTranscriber")
}

fn venv_python() -> PathBuf {
    app_data_dir()
        .join("venv")
        .join("Scripts")
        .join("python.exe")
}

fn server_script() -> PathBuf {
    app_data_dir().join("server").join("transcribe_server.py")
}

fn server_port_file() -> PathBuf {
    app_data_dir().join("server-port.txt")
}

fn find_available_server_port() -> Result<u16, String> {
    for port in 3000..3020 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free local transcription port found in range 3000-3019".into())
}

#[tauri::command]
fn is_setup_complete() -> bool {
    let server_dir = server_script()
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default();
    venv_python().exists()
        && server_script().exists()
        && server_dir.join("transcript_quality.py").exists()
        && server_dir.join("config.py").exists()
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
fn get_system_profile() -> component_manager::SystemProfile {
    component_manager::system_profile()
}

#[tauri::command]
fn get_component_statuses() -> Vec<component_manager::ComponentStatus> {
    let profile = component_manager::system_profile();
    component_manager::component_statuses(&profile)
}

#[tauri::command]
async fn install_component(app: tauri::AppHandle, component_id: String) -> Result<String, String> {
    whisper_setup::install_component(&app, &component_id).await
}

fn ordered_component_ids(
    component_ids: Vec<String>,
    include_core: bool,
) -> Result<Vec<String>, String> {
    const ORDER: [&str; 4] = [
        "core-runtime",
        "cuda-runtime",
        "hebrew-model",
        "advanced-speech",
    ];
    if component_ids.iter().any(|id| !ORDER.contains(&id.as_str())) {
        return Err("Unknown component requested".into());
    }
    let mut ordered = Vec::new();
    if include_core {
        ordered.push("core-runtime".to_string());
    }
    for id in ORDER {
        if component_ids.iter().any(|candidate| candidate == id)
            && !ordered.iter().any(|candidate| candidate == id)
        {
            ordered.push(id.to_string());
        }
    }
    if ordered.is_empty() {
        return Err("No components selected".into());
    }
    Ok(ordered)
}

fn publish_background_state(
    app: &tauri::AppHandle,
    state: &BackgroundInstallState,
    update: impl FnOnce(&mut BackgroundInstallSnapshot),
) -> BackgroundInstallSnapshot {
    let snapshot = {
        let mut guard = state.0.lock().expect("background install state poisoned");
        update(&mut guard);
        guard.clone()
    };
    let _ = app.emit("background-install-state", snapshot.clone());
    snapshot
}

#[tauri::command]
fn get_background_install_state(
    state: State<'_, BackgroundInstallState>,
) -> BackgroundInstallSnapshot {
    state
        .0
        .lock()
        .expect("background install state poisoned")
        .clone()
}

#[tauri::command]
fn start_background_install(
    app: tauri::AppHandle,
    state: State<'_, BackgroundInstallState>,
    component_ids: Vec<String>,
) -> Result<BackgroundInstallSnapshot, String> {
    let components = ordered_component_ids(component_ids, !is_setup_complete())?;
    {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Background installer state is unavailable")?;
        if guard.status == "running" {
            return Err("התקנה אחרת כבר פועלת ברקע.".into());
        }
    }

    let initial = publish_background_state(&app, &state, |snapshot| {
        snapshot.status = "running".into();
        snapshot.components = components.clone();
        snapshot.current_component = None;
        snapshot.completed_components.clear();
        snapshot.error = None;
    });

    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        for component_id in components {
            let install_state = task_app.state::<BackgroundInstallState>();
            publish_background_state(&task_app, &install_state, |snapshot| {
                snapshot.current_component = Some(component_id.clone());
            });

            if let Err(error) = whisper_setup::install_component(&task_app, &component_id).await {
                let install_state = task_app.state::<BackgroundInstallState>();
                publish_background_state(&task_app, &install_state, |snapshot| {
                    snapshot.status = "failed".into();
                    snapshot.current_component = None;
                    snapshot.error = Some(error);
                });
                return;
            }

            let install_state = task_app.state::<BackgroundInstallState>();
            publish_background_state(&task_app, &install_state, |snapshot| {
                snapshot.completed_components.push(component_id.clone());
            });

            if component_id == "core-runtime" {
                let server_state = task_app.state::<ServerState>();
                match start_whisper_server(server_state) {
                    Ok(result) => {
                        let _ = task_app.emit("local-server-ready", result);
                    }
                    Err(error) => {
                        log::warn!("Core installed but local server did not start: {error}");
                    }
                }
            }
        }

        let install_state = task_app.state::<BackgroundInstallState>();
        publish_background_state(&task_app, &install_state, |snapshot| {
            snapshot.status = "completed".into();
            snapshot.current_component = None;
            snapshot.error = None;
        });
    });

    Ok(initial)
}

#[tauri::command]
fn get_runtime_info() -> serde_json::Value {
    serde_json::json!({
        "pythonVersion": whisper_setup::python_version(),
        "appDataDir": app_data_dir().to_string_lossy(),
        "serverPort": std::fs::read_to_string(server_port_file()).ok().and_then(|value| value.trim().parse::<u16>().ok()),
    })
}

#[tauri::command]
fn start_whisper_server(state: State<'_, ServerState>) -> Result<ServerLaunchResult, String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(None) = child.try_wait() {
            let port = std::fs::read_to_string(server_port_file())
                .ok()
                .and_then(|value| value.trim().parse::<u16>().ok())
                .unwrap_or(3000);
            return Ok(ServerLaunchResult {
                status: "already-running".into(),
                port,
                server_url: format!("http://127.0.0.1:{port}"),
            });
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

    let port = find_available_server_port()?;
    let hf_cache = app_data_dir().join("models/huggingface");
    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(app_data_dir())
        .env("HF_HOME", app_data_dir().join("models"))
        .env("HF_HUB_CACHE", &hf_cache)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    std::fs::write(server_port_file(), port.to_string()).map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok(ServerLaunchResult {
        status: "started".into(),
        port,
        server_url: format!("http://127.0.0.1:{port}"),
    })
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
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(ServerState(Mutex::new(None)))
        .manage(BackgroundInstallState(Mutex::new(
            BackgroundInstallSnapshot::default(),
        )))
        .invoke_handler(tauri::generate_handler![
            is_setup_complete,
            get_app_data_dir,
            get_system_profile,
            get_component_statuses,
            get_runtime_info,
            get_background_install_state,
            start_background_install,
            install_component,
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

#[cfg(test)]
mod tests {
    use super::ordered_component_ids;

    #[test]
    fn background_install_is_deduplicated_and_dependency_ordered() {
        let ordered = ordered_component_ids(
            vec![
                "hebrew-model".into(),
                "core-runtime".into(),
                "hebrew-model".into(),
                "cuda-runtime".into(),
            ],
            false,
        )
        .unwrap();
        assert_eq!(
            ordered,
            vec!["core-runtime", "cuda-runtime", "hebrew-model"]
        );
    }

    #[test]
    fn background_install_rejects_unknown_components() {
        assert!(ordered_component_ids(vec!["unknown".into()], true).is_err());
    }
}

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

const CUDA_12_8_MIN_WINDOWS_DRIVER: u32 = 570;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuProfile {
    pub vendor: String,
    pub name: Option<String>,
    pub vram_mb: Option<u64>,
    pub driver_version: Option<String>,
    pub cuda_reported: Option<String>,
    pub cuda_compatible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub os: String,
    pub architecture: String,
    pub cpu: String,
    pub ram_gb: Option<f64>,
    pub disk_free_gb: Option<f64>,
    pub gpu: GpuProfile,
    pub recommended_mode: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStatus {
    pub id: String,
    pub label: String,
    pub description: String,
    pub estimated_size_mb: u64,
    pub required: bool,
    pub recommended: bool,
    pub installed: bool,
    pub version: Option<String>,
}

fn app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .expect("LOCALAPPDATA not found")
        .join("SmartHebrewTranscriber")
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = hidden_command(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_major(version: &str) -> Option<u32> {
    version.split('.').next()?.trim().parse().ok()
}

fn detect_nvidia_gpu() -> GpuProfile {
    let query = command_output(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ],
    );
    let cuda_reported = command_output("nvidia-smi", &[]).and_then(|text| {
        let marker = "CUDA Version:";
        let start = text.find(marker)? + marker.len();
        Some(
            text[start..]
                .trim_start()
                .split_whitespace()
                .next()?
                .trim()
                .to_string(),
        )
    });

    if let Some(line) = query.and_then(|value| value.lines().next().map(str::to_string)) {
        let parts: Vec<_> = line.split(',').map(str::trim).collect();
        let name = parts
            .first()
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let vram_mb = parts.get(1).and_then(|value| value.parse::<u64>().ok());
        let driver_version = parts
            .get(2)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let driver_ok = driver_version
            .as_deref()
            .and_then(parse_major)
            .map(|major| major >= CUDA_12_8_MIN_WINDOWS_DRIVER)
            .unwrap_or(false);
        return GpuProfile {
            vendor: "nvidia".into(),
            name,
            vram_mb,
            driver_version,
            cuda_reported,
            cuda_compatible: driver_ok && vram_mb.unwrap_or(0) >= 4096,
        };
    }

    let generic_gpu = command_output(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
        ],
    )
    .filter(|value| !value.is_empty());
    let vendor = generic_gpu
        .as_deref()
        .map(|name| {
            let lower = name.to_ascii_lowercase();
            if lower.contains("amd") || lower.contains("radeon") {
                "amd"
            } else if lower.contains("intel") {
                "intel"
            } else {
                "unknown"
            }
        })
        .unwrap_or("none")
        .to_string();

    GpuProfile {
        vendor,
        name: generic_gpu,
        vram_mb: None,
        driver_version: None,
        cuda_reported: None,
        cuda_compatible: false,
    }
}

fn powershell_number(script: &str) -> Option<f64> {
    command_output("powershell", &["-NoProfile", "-Command", script])?
        .replace(',', ".")
        .parse()
        .ok()
}

pub fn system_profile() -> SystemProfile {
    let gpu = detect_nvidia_gpu();
    let ram_gb = powershell_number(
        "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)",
    );
    let disk_free_gb = powershell_number(
        "[math]::Round((Get-PSDrive -Name $env:SystemDrive.Substring(0,1)).Free / 1GB, 1)",
    );
    let cpu = std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| "Unknown CPU".into());
    let os = command_output("cmd", &["/C", "ver"]).unwrap_or_else(|| std::env::consts::OS.into());
    let mut warnings = Vec::new();

    if ram_gb.unwrap_or(0.0) < 8.0 {
        warnings.push("פחות מ־8GB RAM: מומלץ להשתמש במודל קל או במצב CPU חסכוני.".into());
    }
    if disk_free_gb.unwrap_or(0.0) < 8.0 {
        warnings.push("נדרש לפחות 8GB פנויים להתקנת המנוע והמודל העברי.".into());
    }
    if gpu.vendor == "nvidia" && !gpu.cuda_compatible {
        warnings.push(
            "נמצא כרטיס NVIDIA, אך הדרייבר או זיכרון ה־GPU אינם מתאימים לחבילת CUDA המומלצת."
                .into(),
        );
    }
    if gpu.vendor != "nvidia" {
        warnings.push("CUDA דורש כרטיס NVIDIA. המערכת תתקין מצב CPU אוטומטי.".into());
    }

    SystemProfile {
        os,
        architecture: std::env::consts::ARCH.into(),
        cpu,
        ram_gb,
        disk_free_gb,
        recommended_mode: if gpu.cuda_compatible { "cuda" } else { "cpu" }.into(),
        gpu,
        warnings,
    }
}

fn marker_path(component_id: &str) -> PathBuf {
    app_data_dir()
        .join("components")
        .join(component_id)
        .join("installed.json")
}

fn marker_version(component_id: &str) -> Option<String> {
    let data = std::fs::read_to_string(marker_path(component_id)).ok()?;
    serde_json::from_str::<serde_json::Value>(&data)
        .ok()?
        .get("version")?
        .as_str()
        .map(str::to_string)
}

pub fn write_marker(component_id: &str, version: &str) -> Result<(), String> {
    let path = marker_path(component_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        path,
        serde_json::json!({
            "id": component_id,
            "version": version,
            "installedAt": chrono_like_timestamp(),
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())
}

fn chrono_like_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

pub fn component_statuses(profile: &SystemProfile) -> Vec<ComponentStatus> {
    let root = app_data_dir();
    let core_installed = root.join("venv/Scripts/python.exe").exists()
        && root.join("server/transcribe_server.py").exists()
        && root.join("server/transcript_quality.py").exists()
        && root.join("server/config.py").exists();
    let model_installed =
        root.join("models/hebrew-turbo/model.bin").exists() || marker_path("hebrew-model").exists();
    let cuda_installed = marker_path("cuda-runtime").exists();
    let advanced_installed = marker_path("advanced-speech").exists();

    vec![
        ComponentStatus {
            id: "core-runtime".into(),
            label: "מנוע תמלול מקומי".into(),
            description:
                "Python פרטי, faster-whisper ושרת מקומי. אינו משנה את Python או PATH במחשב.".into(),
            estimated_size_mb: 650,
            required: true,
            recommended: true,
            installed: core_installed,
            version: marker_version("core-runtime"),
        },
        ComponentStatus {
            id: "cuda-runtime".into(),
            label: "האצת NVIDIA CUDA".into(),
            description: "ספריות CUDA מקומיות לאפליקציה בלבד; לא מתקין CUDA Toolkit מערכתי.".into(),
            estimated_size_mb: 1100,
            required: false,
            recommended: profile.gpu.cuda_compatible,
            installed: cuda_installed,
            version: marker_version("cuda-runtime"),
        },
        ComponentStatus {
            id: "hebrew-model".into(),
            label: "מודל עברי מומלץ".into(),
            description: "ivrit-ai Whisper large-v3-turbo בפורמט CTranslate2, מקובע לגרסה שנבדקה."
                .into(),
            estimated_size_mb: 1650,
            required: false,
            recommended: true,
            installed: model_installed,
            version: marker_version("hebrew-model"),
        },
        ComponentStatus {
            id: "advanced-speech".into(),
            label: "זיהוי דוברים ויישור מתקדם".into(),
            description: if profile.gpu.cuda_compatible {
                "PyTorch CUDA, WhisperX ו־pyannote. חבילה גדולה ומותקנת רק לפי בחירה."
            } else {
                "PyTorch CPU, WhisperX ו־pyannote. פועל ללא NVIDIA אך יהיה איטי יותר."
            }
            .into(),
            estimated_size_mb: if profile.gpu.cuda_compatible {
                6500
            } else {
                3500
            },
            required: false,
            recommended: false,
            installed: advanced_installed,
            version: marker_version("advanced-speech"),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::parse_major;

    #[test]
    fn parses_nvidia_driver_major_version() {
        assert_eq!(parse_major(" 566.36 "), Some(566));
        assert_eq!(parse_major("528"), Some(528));
    }

    #[test]
    fn rejects_invalid_driver_versions() {
        assert_eq!(parse_major("unknown"), None);
        assert_eq!(parse_major(""), None);
    }
}

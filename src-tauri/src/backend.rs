use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, Url};

/** Packaged VisionOS API server — intentionally uncommon port. */
pub const BACKEND_PORT: u16 = 39247;
/** Bundled SearXNG — intentionally uncommon port. */
pub const SEARXNG_PORT: u16 = 37583;

pub struct ManagedProcesses {
    pub node: Mutex<Option<Child>>,
    pub searxng: Mutex<Option<Child>>,
}

pub fn manage_backend(app: &tauri::App) {
    app.manage(ManagedProcesses {
        node: Mutex::new(None),
        searxng: Mutex::new(None),
    });
}

fn node_binary(resource_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        resource_dir.join("node").join("node.exe")
    } else {
        resource_dir.join("node").join("bin").join("node")
    }
}

fn searxng_python(resource_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        resource_dir
            .join("searxng-venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        resource_dir
            .join("searxng-venv")
            .join("bin")
            .join("python")
    }
}

fn server_entry(resource_dir: &Path) -> PathBuf {
    resource_dir.join("server").join("build").join("index.js")
}

fn searxng_settings(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("searxng")
        .join("core-config")
        .join("settings.yml")
}

fn append_log(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn prepend_node_to_path(cmd: &mut Command, resource_dir: &Path) {
    let node_dir = if cfg!(target_os = "windows") {
        resource_dir.join("node")
    } else {
        resource_dir.join("node").join("bin")
    };
    if !node_dir.is_dir() {
        return;
    }
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = if current.is_empty() {
        node_dir.display().to_string()
    } else {
        format!("{}{}{}", node_dir.display(), sep, current)
    };
    cmd.env("PATH", merged);
}

/** Keep OS basics for child processes; drop inherited API keys and dev `.env` leakage. */
fn apply_isolated_runtime_env(cmd: &mut Command) {
    cmd.env_clear();
    for key in [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "SYSTEMROOT",
        "WINDIR",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "LANG",
        "LC_ALL",
        "XDG_RUNTIME_DIR",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }
}

fn wait_for_url(url: &str, log_path: &Path, label: &str) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if let Ok(response) = ureq::get(url).call() {
            if response.status() == 200 || response.status() == 404 {
                // SearXNG root may 200; health endpoint 200 when ready.
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    append_log(log_path, &format!("Timed out waiting for {label} at {url}"));
    Err(format!("{label} did not become healthy at {url}"))
}

fn spawn_searxng(resource_dir: &Path, log_path: &Path) -> Result<Child, String> {
    let python = searxng_python(resource_dir);
    let settings = searxng_settings(resource_dir);
    if !python.is_file() {
        return Err(format!(
            "Bundled SearXNG Python not found: {}",
            python.display()
        ));
    }
    if !settings.is_file() {
        return Err(format!(
            "SearXNG settings not found: {}",
            settings.display()
        ));
    }

    let searx_log = log_path.with_file_name("searxng.log");
    let log_file = File::options()
        .create(true)
        .append(true)
        .open(&searx_log)
        .map_err(|e| e.to_string())?;

    let mut child_cmd = Command::new(&python);
    apply_isolated_runtime_env(&mut child_cmd);
    prepend_node_to_path(&mut child_cmd, resource_dir);
    let child = child_cmd
        .arg("-m")
        .arg("searx.webapp")
        .current_dir(resource_dir.join("searxng-src"))
        .env("SEARXNG_SETTINGS_PATH", &settings)
        .env("SEARXNG_BIND_ADDRESS", "127.0.0.1")
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|e| format!("Failed to start bundled SearXNG: {e}"))?;

    append_log(
        log_path,
        &format!(
            "Spawned SearXNG pid={} python={}",
            child.id(),
            python.display()
        ),
    );

    Ok(child)
}

/** Windows installs: web search is best-effort — never block app launch on SearXNG. */
fn try_start_searxng(resource_dir: &Path, log_path: &Path) -> Option<Child> {
    let mut child = match spawn_searxng(resource_dir, log_path) {
        Ok(child) => child,
        Err(e) => {
            append_log(
                log_path,
                &format!("WARN: SearXNG did not start; continuing without web search: {e}"),
            );
            return None;
        }
    };

    let searx_url = format!("http://127.0.0.1:{SEARXNG_PORT}/");
    if let Err(e) = wait_for_url(&searx_url, log_path, "SearXNG") {
        append_log(
            log_path,
            &format!("WARN: SearXNG did not become healthy; continuing without web search: {e}"),
        );
        kill_child(&mut child);
        return None;
    }

    Some(child)
}

pub fn start_packaged_backend(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let node = node_binary(&resource_dir);
    let server_js = server_entry(&resource_dir);
    if !node.is_file() {
        return Err(format!("Bundled Node runtime not found: {}", node.display()));
    }
    if !server_js.is_file() {
        return Err(format!(
            "Bundled SvelteKit server not found: {}",
            server_js.display()
        ));
    }

    let log_path = data_dir.join("server.log");

    let searx_child = try_start_searxng(&resource_dir, &log_path);
    let searxng_optional = searx_child.is_none();

    let log_file = File::options()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;

    let workspace_dir = data_dir.join("workspace");
    fs::create_dir_all(&workspace_dir).map_err(|e| e.to_string())?;
    let hf_cache = data_dir.join("hf-cache");
    fs::create_dir_all(&hf_cache).map_err(|e| e.to_string())?;
    let transcripts_dir = data_dir.join("transcripts");
    fs::create_dir_all(&transcripts_dir).map_err(|e| e.to_string())?;

    let searx_base = format!("http://127.0.0.1:{SEARXNG_PORT}");

    let mut node_cmd = Command::new(&node);
    apply_isolated_runtime_env(&mut node_cmd);
    prepend_node_to_path(&mut node_cmd, &resource_dir);
    let mut node_child = node_cmd
        .arg(&server_js)
        .current_dir(resource_dir.join("server"))
        .env("VISIONOS_PACKAGED", "true")
        .env("VISIONOS_ROOT", &resource_dir)
        .env("VISIONOS_DATA_DIR", &data_dir)
        .env("VISIONOS_SERVER_ROOT", resource_dir.join("server"))
        .env("HOST", "127.0.0.1")
        .env("PORT", BACKEND_PORT.to_string())
        .env("SEARXNG_API_BASE", &searx_base)
        .env("SEARXNG_AUTO_START", "false")
        .env(
            "SEARXNG_OPTIONAL",
            if searxng_optional { "true" } else { "false" },
        )
        .env("DATABASE_PATH", data_dir.join("jarvis.db"))
        .env("WORKSPACE_DIR", &workspace_dir)
        .env("TRANSCRIPT_DIR", &transcripts_dir)
        .env("HF_HOME", &hf_cache)
        .env("TRANSFORMERS_CACHE", &hf_cache)
        .env("HUGGINGFACE_HUB_CACHE", &hf_cache)
        .stdout(Stdio::from(log_file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|e| format!("Failed to start VisionOS backend: {e}"))?;

    append_log(
        &log_path,
        &format!(
            "Spawned backend pid={} node={} server={}",
            node_child.id(),
            node.display(),
            server_js.display()
        ),
    );

    // Do not gate app launch on /api/health because it can report degraded
    // (e.g. missing LLM/search) even when the backend is up and UI can load.
    let backend_url = format!("http://127.0.0.1:{BACKEND_PORT}/");
    wait_for_url(&backend_url, &log_path, "VisionOS backend")?;

    if let Some(state) = app.try_state::<ManagedProcesses>() {
        let mut searx_guard = state.searxng.lock().map_err(|e| e.to_string())?;
        let mut node_guard = state.node.lock().map_err(|e| e.to_string())?;
        *searx_guard = searx_child;
        *node_guard = Some(node_child);
    } else {
        let _ = node_child.kill();
        if let Some(mut child) = searx_child {
            kill_child(&mut child);
        }
        return Err("Process state was not initialized".into());
    }

    Ok(())
}

pub fn navigate_main_window(app: &AppHandle, port: u16) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let url = format!("http://127.0.0.1:{port}/");
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;

    if let Err(e) = window.navigate(parsed.clone()) {
        log::warn!("window.navigate failed ({e}); falling back to location.replace");
        let escaped = url.replace('\\', "\\\\").replace('\'', "\\'");
        window
            .eval(&format!("window.location.replace('{escaped}')"))
            .map_err(|e| e.to_string())?;
    }

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if !matches!(event, RunEvent::Exit) {
        return;
    }
    if let Some(state) = app.try_state::<ManagedProcesses>() {
        if let Ok(mut guard) = state.node.lock() {
            if let Some(mut child) = guard.take() {
                kill_child(&mut child);
            }
        }
        if let Ok(mut guard) = state.searxng.lock() {
            if let Some(mut child) = guard.take() {
                kill_child(&mut child);
            }
        }
    }
}

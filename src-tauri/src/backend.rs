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

/** Reports real packaged startup progress to the boot splash webview. */
#[derive(Clone)]
pub struct StartupReporter {
    app: AppHandle,
}

impl StartupReporter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn step(&self, progress: u8, status: &str) {
        self.emit(progress, status, None);
    }

    pub fn step_detail(&self, progress: u8, status: &str, detail: &str) {
        self.emit(progress, status, Some(detail));
    }

    fn emit(&self, progress: u8, status: &str, detail: Option<&str>) {
        let app = self.app.clone();
        let status = status.to_string();
        let detail = detail.map(str::to_string);
        let progress = progress.min(100);
        let _ = self.app.run_on_main_thread(move || {
            emit_boot_progress(&app, progress, &status, detail.as_deref());
        });
    }
}

fn emit_boot_progress(app: &AppHandle, progress: u8, status: &str, detail: Option<&str>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let payload = serde_json::json!({
        "progress": progress,
        "status": status,
        "detail": detail,
    });
    let script = format!("window.visionOSBoot?.update({payload})");
    let _ = window.eval(&script);
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

fn prepend_path_dirs(cmd: &mut Command, dirs: &[PathBuf]) {
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut prefix = Vec::new();
    for dir in dirs {
        if dir.is_dir() {
            prefix.push(dir.display().to_string());
        }
    }
    if prefix.is_empty() {
        return;
    }
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = if current.is_empty() {
        prefix.join(sep)
    } else {
        format!("{}{}{}", prefix.join(sep), sep, current)
    };
    cmd.env("PATH", merged);
}

fn prepend_node_to_path(cmd: &mut Command, resource_dir: &Path) {
    let node_dir = if cfg!(target_os = "windows") {
        resource_dir.join("node")
    } else {
        resource_dir.join("node").join("bin")
    };
    prepend_path_dirs(cmd, &[node_dir]);
}

fn prepend_python_runtime(cmd: &mut Command, resource_dir: &Path) {
    let venv = resource_dir.join("searxng-venv");
    let venv_bin = if cfg!(target_os = "windows") {
        venv.join("Scripts")
    } else {
        venv.join("bin")
    };

    if venv.is_dir() {
        cmd.env("VIRTUAL_ENV", &venv);
    }

    // Do not set PYTHONHOME — it breaks venv interpreters relocated after CI packaging.
    prepend_path_dirs(cmd, &[venv_bin]);
}

fn bundled_python_home(resource_dir: &Path) -> PathBuf {
    resource_dir.join("python")
}

fn bundled_python_exe(resource_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        bundled_python_home(resource_dir).join("python.exe")
    } else {
        bundled_python_home(resource_dir).join("bin").join("python3")
    }
}

fn searxng_venv_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("searxng-venv")
}

fn searxng_site_packages_glob(resource_dir: &Path) -> PathBuf {
    let venv = searxng_venv_dir(resource_dir);
    if cfg!(target_os = "windows") {
        return venv.join("Lib").join("site-packages");
    }
    let lib = venv.join("lib");
    if let Ok(entries) = fs::read_dir(&lib) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("python") {
                let site = entry.path().join("site-packages");
                if site.is_dir() {
                    return site;
                }
            }
        }
    }
    lib.join("python3.12").join("site-packages")
}

fn verify_searxng_import(resource_dir: &Path) -> bool {
    let vpy = searxng_python(resource_dir);
    if !vpy.is_file() {
        return false;
    }
    let mut cmd = Command::new(&vpy);
    apply_isolated_runtime_env(&mut cmd);
    prepend_python_runtime(&mut cmd, resource_dir);
    apply_hidden_child_process(&mut cmd);
    cmd.arg("-c")
        .arg(if cfg!(target_os = "windows") {
            "from searx import limiter"
        } else {
            "import searx"
        })
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn write_packaged_pyvenv_cfg(resource_dir: &Path) -> Result<(), String> {
    let venv_dir = searxng_venv_dir(resource_dir);
    let python_home = bundled_python_home(resource_dir);
    let python_exe = bundled_python_exe(resource_dir);
    let content = format!(
        "home = {}\ninclude-system-site-packages = false\nexecutable = {}\ncommand = {} -m venv {}\n",
        python_home.display(),
        python_exe.display(),
        python_exe.display(),
        venv_dir.display()
    );
    fs::write(venv_dir.join("pyvenv.cfg"), content).map_err(|e| e.to_string())
}

fn patch_editable_searxng_finders(resource_dir: &Path) -> Result<(), String> {
    let site = searxng_site_packages_glob(resource_dir);
    if !site.is_dir() {
        return Ok(());
    }

    let searx_pkg = resource_dir.join("searxng-src").join("searx");
    let searx_path = searx_pkg
        .to_string_lossy()
        .replace('\\', "/");

    for entry in fs::read_dir(&site).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.starts_with("__editable___searxng") || !file_name.ends_with("_finder.py") {
            continue;
        }

        let path = entry.path();
        let mut text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let Some(start) = text.find("MAPPING:") else {
            continue;
        };
        let Some(rel_end) = text[start..].find('\n') else {
            continue;
        };
        let end = start + rel_end;
        let replacement = format!("MAPPING: dict[str, str] = {{'searx': '{searx_path}'}}");
        text.replace_range(start..end, &replacement);
        fs::write(&path, text).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn rebuild_searxng_venv(resource_dir: &Path, log_path: &Path) -> Result<(), String> {
    let script = resource_dir.join("scripts").join("ensure-packaged-searxng.mjs");
    if !script.is_file() {
        return Err(format!(
            "SearXNG repair script missing: {}",
            script.display()
        ));
    }

    append_log(log_path, "Rebuilding bundled SearXNG virtualenv…");

    let node = node_binary(resource_dir);
    let mut cmd = Command::new(&node);
    apply_isolated_runtime_env(&mut cmd);
    prepend_node_to_path(&mut cmd, resource_dir);
    apply_hidden_child_process(&mut cmd);
    let status = cmd
        .arg(&script)
        .env("VISIONOS_BUNDLE_ROOT", resource_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("Failed to rebuild SearXNG venv: {e}"))?;

    if !status.success() {
        return Err("SearXNG virtualenv rebuild failed (see searxng.log)".into());
    }

    Ok(())
}

fn patch_valkeydb_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }

    let mut text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if text.contains("VISIONOS_WINDOWS_VALKEY_GUARD") {
        return Ok(false);
    }
    if !text.contains("import pwd") {
        return Ok(false);
    }

    text = text.replace(
        "import os\r\nimport pwd\r\nimport logging",
        "import os\n\ntry:\n    import pwd\nexcept ImportError:  # VISIONOS_WINDOWS_VALKEY_GUARD\n    pwd = None  # type: ignore\n\nimport logging",
    );
    text = text.replace(
        "import os\nimport pwd\nimport logging",
        "import os\n\ntry:\n    import pwd\nexcept ImportError:  # VISIONOS_WINDOWS_VALKEY_GUARD\n    pwd = None  # type: ignore\n\nimport logging",
    );
    text = text.replace(
        "        _pw = pwd.getpwuid(os.getuid())\r\n        logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)",
        "        if pwd is not None:\r\n            _pw = pwd.getpwuid(os.getuid())\r\n            logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)\r\n        else:\r\n            logger.exception(\"can't connect valkey DB ...\")",
    );
    text = text.replace(
        "        _pw = pwd.getpwuid(os.getuid())\n        logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)",
        "        if pwd is not None:\n            _pw = pwd.getpwuid(os.getuid())\n            logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)\n        else:\n            logger.exception(\"can't connect valkey DB ...\")",
    );

    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

fn patch_searxng_windows_sources(resource_dir: &Path) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }

    let src_valkeydb = resource_dir
        .join("searxng-src")
        .join("searx")
        .join("valkeydb.py");
    let _ = patch_valkeydb_file(&src_valkeydb)?;

    let site_valkeydb = searxng_site_packages_glob(resource_dir)
        .join("searx")
        .join("valkeydb.py");
    let _ = patch_valkeydb_file(&site_valkeydb)?;

    Ok(())
}

/** CI-built venvs embed absolute paths; repair them after install to the user's machine. */
fn ensure_searxng_venv(resource_dir: &Path, log_path: &Path) -> Result<(), String> {
    patch_searxng_windows_sources(resource_dir)?;

    if verify_searxng_import(resource_dir) {
        return Ok(());
    }

    append_log(
        log_path,
        "WARN: SearXNG venv not importable; repairing packaged Python paths…",
    );

    write_packaged_pyvenv_cfg(resource_dir)?;
    patch_editable_searxng_finders(resource_dir)?;

    if verify_searxng_import(resource_dir) {
        append_log(log_path, "SearXNG venv repaired successfully.");
        return Ok(());
    }

    rebuild_searxng_venv(resource_dir, log_path)?;

    if verify_searxng_import(resource_dir) {
        append_log(log_path, "SearXNG venv rebuilt successfully.");
        return Ok(());
    }

    Err("SearXNG virtualenv is not usable after repair".into())
}

#[cfg(windows)]
fn apply_hidden_child_process(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_hidden_child_process(_cmd: &mut Command) {}

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
        "PATHEXT",
        "COMSPEC",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
    ] {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }
}

fn wait_for_url_with_progress(
    url: &str,
    log_path: &Path,
    label: &str,
    max_wait: Duration,
    reporter: Option<&StartupReporter>,
    progress_start: u8,
    progress_end: u8,
    status: &str,
) -> Result<(), String> {
    let started = Instant::now();
    let range = progress_end.saturating_sub(progress_start) as f32;
    let deadline = started + max_wait;

    while Instant::now() < deadline {
        if let Ok(response) = ureq::get(url).call() {
            if response.status() == 200 || response.status() == 404 {
                if let Some(r) = reporter {
                    if !status.is_empty() {
                        r.step(progress_end, status);
                    }
                }
                return Ok(());
            }
        }

        if let Some(r) = reporter {
            if !status.is_empty() && max_wait.as_secs_f32() > 0.0 {
                let fraction = (started.elapsed().as_secs_f32() / max_wait.as_secs_f32()).min(1.0);
                let pct = progress_start as f32 + range * fraction;
                r.step(pct as u8, status);
            }
        }

        std::thread::sleep(Duration::from_millis(400));
    }

    append_log(
        log_path,
        &format!("Timed out waiting for {label} at {url} ({max_wait:?})"),
    );
    Err(format!("{label} did not become healthy at {url}"))
}

fn searxng_startup_wait() -> Duration {
    if cfg!(target_os = "windows") {
        Duration::from_secs(60)
    } else {
        Duration::from_secs(60)
    }
}

fn spawn_searxng(resource_dir: &Path, log_path: &Path) -> Result<Child, String> {
    ensure_searxng_venv(resource_dir, log_path)?;

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
    prepend_python_runtime(&mut child_cmd, resource_dir);
    prepend_node_to_path(&mut child_cmd, resource_dir);
    apply_hidden_child_process(&mut child_cmd);
    let child = child_cmd
        .arg("-m")
        .arg("searx.webapp")
        .current_dir(resource_dir.join("searxng-src"))
        .env("SEARXNG_SETTINGS_PATH", &settings)
        .env("SEARXNG_BIND_ADDRESS", "127.0.0.1")
        .env("SEARXNG_PORT", SEARXNG_PORT.to_string())
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
fn try_start_searxng(
    resource_dir: &Path,
    log_path: &Path,
    reporter: &StartupReporter,
) -> Option<Child> {
    reporter.step(14, "Starting web search (SearXNG)…");

    let mut child = match spawn_searxng(resource_dir, log_path) {
        Ok(child) => child,
        Err(e) => {
            append_log(
                log_path,
                &format!("WARN: SearXNG did not start; continuing without web search: {e}"),
            );
            reporter.step_detail(
                40,
                "Web search unavailable",
                "SearXNG could not start — research may be limited",
            );
            return None;
        }
    };

    let searx_url = format!("http://127.0.0.1:{SEARXNG_PORT}/");
    if let Err(e) = wait_for_url_with_progress(
        &searx_url,
        log_path,
        "SearXNG",
        searxng_startup_wait(),
        Some(reporter),
        16,
        40,
        "Waiting for web search…",
    ) {
        append_log(
            log_path,
            &format!("WARN: SearXNG did not become healthy; continuing without web search: {e}"),
        );
        kill_child(&mut child);
        reporter.step_detail(
            40,
            "Web search unavailable",
            "SearXNG timed out — research may be limited",
        );
        return None;
    }

    reporter.step_detail(42, "Web search ready", &format!("SearXNG at {searx_url}"));
    Some(child)
}

pub fn start_packaged_backend(app: &AppHandle, reporter: &StartupReporter) -> Result<(), String> {
    reporter.step(6, "Initializing VisionOS runtime…");

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    reporter.step(10, "Verifying bundled services…");

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

    let searx_child = try_start_searxng(&resource_dir, &log_path, reporter);
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

    reporter.step(48, "Starting VisionOS backend…");

    let mut node_cmd = Command::new(&node);
    apply_isolated_runtime_env(&mut node_cmd);
    prepend_node_to_path(&mut node_cmd, &resource_dir);
    apply_hidden_child_process(&mut node_cmd);
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
    wait_for_url_with_progress(
        &backend_url,
        &log_path,
        "VisionOS backend",
        Duration::from_secs(120),
        Some(reporter),
        52,
        92,
        "Connecting to backend…",
    )?;

    reporter.step(96, "Preparing desktop interface…");

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

const STARTUP_BOOT_HTML: &str = include_str!("../assets/startup-boot.html");

fn write_startup_html(window: &tauri::WebviewWindow, html: &str) -> Result<(), String> {
    window
        .navigate(Url::parse("about:blank").map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let script = format!(
        "document.open();document.write({});document.close();",
        serde_json::to_string(html).map_err(|e| e.to_string())?
    );
    window.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn show_startup_loading(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let _ = window.set_title("VisionOS");
    write_startup_html(&window, STARTUP_BOOT_HTML)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn show_startup_error(app: &AppHandle, message: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let html = format!(
        r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>VisionOS</title><style>
html,body{{height:100%;margin:0;background:#1a1010;color:#f5d0d0;font-family:system-ui,sans-serif}}
.wrap{{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;box-sizing:border-box}}
.box{{max-width:640px;background:#241414;border:1px solid #5a2b2b;border-radius:12px;padding:20px}}
h1{{margin:0 0 8px;font-size:18px;color:#ffb4b4}}pre{{white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;color:#f0c6c6}}
</style></head><body><div class="wrap"><div class="box"><h1>VisionOS failed to start</h1><pre>{}</pre></div></div></body></html>"#,
        html_escape(message)
    );
    write_startup_html(&window, &html)?;
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn navigate_main_window(app: &AppHandle, port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/");
    navigate_window_to_url(app, &url)
}

pub fn navigate_window_to_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    emit_boot_progress(app, 100, "Welcome to VisionOS", None);
    std::thread::sleep(Duration::from_millis(1000));
    let _ = window.eval("window.visionOSBoot?.complete?.();");
    std::thread::sleep(Duration::from_millis(500));

    let parsed = Url::parse(url).map_err(|e| e.to_string())?;

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

#[cfg(debug_assertions)]
const DEV_UI_URL: &str = "http://127.0.0.1:5173/";

#[cfg(debug_assertions)]
pub fn schedule_dev_ui_navigation(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(3300));
        let handle_for_nav = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Err(e) = navigate_window_to_url(&handle_for_nav, DEV_UI_URL) {
                log::error!("Failed to open dev UI after boot splash: {e}");
                if let Some(window) = handle_for_nav.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    });
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

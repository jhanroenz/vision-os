use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn open_browser_window(app: AppHandle, url: String, title: Option<String>) -> Result<(), String> {
    let parsed = url
        .parse()
        .map_err(|e| format!("Invalid URL: {e}"))?;

    let label = format!("browser-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "Browser".to_string()))
        .inner_size(1024.0, 720.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_browser_window])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Production: SvelteKit adapter-node server should be started before the webview loads.
            // Dev: `tauri dev` uses devUrl → Vite/SvelteKit on :5173.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("VisionOS");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod backend;

use backend::{manage_backend, navigate_main_window, on_run_event, start_packaged_backend, BACKEND_PORT};
use tauri::{include_image, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const WINDOW_ICON: tauri::image::Image<'static> = include_image!("icons/icon.png");

#[tauri::command]
fn open_browser_window(app: AppHandle, url: String, title: Option<String>) -> Result<(), String> {
    let parsed = url
        .parse()
        .map_err(|e| format!("Invalid URL: {e}"))?;

    let label = format!(
        "browser-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "Browser".to_string()))
        .inner_size(1024.0, 720.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_browser_window, exit_app])
        .setup(|app| {
            manage_backend(app);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("VisionOS");
                let _ = window.set_icon(WINDOW_ICON.clone());

                if cfg!(debug_assertions) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                start_packaged_backend(&handle)?;
                navigate_main_window(&handle, BACKEND_PORT)?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            on_run_event(app_handle, &event);
        });
}

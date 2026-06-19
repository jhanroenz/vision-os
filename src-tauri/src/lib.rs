mod backend;

use backend::{
    manage_backend, navigate_main_window, on_run_event, show_startup_error, show_startup_loading,
    start_packaged_backend, StartupReporter, BACKEND_PORT,
};
use tauri::{include_image, AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

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
                show_dev_main_window(&window);
            }

            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                let reporter = StartupReporter::new(handle.clone());
                show_startup_loading(&handle)?;
                reporter.step(2, "Starting VisionOS…");

                std::thread::spawn(move || {
                    let result = start_packaged_backend(&handle, &reporter);
                    let handle_for_ui = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        match result {
                            Ok(()) => {
                                if let Err(e) = navigate_main_window(&handle_for_ui, BACKEND_PORT) {
                                    log::error!("Failed to open VisionOS UI: {e}");
                                    let _ = show_startup_error(
                                        &handle_for_ui,
                                        &format!("Failed to open VisionOS UI:\n{e}"),
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!("Packaged backend failed: {e}");
                                let _ = show_startup_error(&handle_for_ui, &e);
                            }
                        }
                    });
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if cfg!(debug_assertions) {
                if let RunEvent::Ready = event {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        show_dev_main_window(&window);
                    }
                }
            }
            on_run_event(app_handle, &event);
        });
}

#[cfg(debug_assertions)]
fn show_dev_main_window(window: &tauri::WebviewWindow) {
    if let Err(e) = window.center() {
        log::warn!("Failed to center main window: {e}");
    }
    if let Err(e) = window.show() {
        log::error!("Failed to show main window: {e}");
    }
    if let Err(e) = window.set_focus() {
        log::warn!("Failed to focus main window: {e}");
    }
}

#[cfg(not(debug_assertions))]
fn show_dev_main_window(_window: &tauri::WebviewWindow) {}

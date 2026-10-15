mod debug_log;
mod startup_trace;
use startup_trace::StartupTrace;
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

#[tauri::command]
async fn startup_mark(
    app: tauri::AppHandle,
    trace: tauri::State<'_, Arc<StartupTrace>>,
    stage: String,
) -> Result<(), String> {
    trace.frontend(&stage)?;
    let probe_complete = if trace.hidden {
        stage == "doctor_ready"
    } else {
        stage == "doctor_frame"
    };
    if probe_complete && trace.probe && !trace.ready.swap(true, Ordering::Relaxed) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            // Exercise the same close event and unsaved-change guard as window X.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        });
    }
    Ok(())
}

pub fn run() {
    let trace = Arc::new(StartupTrace::new());
    let watchdog = trace.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if !watchdog.frame.load(Ordering::Relaxed) {
            watchdog.record("startup_timeout");
        }
        if watchdog.probe {
            watchdog.record("probe_timeout");
            std::process::exit(2);
        }
    });
    let mut context = tauri::generate_context!();
    if trace.hidden {
        for window in &mut context.config_mut().app.windows {
            window.visible = false;
        }
    }
    let page_trace = trace.clone();
    let setup_trace = trace.clone();
    let window_trace = trace.clone();
    tauri::Builder::default()
        .manage(trace.clone())
        .manage(Arc::new(debug_log::DebugLog::default()))
        .invoke_handler(tauri::generate_handler![
            startup_mark,
            debug_log::debug_log_append,
            debug_log::debug_log_read,
            debug_log::debug_log_clear
        ])
        .setup(move |_| {
            setup_trace.record("setup");
            Ok(())
        })
        .on_page_load(move |_, payload| {
            page_trace.record(match payload.event() {
                tauri::webview::PageLoadEvent::Started => "page_started",
                tauri::webview::PageLoadEvent::Finished => "page_finished",
            });
        })
        .on_window_event(move |_, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                window_trace.record("window_close_request")
            }
            tauri::WindowEvent::Destroyed => window_trace.record("window_destroyed"),
            _ => {}
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(context)
        .expect("failed to run Asset Doctor");
    trace.record("process_exit");
}

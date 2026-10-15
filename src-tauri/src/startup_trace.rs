use std::{fs::{self, File, OpenOptions}, io::Write, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::{Instant, SystemTime, UNIX_EPOCH}};

pub struct StartupTrace {
    file: Mutex<Option<File>>,
    start: Instant,
    events: Mutex<usize>,
    pub ready: AtomicBool,
    pub frame: AtomicBool,
    pub probe: bool,
    pub hidden: bool,
}
impl StartupTrace {
    pub fn new() -> Self {
        let mode = std::env::var("ASSET_DOCTOR_STARTUP_PROBE").unwrap_or_default();
        let directory = std::env::var_os("ASSET_DOCTOR_STARTUP_TRACE_DIR").map(PathBuf::from).unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("com.constantinejj.assetdoctor").join("logs")
        });
        let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let file = fs::create_dir_all(&directory).ok().and_then(|_| OpenOptions::new().create_new(true).write(true).open(directory.join(format!("startup-{}-{epoch}.log", std::process::id()))).ok());
        let trace = Self { file: Mutex::new(file), start: Instant::now(), events: Mutex::new(0), ready: AtomicBool::new(false), frame: AtomicBool::new(false), probe: mode == "hidden" || mode == "visible", hidden: mode == "hidden" };
        trace.record("process_start");
        trace
    }
    pub fn record(&self, stage: &str) {
        // Bounded, stage-only log: no model contents, filenames, URLs or user data.
        let Ok(mut count) = self.events.lock() else { return; };
        if *count >= 48 { return; }
        *count += 1;
        if let Ok(mut file) = self.file.lock() {
            if let Some(file) = file.as_mut() { let _ = writeln!(file, "{}\t{}\t{}", self.start.elapsed().as_millis(), env!("CARGO_PKG_VERSION"), stage); let _ = file.flush(); }
        }
    }
    pub fn frontend(&self, stage: &str) -> Result<(), String> {
        match stage {
            "frontend_module" | "react_ready" | "doctor_create" | "doctor_ready" | "doctor_frame" | "compare_create" | "compare_ready" => {},
            _ => return Err("Unsupported startup stage".into()),
        }
        if stage == "doctor_frame" { self.frame.store(true, Ordering::Relaxed); }
        self.record(stage);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frontend_trace_rejects_arbitrary_data_and_tracks_first_frame() {
        let trace = StartupTrace { file: Mutex::new(None), start: Instant::now(), events: Mutex::new(0), ready: AtomicBool::new(false), frame: AtomicBool::new(false), probe: false, hidden: false };
        assert!(trace.frontend("private/model.glb").is_err());
        assert_eq!(*trace.events.lock().unwrap(), 0);
        assert!(trace.frontend("doctor_ready").is_ok());
        assert!(!trace.frame.load(Ordering::Relaxed));
        assert!(trace.frontend("doctor_frame").is_ok());
        assert!(trace.frame.load(Ordering::Relaxed));
        for _ in 0..100 { trace.record("test"); }
        assert_eq!(*trace.events.lock().unwrap(), 48);
    }
}

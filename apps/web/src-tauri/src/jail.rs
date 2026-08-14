/// Making sure no bot outlives the application that started it.
///
/// Stop kills the process and so does closing the window, but neither of those
/// runs when the application is killed or crashes — and a bot left behind then
/// is invisible: it holds no window, it keeps answering on Discord, and the
/// only way the user finds it is by opening the Task Manager, which is exactly
/// the thing this product exists so they never have to do.
///
/// On Windows the operating system can guarantee it. Every bot is assigned to a
/// job object owned by the application, configured to kill everything in it
/// when the last handle to it closes — which happens when the application's
/// process ends, however it ends. It is not cooperative and there is nothing
/// for a crash to skip.
///
/// The bot watches its end of the pipe as well (see the Compiler's Session
/// entry point), which covers the platforms this does not.
#[derive(Default)]
pub struct Jail {
    #[cfg(windows)]
    job: std::sync::Mutex<Option<win32job::Job>>,
}

impl Jail {
    /// Puts a process under the application's lifetime.
    ///
    /// A failure here is not worth refusing to run a bot over: it costs the
    /// crash guarantee, and Stop, closing the window and the pipe the bot
    /// watches all still work.
    #[cfg(windows)]
    pub fn hold(&self, pid: u32) {
        let mut held = self.job.lock().unwrap();
        if held.is_none() {
            *held = create().map_err(report).ok();
        }
        if let Some(job) = held.as_ref() {
            let _ = assign(job, pid).map_err(report);
        }
    }

    #[cfg(not(windows))]
    pub fn hold(&self, _pid: u32) {
        // Only Windows ships in v1 (ADR 0002). Elsewhere the pipe the bot
        // watches is the whole guarantee.
    }
}

#[cfg(windows)]
fn report(error: String) -> String {
    log::warn!("a bot could not be tied to this application's lifetime: {error}");
    error
}

#[cfg(windows)]
fn create() -> Result<win32job::Job, String> {
    let job = win32job::Job::create().map_err(|error| error.to_string())?;
    let mut limits = job.query_extended_limit_info().map_err(|error| error.to_string())?;
    limits.limit_kill_on_job_close();
    job.set_extended_limit_info(&limits)
        .map_err(|error| error.to_string())?;
    Ok(job)
}

#[cfg(windows)]
fn assign(job: &win32job::Job, pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    // SAFETY: the handle is opened and closed here and nowhere else, and it is
    // checked for null before it is used.
    unsafe {
        let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return Err(format!("the bot's process {pid} could not be opened"));
        }
        let assigned = job.assign_process(handle as isize);
        CloseHandle(handle);
        assigned.map_err(|error| error.to_string())
    }
}

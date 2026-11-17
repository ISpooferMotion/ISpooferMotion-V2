use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Default)]
pub struct SpooferControl {
    pub active_job_id: Option<String>,
    pub paused: bool,
    pub cancelled: bool,
}

pub static SPOOFER_CONTROL: OnceLock<Mutex<SpooferControl>> = OnceLock::new();

pub fn spoofer_control() -> &'static Mutex<SpooferControl> {
    SPOOFER_CONTROL.get_or_init(|| Mutex::new(SpooferControl::default()))
}

pub fn begin_spoofer_job(job_id: &str) -> crate::error::Result<()> {
    let mut control =
        spoofer_control().lock().map_err(|_| "Spoofer control state is unavailable.")?;
    if control.active_job_id.is_some() {
        return Err("A spoofing job is already running.".into());
    }
    *control =
        SpooferControl { active_job_id: Some(job_id.to_string()), paused: false, cancelled: false };
    Ok(())
}

pub fn finish_spoofer_job(job_id: &str) {
    if let Ok(mut control) = spoofer_control().lock() {
        if control.active_job_id.as_deref() == Some(job_id) {
            *control = SpooferControl::default();
        }
    }
}

pub async fn wait_if_paused(job_id: &str) -> crate::error::Result<()> {
    loop {
        let paused = {
            let control =
                spoofer_control().lock().map_err(|_| "Spoofer control state is unavailable.")?;
            if control.active_job_id.as_deref() != Some(job_id) {
                return Err("Spoofing job is no longer active.".into());
            }
            if control.cancelled {
                return Err("Job cancelled by user".into());
            }
            control.paused
        };
        if !paused {
            return Ok(());
        }
        sleep(Duration::from_millis(500)).await;
    }
}

pub fn update_spoofer_control(job_id: &str, update: impl FnOnce(&mut SpooferControl)) -> bool {
    let Ok(mut control) = spoofer_control().lock() else {
        return false;
    };
    if control.active_job_id.as_deref() != Some(job_id) {
        return false;
    }
    update(&mut control);
    true
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    static TEST_MUTEX: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    fn test_mutex() -> &'static std::sync::Mutex<()> {
        TEST_MUTEX.get_or_init(|| std::sync::Mutex::new(()))
    }

    #[tokio::test]
    async fn test_spoofer_job_lifecycle() {
        let _guard = test_mutex().lock().unwrap();

        {
            *spoofer_control().lock().unwrap() = SpooferControl::default();
        }

        let job_id = "test_job_123";

        assert!(begin_spoofer_job(job_id).is_ok());

        assert!(begin_spoofer_job("another_job").is_err());

        assert!(update_spoofer_control(job_id, |c| c.paused = true));

        let is_paused = spoofer_control().lock().unwrap().paused;
        assert!(is_paused);

        finish_spoofer_job(job_id);

        let is_active = spoofer_control().lock().unwrap().active_job_id.is_some();
        assert!(!is_active);

        assert!(begin_spoofer_job("job_456").is_ok());
        finish_spoofer_job("job_456");
    }

    #[tokio::test]
    async fn test_update_invalid_job_id() {
        let _guard = test_mutex().lock().unwrap();
        {
            *spoofer_control().lock().unwrap() = SpooferControl::default();
        }

        assert!(begin_spoofer_job("job_1").is_ok());

        assert!(!update_spoofer_control("job_2", |c| c.paused = true));

        let is_paused = spoofer_control().lock().unwrap().paused;
        assert!(!is_paused);

        finish_spoofer_job("job_1");
    }
}

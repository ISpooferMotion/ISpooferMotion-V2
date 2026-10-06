// ISM-V2-PROVENANCE: D04857E4B2CFED1D729DF52B
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

#[cfg(not(target_os = "windows"))]
pub mod stub;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(not(target_os = "windows"))]
pub use stub::*;
#[cfg(target_os = "windows")]
pub use windows::*;

// ISM-V2-PROVENANCE-END: D04857E4B2CFED1D729DF52B

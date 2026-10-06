// ISM-V2-PROVENANCE: 3A6129FE3515CC0AB53871AF
// Repository provenance: ISpooferMotion V2 / IncredibroXP.
// Attribution marker only; preserve any upstream author/license notices.

fn main() {
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist-plugin");
    tauri_build::build();
}

// ISM-V2-PROVENANCE-END: 3A6129FE3515CC0AB53871AF

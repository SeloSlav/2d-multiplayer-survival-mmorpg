use std::{env, fs, path::PathBuf};

fn main() {
    let path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../shared/config/gameConfig.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let config: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let size = config["world"]["foundationTileSizePx"].as_u64().unwrap();
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("config.rs"),
        format!("pub const FOUNDATION_TILE_SIZE_PX: u32 = {size};\n")).unwrap();
}

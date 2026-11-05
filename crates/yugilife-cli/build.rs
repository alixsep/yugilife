use std::fmt::Write;
use std::path::{Path, PathBuf};

fn collect(directory: &Path, root: &Path, files: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).map(|entry| entry.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(&path, root, files);
        } else if let Ok(relative) = path.strip_prefix(root) {
            files.push((relative.to_string_lossy().replace('\\', "/"), path.clone()));
        }
    }
}

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default()).join("templates");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    let mut source = String::from("pub static PACKAGED_FILES: &[(&str, &[u8])] = &[\n");
    for (relative, path) in &files {
        let _ = writeln!(source, "    ({relative:?}, include_bytes!({:?})),", path.display().to_string());
    }
    source.push_str("];\n");
    let output = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default()).join("packaged.rs");
    let _ = std::fs::write(output, source);
}

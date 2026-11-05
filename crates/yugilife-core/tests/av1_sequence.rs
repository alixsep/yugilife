use std::path::PathBuf;

use yugilife_core::raster::av1::sequence_info;
use yugilife_core::raster::decode::{ChromaLayout, avif_items, avif_picture_info};

/// The AV1 sequence header parser reads the same bit depth, layout, matrix and range dav1d does,
/// for the artwork in `materials/artworks/processed` (not in the repository; skipped without it),
/// or for the directory in `YUGILIFE_AVIF_DIRECTORY`.
#[test]
fn sequence_headers_match_dav1d_for_the_artwork() {
    let directory = std::env::var_os("YUGILIFE_AVIF_DIRECTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../materials/artworks/processed"));
    let Ok(entries) = std::fs::read_dir(&directory) else {
        eprintln!("skipped: {} is not available", directory.display());
        return;
    };
    let mut files: Vec<PathBuf> =
        entries.filter_map(Result::ok).map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|e| e == "avif")).collect();
    files.sort();
    let limit = std::env::var("YUGILIFE_AVIF_LIMIT").ok().and_then(|value| value.parse().ok()).unwrap_or(200);
    let mut checked = 0;
    for path in files.iter().take(limit) {
        let bytes = std::fs::read(path).unwrap();
        let (color, alpha) = avif_items(&bytes).expect("an AVIF container");
        let expected = avif_picture_info(&bytes).expect("dav1d decodes it");
        for (item, (bit_depth, layout, matrix, full_range)) in [Some(color), alpha].into_iter().flatten().zip(expected) {
            let info = sequence_info(&item).unwrap_or_else(|| panic!("{}: no sequence header", path.display()));
            let parsed_layout = match (info.monochrome, info.subsampling_x, info.subsampling_y) {
                (true, _, _) => ChromaLayout::I400,
                (false, true, true) => ChromaLayout::I420,
                (false, true, false) => ChromaLayout::I422,
                _ => ChromaLayout::I444,
            };
            let parsed_matrix = match info.matrix {
                1 => 1,
                9 => 9,
                10 => 10,
                _ => 6,
            };
            assert_eq!(
                (usize::from(info.bit_depth), parsed_layout, parsed_matrix, info.full_range),
                (bit_depth, layout, matrix, full_range),
                "{}",
                path.display()
            );
            checked += 1;
        }
    }
    eprintln!("checked {checked} AV1 items from {}", directory.display());
}

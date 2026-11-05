use std::path::PathBuf;

use freetype::face::LoadFlag;
use yugilife_core::assets::AssetSource;
use yugilife_core::text::fonts::load_font;
use yugilife_core::text::hinting::hinted_advance;
use yugilife_core::text::measure::{kerning_advance, pixel_advance};

#[test]
fn rounds_kerning_from_harfbuzz_fixed_point_rather_than_freetype() {
    // ITC Stone Serif Medium Italic kerns "No" by -18 units: -0.504px at 28px. Chromium draws the
    // "o" 20px after the "N", which only rounding the 16.16 value gives.
    assert_eq!(kerning_advance(-18.0, 28.0, 1000.0), -1.0);
    assert_eq!(pixel_advance(-18.0, 28.0, 1000.0), 0.0);
    assert_eq!(kerning_advance(18.0, 28.0, 1000.0), 1.0);
    assert_eq!(kerning_advance(-17.0, 28.0, 1000.0), 0.0);
    assert_eq!(kerning_advance(0.0, 24.0, 2048.0), 0.0);
}

fn packaged_font(name: &str) -> (AssetSource, Vec<u8>) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../yugilife-cli/templates/shared/fonts").join(name);
    let bytes = std::fs::read(&path).expect("the packaged font must be readable");
    let sfnt = match &bytes[..4] {
        b"wOF2" => wuff::decompress_woff2(&bytes).unwrap(),
        b"wOFF" => wuff::decompress_woff1(&bytes).unwrap(),
        _ => bytes.clone(),
    };
    (AssetSource::from_bytes(bytes, None, name), sfnt)
}

#[test]
fn autohinted_advances_match_freetype_for_the_packaged_fonts() {
    let library = freetype::Library::init().unwrap();
    for name in ["ITCStoneSerifMedium.woff2", "ITCStoneSerifStdBold.woff2", "DFP-ReiSho-W6-JAJWA.woff"] {
        let (source, sfnt) = packaged_font(name);
        let font = load_font(&source, name).unwrap();
        assert!(font.autohinted, "{name} should take the autohinted path");
        let face = library.new_memory_face(sfnt, 0).unwrap();
        let glyphs = face.num_glyphs() as u16;
        for size in (6..=64).chain([72, 90]) {
            face.set_char_size(0, (size * 64) as isize, 72, 72).unwrap();
            for glyph in 0..glyphs {
                face.load_glyph(u32::from(glyph), LoadFlag::TARGET_NORMAL | LoadFlag::FORCE_AUTOHINT).unwrap();
                let expected = (face.glyph().advance().x as f64 / 64.0).round();
                assert_eq!(hinted_advance(&font, glyph, size), Some(expected), "{name} glyph {glyph} at {size}px");
            }
        }
    }
}

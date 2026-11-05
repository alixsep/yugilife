//! Prints every candidate advance for a string's glyphs at one size: the port's scaled advance and
//! kerning, FreeType's under several load modes, and the font's hdmx entry.
//!
//!   cargo run --release -p yugilife-core --example probe_advance -- <font> <size> <text>

use freetype::face::LoadFlag;
use skrifa::raw::TableProvider;
use skrifa::{FontRef, MetadataProvider};
use yugilife_core::text::measure::pixel_advance;

fn decompress(bytes: &[u8]) -> Vec<u8> {
    match &bytes[..4] {
        b"wOF2" => wuff::decompress_woff2(bytes).unwrap(),
        b"wOFF" => wuff::decompress_woff1(bytes).unwrap(),
        _ => bytes.to_vec(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sfnt = decompress(&std::fs::read(&args[1]).unwrap());
    let size: u32 = args[2].parse().unwrap();
    let text = &args[3];
    let font = FontRef::new(&sfnt).unwrap();
    let units_per_em = f64::from(font.head().unwrap().units_per_em());
    let hdmx = font.hdmx().ok();
    println!("unitsPerEm {units_per_em}, hdmx present: {}", hdmx.is_some());
    let face = rustybuzz::Face::from_slice(&sfnt, 0).unwrap();
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let shaped = rustybuzz::shape(&face, &[], buffer);
    let library = freetype::Library::init().unwrap();
    let ft = library.new_memory_face(sfnt.clone(), 0).unwrap();
    ft.set_char_size(0, (size * 64) as isize, 72, 72).unwrap();
    let modes: [(&str, LoadFlag); 4] = [
        ("default", LoadFlag::DEFAULT),
        ("light", LoadFlag::TARGET_LIGHT),
        ("no_hinting", LoadFlag::NO_HINTING),
        ("normal+autohint", LoadFlag::TARGET_NORMAL | LoadFlag::FORCE_AUTOHINT),
    ];
    let charmap = font.charmap();
    for ((info, position), character) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()).zip(text.chars()) {
        let glyph = info.glyph_id;
        let natural = f64::from(face.glyph_hor_advance(rustybuzz::ttf_parser::GlyphId(glyph as u16)).unwrap_or(0));
        let kerning = f64::from(position.x_advance) - natural;
        let mut line = format!(
            "{character:?} glyph {glyph} (cmap {:?}): natural {natural} kerning {kerning} -> port {} + {}",
            charmap.map(character).map(|id| id.to_u32()),
            pixel_advance(natural, f64::from(size), units_per_em),
            pixel_advance(kerning, f64::from(size), units_per_em)
        );
        for (name, flags) in &modes {
            ft.load_glyph(glyph, *flags).unwrap();
            line.push_str(&format!(" | {name} {}", ft.glyph().advance().x as f64 / 64.0));
        }
        if let Some(hdmx) = &hdmx {
            let record = hdmx.records().iter().filter_map(Result::ok).find(|record| u32::from(record.pixel_size) == size);
            if let Some(record) = record {
                line.push_str(&format!(" | hdmx {:?}", record.widths.get(glyph as usize)));
            }
        }
        println!("{line}");
    }
}

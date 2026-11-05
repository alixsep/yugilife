//! Compares FreeType's autohinted advances with skrifa's for every glyph of every font in a
//! directory, at every integer pixel size in a range. Mirrors `text::hinting::hinted_advance`.

use std::path::Path;

use freetype::face::LoadFlag;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, Engine, HintingInstance, HintingOptions, OutlinePen, Target};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider};

struct NullPen;

impl OutlinePen for NullPen {
    fn move_to(&mut self, _: f32, _: f32) {}
    fn line_to(&mut self, _: f32, _: f32) {}
    fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {}
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {}
    fn close(&mut self) {}
}

fn decompress(bytes: &[u8]) -> Vec<u8> {
    match &bytes[..4] {
        b"wOF2" => wuff::decompress_woff2(bytes).unwrap(),
        b"wOFF" => wuff::decompress_woff1(bytes).unwrap(),
        _ => bytes.to_vec(),
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let directory = args.next().expect("font directory");
    let max_size: u32 = args.next().map_or(96, |value| value.parse().unwrap());
    let library = freetype::Library::init().unwrap();
    let mut total_mismatches = 0usize;
    let mut entries: Vec<_> = std::fs::read_dir(&directory).unwrap().map(|entry| entry.unwrap().path()).collect();
    entries.sort();
    for path in entries {
        let sfnt = decompress(&std::fs::read(&path).unwrap());
        let font = FontRef::new(&sfnt).unwrap();
        let has_glyf = font.table_data(skrifa::raw::types::Tag::new(b"glyf")).is_some();
        let max_instructions = font.maxp().ok().and_then(|maxp| maxp.max_size_of_instructions());
        let autohinted = has_glyf && max_instructions == Some(0);
        let name = Path::new(&path).file_name().unwrap().to_string_lossy().into_owned();
        if !autohinted {
            println!("{name}: not autohinted by the port (glyf={has_glyf}, maxSizeOfInstructions={max_instructions:?}), skipped");
            continue;
        }
        let glyph_count = font.maxp().unwrap().num_glyphs();
        let outlines = font.outline_glyphs();
        let face = library.new_memory_face(sfnt.clone(), 0).unwrap();
        let mut compared = 0usize;
        let mut mismatches = 0usize;
        for size in 1..=max_size {
            face.set_char_size(0, (size * 64) as isize, 72, 72).unwrap();
            let options = HintingOptions { engine: Engine::Auto(None), target: Target::default() };
            let instance = HintingInstance::new(&outlines, Size::new(size as f32), LocationRef::default(), options).unwrap();
            for glyph in 0..glyph_count {
                if face.load_glyph(u32::from(glyph), LoadFlag::TARGET_NORMAL | LoadFlag::FORCE_AUTOHINT).is_err() {
                    continue;
                }
                let freetype_advance = (face.glyph().advance().x as f64 / 64.0).round();
                let Some(outline) = outlines.get(GlyphId::new(u32::from(glyph))) else { continue };
                let skrifa_advance = outline
                    .draw(DrawSettings::hinted(&instance, false), &mut NullPen)
                    .ok()
                    .and_then(|metrics| metrics.advance_width)
                    .map(|advance| f64::from(advance).round());
                compared += 1;
                if skrifa_advance != Some(freetype_advance) {
                    mismatches += 1;
                    if mismatches <= 5 {
                        println!("  {name} size {size} glyph {glyph}: freetype {freetype_advance} skrifa {skrifa_advance:?}");
                    }
                }
            }
        }
        total_mismatches += mismatches;
        println!("{name}: {compared} advances compared at sizes 1..={max_size}, {mismatches} mismatches");
    }
    println!("total mismatches: {total_mismatches}");
}

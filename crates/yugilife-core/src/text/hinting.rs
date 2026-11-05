//! Autohinted glyph advances, as Chromium's `measureText` gets them from FreeType with
//! `FT_LOAD_TARGET_NORMAL | FT_LOAD_FORCE_AUTOHINT`.
//!
//! The advances come from skrifa's port of the FreeType autohinter, which needs no C library and so
//! also builds for WebAssembly. `examples/hinting_parity.rs` compares it with FreeType itself for
//! every glyph of every autohinted template font at sizes 1 to 128: they agree on all of them.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, Engine, GlyphStyles, HintingInstance, HintingOptions, OutlinePen, Target};
use skrifa::{FontRef, GlyphId, MetadataProvider};

use crate::text::fonts::SharedFont;

struct NullPen;

impl OutlinePen for NullPen {
    fn move_to(&mut self, _: f32, _: f32) {}
    fn line_to(&mut self, _: f32, _: f32) {}
    fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {}
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {}
    fn close(&mut self) {}
}

struct HintingFace {
    /// Held so the font, and with it the address that keys this cache, outlives the entry.
    font: SharedFont,
    styles: GlyphStyles,
    instances: HashMap<u32, HintingInstance>,
    advances: HashMap<(u32, u16), f64>,
}

impl HintingFace {
    fn new(font: &SharedFont) -> Option<Self> {
        let font_ref = FontRef::new(&font.sfnt).ok()?;
        let styles = GlyphStyles::new(&font_ref.outline_glyphs());
        Some(Self { font: font.clone(), styles, instances: HashMap::new(), advances: HashMap::new() })
    }
}

thread_local! {
    static FACES: RefCell<HashMap<usize, Option<HintingFace>>> = RefCell::new(HashMap::new());
}

pub fn hinted_advance(font: &SharedFont, glyph: u16, size: u32) -> Option<f64> {
    let key = Arc::as_ptr(font) as usize;
    FACES.with(|faces| {
        let mut faces = faces.borrow_mut();
        let face = faces.entry(key).or_insert_with(|| HintingFace::new(font)).as_mut()?;
        if let Some(advance) = face.advances.get(&(size, glyph)) {
            return Some(*advance);
        }
        let font = face.font.clone();
        let font_ref = FontRef::new(&font.sfnt).ok()?;
        let outlines = font_ref.outline_glyphs();
        if !face.instances.contains_key(&size) {
            let options = HintingOptions { engine: Engine::Auto(Some(face.styles.clone())), target: Target::default() };
            let instance = HintingInstance::new(&outlines, Size::new(size as f32), LocationRef::default(), options).ok()?;
            face.instances.insert(size, instance);
        }
        let instance = face.instances.get(&size)?;
        let outline = outlines.get(GlyphId::new(u32::from(glyph)))?;
        let metrics = outline.draw(DrawSettings::hinted(instance, false), &mut NullPen).ok()?;
        let advance = f64::from(metrics.advance_width?).round();
        face.advances.insert((size, glyph), advance);
        Some(advance)
    })
}

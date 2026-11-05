use std::collections::HashMap;

use indexmap::IndexMap;
use rustybuzz::ttf_parser::GlyphId;
use rustybuzz::{Face, UnicodeBuffer};

use crate::rich_text::grapheme_count;
use crate::text::fonts::SharedFont;
use crate::text::hinting::hinted_advance;
use crate::text::layout::InlineTypography;

pub struct FontBook {
    fonts: IndexMap<String, SharedFont>,
}

impl FontBook {
    pub fn new(fonts: IndexMap<String, SharedFont>) -> Self {
        Self { fonts }
    }

    pub fn get(&self, family: &str) -> Option<&SharedFont> {
        self.fonts.get(family)
    }

    /// The font that draws text with this CSS `font-family` value, and the family it was found
    /// under: the first listed family the book has, as in a browser. Measuring, outlining, and the
    /// missing-glyph check all resolve fonts here, so they always agree on the font.
    pub fn resolve(&self, font_family: &str) -> Option<(&str, &SharedFont)> {
        // Template families are single names; take that common case without parsing.
        let found = match self.fonts.get_key_value(font_family) {
            Some(entry) => Some(entry),
            None => css_font_families(font_family).iter().find_map(|family| self.fonts.get_key_value(family.as_str())),
        };
        found.map(|(family, font)| (family.as_str(), font))
    }

    fn first(&self) -> Option<&SharedFont> {
        self.fonts.values().next()
    }
}

#[derive(Clone, Copy)]
pub struct ShapedGlyph {
    pub glyph: u16,
    pub cluster: u32,
    pub advance: f64,
}

pub struct Measurer<'a> {
    book: &'a FontBook,
    faces: HashMap<usize, Option<Face<'a>>>,
    widths: HashMap<(usize, u64, String), f64>,
}

pub fn pixel_advance(units: f64, font_size: f64, units_per_em: f64) -> f64 {
    let scale = freetype_div_fix((font_size * 64.0) as i64, units_per_em as i64);
    let scaled = freetype_mul_fix(units as i64, scale);
    ((scaled + 32) >> 6) as f64
}

/// Kerning in whole pixels. Chromium takes it from HarfBuzz, which scales font units in 16.16 fixed
/// point (`hb_font_t::em_mult`), not from FreeType's 26.6. The difference decides the rounding of
/// values just past half a pixel: -18 units at 28px are -0.504px, which 26.6 truncates to -0.5 and
/// rounds to 0, while Chromium rounds them to -1.
pub fn kerning_advance(units: f64, font_size: f64, units_per_em: f64) -> f64 {
    let scale = (font_size * 65536.0).round() as i64;
    let multiplier = (scale << 16) / units_per_em as i64;
    let position = (units as i64 * multiplier + 32768) >> 16;
    ((position + 32768) >> 16) as f64
}

fn freetype_div_fix(numerator: i64, denominator: i64) -> i64 {
    let negative = (numerator < 0) != (denominator < 0);
    let (numerator, denominator) = (numerator.abs(), denominator.abs());
    let quotient = ((numerator << 16) + denominator / 2) / denominator;
    if negative { -quotient } else { quotient }
}

fn freetype_mul_fix(value: i64, scale: i64) -> i64 {
    let negative = (value < 0) != (scale < 0);
    let product = (value.abs() * scale.abs() + 0x8000) >> 16;
    if negative { -product } else { product }
}

impl<'a> Measurer<'a> {
    pub fn new(book: &'a FontBook) -> Self {
        Self { book, faces: HashMap::new(), widths: HashMap::new() }
    }

    pub fn book(&self) -> &'a FontBook {
        self.book
    }

    /// Text in a family the book lacks is measured with the template's first font so that layout
    /// can finish; outlining rejects that text rather than drawing it with a font it was not
    /// measured with.
    pub fn font(&self, family: &str) -> Option<&'a SharedFont> {
        self.book.resolve(family).map(|(_, font)| font).or_else(|| self.book.first())
    }

    fn face(&mut self, font: &'a SharedFont) -> Option<&Face<'a>> {
        let key = std::sync::Arc::as_ptr(font) as usize;
        self.faces.entry(key).or_insert_with(|| font.shaping_face()).as_ref()
    }

    pub fn shape(&mut self, family: &str, font_size: f64, text: &str) -> Vec<ShapedGlyph> {
        let Some(font) = self.font(family) else {
            return Vec::new();
        };
        let units_per_em = font.units_per_em;
        let hinted_size = font_size.round().max(1.0);
        let Some(face) = self.face(font) else {
            return Vec::new();
        };
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = rustybuzz::shape(face, &[], buffer);
        shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| {
                let glyph = info.glyph_id as u16;
                let natural = f64::from(face.glyph_hor_advance(GlyphId(glyph)).unwrap_or(0));
                let kerning = f64::from(position.x_advance) - natural;
                let base = if font.autohinted {
                    hinted_advance(font, glyph, hinted_size as u32).unwrap_or_else(|| pixel_advance(natural, hinted_size, units_per_em))
                } else {
                    pixel_advance(natural, hinted_size, units_per_em)
                };
                ShapedGlyph { glyph, cluster: info.cluster, advance: base + kerning_advance(kerning, hinted_size, units_per_em) }
            })
            .collect()
    }

    pub fn text_width(&mut self, family: &str, font_size: f64, text: &str) -> f64 {
        let key_font = self.font(family).map_or(0, |font| std::sync::Arc::as_ptr(font) as usize);
        let key = (key_font, font_size.to_bits(), text.to_owned());
        if let Some(width) = self.widths.get(&key) {
            return *width;
        }
        let width = self.shape(family, font_size, text).iter().map(|glyph| glyph.advance).sum();
        self.widths.insert(key, width);
        width
    }

    pub fn measure(&mut self, text: &str, typography: &InlineTypography) -> f64 {
        let width = self.text_width(&typography.font_family, typography.font_size, text);
        let spacing = typography.letter_spacing.unwrap_or(0.0);
        if spacing == 0.0 {
            return width;
        }
        width + (grapheme_count(text).saturating_sub(1)) as f64 * spacing
    }
}

/// The family names in a CSS `font-family` value, in order, with quotes removed.
pub fn css_font_families(value: &str) -> Vec<String> {
    let mut families = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for character in value.chars() {
        match quote {
            Some(open) if character == open => quote = None,
            Some(_) => current.push(character),
            None if character == '"' || character == '\'' => quote = Some(character),
            None if character == ',' => {
                if !current.trim().is_empty() {
                    families.push(current.trim().to_owned());
                }
                current.clear();
            }
            None => current.push(character),
        }
    }
    if !current.trim().is_empty() {
        families.push(current.trim().to_owned());
    }
    families
}

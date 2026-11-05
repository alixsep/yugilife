use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rustybuzz::UnicodeBuffer;

use crate::error::{Error, Result};
use crate::number::to_fixed;
use crate::rich_text::grapheme_segments;
use crate::svg::{AttributeValue, SvgElement};
use crate::text::fonts::{SharedFont, glyph_outline};
use crate::text::measure::{FontBook, Measurer, css_font_families};
use crate::text::svg_layout::{TextLayout, TextStyle, layout_text};
use crate::validation::validate_rendered_svg_element;

pub type GlyphPathCache = Mutex<HashMap<(usize, u16), Arc<String>>>;

const OUTLINED_GROUP_ATTRIBUTES: [&str; 3] = ["id", "role", "transform"];

fn number(value: f64) -> String {
    if value.abs() < 0.000_000_5 {
        return "0".to_owned();
    }
    let fixed: f64 = to_fixed(value, 6).parse().unwrap_or(value);
    crate::number::js_number(if fixed == 0.0 { 0.0 } else { fixed })
}

fn serialized_family(value: &str) -> String {
    css_font_families(value)
        .iter()
        .map(|family| {
            if family.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_') {
                family.clone()
            } else {
                format!("\"{family}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn ignored_code_point(code: u32) -> bool {
    code == 0x200c || code == 0x200d || (0xfe00..=0xfe0f).contains(&code) || (0xe0100..=0xe01ef).contains(&code)
}

/// A character that the font drawing it has no glyph for.
#[derive(Debug, Clone, PartialEq)]
pub struct MissingGlyph {
    pub character: char,
    pub font_family: String,
}

/// The characters in a text element that its fonts have no glyph for, once per font and in the order
/// they first appear. Shaping maps such a character to glyph 0, the font's own missing-glyph shape
/// (usually an empty box), so that is what is measured and drawn. A card's text is user data, and
/// one unsupported character must not keep the whole card from rendering.
pub fn missing_glyphs(fonts: &FontBook, element: &SvgElement) -> Vec<MissingGlyph> {
    let mut missing = Vec::new();
    collect_missing_glyphs(fonts, element, &TextStyle::default(), &mut missing);
    missing
}

fn collect_missing_glyphs(fonts: &FontBook, element: &SvgElement, inherited: &TextStyle, missing: &mut Vec<MissingGlyph>) {
    let style = inherited_for(inherited, element);
    if let Some(text) = element.text.as_deref().filter(|text| !text.is_empty())
        && let Some((family, font)) = fonts.resolve(&style.font_family)
        && let Some(face) = font.face()
    {
        for character in text.chars() {
            if ignored_code_point(character as u32) || face.glyph_index(character).is_some_and(|glyph| glyph.0 != 0) {
                continue;
            }
            if !missing.iter().any(|known| known.character == character && known.font_family == family) {
                missing.push(MissingGlyph { character, font_family: family.to_owned() });
            }
        }
    }
    for child in &element.children {
        collect_missing_glyphs(fonts, child, &style, missing);
    }
}

struct OutlineStyle {
    font: SharedFont,
    font_size: f64,
    synthetic_bold: bool,
    synthetic_italic: bool,
    style: TextStyle,
}

fn paint_attributes(style: &OutlineStyle, fill: &str, path: &mut SvgElement) {
    let computed = &style.style;
    path.set("fill", fill);
    if computed.fill_opacity != "1" {
        path.set("fill-opacity", computed.fill_opacity.as_str());
    }
    if computed.opacity != "1" {
        path.set("opacity", computed.opacity.as_str());
    }
    let stroke_width = crate::js::parse_float(&computed.stroke_width);
    let stroke_width_units = if stroke_width.is_finite() && stroke_width > 0.0 {
        AttributeValue::Number((stroke_width / style.font_size) * style.font.units_per_em)
    } else {
        AttributeValue::Text(computed.stroke_width.clone())
    };
    let has_stroke = computed.stroke != "none" || style.synthetic_bold;
    if has_stroke && !computed.paint_order.is_empty() && computed.paint_order != "normal" {
        path.set("paint-order", computed.paint_order.as_str());
    }
    if computed.stroke == "none" {
        if style.synthetic_bold {
            path.set("stroke", fill);
            path.set("stroke-linejoin", "round");
            if computed.fill_opacity != "1" {
                path.set("stroke-opacity", computed.fill_opacity.as_str());
            }
            path.set("stroke-width", style.font.units_per_em / 24.0);
        }
        return;
    }
    path.set("stroke", computed.stroke.as_str());
    if computed.stroke_linecap != "butt" {
        path.set("stroke-linecap", computed.stroke_linecap.as_str());
    }
    if computed.stroke_linejoin != "miter" {
        path.set("stroke-linejoin", computed.stroke_linejoin.as_str());
    }
    if computed.stroke_miterlimit != "4" {
        path.set("stroke-miterlimit", computed.stroke_miterlimit.as_str());
    }
    if computed.stroke_opacity != "1" {
        path.set("stroke-opacity", computed.stroke_opacity.as_str());
    }
    path.set("stroke-width", stroke_width_units);
}

pub struct Outliner<'a> {
    fonts: &'a FontBook,
    measurer: Measurer<'a>,
    glyphs: &'a GlyphPathCache,
    cancel: Option<&'a std::sync::atomic::AtomicBool>,
}

impl<'a> Outliner<'a> {
    pub fn new(fonts: &'a FontBook, glyphs: &'a GlyphPathCache, cancel: Option<&'a std::sync::atomic::AtomicBool>) -> Self {
        Self { fonts, measurer: Measurer::new(fonts), glyphs, cancel }
    }

    pub fn outline_elements(&mut self, elements: &[SvgElement]) -> Result<Vec<SvgElement>> {
        if !elements.iter().any(contains_text_element) {
            return Ok(elements.to_vec());
        }
        let mut outlined = Vec::with_capacity(elements.len());
        for element in elements {
            outlined.push(self.outline_definition(element, &TextStyle::default())?);
        }
        for (index, element) in outlined.iter().enumerate() {
            validate_rendered_svg_element(element, &format!("Outlined SVG element {index}"))?;
        }
        Ok(outlined)
    }

    fn outline_definition(&mut self, element: &SvgElement, inherited: &TextStyle) -> Result<SvgElement> {
        if element.tag == "text" {
            return self.outline_text(element, inherited);
        }
        let style = inherited_for(inherited, element);
        let mut copy = SvgElement {
            tag: element.tag.clone(),
            attributes: element.attributes.clone(),
            children: Vec::new(),
            text: element.text.clone(),
        };
        for child in &element.children {
            copy.children.push(self.outline_definition(child, &style)?);
        }
        Ok(copy)
    }

    fn outline_style(&self, style: &TextStyle) -> Result<OutlineStyle> {
        let (_, font) = self.fonts.resolve(&style.font_family).ok_or_else(|| {
            Error::render(format!(
                "Cannot outline SVG text using font-family \"{}\" because it has no resolved fontAssetId. Use textMode \"text\" or declare the font asset in template typography.",
                serialized_family(&style.font_family)
            ))
        })?;
        let font = font.clone();
        if !(style.font_size.is_finite() && style.font_size > 0.0) {
            return Err(Error::render(format!(
                "Cannot outline SVG text with font-size \"{}px\".",
                crate::number::js_number(style.font_size)
            )));
        }
        let requested_weight = crate::js::parse_float(&style.font_weight);
        let requested_bold = requested_weight.is_finite() && requested_weight.trunc() >= 600.0;
        let requested_italic = style.font_style != "normal";
        Ok(OutlineStyle {
            synthetic_bold: requested_bold && !font.is_bold,
            synthetic_italic: requested_italic && !font.is_italic,
            font,
            font_size: style.font_size,
            style: style.clone(),
        })
    }

    fn glyph_path(&self, font: &SharedFont, glyph: u16) -> Arc<String> {
        let key = (Arc::as_ptr(font) as usize, glyph);
        if let Some(path) = self.glyphs.lock().ok().and_then(|cache| cache.get(&key).cloned()) {
            return path;
        }
        let path = Arc::new(font.face().map(|face| glyph_outline(&face, glyph).to_svg_path()).unwrap_or_default());
        if let Ok(mut cache) = self.glyphs.lock() {
            cache.insert(key, path.clone());
        }
        path
    }

    fn outline_text(&mut self, element: &SvgElement, inherited: &TextStyle) -> Result<SvgElement> {
        let rendered = layout_text(element, inherited, &mut self.measurer, false);
        let natural = layout_text(element, inherited, &mut self.measurer, true);
        let mut paths = Vec::new();
        for run in &rendered.runs {
            crate::render::check_cancel(self.cancel)?;
            let style = self.outline_style(&run.style)?;
            let run_start = rendered.utf16_offset(run.start);
            let run_length: usize = run.text.encode_utf16().count();
            let subtree_length = rendered.utf16_offset(run.subtree_end) - run_start;
            let natural_subtree = f64::from(natural.substring_length(run_start, subtree_length));
            let declared_stretch = run.length_adjust.as_ref().and_then(|(adjust, length)| {
                if adjust != "spacingAndGlyphs" {
                    return None;
                }
                let target = crate::js::parse_float(length);
                (target.is_finite() && target > 0.0 && natural_subtree > 0.0).then(|| target / natural_subtree)
            });
            let natural_run = f64::from(natural.substring_length(run_start, run_length));
            let rendered_run = f64::from(rendered.substring_length(run_start, run_length));
            let browser_stretch = if natural_run > 0.0 { rendered_run / natural_run } else { 1.0 };
            let manual = declared_stretch.filter(|declared| (browser_stretch - declared).abs() > 0.000_001);
            let origins = manual.map(|_| (position(&rendered, run_start), position(&natural, run_start)));
            let mut index = 0usize;
            for grapheme in grapheme_segments(&run.text) {
                crate::render::check_cancel(self.cancel)?;
                let length = grapheme.encode_utf16().count();
                let global_index = run_start + index;
                let start = match (manual, origins) {
                    (Some(stretch), Some((rendered_origin, natural_origin))) => {
                        let natural_start = position(&natural, global_index);
                        (
                            rendered_origin.0 + (natural_start.0 - natural_origin.0) * stretch,
                            rendered_origin.1 + (natural_start.1 - natural_origin.1),
                        )
                    }
                    _ => position(&rendered, global_index),
                };
                let scale_y = style.font_size / style.font.units_per_em;
                let natural_length = f64::from(natural.substring_length(global_index, length));
                let rendered_length = match manual {
                    Some(stretch) => natural_length * stretch,
                    None => f64::from(rendered.substring_length(global_index, length)),
                };
                let measured_stretch = if natural_length > 0.0 { rendered_length / natural_length } else { 1.0 };
                let scale_x = scale_y * if measured_stretch.is_finite() && measured_stretch > 0.0 { measured_stretch } else { 1.0 };
                let baseline_offset = if matches!(style.style.dominant_baseline.as_str(), "text-before-edge" | "text-top") {
                    style.font.ascent * scale_y
                } else {
                    0.0
                };
                self.place_glyphs(&style, grapheme, start, scale_x, scale_y, baseline_offset, &mut paths);
                index += length;
            }
        }
        let mut group = SvgElement::new("g");
        group.attributes =
            element.attributes.iter().filter(|(name, _)| OUTLINED_GROUP_ATTRIBUTES.contains(&name.as_str())).cloned().collect();
        group.children = paths;
        Ok(group)
    }

    #[allow(clippy::too_many_arguments)]
    fn place_glyphs(
        &mut self,
        style: &OutlineStyle,
        grapheme: &str,
        start: (f64, f64),
        scale_x: f64,
        scale_y: f64,
        baseline_offset: f64,
        paths: &mut Vec<SvgElement>,
    ) {
        let Some(face) = style.font.shaping_face() else {
            return;
        };
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(grapheme);
        buffer.guess_segment_properties();
        let shaped = rustybuzz::shape(&face, &[], buffer);
        let (mut pen_x, mut pen_y) = (0.0f64, 0.0f64);
        for (info, position) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            let glyph = info.glyph_id as u16;
            let x = start.0 + (pen_x + f64::from(position.x_offset)) * scale_x;
            let y = start.1 + baseline_offset - (pen_y + f64::from(position.y_offset)) * scale_y;
            let mut transform = format!("translate({} {}) scale({} {})", number(x), number(y), number(scale_x), number(-scale_y));
            if style.synthetic_italic {
                transform.push_str(" skewX(11.309932)");
            }
            let d = self.glyph_path(&style.font, glyph);
            if !d.is_empty() {
                let mut path = SvgElement::new("path");
                path.set("d", d.as_str());
                paint_attributes(style, &style.style.fill, &mut path);
                path.set("transform", transform);
                paths.push(path);
            }
            pen_x += f64::from(position.x_advance);
            pen_y += f64::from(position.y_advance);
        }
    }
}

fn position(layout: &TextLayout, utf16_offset: usize) -> (f64, f64) {
    layout.start_position(utf16_offset).map_or((0.0, 0.0), |(x, y)| (f64::from(x), f64::from(y)))
}

fn contains_text_element(element: &SvgElement) -> bool {
    element.tag == "text" || element.children.iter().any(contains_text_element)
}

fn inherited_for(style: &TextStyle, element: &SvgElement) -> TextStyle {
    crate::text::svg_layout::inherit_style(style, element)
}

use std::sync::Arc;

use rustybuzz::ttf_parser::{Face, GlyphId, OutlineBuilder, name_id};

use crate::assets::AssetSource;
use crate::error::{Error, Result};

#[derive(Debug)]
pub struct FontData {
    pub sfnt: Vec<u8>,
    pub units_per_em: f64,
    pub ascent: f64,
    pub is_bold: bool,
    pub is_italic: bool,
    pub autohinted: bool,
}

pub type SharedFont = Arc<FontData>;

pub fn load_font(source: &AssetSource, asset_id: &str) -> Result<SharedFont> {
    let resolved = source.read()?;
    let bytes = resolved.bytes();
    let sfnt =
        decode_font_container(bytes).ok_or_else(|| Error::render(format!("Could not load font outlines from \"{}\".", source.label())))?;
    let face = Face::parse(&sfnt, 0).map_err(|_| Error::render(format!("Font asset \"{asset_id}\" could not be parsed.")))?;
    let subfamily =
        face.names().into_iter().filter(|name| name.name_id == name_id::SUBFAMILY).find_map(|name| name.to_string()).unwrap_or_default();
    let subfamily_lower = subfamily.to_lowercase();
    let bold_word = subfamily_lower.split(|character: char| character.is_whitespace() || character == '-').any(|word| word == "bold");
    let is_bold = face.is_bold() || bold_word;
    let is_italic =
        face.italic_angle() != 0.0 || face.is_italic() || subfamily_lower.contains("italic") || subfamily_lower.contains("oblique");
    let units_per_em = f64::from(face.units_per_em());
    let ascent = f64::from(face.tables().hhea.ascender);
    let autohinted = face.tables().glyf.is_some() && max_size_of_instructions(&face) == Some(0);
    Ok(Arc::new(FontData { sfnt, units_per_em, ascent, is_bold, is_italic, autohinted }))
}

fn max_size_of_instructions(face: &Face) -> Option<u16> {
    let maxp = face.raw_face().table(rustybuzz::ttf_parser::Tag::from_bytes(b"maxp"))?;
    let bytes = maxp.get(26..28)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn decode_font_container(bytes: &[u8]) -> Option<Vec<u8>> {
    match bytes.get(..4)? {
        b"wOF2" => wuff::decompress_woff2(bytes).ok(),
        b"wOFF" => wuff::decompress_woff1(bytes).ok(),
        _ => Some(bytes.to_vec()),
    }
}

impl FontData {
    pub fn face(&self) -> Option<Face<'_>> {
        Face::parse(&self.sfnt, 0).ok()
    }

    pub fn shaping_face(&self) -> Option<rustybuzz::Face<'_>> {
        rustybuzz::Face::from_slice(&self.sfnt, 0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathVerb {
    Move(f64, f64),
    Line(f64, f64),
    Quad(f64, f64, f64, f64),
    Cubic(f64, f64, f64, f64, f64, f64),
    Close,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct GlyphOutline {
    pub verbs: Vec<PathVerb>,
}

impl OutlineBuilder for GlyphOutline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.verbs.push(PathVerb::Move(f64::from(x), f64::from(y)));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.verbs.push(PathVerb::Line(f64::from(x), f64::from(y)));
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.verbs.push(PathVerb::Quad(f64::from(x1), f64::from(y1), f64::from(x), f64::from(y)));
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let values = [x1, y1, x2, y2, x, y].map(f64::from);
        self.verbs.push(PathVerb::Cubic(values[0], values[1], values[2], values[3], values[4], values[5]));
    }

    fn close(&mut self) {
        let start = self.verbs.iter().rev().find_map(|verb| match *verb {
            PathVerb::Move(x, y) => Some((x, y)),
            _ => None,
        });
        if let (Some(PathVerb::Line(x, y)), Some(start)) = (self.verbs.last(), start)
            && (*x, *y) == start
        {
            self.verbs.pop();
        }
        self.verbs.push(PathVerb::Close);
    }
}

impl GlyphOutline {
    pub fn is_empty(&self) -> bool {
        self.verbs.is_empty()
    }

    pub fn to_svg_path(&self) -> String {
        let mut output = String::new();
        let mut push = |command: char, values: &[f64]| {
            output.push(command);
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(' ');
                }
                output.push_str(&crate::number::js_number(crate::number::js_round(value * 100.0) / 100.0));
            }
        };
        for verb in &self.verbs {
            match *verb {
                PathVerb::Move(x, y) => push('M', &[x, y]),
                PathVerb::Line(x, y) => push('L', &[x, y]),
                PathVerb::Quad(x1, y1, x, y) => push('Q', &[x1, y1, x, y]),
                PathVerb::Cubic(x1, y1, x2, y2, x, y) => push('C', &[x1, y1, x2, y2, x, y]),
                PathVerb::Close => push('Z', &[]),
            }
        }
        output
    }
}

#[derive(Debug, Clone, Copy)]
struct GlyfPoint {
    x: f64,
    y: f64,
    on_curve: bool,
    end_contour: bool,
}

struct GlyfTables<'a> {
    glyf: &'a [u8],
    loca: &'a [u8],
    long_offsets: bool,
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*data.get(offset)?, *data.get(offset + 1)?]))
}

fn read_i16(data: &[u8], offset: usize) -> Option<i16> {
    read_u16(data, offset).map(|value| value as i16)
}

impl<'a> GlyfTables<'a> {
    fn new(face: &Face<'a>) -> Option<Self> {
        let raw = face.raw_face();
        let glyf = raw.table(rustybuzz::ttf_parser::Tag::from_bytes(b"glyf"))?;
        let loca = raw.table(rustybuzz::ttf_parser::Tag::from_bytes(b"loca"))?;
        let long_offsets = face.tables().head.index_to_location_format == rustybuzz::ttf_parser::head::IndexToLocationFormat::Long;
        Some(Self { glyf, loca, long_offsets })
    }

    fn offset(&self, glyph: u16) -> Option<usize> {
        let index = usize::from(glyph);
        if self.long_offsets {
            let offset = index * 4;
            let bytes = self.loca.get(offset..offset + 4)?;
            Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize)
        } else {
            read_u16(self.loca, index * 2).map(|value| usize::from(value) * 2)
        }
    }

    fn points(&self, glyph: u16, depth: u32) -> Option<Vec<GlyfPoint>> {
        let (start, end) = (self.offset(glyph)?, self.offset(glyph.checked_add(1)?)?);
        if start == end || depth > 16 {
            return Some(Vec::new());
        }
        let data = self.glyf.get(start..end)?;
        let contours = read_i16(data, 0)?;
        if contours > 0 {
            simple_points(data, contours as usize)
        } else if contours < 0 {
            self.composite_points(data, depth)
        } else {
            Some(Vec::new())
        }
    }

    fn composite_points(&self, data: &[u8], depth: u32) -> Option<Vec<GlyfPoint>> {
        let mut points = Vec::new();
        let mut offset = 10;
        loop {
            let flags = read_u16(data, offset)?;
            let glyph = read_u16(data, offset + 2)?;
            offset += 4;
            let (dx, dy) = if flags & 1 != 0 {
                let values = (read_i16(data, offset)?, read_i16(data, offset + 2)?);
                offset += 4;
                (f64::from(values.0), f64::from(values.1))
            } else {
                let values = (*data.get(offset)? as i8, *data.get(offset + 1)? as i8);
                offset += 2;
                (f64::from(values.0), f64::from(values.1))
            };
            let mut read_scale = || -> Option<f64> {
                let value = f64::from(read_i16(data, offset)?) / 16384.0;
                offset += 2;
                Some(value)
            };
            let (mut scale_x, mut scale_y, mut scale01, mut scale10) = (1.0, 1.0, 0.0, 0.0);
            if flags & 8 != 0 {
                scale_x = read_scale()?;
                scale_y = scale_x;
            } else if flags & 64 != 0 {
                scale_x = read_scale()?;
                scale_y = read_scale()?;
            } else if flags & 128 != 0 {
                scale_x = read_scale()?;
                scale01 = read_scale()?;
                scale10 = read_scale()?;
                scale_y = read_scale()?;
            }
            for point in self.points(glyph, depth + 1)? {
                points.push(GlyfPoint {
                    x: point.x * scale_x + point.y * scale01 + dx,
                    y: point.y * scale_y + point.x * scale10 + dy,
                    ..point
                });
            }
            if flags & 32 == 0 {
                return Some(points);
            }
        }
    }
}

fn simple_points(data: &[u8], contours: usize) -> Option<Vec<GlyfPoint>> {
    let ends: Vec<usize> = (0..contours).map(|index| read_u16(data, 10 + index * 2).map(usize::from)).collect::<Option<_>>()?;
    let count = ends.last()? + 1;
    let instructions = usize::from(read_u16(data, 10 + contours * 2)?);
    let mut offset = 12 + contours * 2 + instructions;
    let mut flags = Vec::with_capacity(count);
    while flags.len() < count {
        let flag = *data.get(offset)?;
        offset += 1;
        flags.push(flag);
        if flag & 8 != 0 {
            let repeat = *data.get(offset)?;
            offset += 1;
            flags.extend(std::iter::repeat_n(flag, usize::from(repeat)));
        }
    }
    let mut read_coordinates = |short: u8, same: u8| -> Option<Vec<f64>> {
        let mut value = 0i32;
        let mut values = Vec::with_capacity(flags.len());
        for flag in &flags {
            if flag & short != 0 {
                let delta = i32::from(*data.get(offset)?);
                offset += 1;
                value += if flag & same != 0 { delta } else { -delta };
            } else if flag & same == 0 {
                value += i32::from(read_i16(data, offset)?);
                offset += 2;
            }
            values.push(f64::from(value));
        }
        Some(values)
    };
    let xs = read_coordinates(2, 16)?;
    let ys = read_coordinates(4, 32)?;
    Some(
        flags
            .iter()
            .enumerate()
            .map(|(index, flag)| GlyfPoint { x: xs[index], y: ys[index], on_curve: flag & 1 != 0, end_contour: ends.contains(&index) })
            .collect(),
    )
}

fn contour_outline(outline: &mut GlyphOutline, contour: &[GlyfPoint]) {
    let (Some(first), Some(last)) = (contour.first(), contour.last()) else {
        return;
    };
    let (mut first, mut start, mut curve) = (*first, 1, None);
    if !first.on_curve {
        first = if last.on_curve {
            *last
        } else {
            GlyfPoint { x: (first.x + last.x) / 2.0, y: (first.y + last.y) / 2.0, on_curve: false, end_contour: false }
        };
        curve = Some(first);
        start = 0;
    }
    outline.verbs.push(PathVerb::Move(first.x, first.y));
    for index in start..contour.len() {
        let point = contour[index];
        let previous = if index == 0 { first } else { contour[index - 1] };
        match (previous.on_curve, point.on_curve) {
            (true, true) => outline.verbs.push(PathVerb::Line(point.x, point.y)),
            (true, false) => curve = Some(point),
            (false, false) => {
                let middle = ((previous.x + point.x) / 2.0, (previous.y + point.y) / 2.0);
                outline.verbs.push(PathVerb::Quad(previous.x, previous.y, middle.0, middle.1));
                curve = Some(point);
            }
            (false, true) => {
                let control = curve.unwrap_or(previous);
                outline.verbs.push(PathVerb::Quad(control.x, control.y, point.x, point.y));
                curve = None;
            }
        }
    }
    if let Some(control) = curve {
        outline.verbs.push(PathVerb::Quad(control.x, control.y, first.x, first.y));
    }
    outline.verbs.push(PathVerb::Close);
}

fn glyf_outline(tables: &GlyfTables, glyph: u16) -> Option<GlyphOutline> {
    let points = tables.points(glyph, 0)?;
    let mut outline = GlyphOutline::default();
    let mut contour = Vec::new();
    for point in points {
        contour.push(point);
        if point.end_contour {
            contour_outline(&mut outline, &contour);
            contour.clear();
        }
    }
    Some(outline)
}

pub fn glyph_outline(face: &Face, glyph: u16) -> GlyphOutline {
    if let Some(outline) = GlyfTables::new(face).and_then(|tables| glyf_outline(&tables, glyph)) {
        return outline;
    }
    let mut outline = GlyphOutline::default();
    face.outline_glyph(GlyphId(glyph), &mut outline);
    outline
}

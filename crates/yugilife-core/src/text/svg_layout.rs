use crate::svg::{AttributeValue, SvgElement};
use crate::text::measure::Measurer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    Start,
    Middle,
    End,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: String,
    pub font_style: String,
    pub letter_spacing: f64,
    pub text_anchor: Anchor,
    pub dominant_baseline: String,
    pub fill: String,
    pub fill_opacity: String,
    pub stroke: String,
    pub stroke_width: String,
    pub stroke_opacity: String,
    pub stroke_linejoin: String,
    pub stroke_linecap: String,
    pub stroke_miterlimit: String,
    pub paint_order: String,
    pub opacity: String,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: String::new(),
            font_size: 16.0,
            font_weight: "400".to_owned(),
            font_style: "normal".to_owned(),
            letter_spacing: 0.0,
            text_anchor: Anchor::Start,
            dominant_baseline: "auto".to_owned(),
            fill: "rgb(0, 0, 0)".to_owned(),
            fill_opacity: "1".to_owned(),
            stroke: "none".to_owned(),
            stroke_width: "1px".to_owned(),
            stroke_opacity: "1".to_owned(),
            stroke_linejoin: "miter".to_owned(),
            stroke_linecap: "butt".to_owned(),
            stroke_miterlimit: "4".to_owned(),
            paint_order: "normal".to_owned(),
            opacity: "1".to_owned(),
        }
    }
}

fn attribute_text(value: &AttributeValue) -> String {
    value.to_js_string()
}

fn parse_length(value: &str, font_size: f64) -> Option<f64> {
    let text = crate::js::trim(value);
    if let Some(number) = text.strip_suffix("px") {
        return number.trim().parse().ok();
    }
    if let Some(number) = text.strip_suffix("em") {
        return number.trim().parse::<f64>().ok().map(|value| value * font_size);
    }
    text.parse().ok()
}

fn list_values(value: &AttributeValue) -> Vec<f32> {
    match value {
        AttributeValue::Number(number) => vec![*number as f32],
        AttributeValue::Text(text) => text
            .split(|character: char| character == ',' || character.is_whitespace())
            .filter(|part| !part.is_empty())
            .filter_map(|part| parse_length(part, 16.0).map(|value| value as f32))
            .collect(),
    }
}

pub fn css_color(value: &str) -> String {
    match svgtypes::Paint::from_str(value.trim()) {
        Ok(svgtypes::Paint::None) => "none".to_owned(),
        Ok(svgtypes::Paint::Color(color)) => {
            if color.alpha == 255 {
                format!("rgb({}, {}, {})", color.red, color.green, color.blue)
            } else {
                let alpha = f64::from(color.alpha) / 255.0;
                format!(
                    "rgba({}, {}, {}, {})",
                    color.red,
                    color.green,
                    color.blue,
                    crate::number::js_number((alpha * 1000.0).round() / 1000.0)
                )
            }
        }
        Ok(svgtypes::Paint::CurrentColor) => "rgb(0, 0, 0)".to_owned(),
        _ => value.to_owned(),
    }
}

pub fn inherit_style(style: &TextStyle, element: &SvgElement) -> TextStyle {
    style.inherit(element)
}

impl TextStyle {
    fn inherit(&self, element: &SvgElement) -> Self {
        let mut style = self.clone();
        if let Some(size) = element.attribute("font-size").and_then(|value| parse_length(&attribute_text(value), self.font_size)) {
            style.font_size = size;
        }
        for (name, value) in &element.attributes {
            let text = attribute_text(value);
            match name.as_str() {
                "font-family" => style.font_family = text,
                "font-weight" => {
                    style.font_weight = match text.as_str() {
                        "normal" => "400".to_owned(),
                        "bold" => "700".to_owned(),
                        _ => text,
                    }
                }
                "font-style" => style.font_style = text,
                "letter-spacing" => {
                    style.letter_spacing = if text == "normal" { 0.0 } else { parse_length(&text, style.font_size).unwrap_or(0.0) }
                }
                "text-anchor" => {
                    style.text_anchor = match text.as_str() {
                        "middle" => Anchor::Middle,
                        "end" => Anchor::End,
                        _ => Anchor::Start,
                    }
                }
                "dominant-baseline" => style.dominant_baseline = text,
                "fill" => style.fill = css_color(&text),
                "fill-opacity" => style.fill_opacity = text,
                "stroke" => style.stroke = css_color(&text),
                "stroke-width" => {
                    style.stroke_width = match parse_length(&text, style.font_size) {
                        Some(width) => format!("{}px", crate::number::js_number(width)),
                        None => text,
                    }
                }
                "stroke-opacity" => style.stroke_opacity = text,
                "stroke-linejoin" => style.stroke_linejoin = text,
                "stroke-linecap" => style.stroke_linecap = text,
                "stroke-miterlimit" => style.stroke_miterlimit = text,
                "paint-order" => style.paint_order = text,
                _ => {}
            }
        }
        style.opacity = element.attribute("opacity").map_or_else(|| "1".to_owned(), attribute_text);
        style
    }
}

#[derive(Debug, Clone)]
pub struct Character {
    pub code_point: char,
    pub utf16_offset: usize,
    pub run: usize,
    pub item: usize,
    local_start: i64,
    local_end: i64,
    resolve_x: Option<f32>,
    resolve_y: Option<f32>,
    resolve_dx: Option<f32>,
    resolve_dy: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct TextRun {
    pub text: String,
    pub style: TextStyle,
    pub start: usize,
    pub end: usize,
    pub subtree_end: usize,
    pub length_adjust: Option<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct Item {
    pub start: usize,
    pub end: usize,
    pub run: usize,
    pub x: f32,
    pub y: f32,
    pub inline_size: f32,
    pub length_adjust_scale: f32,
    anchored_chunk: bool,
    css_x: f32,
    css_y: f32,
    text_length_shift_x: f32,
    text_length_resolved: bool,
}

#[derive(Debug, Clone)]
struct TextLengthRange {
    start: usize,
    end: usize,
    text_length: f32,
    spacing_and_glyphs: bool,
}

#[derive(Debug, Clone)]
pub struct TextLayout {
    pub characters: Vec<Character>,
    pub items: Vec<Item>,
    pub runs: Vec<TextRun>,
}

struct Builder {
    characters: Vec<Character>,
    runs: Vec<TextRun>,
    ranges: Vec<TextLengthRange>,
    shifts: Vec<f64>,
    utf16: usize,
    natural: bool,
}

fn assign(list: &[f32], characters: &mut [Character], set: impl Fn(&mut Character, f32)) {
    for (character, value) in characters.iter_mut().zip(list) {
        set(character, *value);
    }
}

impl Builder {
    fn visit(&mut self, element: &SvgElement, style: &TextStyle, baseline_shift: f64) {
        let style = style.inherit(element);
        let baseline_shift = baseline_shift + element_baseline_shift(element, style.font_size);
        let start = self.characters.len();
        let mut own_run = None;
        if let Some(text) = element.text.as_deref().filter(|text| !text.is_empty()) {
            let run = self.runs.len();
            own_run = Some(run);
            for code_point in text.chars() {
                self.characters.push(Character {
                    code_point,
                    utf16_offset: self.utf16,
                    run,
                    item: 0,
                    local_start: 0,
                    local_end: 0,
                    resolve_x: None,
                    resolve_y: None,
                    resolve_dx: None,
                    resolve_dy: None,
                });
                self.shifts.push(baseline_shift);
                self.utf16 += code_point.len_utf16();
            }
            let length_adjust = if self.natural {
                None
            } else {
                element.attribute("textLength").map(|length| {
                    let adjust = element.attribute("lengthAdjust").map_or_else(|| "spacing".to_owned(), attribute_text);
                    (adjust, attribute_text(length))
                })
            };
            self.runs.push(TextRun {
                text: text.to_owned(),
                style: style.clone(),
                start,
                end: self.characters.len(),
                subtree_end: self.characters.len(),
                length_adjust,
            });
        }
        for child in &element.children {
            self.visit(child, &style, baseline_shift);
        }
        let end = self.characters.len();
        if let Some(run) = own_run {
            self.runs[run].subtree_end = end;
        }
        if end == start {
            return;
        }
        let characters = &mut self.characters[start..end];
        let own = |name: &str| element.attribute(name).map(list_values);
        if let Some(values) = own("x") {
            assign(&values, characters, |character, value| character.resolve_x = character.resolve_x.or(Some(value)));
        }
        if let Some(values) = own("y") {
            assign(&values, characters, |character, value| character.resolve_y = character.resolve_y.or(Some(value)));
        }
        if let Some(values) = own("dx") {
            assign(&values, characters, |character, value| character.resolve_dx = character.resolve_dx.or(Some(value)));
        }
        if let Some(values) = own("dy") {
            assign(&values, characters, |character, value| character.resolve_dy = character.resolve_dy.or(Some(value)));
        }
        if !self.natural
            && let Some(length) = element.attribute("textLength")
        {
            let text_length = parse_length(&attribute_text(length), style.font_size).unwrap_or(0.0) as f32;
            let spacing_and_glyphs = element.attribute("lengthAdjust").is_some_and(|value| attribute_text(value) == "spacingAndGlyphs");
            if text_length >= 0.0 {
                self.ranges.push(TextLengthRange { start, end: end - 1, text_length, spacing_and_glyphs });
            }
        }
    }
}

fn element_baseline_shift(element: &SvgElement, font_size: f64) -> f64 {
    let Some(value) = element.attribute("baseline-shift") else {
        return 0.0;
    };
    let text = attribute_text(value);
    match text.as_str() {
        "baseline" => 0.0,
        "super" => font_size / 3.0,
        "sub" => -font_size / 5.0,
        other => match other.strip_suffix('%') {
            Some(percent) => percent.trim().parse::<f64>().map_or(0.0, |value| value * font_size / 100.0),
            None => parse_length(other, font_size).unwrap_or(0.0),
        },
    }
}

fn layout_unit_floor(value: i64) -> i64 {
    value.div_euclid(1024)
}

fn layout_unit_ceil(value: i64) -> i64 {
    -(-value).div_euclid(1024)
}

pub fn layout_text(element: &SvgElement, inherited: &TextStyle, measurer: &mut Measurer, natural: bool) -> TextLayout {
    let mut builder = Builder { characters: Vec::new(), runs: Vec::new(), ranges: Vec::new(), shifts: Vec::new(), utf16: 0, natural };
    builder.visit(element, inherited, 0.0);
    let Builder { mut characters, runs, ranges, shifts, .. } = builder;
    let mut items: Vec<Item> = Vec::new();
    let mut line_offset: i64 = 0;
    for (run_index, run) in runs.iter().enumerate() {
        let glyphs = measurer.shape(&run.style.font_family, run.style.font_size, &run.text);
        let byte_offsets: Vec<usize> = run.text.char_indices().map(|(offset, _)| offset).collect();
        let mut advances = vec![0i64; byte_offsets.len()];
        let mut cluster_start = vec![false; byte_offsets.len()];
        for glyph in &glyphs {
            let index = byte_offsets.partition_point(|offset| *offset < glyph.cluster as usize).min(advances.len().saturating_sub(1));
            advances[index] += (glyph.advance * 65536.0).round() as i64;
            cluster_start[index] = true;
        }
        let spacing = (run.style.letter_spacing as f32 * 65536.0).trunc() as i64;
        let mut position: i64 = 0;
        let mut item_origin: i64 = 0;
        for local in 0..advances.len() {
            let index = run.start + local;
            let character = &characters[index];
            let positioned = character.resolve_x.is_some()
                || character.resolve_y.is_some()
                || character.resolve_dx.is_some()
                || character.resolve_dy.is_some();
            if local == 0 || positioned {
                if let Some(previous) = items.last_mut().filter(|item| item.run == run_index) {
                    line_offset += layout_unit_ceil(position - item_origin);
                    previous.inline_size = layout_unit_ceil(position - item_origin) as f32 / 64.0;
                }
                item_origin = position;
                items.push(Item {
                    start: index,
                    end: index,
                    run: run_index,
                    x: 0.0,
                    y: 0.0,
                    inline_size: 0.0,
                    length_adjust_scale: 1.0,
                    anchored_chunk: false,
                    css_x: line_offset as f32 / 64.0,
                    css_y: -(shifts[index] as f32),
                    text_length_shift_x: 0.0,
                    text_length_resolved: false,
                });
            }
            let item_index = items.len() - 1;
            let item = &mut items[item_index];
            item.end = index + 1;
            let character = &mut characters[index];
            character.item = item_index;
            character.local_start = position - item_origin;
            if cluster_start[local] || local == 0 {
                position += advances[local] + spacing;
            }
            character.local_end = position - item_origin;
        }
        if let Some(last) = items.last_mut().filter(|item| item.run == run_index) {
            line_offset += layout_unit_ceil(position - item_origin);
            last.inline_size = layout_unit_ceil(position - item_origin) as f32 / 64.0;
        }
    }
    if items.is_empty() {
        return TextLayout { characters, items, runs };
    }
    items[0].anchored_chunk = true;
    for item in &mut items {
        let first = &characters[item.start];
        if first.resolve_x.is_some() || first.resolve_y.is_some() {
            item.anchored_chunk = true;
        }
    }
    let mut shift_x: f32 = 0.0;
    let mut shift_y: f32 = 0.0;
    for item in &mut items {
        let first = &characters[item.start];
        if first.resolve_x.is_some() {
            shift_x = 0.0;
        }
        if first.resolve_y.is_some() {
            shift_y = 0.0;
        }
        shift_x += first.resolve_dx.unwrap_or(0.0);
        shift_y += first.resolve_dy.unwrap_or(0.0);
        item.x = item.css_x + shift_x;
        item.y = item.css_y + shift_y;
    }
    let mut resolved_starts: Vec<usize> = Vec::new();
    for range in &ranges {
        let first = characters[range.start].item;
        let last = characters[range.end].item;
        resolve_text_length(&mut items, first, last + 1, range, &mut resolved_starts);
    }
    let mut shift_x: f32 = 0.0;
    let mut shift_y: f32 = 0.0;
    for item in &mut items {
        let first = &characters[item.start];
        if let Some(x) = first.resolve_x {
            shift_x = x - item.css_x - item.text_length_shift_x;
        }
        if let Some(y) = first.resolve_y {
            shift_y = y;
        }
        item.x += shift_x;
        item.y += shift_y;
    }
    apply_anchoring(&mut items, &runs);
    TextLayout { characters, items, runs }
}

fn resolve_text_length(items: &mut [Item], start: usize, end: usize, range: &TextLengthRange, resolved_starts: &mut Vec<usize>) {
    let mut minimum = f32::INFINITY;
    let mut maximum = f32::NEG_INFINITY;
    for item in &items[start..end] {
        minimum = minimum.min(item.x);
        maximum = maximum.max(item.x + item.inline_size);
    }
    if minimum == f32::INFINITY {
        return;
    }
    let delta = range.text_length - (maximum - minimum);

    let shift = if range.spacing_and_glyphs {
        if minimum >= maximum {
            return;
        }
        let scale = range.text_length / (maximum - minimum);
        for item in &mut items[start..end] {
            let original = item.x;
            item.x = minimum + (item.x - minimum) * scale;
            item.text_length_shift_x += item.x - original;
            if !item.text_length_resolved {
                item.length_adjust_scale = scale;
                item.inline_size *= scale;
            }
            item.text_length_resolved = true;
        }
        delta
    } else {
        let mut count = items[start..end].iter().filter(|item| !item.text_length_resolved).count() as i64;
        count += resolved_starts.iter().filter(|index| start <= **index && **index < end).count() as i64 - 1;
        let item_delta = if count != 0 { delta / count as f32 } else { 0.0 };
        let mut running = 0.0f32;
        for (index, item) in items.iter_mut().enumerate().take(end).skip(start) {
            item.x += running;
            item.text_length_shift_x += running;
            if resolved_starts.contains(&index) || !item.text_length_resolved {
                running += item_delta;
            }
            item.text_length_resolved = true;
        }
        running
    };
    for item in &mut items[end..] {
        if item.anchored_chunk {
            break;
        }
        item.x += shift;
    }
    resolved_starts.retain(|index| !(start <= *index && *index < end));
    resolved_starts.push(start);
}

fn apply_anchoring(items: &mut [Item], runs: &[TextRun]) {
    let mut start = 0;
    while start < items.len() {
        let mut end = start;
        while end + 1 < items.len() && !items[end + 1].anchored_chunk {
            end += 1;
        }
        let mut minimum = f32::INFINITY;
        let mut maximum = f32::NEG_INFINITY;
        for item in &items[start..=end] {
            minimum = minimum.min(item.x);
            maximum = maximum.max(item.x + item.inline_size);
        }
        let mut shift = items[start].x;
        shift = match runs[items[start].run].style.text_anchor {
            Anchor::Start => shift - minimum,
            Anchor::End => shift - maximum,
            Anchor::Middle => shift - (minimum + maximum) / 2.0,
        };
        for item in &mut items[start..=end] {
            item.x += shift;
        }
        start = end + 1;
    }
}

impl TextLayout {
    fn index_of_utf16(&self, offset: usize) -> Option<usize> {
        self.characters.binary_search_by_key(&offset, |character| character.utf16_offset).ok()
    }

    pub fn start_position(&self, utf16_offset: usize) -> Option<(f32, f32)> {
        let character = &self.characters[self.index_of_utf16(utf16_offset)?];
        let item = &self.items[character.item];
        let local = layout_unit_floor(character.local_start) as f32 / 64.0;
        let x = local + item.x;
        let scale = item.length_adjust_scale;
        if scale == 1.0 {
            return Some((x, item.y));
        }
        let translation = item.x - scale * item.x;
        let mapped = f64::from(scale) * f64::from(x) + f64::from(translation);
        Some((mapped as f32, item.y))
    }

    pub fn substring_length(&self, utf16_offset: usize, utf16_length: usize) -> f32 {
        let end = utf16_offset + utf16_length;
        let mut total = 0.0f32;
        let mut current: Option<(usize, usize, usize)> = None;
        let flush = |current: Option<(usize, usize, usize)>, total: &mut f32| {
            let Some((item_index, first, last)) = current else {
                return;
            };
            let item = &self.items[item_index];
            let width = if first == item.start && last + 1 == item.end {
                ((item.inline_size / item.length_adjust_scale) * 64.0) as i32 as f32 / 64.0
            } else {
                let (start, end) = (self.characters[first].local_start, self.characters[last].local_end);
                (layout_unit_ceil(end) - layout_unit_floor(start)) as f32 / 64.0
            };
            *total += width * item.length_adjust_scale;
        };
        for (index, character) in self.characters.iter().enumerate() {
            if character.utf16_offset < utf16_offset || character.utf16_offset >= end {
                continue;
            }
            current = match current {
                Some((item, first, _)) if item == character.item => Some((item, first, index)),
                other => {
                    flush(other, &mut total);
                    Some((character.item, index, index))
                }
            };
        }
        flush(current, &mut total);
        total
    }

    pub fn utf16_offset(&self, character: usize) -> usize {
        self.characters.get(character).map_or_else(|| self.number_of_chars(), |character| character.utf16_offset)
    }

    pub fn number_of_chars(&self) -> usize {
        self.characters.last().map_or(0, |character| character.utf16_offset + character.code_point.len_utf16())
    }
}

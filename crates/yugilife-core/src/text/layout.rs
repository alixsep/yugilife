use crate::card::{CardData, CardValue};
use crate::error::{Error, Result};
use crate::js;
use crate::model::{Position, SemanticValue, TextFormat, TextLayer};
use crate::number::stable_layout_number;
use crate::rich_text::{
    RichTextDocument, RichTextElement, RichTextLength, RichTextNode, RichTextWarning, TagName, grapheme_segments,
    has_leading_authored_line_fit_split, parse_rich_text, parse_rich_text_length, plain_text_from_rich_text, rich_text_has_formatting,
};
use crate::svg::{AttributeValue, SvgElement};
use crate::text::measure::Measurer;
use crate::text::typography::{FitProfile, FontWeight, TextAnchor, TextStroke, TextTypography};

const DEFAULT_AUTO_SCALE_X_QUANTIFIER: f64 = 0.01;
const SCALE_EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, PartialEq)]
pub struct InlineTypography {
    pub fill: String,
    pub font_family: String,
    pub font_size: f64,
    pub font_style: Option<String>,
    pub font_weight: Option<FontWeight>,
    pub letter_spacing: Option<f64>,
}

impl InlineTypography {
    pub fn from_typography(typography: &TextTypography) -> Self {
        Self {
            fill: typography.fill.clone(),
            font_family: typography.font_family.clone(),
            font_size: typography.font_size,
            font_style: typography.font_style.clone(),
            font_weight: typography.font_weight.clone(),
            letter_spacing: typography.letter_spacing,
        }
    }

    fn with_size(&self, font_size: f64) -> Self {
        Self { font_size, ..self.clone() }
    }
}

pub struct TextLayoutRequest<'a> {
    pub card: &'a CardData,
    pub layer_id: &'a str,
    pub layer: &'a TextLayer,
    pub position: Position,
    pub typography: &'a TextTypography,
    pub fit_profile_id: Option<&'a str>,
    pub semantic_value: Option<&'a SemanticValue>,
}

pub fn create_text_element(
    request: &TextLayoutRequest,
    measurer: &mut Measurer,
    warnings: &mut Vec<RichTextWarning>,
) -> Result<SvgElement> {
    let value = text_value(request)?;
    let source = match &value {
        TextValue::Text(text) => text.clone(),
        TextValue::Lines(lines) => lines.join("\n"),
    };
    let parsed = parse_rich_text(&source);
    warnings.extend(parsed.warnings);
    let layout = Layout { request, typography: request.typography };
    if rich_text_has_formatting(&parsed.document) {
        return Ok(layout.rich_element(&parsed.document, measurer));
    }
    let plain = plain_text_from_rich_text(&parsed.document);
    Ok(layout.plain_element(&plain, measurer))
}

enum TextValue {
    Text(String),
    Lines(Vec<String>),
}

fn json_list_entry(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Null => "null".to_owned(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        serde_json::Value::Number(number) => crate::number::js_number(number.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::Array(entries) => entries
            .iter()
            .map(|entry| match entry {
                serde_json::Value::Null => String::new(),
                other => json_list_entry(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        serde_json::Value::Object(_) => "[object Object]".to_owned(),
    }
}

enum RawValue {
    Missing,
    Scalar(String, bool),
    List(Vec<String>),
    Unserializable,
}

fn raw_card_value(value: Option<&CardValue>) -> Option<RawValue> {
    match value? {
        CardValue::Asset(_) => Some(RawValue::Unserializable),
        CardValue::Json(serde_json::Value::Null) => None,
        CardValue::Json(serde_json::Value::String(text)) => Some(RawValue::Scalar(text.clone(), text.is_empty())),
        CardValue::Json(serde_json::Value::Number(number)) => {
            Some(RawValue::Scalar(crate::number::js_number(number.as_f64().unwrap_or(f64::NAN)), false))
        }
        CardValue::Json(serde_json::Value::Bool(flag)) => Some(RawValue::Scalar(flag.to_string(), false)),
        CardValue::Json(serde_json::Value::Array(entries)) => Some(RawValue::List(entries.iter().map(json_list_entry).collect())),
        CardValue::Json(serde_json::Value::Object(_)) => Some(RawValue::Unserializable),
    }
}

fn text_value(request: &TextLayoutRequest) -> Result<TextValue> {
    let layer = request.layer;
    let raw = if layer.semantic_path.is_some() {
        match request.semantic_value {
            None => RawValue::Missing,
            Some(SemanticValue::Primitive(primitive)) => {
                let text = primitive.to_js_string();
                let empty = matches!(primitive, crate::model::Primitive::String(value) if value.is_empty());
                RawValue::Scalar(text, empty)
            }
            Some(SemanticValue::List(entries)) => RawValue::List(entries.iter().map(crate::model::Primitive::to_js_string).collect()),
        }
    } else if let Some(field) = &layer.field {
        raw_card_value(request.card.get(field))
            .or_else(|| layer.fallback_field.as_ref().and_then(|fallback| raw_card_value(request.card.get(fallback))))
            .unwrap_or(RawValue::Missing)
    } else {
        RawValue::Missing
    };
    let prefix = layer.prefix.as_deref().unwrap_or("");
    let suffix = layer.suffix.as_deref().unwrap_or("");
    match raw {
        RawValue::Missing | RawValue::Scalar(_, true) => Ok(TextValue::Text(String::new())),
        RawValue::List(values) => match layer.format {
            Some(TextFormat::Pair) => {
                let entries: Vec<&str> = match layer.pair_index {
                    None => values.iter().filter(|value| !value.is_empty()).map(String::as_str).collect(),
                    Some(index) => values.get(index).filter(|value| !value.is_empty()).map(String::as_str).into_iter().collect(),
                };
                if entries.is_empty() {
                    Ok(TextValue::Text(String::new()))
                } else {
                    let separator = layer.separator.as_deref().unwrap_or(" / ");
                    Ok(TextValue::Text(format!("{prefix}{}{suffix}", entries.join(separator))))
                }
            }
            Some(TextFormat::TypeList) => {
                let entries: Vec<&str> = values.iter().filter(|value| !value.is_empty()).map(String::as_str).collect();
                Ok(TextValue::Text(if entries.is_empty() { String::new() } else { format!("[{}]", entries.join("/")) }))
            }
            Some(TextFormat::Lines) => {
                if values.is_empty() {
                    return Ok(TextValue::Lines(Vec::new()));
                }
                let mut lines: Vec<String> = values.iter().flat_map(|line| js::split_lines(line).into_iter().map(str::to_owned)).collect();
                if !prefix.is_empty()
                    && let Some(first) = lines.first_mut()
                {
                    *first = format!("{prefix}{first}");
                }
                if !suffix.is_empty()
                    && let Some(last) = lines.last_mut()
                {
                    last.push_str(suffix);
                }
                Ok(TextValue::Lines(lines))
            }
            _ => Ok(TextValue::Lines(values)),
        },
        RawValue::Scalar(text, false) => {
            let text = format!("{prefix}{text}{suffix}");
            if layer.format == Some(TextFormat::Lines) {
                Ok(TextValue::Lines(js::split_lines(&text).into_iter().map(str::to_owned).collect()))
            } else {
                Ok(TextValue::Text(text))
            }
        }
        RawValue::Unserializable => Err(Error::render(format!(
            "Text layer \"{}\" cannot serialize card field \"{}\".",
            request.layer_id,
            layer.field.as_deref().or(layer.semantic_path.as_deref()).unwrap_or(request.layer_id)
        ))),
    }
}

fn stroke_attributes(element: &mut SvgElement, stroke: Option<&TextStroke>, font_scale: f64) {
    let Some(stroke) = stroke else {
        return;
    };
    element.set("paint-order", if stroke.outer { "stroke fill" } else { "fill stroke" });
    element.set("stroke", stroke.color.as_str());
    element.set("stroke-linejoin", stroke.linejoin.as_deref().unwrap_or("round"));
    if let Some(opacity) = stroke.opacity {
        element.set("stroke-opacity", opacity);
    }
    element.set("stroke-width", stable_layout_number(stroke.width * if stroke.outer { 2.0 } else { 1.0 } * font_scale));
}

fn minimum_auto_scale_x(profile: &FitProfile, typography: &TextTypography) -> f64 {
    1.0 - profile.max_auto_compression_x.or(typography.max_auto_compression_x).unwrap_or(0.0)
}

fn quantifier(typography: &TextTypography) -> f64 {
    typography.auto_scale_x_quantifier.unwrap_or(DEFAULT_AUTO_SCALE_X_QUANTIFIER)
}

fn floor_auto_scale_x(scale: f64, typography: &TextTypography) -> f64 {
    let step = quantifier(typography);
    stable_layout_number(((scale + SCALE_EPSILON) / step).floor() * step)
}

fn smallest_quantified_auto_scale_x(profile: &FitProfile, typography: &TextTypography) -> f64 {
    let step = quantifier(typography);
    let minimum = minimum_auto_scale_x(profile, typography);
    stable_layout_number(1f64.min(((minimum - SCALE_EPSILON) / step).ceil() * step))
}

fn largest_fitting_auto_scale_x(profile: &FitProfile, typography: &TextTypography, mut fits: impl FnMut(f64) -> bool) -> Option<f64> {
    if fits(1.0) {
        return Some(1.0);
    }
    let minimum = minimum_auto_scale_x(profile, typography);
    if !fits(minimum) {
        return None;
    }
    let mut fitting = minimum;
    let mut overflowing = 1.0;
    for _ in 0..24 {
        let candidate = f64::midpoint(fitting, overflowing);
        if fits(candidate) {
            fitting = candidate;
        } else {
            overflowing = candidate;
        }
    }
    let quantified = floor_auto_scale_x(fitting, typography);
    if quantified + SCALE_EPSILON < minimum {
        return None;
    }
    fits(quantified).then_some(quantified)
}

fn typography_for_fit_profile(base: &TextTypography, profile: &FitProfile) -> TextTypography {
    TextTypography { font_size: profile.font_size, line_height: Some(profile.line_height.unwrap_or(profile.font_size)), ..base.clone() }
}

fn lines_fit_profile(line_count: usize, profile: &FitProfile, typography: &TextTypography) -> bool {
    if profile.max_lines.is_some_and(|maximum| line_count as f64 > maximum) {
        return false;
    }
    if let Some(max_height) = typography.max_height {
        let line_height = typography.line_height.unwrap_or(typography.font_size);
        let height = typography.font_size + (line_count.saturating_sub(1)) as f64 * line_height;
        if height > max_height {
            return false;
        }
    }
    true
}

fn is_hspace(character: char) -> bool {
    js::is_whitespace(character) && character != '\r' && character != '\n'
}

fn wrap_tokens(line: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut rest = line;
    while let Some(first) = rest.chars().next() {
        let length = if is_hspace(first) {
            rest.find(|character| !is_hspace(character)).unwrap_or(rest.len())
        } else {
            let word = rest.find(js::is_whitespace).unwrap_or(rest.len());
            word + rest[word..].find(|character| !is_hspace(character)).unwrap_or(rest.len() - word)
        };
        tokens.push(&rest[..length]);
        rest = &rest[length..];
    }
    if tokens.is_empty() { vec![line] } else { tokens }
}

fn wrap_line(line: &str, max_width: f64, measure: &mut impl FnMut(&str) -> f64) -> Vec<String> {
    if line.is_empty() || measure(line) <= max_width {
        return vec![line.to_owned()];
    }
    let mut wrapped: Vec<String> = Vec::new();
    let mut current = String::new();
    let append_piece = |piece: &str, current: &mut String, wrapped: &mut Vec<String>, measure: &mut dyn FnMut(&str) -> f64| {
        if !current.is_empty() && measure(&format!("{current}{piece}")) > max_width {
            wrapped.push(std::mem::take(current));
        }
        if measure(piece) <= max_width {
            *current = piece.to_owned();
            return;
        }
        for character in grapheme_segments(piece) {
            let candidate = format!("{current}{character}");
            if !current.is_empty() && measure(&candidate) > max_width {
                wrapped.push(std::mem::replace(current, character.to_owned()));
            } else {
                *current = candidate;
            }
        }
    };
    for token in wrap_tokens(line) {
        if current.is_empty() {
            append_piece(token, &mut current, &mut wrapped, measure);
        } else {
            let candidate = format!("{current}{token}");
            if measure(&candidate) <= max_width {
                current = candidate;
            } else {
                wrapped.push(std::mem::take(&mut current));
                append_piece(token, &mut current, &mut wrapped, measure);
            }
        }
    }
    if !current.is_empty() || wrapped.is_empty() {
        wrapped.push(current);
    }
    wrapped
}

fn text_tokens(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut previous_space: Option<bool> = None;
    for (offset, character) in text.char_indices() {
        let space = js::is_whitespace(character);
        if previous_space.is_some_and(|previous| previous != space) {
            tokens.push(&text[start..offset]);
            start = offset;
        }
        previous_space = Some(space);
    }
    if start < text.len() {
        tokens.push(&text[start..]);
    }
    if tokens.is_empty() { vec![text] } else { tokens }
}

fn is_word_separator(tokens: &[&str], index: usize) -> bool {
    let Some(token) = tokens.get(index) else {
        return false;
    };
    index > 0
        && token.chars().any(js::is_whitespace)
        && tokens.get(index - 1).is_some_and(|previous| js::has_visible(previous))
        && tokens.get(index + 1).is_some_and(|next| js::has_visible(next))
}

#[derive(Debug, Clone)]
struct PlainLine {
    auto_scale_x: f64,
    paragraph_end: bool,
    text: String,
}

struct ProfileLayout<Line> {
    fits: bool,
    lines: Vec<Line>,
    typography: TextTypography,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Align {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VerticalAlign {
    Sub,
    Super,
}

#[derive(Debug, Clone, PartialEq)]
struct RichStyle {
    align: Option<Align>,
    compression: f64,
    nocompress: bool,
    nowrap: bool,
    ruby_text: Option<String>,
    scale_y: f64,
    shift_x: f64,
    shift_y: f64,
    vertical_align: Option<VerticalAlign>,
    typography: InlineTypography,
}

#[derive(Debug, Clone)]
enum RichToken {
    Space { length: RichTextLength, style: RichStyle },
    Text { text: String, style: RichStyle },
}

impl RichToken {
    fn style(&self) -> &RichStyle {
        match self {
            Self::Space { style, .. } | Self::Text { style, .. } => style,
        }
    }

    fn style_mut(&mut self) -> &mut RichStyle {
        match self {
            Self::Space { style, .. } | Self::Text { style, .. } => style,
        }
    }

    fn is_newline(&self) -> bool {
        matches!(self, Self::Text { text, .. } if text == "\n")
    }
}

#[derive(Debug, Clone)]
struct RichLine {
    auto_scale_x: f64,
    paragraph_end: bool,
    tokens: Vec<RichToken>,
}

fn apply_rich_element(style: &RichStyle, node: &RichTextElement) -> RichStyle {
    let mut next = style.clone();
    let parent_size = style.typography.font_size;
    let value = node.attribute("value");
    match node.tag {
        TagName::B => next.typography.font_weight = Some(FontWeight::Keyword("bold".to_owned())),
        TagName::I => next.typography.font_style = Some("italic".to_owned()),
        TagName::Color => {
            if let Some(color) = value.filter(|color| !color.is_empty()) {
                next.typography.fill = color.to_owned();
            }
        }
        TagName::Scale => {
            if let Some(x) = node.attribute("x") {
                next.compression *= js::parse_float(x);
            }
            if let Some(y) = node.attribute("y") {
                let vertical = js::parse_float(y);
                next.scale_y *= vertical;
                next.typography.font_size *= vertical;
            }
        }
        TagName::Nowrap => {
            next.nowrap = true;
            if node.attribute("align") == Some("justify") {
                next.align = Some(Align::Justify);
            }
        }
        TagName::Nocompress => next.nocompress = true,
        TagName::Size => {
            if let Some(length) = value.filter(|value| !value.is_empty()).and_then(|value| parse_rich_text_length(value, false)) {
                next.typography.font_size = length.pixels(parent_size);
            }
        }
        TagName::Tracking => {
            if let Some(length) = value.filter(|value| !value.is_empty()).and_then(|value| parse_rich_text_length(value, true)) {
                next.typography.letter_spacing = Some(length.pixels(parent_size));
            }
        }
        TagName::Shift => {
            let length =
                |key: &str| node.attribute(key).filter(|value| !value.is_empty()).and_then(|value| parse_rich_text_length(value, true));
            if let Some(x) = length("x") {
                next.shift_x += x.pixels(parent_size);
            }
            if let Some(y) = length("y") {
                next.shift_y += y.pixels(parent_size);
            }
        }
        TagName::Sub | TagName::Sup => {
            next.vertical_align = Some(if node.tag == TagName::Sub { VerticalAlign::Sub } else { VerticalAlign::Super });
            next.typography.font_size = parent_size * 0.7;
            next.shift_x -= parent_size * 0.1;
        }
        TagName::Align => {
            next.align = match value {
                Some("left") => Some(Align::Left),
                Some("center") => Some(Align::Center),
                Some("right") => Some(Align::Right),
                Some("justify") => Some(Align::Justify),
                _ => next.align,
            };
        }
        TagName::Ruby => {
            if let Some(text) = node.attribute("text") {
                next.ruby_text = Some(text.to_owned());
            }
        }
        TagName::Space => {}
    }
    next
}

fn append_rich_text_tokens(tokens: &mut Vec<RichToken>, text: &str, style: &RichStyle) {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    for (index, line) in lines.iter().enumerate() {
        for piece in rich_pieces(line) {
            tokens.push(RichToken::Text { text: piece.to_owned(), style: style.clone() });
        }
        if index < lines.len() - 1 {
            tokens.push(RichToken::Text { text: "\n".to_owned(), style: style.clone() });
        }
    }
}

fn rich_pieces(line: &str) -> Vec<&str> {
    let mut pieces = Vec::new();
    let mut rest = line;
    while let Some(first) = rest.chars().next() {
        let length = if js::is_whitespace(first) {
            rest.find(|character| !js::is_whitespace(character)).unwrap_or(rest.len())
        } else {
            let word = rest.find(js::is_whitespace).unwrap_or(rest.len());
            word + rest[word..].find(|character| !js::is_whitespace(character)).unwrap_or(rest.len() - word)
        };
        pieces.push(&rest[..length]);
        rest = &rest[length..];
    }
    pieces
}

fn flatten_rich_nodes(nodes: &[RichTextNode], style: &RichStyle, output: &mut Vec<RichToken>) {
    for node in nodes {
        match node {
            RichTextNode::Text(text) => append_rich_text_tokens(output, text, style),
            RichTextNode::Element(element) if element.tag == TagName::Space => {
                if let Some(length) =
                    element.attribute("width").filter(|value| !value.is_empty()).and_then(|value| parse_rich_text_length(value, false))
                {
                    output.push(RichToken::Space { length, style: style.clone() });
                }
            }
            RichTextNode::Element(element) => {
                let child_style = apply_rich_element(style, element);
                flatten_rich_nodes(&element.children, &child_style, output);
            }
        }
    }
}

fn rich_tokens(document: &RichTextDocument, typography: &TextTypography) -> Vec<RichToken> {
    let mut output = Vec::new();
    let style = RichStyle {
        align: None,
        compression: 1.0,
        nocompress: false,
        nowrap: false,
        ruby_text: None,
        scale_y: 1.0,
        shift_x: 0.0,
        shift_y: 0.0,
        vertical_align: None,
        typography: InlineTypography::from_typography(typography),
    };
    flatten_rich_nodes(&document.children, &style, &mut output);
    output
}

fn rich_token_width(token: &RichToken, measurer: &mut Measurer, auto_scale_x: f64) -> f64 {
    match token {
        RichToken::Space { length, style } => {
            let width = length.pixels(style.typography.font_size);
            (width / style.scale_y) * if style.nocompress { 1.0 } else { auto_scale_x }
        }
        RichToken::Text { text, style } => {
            let automatic = if style.nocompress { 1.0 } else { auto_scale_x };
            (measurer.measure(text, &style.typography) / style.scale_y) * style.compression * automatic
        }
    }
}

fn rich_line_width(tokens: &[RichToken], measurer: &mut Measurer, auto_scale_x: f64) -> f64 {
    tokens.iter().map(|token| rich_token_width(token, measurer, auto_scale_x)).sum()
}

struct RichRun {
    compression: f64,
    carry_shift_x: bool,
    nocompress: bool,
    nowrap: bool,
    scale_y: f64,
    shift_x: f64,
    shift_y: f64,
    tokens: Vec<RichToken>,
}

fn rich_token_runs(tokens: &[RichToken]) -> Vec<RichRun> {
    let mut runs: Vec<RichRun> = Vec::new();
    for token in tokens {
        let style = token.style();
        let carry_shift_x = style.vertical_align.is_some();
        if let Some(previous) = runs.last_mut()
            && previous.compression == style.compression
            && previous.carry_shift_x == carry_shift_x
            && previous.nocompress == style.nocompress
            && previous.nowrap == style.nowrap
            && previous.scale_y == style.scale_y
            && previous.shift_x == style.shift_x
            && previous.shift_y == style.shift_y
        {
            previous.tokens.push(token.clone());
            continue;
        }
        runs.push(RichRun {
            compression: style.compression,
            carry_shift_x,
            nocompress: style.nocompress,
            nowrap: style.nowrap,
            scale_y: style.scale_y,
            shift_x: style.shift_x,
            shift_y: style.shift_y,
            tokens: vec![token.clone()],
        });
    }
    runs
}

fn nowrap_compression_ratios(runs: &[RichRun], max_width: Option<f64>, measurer: &mut Measurer, auto_scale_x: f64) -> Vec<f64> {
    let automatic: Vec<f64> = runs.iter().map(|run| if run.nocompress { 1.0 } else { auto_scale_x }).collect();
    let mut ratios = automatic.clone();
    let Some(max_width) = max_width else {
        return ratios;
    };
    let widths: Vec<f64> = runs.iter().zip(&automatic).map(|(run, ratio)| rich_line_width(&run.tokens, measurer, 1.0) * ratio).collect();
    let line_width: f64 = widths.iter().sum();
    if line_width <= max_width {
        return ratios;
    }
    let compressible = |run: &RichRun| run.nowrap && !run.nocompress && run.compression == 1.0;
    let compressible_width: f64 = runs.iter().zip(&widths).map(|(run, width)| if compressible(run) { *width } else { 0.0 }).sum();
    if compressible_width <= 0.0 {
        return ratios;
    }
    let fixed_width = line_width - compressible_width;
    let available = max_width - fixed_width;
    let ratio = 1f64.min(0.01f64.max(if available > 0.0 { available / compressible_width } else { max_width / line_width }));
    for (index, run) in runs.iter().enumerate() {
        if compressible(run) {
            ratios[index] = auto_scale_x * ratio;
        }
    }
    ratios
}

fn split_rich_paragraphs(tokens: Vec<RichToken>) -> Vec<Vec<RichToken>> {
    let mut paragraphs: Vec<Vec<RichToken>> = vec![Vec::new()];
    for token in tokens {
        if token.is_newline() {
            paragraphs.push(Vec::new());
        } else if let Some(last) = paragraphs.last_mut() {
            last.push(token);
        }
    }
    paragraphs
}

fn split_long_rich_token(token: &RichToken, max_width: f64, measurer: &mut Measurer, auto_scale_x: f64) -> Vec<Vec<RichToken>> {
    let (text, style) = match token {
        RichToken::Text { text, style } if !style.nowrap && !text.is_empty() => (text, style),
        _ => return vec![vec![token.clone()]],
    };
    let mut pieces: Vec<Vec<RichToken>> = Vec::new();
    let mut current: Option<String> = None;
    for character in grapheme_segments(text) {
        let next_text = format!("{}{character}", current.as_deref().unwrap_or(""));
        let next = RichToken::Text { text: next_text.clone(), style: style.clone() };
        if current.is_some() && rich_token_width(&next, measurer, auto_scale_x) > max_width {
            if let Some(previous) = current.take() {
                pieces.push(vec![RichToken::Text { text: previous, style: style.clone() }]);
            }
            current = Some(character.to_owned());
        } else {
            current = Some(next_text);
        }
    }
    if let Some(previous) = current {
        pieces.push(vec![RichToken::Text { text: previous, style: style.clone() }]);
    }
    if pieces.is_empty() { vec![vec![token.clone()]] } else { pieces }
}

fn rich_wrap_paragraph(tokens: &[RichToken], max_width: f64, measurer: &mut Measurer, auto_scale_x: f64) -> Vec<Vec<RichToken>> {
    if tokens.is_empty() {
        return vec![Vec::new()];
    }
    let mut units: Vec<Vec<RichToken>> = Vec::new();
    for token in tokens {
        let joins = token.style().nowrap && units.last().and_then(|unit| unit.last()).is_some_and(|previous| previous.style().nowrap);
        match units.last_mut() {
            Some(unit) if joins => unit.push(token.clone()),
            _ => units.push(vec![token.clone()]),
        }
    }
    let mut lines: Vec<Vec<RichToken>> = Vec::new();
    let mut current: Vec<RichToken> = Vec::new();
    let mut current_width = 0.0;
    let push_current = |current: &mut Vec<RichToken>, current_width: &mut f64, lines: &mut Vec<Vec<RichToken>>| {
        if !current.is_empty() {
            lines.push(std::mem::take(current));
        }
        *current_width = 0.0;
    };
    for unit in units {
        let width = rich_line_width(&unit, measurer, auto_scale_x);
        if !current.is_empty() && current_width + width > max_width {
            push_current(&mut current, &mut current_width, &mut lines);
        }
        if width <= max_width || unit.iter().any(|token| token.style().nowrap) || unit.len() != 1 {
            current.extend(unit);
            current_width += width;
            continue;
        }
        for piece in split_long_rich_token(&unit[0], max_width, measurer, auto_scale_x) {
            let piece_width = rich_line_width(&piece, measurer, auto_scale_x);
            if !current.is_empty() && current_width + piece_width > max_width {
                push_current(&mut current, &mut current_width, &mut lines);
            }
            current.extend(piece);
            current_width += piece_width;
            if current_width >= max_width {
                push_current(&mut current, &mut current_width, &mut lines);
            }
        }
    }
    push_current(&mut current, &mut current_width, &mut lines);
    if lines.is_empty() { vec![Vec::new()] } else { lines }
}

fn rich_lines_for_paragraphs(
    paragraphs: &[Vec<RichToken>],
    typography: &TextTypography,
    measurer: &mut Measurer,
    auto_scale_x: f64,
) -> Vec<RichLine> {
    let mut lines = Vec::new();
    for paragraph in paragraphs {
        let wrapped = match (typography.wrap_word, typography.max_width) {
            (true, Some(max_width)) => rich_wrap_paragraph(paragraph, max_width, measurer, auto_scale_x),
            _ => vec![paragraph.clone()],
        };
        let count = wrapped.len();
        for (index, tokens) in wrapped.into_iter().enumerate() {
            lines.push(RichLine { auto_scale_x, paragraph_end: index == count - 1, tokens });
        }
    }
    if lines.is_empty() {
        lines.push(RichLine { auto_scale_x, paragraph_end: true, tokens: Vec::new() });
    }
    lines
}

fn scale_rich_lines(lines: Vec<RichLine>, scale: f64) -> Vec<RichLine> {
    if scale == 1.0 {
        return lines;
    }
    lines
        .into_iter()
        .map(|mut line| {
            for token in &mut line.tokens {
                let style = token.style_mut();
                style.shift_x *= scale;
                style.shift_y *= scale;
                style.typography.font_size *= scale;
                if let Some(spacing) = style.typography.letter_spacing.as_mut() {
                    *spacing *= scale;
                }
            }
            line
        })
        .collect()
}

fn rich_line_explicit_alignment(line: &RichLine) -> Option<Align> {
    line.tokens.iter().find_map(|token| token.style().align)
}

fn rich_style_attributes(style: &RichStyle, base: &InlineTypography, element: &mut SvgElement) {
    let typography = &style.typography;
    element.set("white-space", "pre");
    element.set("xml:space", "preserve");
    if typography.fill != base.fill {
        element.set("fill", typography.fill.as_str());
    }
    if typography.font_family != base.font_family {
        element.set("font-family", typography.font_family.as_str());
    }
    if typography.font_size != base.font_size {
        element.set("font-size", typography.font_size);
    }
    if let Some(vertical) = style.vertical_align {
        element.set("baseline-shift", if vertical == VerticalAlign::Super { "0.36em" } else { "-0.12em" });
    }
    if typography.font_style != base.font_style
        && let Some(font_style) = typography.font_style.as_deref().filter(|value| !value.is_empty())
    {
        element.set("font-style", font_style);
    }
    if typography.font_weight != base.font_weight
        && let Some(weight) = &typography.font_weight
    {
        let truthy = match weight {
            FontWeight::Number(value) => *value != 0.0,
            FontWeight::Keyword(keyword) => !keyword.is_empty(),
        };
        if truthy {
            element.set(
                "font-weight",
                match weight {
                    FontWeight::Number(value) => AttributeValue::Number(*value),
                    FontWeight::Keyword(keyword) => AttributeValue::Text(keyword.clone()),
                },
            );
        }
    }
    if typography.letter_spacing != base.letter_spacing
        && let Some(spacing) = typography.letter_spacing
    {
        element.set("letter-spacing", spacing);
    }
}

fn set_offsets(element: &mut SvgElement, dx: f64, dy: f64) {
    if dx != 0.0 {
        element.set("dx", dx);
    }
    if dy != 0.0 {
        element.set("dy", dy);
    }
}

fn ruby_span(token: &RichToken, text: &str, base: &InlineTypography, dx: f64, dy: f64, measurer: &mut Measurer) -> SvgElement {
    let style = token.style();
    let typography = &style.typography;
    let annotation_size = 1f64.max(typography.font_size * 0.5);
    let offset = 1f64.max(typography.font_size * 0.65);
    let annotation_text = style.ruby_text.clone().unwrap_or_default();
    let base_width = rich_token_width(token, measurer, 1.0);
    let annotation_width = measurer.measure(&annotation_text, &typography.with_size(annotation_size));
    let mut span = SvgElement::new("tspan");
    rich_style_attributes(style, base, &mut span);
    set_offsets(&mut span, dx, dy);
    let mut annotation = SvgElement::new("tspan");
    annotation.set("font-size", annotation_size);
    annotation.set("text-anchor", "middle");
    annotation.set("dy", -offset);
    annotation.set("dx", base_width / 2.0);
    annotation.text = Some(annotation_text);
    let mut base_text = SvgElement::new("tspan");
    base_text.set("dy", offset);
    base_text.set("dx", -(base_width / 2.0 + annotation_width));
    base_text.text = Some(text.to_owned());
    span.children = vec![annotation, base_text];
    span
}

fn rich_token_children(
    tokens: &[RichToken],
    base: &InlineTypography,
    initial_dx: f64,
    measurer: &mut Measurer,
    shift_dx: f64,
    shift_dy: f64,
) -> Vec<SvgElement> {
    let mut pending_dx = initial_dx;
    let mut pending_shift_dx = shift_dx;
    let mut pending_shift_dy = shift_dy;
    let mut children = Vec::new();
    for token in tokens {
        match token {
            RichToken::Space { length, style } => {
                pending_dx += length.pixels(style.typography.font_size);
            }
            RichToken::Text { text, style } => {
                let dx = pending_dx + pending_shift_dx;
                let dy = pending_shift_dy;
                pending_dx = 0.0;
                pending_shift_dx = 0.0;
                pending_shift_dy = 0.0;
                if style.ruby_text.is_none() {
                    let mut span = SvgElement::new("tspan");
                    rich_style_attributes(style, base, &mut span);
                    set_offsets(&mut span, dx, dy);
                    span.text = Some(text.clone());
                    children.push(span);
                } else {
                    children.push(ruby_span(token, text, base, dx, dy, measurer));
                }
            }
        }
    }
    let trailing_dx = pending_dx + pending_shift_dx;
    if trailing_dx != 0.0 || pending_shift_dy != 0.0 {
        let mut span = SvgElement::new("tspan");
        set_offsets(&mut span, trailing_dx, pending_shift_dy);
        span.set("white-space", "pre");
        span.set("xml:space", "preserve");
        children.push(span);
    }
    children
}

struct Layout<'a> {
    request: &'a TextLayoutRequest<'a>,
    typography: &'a TextTypography,
}

impl Layout<'_> {
    fn base_attributes(&self, element: &mut SvgElement, typography: &TextTypography, fitted_font_size: f64, font_scale: f64, plain: bool) {
        element.set("fill", typography.fill.as_str());
        element.set("font-family", typography.font_family.as_str());
        element.set("font-size", fitted_font_size);
        stroke_attributes(element, typography.stroke.as_ref(), font_scale);
        element.set("white-space", "pre");
        if plain {
            element.set("xml:space", "preserve");
        }
        element.set("x", self.request.position.x);
        element.set("y", self.request.position.y);
        if let Some(anchor) = typography.text_anchor {
            element.set("text-anchor", anchor.as_str());
        }
        if typography.top_anchor {
            element.set("dominant-baseline", "text-before-edge");
        }
        if let Some(style) = typography.font_style.as_deref().filter(|value| !value.is_empty()) {
            element.set("font-style", style);
        }
        if let Some(weight) = &typography.font_weight {
            match weight {
                FontWeight::Number(value) if *value != 0.0 => element.set("font-weight", *value),
                FontWeight::Keyword(keyword) if !keyword.is_empty() => element.set("font-weight", keyword.as_str()),
                _ => {}
            }
        }
        if let Some(spacing) = typography.letter_spacing {
            element.set("letter-spacing", spacing * font_scale);
        }
    }

    fn select_profile<Line>(
        &self,
        measurer: &mut Measurer,
        mut layout_for_profile: impl FnMut(&FitProfile, &mut Measurer) -> ProfileLayout<Line>,
    ) -> Option<ProfileLayout<Line>> {
        let profiles = self.typography.fit_profiles.as_ref().filter(|profiles| !profiles.is_empty())?;
        if let Some(pinned) = self.request.fit_profile_id.and_then(|id| profiles.iter().find(|profile| profile.id == id)) {
            return Some(layout_for_profile(pinned, measurer));
        }
        let mut fallback = None;
        for profile in profiles {
            let candidate = layout_for_profile(profile, measurer);
            if candidate.fits {
                return Some(candidate);
            }
            fallback = Some(candidate);
        }
        fallback
    }

    fn plain_element(&self, plain: &str, measurer: &mut Measurer) -> SvgElement {
        let base = self.typography;
        let source: Vec<String> = js::split_lines(plain).into_iter().map(str::to_owned).collect();
        let has_split = base.has_fit_blocks() && crate::rich_text::has_leading_authored_line_fit_split_source(&source.join("\n"));
        let (leading_block, remainder_block): (Option<&[String]>, &[String]) =
            if has_split { (Some(&source[..1]), &source[1..]) } else { (None, &source[..]) };
        let wrapped_lines = |block: &[String], typography: &TextTypography, auto_scale_x: f64, measurer: &mut Measurer| -> Vec<PlainLine> {
            let wrap_width = if typography.wrap_word { typography.max_width } else { None };
            let Some(wrap_width) = wrap_width else {
                return block.iter().map(|text| PlainLine { auto_scale_x: 1.0, paragraph_end: true, text: text.clone() }).collect();
            };
            let inline = InlineTypography::from_typography(typography);
            let mut lines = Vec::new();
            for line in block {
                let wrapped = wrap_line(line, wrap_width, &mut |text| measurer.measure(text, &inline) * auto_scale_x);
                let count = wrapped.len();
                for (index, text) in wrapped.into_iter().enumerate() {
                    lines.push(PlainLine { auto_scale_x, paragraph_end: index == count - 1, text });
                }
            }
            lines
        };
        let is_type_list = self.request.layer.format == Some(TextFormat::TypeList);
        let layout = self.select_profile(measurer, |profile, measurer| {
            let typography = typography_for_fit_profile(base, profile);
            let preferred = base.fit_blocks_preferred_max_lines.unwrap_or(1);
            let leading = match leading_block {
                Some(block) => {
                    let scale = largest_fitting_auto_scale_x(profile, &typography, |scale| {
                        wrapped_lines(block, &typography, scale, measurer).len() <= preferred
                    })
                    .unwrap_or(1.0);
                    wrapped_lines(block, &typography, scale, measurer)
                }
                None => Vec::new(),
            };
            let inline = InlineTypography::from_typography(&typography);
            let fitting = largest_fitting_auto_scale_x(profile, &typography, |scale| {
                let remainder = wrapped_lines(remainder_block, &typography, scale, measurer);
                if !lines_fit_profile(leading.len() + remainder.len(), profile, &typography) {
                    return false;
                }
                if let (true, Some(max_width)) = (is_type_list, typography.max_width) {
                    let widest = leading
                        .iter()
                        .chain(&remainder)
                        .map(|line| measurer.measure(&line.text, &inline) * line.auto_scale_x)
                        .fold(0.0, f64::max);
                    if widest > max_width {
                        return false;
                    }
                }
                true
            });
            let remainder_scale = fitting.unwrap_or_else(|| smallest_quantified_auto_scale_x(profile, &typography));
            let mut lines = leading;
            lines.extend(wrapped_lines(remainder_block, &typography, remainder_scale, measurer));
            ProfileLayout { fits: fitting.is_some(), lines, typography }
        });
        let has_profiles = base.fit_profiles.is_some();
        let (lines, typography) = match layout {
            Some(layout) => (layout.lines, layout.typography),
            None => (wrapped_lines(&source, base, 1.0, measurer), base.clone()),
        };
        let inline = InlineTypography::from_typography(&typography);
        let widest = lines.iter().map(|line| measurer.measure(&line.text, &inline) * line.auto_scale_x).fold(0.0, f64::max);
        let measured_scale = match typography.max_width {
            Some(max_width) if max_width != 0.0 && widest > max_width => max_width / widest,
            _ => 1.0,
        };
        let minimum_scale = typography.min_font_size.filter(|size| *size != 0.0).map_or(0.0, |size| size / typography.font_size);
        let font_scale = if has_profiles || typography.fit_scale_x { 1.0 } else { measured_scale.max(minimum_scale) };
        let fitted_font_size = typography.font_size * font_scale;
        let fitted = inline.with_size(fitted_font_size);
        let mut element = SvgElement::new("text");
        self.base_attributes(&mut element, &typography, fitted_font_size, font_scale, true);
        let rendered_scale = |line: &PlainLine| if typography.fit_scale_x { line.auto_scale_x * measured_scale } else { line.auto_scale_x };
        if self.request.layer.format == Some(TextFormat::Lines) || lines.len() > 1 {
            let line_height = typography.line_height.unwrap_or(typography.font_size) * font_scale;
            for (index, line) in lines.iter().enumerate() {
                let rendered = PlainLine { auto_scale_x: rendered_scale(line), ..line.clone() };
                if let Some(justified) = self.justified_line(&rendered, index, &typography, &fitted, measurer, line_height) {
                    element.children.extend(justified);
                    continue;
                }
                let natural_width = measurer.measure(&line.text, &fitted);
                let mut span = SvgElement::new("tspan");
                span.set("dy", if index == 0 { 0.0 } else { line_height });
                span.set("x", self.request.position.x);
                if rendered.auto_scale_x < 1.0 && natural_width > 0.0 {
                    span.set("lengthAdjust", "spacingAndGlyphs");
                    span.set("textLength", stable_layout_number(natural_width * rendered.auto_scale_x));
                }
                span.text = Some(line.text.clone());
                element.children.push(span);
            }
            return element;
        }
        let line = lines.first();
        let line_scale = line.map_or(1.0, rendered_scale);
        let natural_width = line.map_or(0.0, |line| measurer.measure(&line.text, &fitted));
        if line_scale < 1.0 && natural_width > 0.0 {
            element.set("lengthAdjust", "spacingAndGlyphs");
            element.set("textLength", stable_layout_number(natural_width * line_scale));
        }
        element.text = Some(line.map(|line| line.text.clone()).unwrap_or_default());
        element
    }

    fn justified_line(
        &self,
        line: &PlainLine,
        line_index: usize,
        typography: &TextTypography,
        fitted: &InlineTypography,
        measurer: &mut Measurer,
        line_height: f64,
    ) -> Option<Vec<SvgElement>> {
        if !typography.justify || line.paragraph_end {
            return None;
        }
        let max_width = typography.max_width?;
        let tokens = text_tokens(&line.text);
        let separators = (0..tokens.len()).filter(|index| is_word_separator(&tokens, *index)).count();
        if separators == 0 {
            return None;
        }
        let natural_width = measurer.measure(&line.text, fitted) * line.auto_scale_x;
        let extra_space = (max_width - natural_width) / separators as f64;
        if extra_space.is_nan() || extra_space <= 0.0 {
            return None;
        }
        let anchor_offset = match typography.text_anchor {
            Some(TextAnchor::Middle) => max_width / 2.0,
            Some(TextAnchor::End) => max_width,
            _ => 0.0,
        };
        let mut x = self.request.position.x - anchor_offset;
        let mut spans = Vec::with_capacity(tokens.len());
        for (index, token) in tokens.iter().enumerate() {
            let mut span = SvgElement::new("tspan");
            if index == 0 {
                span.set("dy", if line_index == 0 { 0.0 } else { line_height });
            }
            span.set("text-anchor", "start");
            span.set("x", x);
            span.text = Some((*token).to_owned());
            let token_width = measurer.measure(token, fitted);
            if line.auto_scale_x < 1.0 && token_width > 0.0 {
                span.set("lengthAdjust", "spacingAndGlyphs");
                span.set("textLength", stable_layout_number(token_width * line.auto_scale_x));
            }
            x += token_width * line.auto_scale_x;
            if index < tokens.len() - 1 {
                x += fitted.letter_spacing.unwrap_or(0.0) * line.auto_scale_x;
            }
            if is_word_separator(&tokens, index) {
                x += extra_space;
            }
            spans.push(span);
        }
        Some(spans)
    }

    fn rich_element(&self, document: &RichTextDocument, measurer: &mut Measurer) -> SvgElement {
        let base = self.typography;
        let has_valid_split = has_leading_authored_line_fit_split(document);
        let is_type_list = self.request.layer.format == Some(TextFormat::TypeList);
        let layout = self.select_profile(measurer, |profile, measurer| {
            let typography = typography_for_fit_profile(base, profile);
            let paragraphs = split_rich_paragraphs(rich_tokens(document, &typography));
            let (leading_block, remainder_block): (Option<&[Vec<RichToken>]>, &[Vec<RichToken>]) =
                if typography.has_fit_blocks() && has_valid_split {
                    (Some(&paragraphs[..1]), &paragraphs[1..])
                } else {
                    (None, &paragraphs[..])
                };
            let preferred = typography.fit_blocks_preferred_max_lines.unwrap_or(1);
            let leading = match leading_block {
                Some(block) => {
                    let scale = largest_fitting_auto_scale_x(profile, &typography, |scale| {
                        rich_lines_for_paragraphs(block, &typography, measurer, scale).len() <= preferred
                    })
                    .unwrap_or(1.0);
                    rich_lines_for_paragraphs(block, &typography, measurer, scale)
                }
                None => Vec::new(),
            };
            let fitting = largest_fitting_auto_scale_x(profile, &typography, |scale| {
                let remainder = rich_lines_for_paragraphs(remainder_block, &typography, measurer, scale);
                if !lines_fit_profile(leading.len() + remainder.len(), profile, &typography) {
                    return false;
                }
                if let (true, Some(max_width)) = (is_type_list, typography.max_width) {
                    let widest = leading
                        .iter()
                        .chain(&remainder)
                        .map(|line| rich_line_width(&line.tokens, measurer, line.auto_scale_x))
                        .fold(0.0, f64::max);
                    if widest > max_width {
                        return false;
                    }
                }
                true
            });
            let remainder_scale = fitting.unwrap_or_else(|| smallest_quantified_auto_scale_x(profile, &typography));
            let mut lines = leading;
            lines.extend(rich_lines_for_paragraphs(remainder_block, &typography, measurer, remainder_scale));
            ProfileLayout { fits: fitting.is_some(), lines, typography }
        });
        let has_profiles = base.fit_profiles.is_some();
        let (lines, typography) = match layout {
            Some(layout) => (layout.lines, layout.typography),
            None => {
                let paragraphs = split_rich_paragraphs(rich_tokens(document, base));
                (rich_lines_for_paragraphs(&paragraphs, base, measurer, 1.0), base.clone())
            }
        };
        let widest = lines.iter().map(|line| rich_line_width(&line.tokens, measurer, line.auto_scale_x)).fold(0.0, f64::max);
        let any_token =
            |predicate: &dyn Fn(&RichStyle) -> bool| lines.iter().any(|line| line.tokens.iter().any(|token| predicate(token.style())));
        let has_nocompress = any_token(&|style| style.nocompress);
        let has_nowrap = any_token(&|style| style.nowrap);
        let has_custom_compression = any_token(&|style| style.compression != 1.0);
        let measured_scale = match typography.max_width {
            Some(max_width) if max_width != 0.0 && widest > max_width => max_width / widest,
            _ => 1.0,
        };
        let minimum_scale = typography.min_font_size.filter(|size| *size != 0.0).map_or(0.0, |size| size / typography.font_size);
        let font_scale = if has_profiles || has_nocompress || has_nowrap || has_custom_compression || typography.fit_scale_x {
            1.0
        } else {
            measured_scale.max(minimum_scale)
        };
        let fitted_font_size = typography.font_size * font_scale;
        let fitted = InlineTypography::from_typography(&typography).with_size(fitted_font_size);
        let fitted_lines = scale_rich_lines(lines, font_scale);
        let mut element = SvgElement::new("text");
        self.base_attributes(&mut element, &typography, fitted_font_size, font_scale, false);
        let line_height = typography.line_height.unwrap_or(typography.font_size) * font_scale;
        let position_x = self.request.position.x;
        for (line_index, line) in fitted_lines.iter().enumerate() {
            let rendered_auto_scale_x = if typography.fit_scale_x { line.auto_scale_x * measured_scale } else { line.auto_scale_x };
            let explicit = rich_line_explicit_alignment(line);
            let alignment = explicit.or(match typography.text_anchor {
                Some(TextAnchor::Middle) => Some(Align::Center),
                Some(TextAnchor::End) => Some(Align::Right),
                _ => None,
            });
            let line_x = match (explicit, typography.max_width, alignment) {
                (Some(_), Some(max_width), Some(Align::Center)) => position_x + max_width / 2.0,
                (Some(_), Some(max_width), Some(Align::Right)) => position_x + max_width,
                _ => position_x,
            };
            let mut line_element = SvgElement::new("tspan");
            line_element.set("dy", if line_index == 0 { 0.0 } else { line_height });
            line_element.set("x", line_x);
            line_element.set("white-space", "pre");
            line_element.set("xml:space", "preserve");
            match alignment {
                Some(Align::Center) => line_element.set("text-anchor", "middle"),
                Some(Align::Right) => line_element.set("text-anchor", "end"),
                Some(Align::Left | Align::Justify) => line_element.set("text-anchor", "start"),
                None => {}
            }
            let is_justified = match explicit {
                Some(explicit) => explicit == Align::Justify,
                None => typography.justify && !line.paragraph_end,
            };
            let line_width = rich_line_width(&line.tokens, measurer, rendered_auto_scale_x);
            if let Some(max_width) = typography.max_width {
                let stretch = is_justified && !line.tokens.iter().any(|token| token.style().nocompress) && line_width < max_width;
                if stretch {
                    line_element.set("lengthAdjust", if rendered_auto_scale_x < 1.0 { "spacing" } else { "spacingAndGlyphs" });
                    line_element.set("textLength", max_width);
                }
            }
            let runs = rich_token_runs(&line.tokens);
            let ratios = nowrap_compression_ratios(&runs, typography.max_width, measurer, rendered_auto_scale_x);
            let mut pending_dx = 0.0;
            let mut active_shift_x = 0.0;
            let mut active_shift_y = 0.0;
            for (run_index, run) in runs.iter().enumerate() {
                let ratio = ratios[run_index];
                let run_width = rich_line_width(&run.tokens, measurer, 1.0);
                let explicit_scale = run.compression != 1.0 || run.scale_y != 1.0;
                let automatic = ratio != 1.0;
                let previous_shift_x = if run_index > 0 && runs[run_index - 1].carry_shift_x { 0.0 } else { active_shift_x };
                let shift_dx = run.shift_x - previous_shift_x;
                let shift_dy = run.shift_y - active_shift_y;
                if (!explicit_scale && !automatic) || run_width == 0.0 {
                    line_element.children.extend(rich_token_children(&run.tokens, &fitted, pending_dx, measurer, shift_dx, shift_dy));
                } else {
                    let mut span = SvgElement::new("tspan");
                    span.set("white-space", "pre");
                    span.set("xml:space", "preserve");
                    if pending_dx + shift_dx != 0.0 {
                        span.set("dx", pending_dx + shift_dx);
                    }
                    if shift_dy != 0.0 {
                        span.set("dy", shift_dy);
                    }
                    span.set("lengthAdjust", "spacingAndGlyphs");
                    span.set("textLength", stable_layout_number(run_width * ratio));
                    span.children = rich_token_children(&run.tokens, &fitted, 0.0, measurer, 0.0, 0.0);
                    line_element.children.push(span);
                }
                pending_dx = 0.0;
                active_shift_x = run.shift_x;
                active_shift_y = run.shift_y;
            }
            element.children.push(line_element);
        }
        element
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_wrap_tokens_with_trailing_space() {
        assert_eq!(wrap_tokens("ab  cd e"), vec!["ab  ", "cd ", "e"]);
        assert_eq!(wrap_tokens("  ab"), vec!["  ", "ab"]);
        assert_eq!(wrap_tokens("ab "), vec!["ab "]);
    }

    #[test]
    fn splits_rich_pieces() {
        assert_eq!(rich_pieces("  ab cd  ef"), vec!["  ", "ab ", "cd  ", "ef"]);
        assert_eq!(rich_pieces(""), Vec::<&str>::new());
    }

    #[test]
    fn splits_justify_tokens() {
        assert_eq!(text_tokens("ab  cd"), vec!["ab", "  ", "cd"]);
        let tokens = text_tokens(" ab cd ");
        assert!(!is_word_separator(&tokens, 0));
        assert!(is_word_separator(&tokens, 2));
        assert!(!is_word_separator(&tokens, 4));
    }
}

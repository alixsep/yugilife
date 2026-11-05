use indexmap::IndexMap;
use serde_json::{Map, Value, json};
use unicode_segmentation::UnicodeSegmentation;

use crate::js;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TagName {
    Align,
    B,
    Color,
    Scale,
    I,
    Nocompress,
    Nowrap,
    Ruby,
    Shift,
    Size,
    Space,
    Sub,
    Sup,
    Tracking,
}

impl TagName {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "align" => Self::Align,
            "b" => Self::B,
            "color" => Self::Color,
            "scale" => Self::Scale,
            "i" => Self::I,
            "nocompress" => Self::Nocompress,
            "nowrap" => Self::Nowrap,
            "ruby" => Self::Ruby,
            "shift" => Self::Shift,
            "size" => Self::Size,
            "space" => Self::Space,
            "sub" => Self::Sub,
            "sup" => Self::Sup,
            "tracking" => Self::Tracking,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Align => "align",
            Self::B => "b",
            Self::Color => "color",
            Self::Scale => "scale",
            Self::I => "i",
            Self::Nocompress => "nocompress",
            Self::Nowrap => "nowrap",
            Self::Ruby => "ruby",
            Self::Shift => "shift",
            Self::Size => "size",
            Self::Space => "space",
            Self::Sub => "sub",
            Self::Sup => "sup",
            Self::Tracking => "tracking",
        }
    }

    fn attributes(self) -> &'static [&'static str] {
        match self {
            Self::Align | Self::Color | Self::Size | Self::Tracking => &["value"],
            Self::Scale | Self::Shift => &["x", "y"],
            Self::Nowrap => &["align"],
            Self::Ruby => &["text"],
            Self::Space => &["width"],
            Self::B | Self::I | Self::Nocompress | Self::Sub | Self::Sup => &[],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarningCode {
    InvalidAttribute,
    InvalidValue,
    MalformedTag,
    MismatchedClosingTag,
    UnknownTag,
    UnclosedTag,
}

impl WarningCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidAttribute => "invalid-attribute",
            Self::InvalidValue => "invalid-value",
            Self::MalformedTag => "malformed-tag",
            Self::MismatchedClosingTag => "mismatched-closing-tag",
            Self::UnknownTag => "unknown-tag",
            Self::UnclosedTag => "unclosed-tag",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTextWarning {
    pub code: WarningCode,
    pub length: usize,
    pub message: String,
    pub offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RichTextNode {
    Text(String),
    Element(RichTextElement),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTextElement {
    pub attributes: IndexMap<String, String>,
    pub children: Vec<RichTextNode>,
    pub tag: TagName,
}

impl RichTextElement {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.get(name).map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTextDocument {
    pub children: Vec<RichTextNode>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RichTextParseResult {
    pub document: RichTextDocument,
    pub warnings: Vec<RichTextWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LengthUnit {
    Em,
    Px,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RichTextLength {
    pub unit: LengthUnit,
    pub value: f64,
}

// The JavaScript shapes of `RichTextParseResult`, `RichTextDocument`, `RichTextNode`,
// `RichTextWarning` and `RichTextLength`.

impl RichTextWarning {
    pub fn to_json(&self) -> Value {
        json!({ "code": self.code.as_str(), "length": self.length, "message": self.message, "offset": self.offset })
    }
}

impl RichTextNode {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Text(text) => json!({ "kind": "text", "text": text }),
            Self::Element(element) => json!({
                "attributes": element.attributes.iter().map(|(name, value)| (name.clone(), Value::String(value.clone()))).collect::<Map<_, _>>(),
                "children": element.children.iter().map(Self::to_json).collect::<Vec<_>>(),
                "kind": "element",
                "tag": element.tag.as_str(),
            }),
        }
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        match value.get("kind")?.as_str()? {
            "text" => Some(Self::Text(value.get("text")?.as_str()?.to_owned())),
            "element" => Some(Self::Element(RichTextElement {
                attributes: value
                    .get("attributes")?
                    .as_object()?
                    .iter()
                    .map(|(name, value)| Some((name.clone(), value.as_str()?.to_owned())))
                    .collect::<Option<_>>()?,
                children: value.get("children")?.as_array()?.iter().map(Self::from_json).collect::<Option<_>>()?,
                tag: TagName::parse(value.get("tag")?.as_str()?)?,
            })),
            _ => None,
        }
    }
}

impl RichTextDocument {
    pub fn to_json(&self) -> Value {
        json!({ "children": self.children.iter().map(RichTextNode::to_json).collect::<Vec<_>>(), "source": self.source })
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        Some(Self {
            children: value.get("children")?.as_array()?.iter().map(RichTextNode::from_json).collect::<Option<_>>()?,
            source: value.get("source")?.as_str()?.to_owned(),
        })
    }
}

impl RichTextParseResult {
    pub fn to_json(&self) -> Value {
        json!({ "document": self.document.to_json(), "warnings": self.warnings.iter().map(RichTextWarning::to_json).collect::<Vec<_>>() })
    }
}

impl RichTextLength {
    pub fn to_json(&self) -> Value {
        json!({ "unit": match self.unit { LengthUnit::Em => "em", LengthUnit::Px => "px" }, "value": crate::validation::number_value(self.value) })
    }

    pub fn pixels(self, font_size: f64) -> f64 {
        match self.unit {
            LengthUnit::Em => self.value * font_size,
            LengthUnit::Px => self.value,
        }
    }
}

struct ParsedTag {
    attributes: IndexMap<String, String>,
    closing: bool,
    name: String,
    self_closing: bool,
}

struct Source {
    characters: Vec<char>,
    offsets: Vec<usize>,
}

impl Source {
    fn new(text: &str) -> Self {
        let characters: Vec<char> = text.chars().collect();
        let mut offsets = Vec::with_capacity(characters.len() + 1);
        let mut offset = 0;
        for character in &characters {
            offsets.push(offset);
            offset += character.len_utf16();
        }
        offsets.push(offset);
        Self { characters, offsets }
    }

    fn get(&self, index: usize) -> Option<char> {
        self.characters.get(index).copied()
    }

    fn slice(&self, start: usize, end: usize) -> String {
        self.characters[start..end.min(self.characters.len())].iter().collect()
    }

    fn len(&self) -> usize {
        self.characters.len()
    }
}

fn is_name_start(character: Option<char>) -> bool {
    character.is_some_and(|value| value.is_ascii_alphabetic())
}

fn is_name_character(character: Option<char>) -> bool {
    character.is_some_and(|value| value.is_ascii_alphanumeric() || value == '_' || value == '-')
}

fn is_space(character: Option<char>) -> bool {
    character.is_some_and(js::is_whitespace)
}

fn find_tag_end(source: &Source, start: usize) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for index in start + 1..source.len() {
        let character = source.characters[index];
        if escaped {
            escaped = false;
            continue;
        }
        if quote.is_some() && character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(open) = quote {
            if character == open {
                quote = None;
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }
        if character == '>' {
            return Some(index);
        }
    }
    None
}

fn decode_attribute_value(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\\'
            && let Some(&next) = characters.peek()
            && matches!(next, '<' | '>' | '\\' | '"')
        {
            decoded.push(next);
            characters.next();
            continue;
        }
        decoded.push(character);
    }
    decoded
}

fn parse_tag(source: &Source, start: usize, end: usize) -> Option<ParsedTag> {
    let mut index = start + 1;
    let closing = source.get(index) == Some('/');
    if closing {
        index += 1;
    }
    while is_space(source.get(index)) {
        index += 1;
    }
    if !is_name_start(source.get(index)) {
        return None;
    }
    let name_start = index;
    while is_name_character(source.get(index)) {
        index += 1;
    }
    let name = source.slice(name_start, index);
    if closing {
        while is_space(source.get(index)) {
            index += 1;
        }
        if index != end {
            return None;
        }
        return Some(ParsedTag { attributes: IndexMap::new(), closing: true, name, self_closing: false });
    }
    let mut attributes = IndexMap::new();
    while index < end {
        while is_space(source.get(index)) {
            index += 1;
        }
        if index >= end {
            break;
        }
        if source.get(index) == Some('/') {
            index += 1;
            while is_space(source.get(index)) {
                index += 1;
            }
            if index != end {
                return None;
            }
            return Some(ParsedTag { attributes, closing: false, name, self_closing: true });
        }
        if !is_name_start(source.get(index)) {
            return None;
        }
        let attribute_start = index;
        while is_name_character(source.get(index)) {
            index += 1;
        }
        let attribute_name = source.slice(attribute_start, index);
        while is_space(source.get(index)) {
            index += 1;
        }
        if source.get(index) != Some('=') {
            return None;
        }
        index += 1;
        while is_space(source.get(index)) {
            index += 1;
        }
        let quote = source.get(index)?;
        if quote != '"' && quote != '\'' {
            return None;
        }
        index += 1;
        let mut value = String::new();
        let mut closed = false;
        while index < end {
            let character = source.characters[index];
            if character == '\\' && index + 1 < end {
                value.push(source.characters[index + 1]);
                index += 2;
                continue;
            }
            if character == quote {
                closed = true;
                index += 1;
                break;
            }
            value.push(character);
            index += 1;
        }
        if !closed || attributes.contains_key(&attribute_name) {
            return None;
        }
        attributes.insert(attribute_name, decode_attribute_value(&value));
    }
    Some(ParsedTag { attributes, closing: false, name, self_closing: false })
}

fn parse_length(value: &str, allow_negative: bool) -> Option<RichTextLength> {
    let text = js::trim(value);
    let (number, unit) = if let Some(number) = text.strip_suffix("px") {
        (number, LengthUnit::Px)
    } else {
        let number = text.strip_suffix("em")?;
        (number, LengthUnit::Em)
    };
    let digits = number.strip_prefix('-').unwrap_or(number);
    let valid = match digits.split_once('.') {
        Some((whole, fraction)) => {
            !fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit()) && whole.bytes().all(|byte| byte.is_ascii_digit())
        }
        None => !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()),
    };
    if !valid {
        return None;
    }
    let parsed = js::to_number(number);
    if !parsed.is_finite() || (!allow_negative && parsed < 0.0) {
        return None;
    }
    Some(RichTextLength { unit, value: parsed })
}

fn parse_compression(value: &str) -> Option<f64> {
    let parsed = js::to_number(value);
    (parsed.is_finite() && parsed > 0.0).then_some(parsed)
}

fn valid_hex_color(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
}

struct Warnings(Vec<RichTextWarning>);

impl Warnings {
    fn push(&mut self, code: WarningCode, message: impl Into<String>, offset: usize, length: usize) {
        self.0.push(RichTextWarning { code, length, message: message.into(), offset });
    }
}

fn validate_tag(tag: &ParsedTag, warnings: &mut Warnings, offset: usize, length: usize) -> Option<TagName> {
    let Some(name) = TagName::parse(&tag.name) else {
        warnings.push(WarningCode::UnknownTag, format!("Unknown rich-text tag <{}>.", tag.name), offset, length);
        return None;
    };
    let allowed = name.attributes();
    if let Some(unknown) = tag.attributes.keys().find(|attribute| !allowed.contains(&attribute.as_str())) {
        warnings.push(
            WarningCode::InvalidAttribute,
            format!("Rich-text tag <{}> does not support attribute \"{unknown}\".", name.as_str()),
            offset,
            length,
        );
        return None;
    }
    if tag.closing {
        if !tag.attributes.is_empty() {
            warnings.push(
                WarningCode::InvalidAttribute,
                format!("Closing rich-text tag </{}> cannot have attributes.", name.as_str()),
                offset,
                length,
            );
            return None;
        }
        return Some(name);
    }
    if name == TagName::Space && !tag.self_closing {
        warnings.push(WarningCode::MalformedTag, "The <space> rich-text tag must be self-closing.", offset, length);
        return None;
    }
    if name != TagName::Space && tag.self_closing {
        warnings.push(WarningCode::MalformedTag, format!("The <{}> rich-text tag must have a closing tag.", name.as_str()), offset, length);
        return None;
    }
    let attribute = |key: &str| tag.attributes.get(key).map(String::as_str);
    let require = |key: &str, warnings: &mut Warnings| {
        if attribute(key).is_some_and(|value| !value.is_empty()) {
            return true;
        }
        warnings.push(
            WarningCode::InvalidAttribute,
            format!("Rich-text tag <{}> requires a non-empty \"{key}\" attribute.", name.as_str()),
            offset,
            length,
        );
        false
    };
    match name {
        TagName::Color => {
            if !require("value", warnings) || !valid_hex_color(attribute("value").unwrap_or("")) {
                warnings.push(
                    WarningCode::InvalidValue,
                    "Rich-text color must be a hexadecimal value such as \"#ff0000\".",
                    offset,
                    length,
                );
                return None;
            }
        }
        TagName::Scale => {
            let x = attribute("x");
            let y = attribute("y");
            if (x.is_none() && y.is_none())
                || x.is_some_and(|value| parse_compression(value).is_none())
                || y.is_some_and(|value| parse_compression(value).is_none())
            {
                warnings.push(
                    WarningCode::InvalidValue,
                    "Rich-text scale requires x or y to be a positive finite number such as \"0.75\" or \"1.25\".",
                    offset,
                    length,
                );
                return None;
            }
        }
        TagName::Nowrap => {
            if attribute("align").is_some_and(|value| value != "justify") {
                warnings.push(WarningCode::InvalidValue, "Rich-text nowrap align must be \"justify\".", offset, length);
                return None;
            }
        }
        TagName::Ruby => {
            if !require("text", warnings) {
                return None;
            }
        }
        TagName::Space => {
            if !require("width", warnings) || parse_length(attribute("width").unwrap_or(""), false).is_none() {
                warnings.push(WarningCode::InvalidValue, "Rich-text space width must use a non-negative px or em length.", offset, length);
                return None;
            }
        }
        TagName::Size | TagName::Tracking => {
            let allow_negative = name == TagName::Tracking;
            if !require("value", warnings) || parse_length(attribute("value").unwrap_or(""), allow_negative).is_none() {
                let suffix = if name == TagName::Size { " that is non-negative" } else { "" };
                warnings.push(
                    WarningCode::InvalidValue,
                    format!("Rich-text {} value must use a px or em length{suffix}.", name.as_str()),
                    offset,
                    length,
                );
                return None;
            }
        }
        TagName::Shift => {
            let x = attribute("x");
            let y = attribute("y");
            if (x.is_none() && y.is_none())
                || x.is_some_and(|value| parse_length(value, true).is_none())
                || y.is_some_and(|value| parse_length(value, true).is_none())
            {
                warnings.push(WarningCode::InvalidValue, "Rich-text shift requires x or y to use a px or em length.", offset, length);
                return None;
            }
        }
        TagName::Align => {
            if !require("value", warnings) {
                return None;
            }
            if !matches!(attribute("value"), Some("left" | "center" | "right" | "justify")) {
                warnings.push(WarningCode::InvalidValue, "Rich-text align value must be left, center, right, or justify.", offset, length);
                return None;
            }
        }
        _ => {}
    }
    Some(name)
}

struct OpenElement {
    element: RichTextElement,
    start: usize,
}

fn append_text(children: &mut Vec<RichTextNode>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(RichTextNode::Text(previous)) = children.last_mut() {
        previous.push_str(text);
    } else {
        children.push(RichTextNode::Text(text.to_owned()));
    }
}

pub fn parse_rich_text(text: &str) -> RichTextParseResult {
    let source = Source::new(text);
    let mut warnings = Warnings(Vec::new());
    let mut roots: Vec<RichTextNode> = Vec::new();
    let mut stack: Vec<OpenElement> = Vec::new();
    let mut pending = String::new();

    fn current<'a>(roots: &'a mut Vec<RichTextNode>, stack: &'a mut [OpenElement]) -> &'a mut Vec<RichTextNode> {
        match stack.last_mut() {
            Some(open) => &mut open.element.children,
            None => roots,
        }
    }

    let mut index = 0;
    while index < source.len() {
        let character = source.characters[index];
        if character == '\\' {
            match source.get(index + 1) {
                Some(escaped @ ('<' | '>' | '\\' | '"')) => {
                    pending.push(escaped);
                    index += 2;
                }
                _ => {
                    pending.push(character);
                    index += 1;
                }
            }
            continue;
        }
        if character != '<' {
            pending.push(character);
            index += 1;
            continue;
        }
        let offset = source.offsets[index];
        let Some(end) = find_tag_end(&source, index) else {
            warnings.push(
                WarningCode::MalformedTag,
                "Rich-text tag is missing its closing angle bracket.",
                offset,
                source.offsets[source.len()] - offset,
            );
            pending.push_str(&source.slice(index, source.len()));
            break;
        };
        let length = source.offsets[end + 1] - offset;
        let Some(parsed) = parse_tag(&source, index, end) else {
            warnings.push(WarningCode::MalformedTag, "Rich-text tag syntax is malformed.", offset, length);
            pending.push_str(&source.slice(index, end + 1));
            index = end + 1;
            continue;
        };
        let Some(name) = validate_tag(&parsed, &mut warnings, offset, length) else {
            pending.push_str(&source.slice(index, end + 1));
            index = end + 1;
            continue;
        };
        append_text(current(&mut roots, &mut stack), &pending);
        pending.clear();
        if parsed.closing {
            if stack.last().is_some_and(|open| open.element.tag == name) {
                if let Some(open) = stack.pop() {
                    current(&mut roots, &mut stack).push(RichTextNode::Element(open.element));
                }
            } else {
                warnings.push(
                    WarningCode::MismatchedClosingTag,
                    format!("Rich-text closing tag </{}> does not match the currently open tag.", name.as_str()),
                    offset,
                    length,
                );
                pending.push_str(&source.slice(index, end + 1));
            }
        } else if name == TagName::Space {
            current(&mut roots, &mut stack).push(RichTextNode::Element(RichTextElement {
                attributes: parsed.attributes,
                children: Vec::new(),
                tag: name,
            }));
        } else {
            stack.push(OpenElement {
                element: RichTextElement { attributes: parsed.attributes, children: Vec::new(), tag: name },
                start: offset,
            });
        }
        index = end + 1;
    }
    append_text(current(&mut roots, &mut stack), &pending);
    let total = source.offsets[source.len()];
    while let Some(open) = stack.pop() {
        warnings.push(
            WarningCode::UnclosedTag,
            format!("Rich-text tag <{}> is not closed.", open.element.tag.as_str()),
            open.start,
            total - open.start,
        );
        current(&mut roots, &mut stack).push(RichTextNode::Element(open.element));
    }
    RichTextParseResult { document: RichTextDocument { children: roots, source: text.to_owned() }, warnings: warnings.0 }
}

pub fn plain_text_from_rich_text(document: &RichTextDocument) -> String {
    fn visit(nodes: &[RichTextNode], output: &mut String) {
        for node in nodes {
            match node {
                RichTextNode::Text(text) => output.push_str(text),
                RichTextNode::Element(element) if element.tag == TagName::Space => output.push(' '),
                RichTextNode::Element(element) => visit(&element.children, output),
            }
        }
    }
    let mut output = String::new();
    visit(&document.children, &mut output);
    output
}

pub fn has_leading_authored_line_fit_split(document: &RichTextDocument) -> bool {
    let plain = plain_text_from_rich_text(document);
    let lines = js::split_lines(&plain);
    lines.len() >= 2 && js::has_visible(lines[0]) && lines[1..].iter().any(|line| js::has_visible(line))
}

pub fn has_leading_authored_line_fit_split_source(source: &str) -> bool {
    has_leading_authored_line_fit_split(&parse_rich_text(source).document)
}

pub fn grapheme_segments(text: &str) -> impl Iterator<Item = &str> {
    text.graphemes(true)
}

pub fn grapheme_count(text: &str) -> usize {
    text.graphemes(true).count()
}

pub fn rich_text_line_lengths(source: &str) -> Vec<usize> {
    let plain = plain_text_from_rich_text(&parse_rich_text(source).document);
    js::split_lines(&plain).into_iter().map(grapheme_count).collect()
}

pub fn rich_text_has_formatting(document: &RichTextDocument) -> bool {
    document.children.iter().any(|node| matches!(node, RichTextNode::Element(_)))
}

pub fn parse_rich_text_length(value: &str, allow_negative: bool) -> Option<RichTextLength> {
    parse_length(value, allow_negative)
}

pub fn parse_rich_text_scale(value: &str) -> Option<f64> {
    parse_compression(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(source: &str) -> Vec<&'static str> {
        parse_rich_text(source).warnings.iter().map(|warning| warning.code.as_str()).collect()
    }

    #[test]
    fn parses_nested_elements_and_merges_text() {
        let result = parse_rich_text("a<b>b<i>c</i></b>d");
        assert!(result.warnings.is_empty());
        assert_eq!(plain_text_from_rich_text(&result.document), "abcd");
        assert_eq!(result.document.children.len(), 3);
    }

    #[test]
    fn keeps_invalid_markup_literal() {
        let result = parse_rich_text("x<unknown>y</b>z<b>");
        assert_eq!(codes("x<unknown>y</b>z<b>"), vec!["unknown-tag", "mismatched-closing-tag", "unclosed-tag"]);
        assert_eq!(plain_text_from_rich_text(&result.document), "x<unknown>y</b>z");
        assert_eq!(result.warnings[2].offset, 16);
        assert_eq!(result.warnings[2].length, 3);
    }

    #[test]
    fn decodes_escapes_and_spaces() {
        let result = parse_rich_text(r#"\<a\> <space width="1em"/>b"#);
        assert_eq!(plain_text_from_rich_text(&result.document), "<a>  b");
    }

    #[test]
    fn validates_values() {
        assert_eq!(codes(r##"<color value="red">x"##), vec!["invalid-value"]);
        assert_eq!(codes(r##"<color value="red">x</color>"##), vec!["invalid-value", "mismatched-closing-tag"]);
        assert_eq!(codes(r#"<scale x="0">x"#), vec!["invalid-value"]);
        assert_eq!(codes(r#"<size value="-1px">x"#), vec!["invalid-value"]);
        assert_eq!(codes(r#"<tracking value="-1px">x</tracking>"#), Vec::<&str>::new());
        assert_eq!(codes(r#"<ruby text="">x"#), vec!["invalid-attribute"]);
        assert_eq!(codes("<space/>"), vec!["invalid-attribute", "invalid-value"]);
        assert_eq!(codes("<b/>"), vec!["malformed-tag"]);
        assert_eq!(codes("<b"), vec!["malformed-tag"]);
    }

    #[test]
    fn detects_leading_authored_lines() {
        assert!(has_leading_authored_line_fit_split_source("a\nb"));
        assert!(!has_leading_authored_line_fit_split_source(" \nb"));
        assert!(!has_leading_authored_line_fit_split_source("a\n "));
        assert_eq!(rich_text_line_lengths("ab<b>c</b>\nd"), vec![3, 1]);
    }

    #[test]
    fn counts_utf16_offsets() {
        let result = parse_rich_text("😀<x>");
        assert_eq!(result.warnings[0].offset, 2);
    }
}

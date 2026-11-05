use serde_json::Value;

use super::shape::{ShapeResult, assert_no_unknown_keys, fail, record, string_of};

pub const SAFE_SVG_TAGS: &[&str] = &["circle", "ellipse", "g", "line", "path", "polygon", "polyline", "rect", "text", "tspan"];

pub const SAFE_SVG_ATTRIBUTES: &[&str] = &[
    "baseline-shift",
    "cx",
    "cy",
    "d",
    "dominant-baseline",
    "dx",
    "dy",
    "fill",
    "fill-opacity",
    "fill-rule",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "height",
    "id",
    "lengthAdjust",
    "letter-spacing",
    "opacity",
    "points",
    "r",
    "role",
    "rx",
    "ry",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "paint-order",
    "text-anchor",
    "textLength",
    "transform",
    "vector-effect",
    "viewBox",
    "white-space",
    "width",
    "x",
    "x1",
    "x2",
    "y",
    "y1",
    "y2",
    "xml:space",
];

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack.to_ascii_lowercase().contains(needle)
}

fn has_function_call(value: &str, name: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find(name) {
        let after = &lower[search + found + name.len()..];
        if after.trim_start_matches(crate::js::is_whitespace).starts_with('(') {
            return true;
        }
        search += found + name.len();
    }
    false
}

fn has_import(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find("@import") {
        let start = search + found;
        let before_ok = start == 0
            || lower[..start].chars().next_back().is_some_and(|character| crate::js::is_whitespace(character) || character == ';');
        let after = lower[start + 7..].chars().next();
        let after_ok = !after.is_some_and(|character| character.is_ascii_alphanumeric() || character == '_');
        if before_ok && after_ok {
            return true;
        }
        search = start + 7;
    }
    false
}

pub fn svg_attribute_value(name: &str, value: &Value, location: &str) -> ShapeResult<()> {
    match value {
        Value::Number(_) => Ok(()),
        Value::String(text) => text_attribute_value(name, text, location),
        _ => fail(format!("{location}.attributes.{name} must be text or a number.")),
    }
}

fn text_attribute_value(name: &str, text: &str, location: &str) -> ShapeResult<()> {
    if text.chars().any(|character| {
        let code = character as u32;
        code <= 8 || code == 11 || code == 12 || (14..=31).contains(&code) || code == 127
    }) {
        return fail(format!("{location}.attributes.{name} contains unsupported control characters."));
    }
    if has_function_call(text, "url")
        || ["javascript:", "data:", "http:", "https:"].iter().any(|scheme| contains_ignore_case(text, scheme))
        || has_import(text)
        || has_function_call(text, "expression")
        || has_function_call(text, "var")
        || text.contains('\\')
        || text.contains("/*")
        || text.contains("*/")
    {
        return fail(format!("{location}.attributes.{name} must not contain URL or active CSS content."));
    }
    Ok(())
}

pub fn validate_svg_element_shape(input: &Value, location: &str) -> ShapeResult<()> {
    let element = record(Some(input), location)?;
    assert_no_unknown_keys(element, &["attributes", "children", "tag", "text"], location)?;
    let tag = element.get("tag");
    if !tag.and_then(Value::as_str).is_some_and(|tag| SAFE_SVG_TAGS.contains(&tag)) {
        return fail(format!("{location}.tag must be a supported inert SVG element; received \"{}\".", string_of(tag)));
    }
    if element.get("text").is_some_and(|text| !text.is_string()) {
        return fail(format!("{location}.text must be a string."));
    }
    if let Some(attributes) = element.get("attributes") {
        let attributes = record(Some(attributes), &format!("{location}.attributes"))?;
        for (name, value) in attributes {
            if name.len() >= 2 && name[..2].eq_ignore_ascii_case("on") {
                return fail(format!("{location} must not use event attribute \"{name}\"."));
            }
            if name.contains(':') && name != "xml:space" {
                return fail(format!("{location} must not use namespaced attribute \"{name}\"."));
            }
            if !SAFE_SVG_ATTRIBUTES.contains(&name.as_str()) {
                return fail(format!("{location} uses unsupported SVG attribute \"{name}\"."));
            }
            svg_attribute_value(name, value, location)?;
            if name == "xml:space" && value.as_str() != Some("preserve") {
                return fail(format!("{location}.attributes.xml:space must be \"preserve\"."));
            }
        }
    }
    if let Some(children) = element.get("children") {
        let Value::Array(children) = children else {
            return fail(format!("{location}.children must be an array."));
        };
        for (index, child) in children.iter().enumerate() {
            validate_svg_element_shape(child, &format!("{location}.children[{index}]"))?;
        }
    }
    Ok(())
}

pub fn validate_rendered_element(element: &crate::svg::SvgElement, location: &str) -> ShapeResult<()> {
    if !SAFE_SVG_TAGS.contains(&element.tag.as_str()) {
        return fail(format!("{location}.tag must be a supported inert SVG element; received \"{}\".", element.tag));
    }
    for (name, value) in &element.attributes {
        if name.len() >= 2 && name[..2].eq_ignore_ascii_case("on") {
            return fail(format!("{location} must not use event attribute \"{name}\"."));
        }
        if name.contains(':') && name != "xml:space" {
            return fail(format!("{location} must not use namespaced attribute \"{name}\"."));
        }
        if !SAFE_SVG_ATTRIBUTES.contains(&name.as_str()) {
            return fail(format!("{location} uses unsupported SVG attribute \"{name}\"."));
        }
        if let crate::svg::AttributeValue::Text(text) = value {
            text_attribute_value(name, text, location)?;
            if name == "xml:space" && text != "preserve" {
                return fail(format!("{location}.attributes.xml:space must be \"preserve\"."));
            }
        } else if name == "xml:space" {
            return fail(format!("{location}.attributes.xml:space must be \"preserve\"."));
        }
    }
    for (index, child) in element.children.iter().enumerate() {
        validate_rendered_element(child, &format!("{location}.children[{index}]"))?;
    }
    Ok(())
}

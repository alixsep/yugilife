mod card;
mod normalize;
mod overrides;
mod shape;
mod svg;
mod template;
mod typography;

use serde_json::Value;

pub use card::{describe_field_value_violation, initial_field_value, number_value};
pub use shape::Record;
pub use template::{compare_template_versions, template_version_is_valid};
pub use typography::{is_truthy, merge_text_typography};

use crate::card::{CardData, CardValue};
use crate::error::{Error, Result};

fn wrap<T>(result: shape::ShapeResult<T>, subject: Option<&str>) -> Result<T> {
    result.map_err(|detail| {
        let message = match subject {
            Some(subject) if !detail.starts_with(&format!("Malformed {subject}:")) => {
                format!("Malformed {subject}: {detail}")
            }
            _ => detail,
        };
        Error::Validation(message)
    })
}

pub fn validate_card_template(input: &Value) -> Result<Record> {
    wrap(template::validate_card_template_shape(input), Some("card template"))
}

pub fn validate_template_manifest(input: &Value) -> Result<()> {
    wrap(template::validate_template_manifest_shape(input), Some("template manifest"))
}

pub fn validate_svg_element(input: &Value, location: Option<&str>) -> Result<()> {
    wrap(svg::validate_svg_element_shape(input, location.unwrap_or("SVG element")), None)
}

pub fn validate_rendered_svg_element(element: &crate::svg::SvgElement, location: &str) -> Result<()> {
    wrap(svg::validate_rendered_element(element, location), None)
}

pub fn validate_presentation_overrides(input: &Value, template: &Record) -> Result<()> {
    wrap(overrides::validate_presentation_overrides_shape(input, template), Some("presentation overrides"))
}

pub fn validate_color_preset(input: &Value, location: &str) -> Result<()> {
    wrap(color_preset_shape(input, location), None)
}

pub fn validate_color_preset_collection(input: &Value) -> Result<()> {
    let location = "Color presets";
    let result = shape::record(Some(input), location)
        .and_then(|presets| presets.iter().try_for_each(|(name, preset)| color_preset_shape(preset, &format!("{location} \"{name}\""))));
    wrap(result, Some("color preset collection"))
}

fn color_preset_shape(input: &Value, location: &str) -> shape::ShapeResult<()> {
    let preset = shape::record(Some(input), location)?;
    if let Some(metadata) = preset.get("metadata") {
        let metadata = shape::record(Some(metadata), &format!("{location}.metadata"))?;
        shape::optional_string(metadata.get("target"), &format!("{location}.metadata.target"))?;
    }
    match preset.get("method").and_then(Value::as_str) {
        Some("identity") => Ok(()),
        Some("rgb-polynomial") => {
            let (Some(Value::Array(exponents)), Some(Value::Array(coefficients))) = (preset.get("exponents"), preset.get("coefficients"))
            else {
                return shape::fail(format!("{location} must contain equally sized exponent and coefficient arrays."));
            };
            if exponents.is_empty() || exponents.len() != coefficients.len() {
                return shape::fail(format!("{location} must contain equally sized exponent and coefficient arrays."));
            }
            for (index, tuple) in exponents.iter().enumerate() {
                let powers = finite_tuple(tuple, &format!("{location}.exponents[{index}]"))?;
                if powers.iter().any(|power| power.fract() != 0.0 || *power < 0.0) {
                    return shape::fail(format!("{location}.exponents[{index}] must contain non-negative integers."));
                }
            }
            for (index, tuple) in coefficients.iter().enumerate() {
                finite_tuple(tuple, &format!("{location}.coefficients[{index}]"))?;
            }
            Ok(())
        }
        Some("skimage-histogram-rgb-lut") => {
            let channels = shape::record(preset.get("channels"), &format!("{location}.channels"))?;
            for channel in ["r", "g", "b"] {
                let valid = matches!(channels.get(channel), Some(Value::Array(values))
                    if values.len() == 256
                        && values.iter().all(|value| value.as_f64().is_some_and(|number| (0.0..=255.0).contains(&number))));
                if !valid {
                    return shape::fail(format!("{location}.channels.{channel} must contain 256 values from 0–255."));
                }
            }
            Ok(())
        }
        _ => shape::fail(format!("{location} uses unsupported method {}.", shape::json_stringify(preset.get("method")))),
    }
}

fn finite_tuple(value: &Value, location: &str) -> shape::ShapeResult<Vec<f64>> {
    match value {
        Value::Array(entries) if entries.len() == 3 => {
            entries.iter().enumerate().map(|(index, entry)| shape::finite_number(Some(entry), &format!("{location}[{index}]"))).collect()
        }
        _ => shape::fail(format!("{location} must contain exactly 3 finite numbers.")),
    }
}

fn repeated_image_violations(card: &CardData, layers: &Value, violations: &mut Vec<String>) {
    for layer in layers.as_array().into_iter().flatten() {
        let kind = layer.get("kind").and_then(Value::as_str);
        if kind == Some("repeated-image") {
            let field = shape::string_of(layer.get("field"));
            let valid = match card.get(&field) {
                None => true,
                Some(CardValue::Json(Value::String(text))) if text.is_empty() => true,
                Some(CardValue::Json(Value::Number(number))) => number.as_f64().is_some_and(|value| value.fract() == 0.0 && value >= 0.0),
                Some(_) => false,
            };
            if !valid {
                violations.push(format!("\"{field}\" must be a non-negative integer"));
            }
        }
        if kind == Some("group")
            && let Some(children) = layer.get("layers")
        {
            repeated_image_violations(card, children, violations);
        }
    }
}

pub fn validate_card_data(card: &CardData, template: &Record) -> Result<()> {
    let mut violations: Vec<String> = template
        .get("cardFields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|field| {
            let name = shape::string_of(field.get("name"));
            describe_field_value_violation(field, card.get(&name), &format!("\"{name}\""), true)
        })
        .collect();
    if let Some(layers) = template.get("layers") {
        repeated_image_violations(card, layers, &mut violations);
    }
    if violations.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(format!("Card data does not satisfy this template: {}.", violations.join("; "))))
    }
}

pub fn create_card_from_template(template: &Record) -> CardData {
    let mut card = CardData::default();
    for field in template.get("cardFields").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object) {
        card.insert(shape::string_of(field.get("name")), CardValue::Json(initial_field_value(field)));
    }
    if !matches!(card.get("name"), Some(CardValue::Json(Value::String(_)))) {
        card.insert("name".to_owned(), CardValue::Json(Value::String(String::new())));
    }
    card
}

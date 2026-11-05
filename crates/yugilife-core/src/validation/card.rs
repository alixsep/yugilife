use serde_json::Value;

use super::shape::Record;
use crate::card::CardValue;
use crate::js;
use crate::number::js_number;
use crate::rich_text::rich_text_line_lengths;

fn is_empty_value(value: Option<&CardValue>) -> bool {
    match value {
        None | Some(CardValue::Json(Value::Null)) => true,
        Some(CardValue::Json(Value::String(text))) => text.is_empty(),
        Some(CardValue::Json(Value::Array(entries))) => {
            entries.is_empty() || entries.iter().all(|entry| matches!(entry, Value::String(text) if text.is_empty()))
        }
        _ => false,
    }
}

fn field_number(field: &Record, key: &str) -> Option<f64> {
    field.get(key).and_then(Value::as_f64)
}

fn numeric_bound_violation(field: &Record, value: f64, subject: &str) -> Option<String> {
    if let Some(minimum) = field_number(field, "min")
        && value < minimum
    {
        return Some(format!("{subject} must be at least {}", js_number(minimum)));
    }
    if let Some(maximum) = field_number(field, "max")
        && value > maximum
    {
        return Some(format!("{subject} must be at most {}", js_number(maximum)));
    }
    None
}

fn length_violation(
    field: &Record,
    entries: &[&str],
    entry_noun: &str,
    subject: &str,
    visible_lengths: Option<Vec<usize>>,
) -> Option<String> {
    if let Some(maximum_items) = field_number(field, "maxItems")
        && entries.len() as f64 > maximum_items
    {
        return Some(format!("{subject} must contain at most {} {entry_noun}", js_number(maximum_items)));
    }
    let maximum_length = field_number(field, "maxLength")?;
    let lengths = visible_lengths.unwrap_or_else(|| entries.iter().flat_map(|entry| rich_text_line_lengths(entry)).collect());
    lengths
        .iter()
        .any(|length| *length as f64 > maximum_length)
        .then(|| format!("{subject} must not exceed {} characters", js_number(maximum_length)))
}

fn options(field: &Record) -> Option<Vec<&str>> {
    field.get("options").and_then(Value::as_array).map(|entries| entries.iter().filter_map(Value::as_str).collect())
}

pub fn describe_field_value_violation(
    field: &Record,
    value: Option<&CardValue>,
    subject: &str,
    allow_empty_optional: bool,
) -> Option<String> {
    let required = field.get("required").and_then(Value::as_bool) == Some(true);
    if is_empty_value(value) {
        if required {
            return Some(format!("{subject} is required"));
        }
        if allow_empty_optional {
            return None;
        }
    }
    let json = match value {
        Some(CardValue::Json(json)) => Some(json),
        _ => None,
    };
    let kind = field.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "boolean" => (!matches!(json, Some(Value::Bool(_)))).then(|| format!("{subject} must be a boolean")),
        "number" => match json.and_then(Value::as_f64) {
            Some(number) if matches!(json, Some(Value::Number(_))) => numeric_bound_violation(field, number, subject),
            _ => Some(format!("{subject} must be a finite number")),
        },
        "number-pair" => {
            let Some(Value::Array(entries)) = json else {
                return Some(format!("{subject} must contain exactly two numbers"));
            };
            if entries.len() != 2 {
                return Some(format!("{subject} must contain exactly two numbers"));
            }
            if !entries.iter().all(Value::is_number) {
                return Some(format!("{subject} must contain only finite numbers"));
            }
            entries.iter().enumerate().find_map(|(index, entry)| {
                numeric_bound_violation(field, entry.as_f64().unwrap_or(f64::NAN), &format!("{subject}[{index}]"))
            })
        }
        "text-list" => {
            let Some(Value::Array(entries)) = json else {
                return Some(format!("{subject} must be a list of strings"));
            };
            let Some(texts) = entries.iter().map(Value::as_str).collect::<Option<Vec<&str>>>() else {
                return Some(format!("{subject} must be a list of strings"));
            };
            if let Some(allowed) = options(field)
                && texts.iter().any(|entry| !allowed.contains(entry))
            {
                return Some(format!("{subject} entries must be one of: {}", allowed.join(", ")));
            }
            length_violation(field, &texts, "entries", subject, None)
        }
        "text" | "multiline" => {
            let lines: Vec<&str> = match json {
                Some(Value::Array(entries)) => match entries.iter().map(Value::as_str).collect::<Option<Vec<_>>>() {
                    Some(lines) => lines,
                    None => return Some(format!("{subject} must be text")),
                },
                Some(Value::String(text)) => vec![text.as_str()],
                _ => return Some(format!("{subject} must be text")),
            };
            if kind == "text" && matches!(json, Some(Value::Array(_))) {
                return Some(format!("{subject} must be a single line of text"));
            }
            if let (Some(allowed), Some(Value::String(text))) = (options(field), json)
                && !allowed.contains(&text.as_str())
            {
                return Some(format!("{subject} must be one of: {}", allowed.join(", ")));
            }
            let structural: Vec<&str> = lines.iter().flat_map(|entry| js::split_lines(entry)).collect();
            let visible = field_number(field, "maxLength").map(|_| rich_text_line_lengths(&lines.join("\n")));
            length_violation(field, &structural, "lines", subject, visible)
        }
        "image" => {
            let is_asset = match value {
                Some(CardValue::Asset(_)) => true,
                Some(CardValue::Json(Value::String(_))) => true,
                Some(CardValue::Json(Value::Object(map))) => map.contains_key("width") && map.contains_key("height"),
                _ => false,
            };
            (!is_asset).then(|| format!("{subject} must be an image source"))
        }
        _ => None,
    }
}

pub fn initial_field_value(field: &Record) -> Value {
    if let Some(default) = field.get("defaultValue") {
        return default.clone();
    }
    let bounded = || {
        field_number(field, "min")
            .or_else(|| field_number(field, "max").filter(|maximum| *maximum < 0.0))
            .map_or(Value::from(0), number_value)
    };
    match field.get("kind").and_then(Value::as_str).unwrap_or("") {
        "boolean" => Value::Bool(false),
        "number" => bounded(),
        "number-pair" => Value::Array(vec![bounded(), bounded()]),
        "text-list" => Value::Array(Vec::new()),
        "text" => field
            .get("options")
            .and_then(Value::as_array)
            .and_then(|entries| entries.first())
            .cloned()
            .unwrap_or_else(|| Value::String(String::new())),
        _ => Value::String(String::new()),
    }
}

pub fn number_value(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

use serde_json::{Map, Value};

use crate::number::js_number;

pub type Record = Map<String, Value>;
pub type ShapeResult<T> = Result<T, String>;

pub fn fail<T>(message: impl Into<String>) -> ShapeResult<T> {
    Err(message.into())
}

pub fn record<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<&'a Record> {
    match value {
        Some(Value::Object(map)) => Ok(map),
        _ => fail(format!("{location} must be an object.")),
    }
}

pub fn non_empty_string<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<&'a str> {
    match value {
        Some(Value::String(text)) if !text.is_empty() => Ok(text),
        _ => fail(format!("{location} must be a non-empty string.")),
    }
}

pub fn finite_number(value: Option<&Value>, location: &str) -> ShapeResult<f64> {
    match value.and_then(Value::as_f64) {
        Some(number) if number.is_finite() => Ok(number),
        _ => fail(format!("{location} must be a finite number.")),
    }
}

pub fn positive_number(value: Option<&Value>, location: &str) -> ShapeResult<f64> {
    let parsed = finite_number(value, location)?;
    if parsed <= 0.0 {
        return fail(format!("{location} must be positive."));
    }
    Ok(parsed)
}

pub fn optional_string<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<Option<&'a str>> {
    match value {
        None => Ok(None),
        Some(_) => non_empty_string(value, location).map(Some),
    }
}

pub fn optional_boolean(value: Option<&Value>, location: &str) -> ShapeResult<Option<bool>> {
    match value {
        None => Ok(None),
        Some(Value::Bool(flag)) => Ok(Some(*flag)),
        Some(_) => fail(format!("{location} must be a boolean.")),
    }
}

pub fn string_array(value: Option<&Value>, location: &str, unique: bool) -> ShapeResult<Vec<String>> {
    let Some(Value::Array(entries)) = value else {
        return fail(format!("{location} must be an array."));
    };
    let mut values = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        values.push(non_empty_string(Some(entry), &format!("{location}[{index}]"))?.to_owned());
    }
    if unique {
        let mut seen = std::collections::HashSet::new();
        if !values.iter().all(|value| seen.insert(value.as_str())) {
            return fail(format!("{location} must contain unique values."));
        }
    }
    Ok(values)
}

pub fn assert_no_unknown_keys(value: &Record, allowed: &[&str], location: &str) -> ShapeResult<()> {
    let unknown: Vec<&str> = value.keys().map(String::as_str).filter(|key| !allowed.contains(key)).collect();
    if unknown.is_empty() { Ok(()) } else { fail(format!("{location} has unsupported fields: {}.", unknown.join(", "))) }
}

pub fn is_integer(value: Option<&Value>) -> bool {
    value.and_then(Value::as_f64).is_some_and(|number| number.is_finite() && number.fract() == 0.0)
}

pub fn string_of(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(Value::Number(number)) => js_number(number.as_f64().unwrap_or(f64::NAN)),
        Some(Value::Array(entries)) => entries
            .iter()
            .map(|entry| match entry {
                Value::Null => String::new(),
                other => string_of(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

pub fn json_stringify(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Number(number)) => js_number(number.as_f64().unwrap_or(f64::NAN)),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    }
}

pub fn region(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    let parsed = record(value, location)?;
    assert_no_unknown_keys(parsed, &["height", "width", "x", "y"], location)?;
    finite_number(parsed.get("x"), &format!("{location}.x"))?;
    finite_number(parsed.get("y"), &format!("{location}.y"))?;
    positive_number(parsed.get("width"), &format!("{location}.width"))?;
    positive_number(parsed.get("height"), &format!("{location}.height"))?;
    Ok(())
}

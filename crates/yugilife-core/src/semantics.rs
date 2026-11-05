use indexmap::IndexMap;
use serde_json::Value;

use crate::card::{CardData, CardValue};
use crate::error::{Error, Result};
use crate::model::{
    CardTemplate, Condition, Primitive, SemanticBinding, SemanticFallback, SemanticTransform, SemanticValue, SourceReference, SourceValue,
};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CardSemantics {
    pub values: IndexMap<String, Option<SemanticValue>>,
}

impl CardSemantics {
    /// `{ values: { path: value } }`, with `null` for a path that has no value (`undefined` in
    /// JavaScript, which JSON cannot carry; no semantic value is ever `null`).
    pub fn to_json(&self) -> Value {
        let values: serde_json::Map<String, Value> =
            self.values.iter().map(|(path, value)| (path.clone(), value.as_ref().map_or(Value::Null, SemanticValue::to_json))).collect();
        serde_json::json!({ "values": values })
    }

    pub fn from_json(value: &Value) -> Self {
        let values = value
            .get("values")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(path, value)| (path.clone(), SemanticValue::from_json(value)))
            .collect();
        Self { values }
    }

    pub fn get(&self, path: &str) -> Option<&SemanticValue> {
        self.values.get(path).and_then(Option::as_ref)
    }
}

fn strictly_equal(left: &Primitive, right: &Primitive) -> bool {
    match (left, right) {
        (Primitive::Bool(left), Primitive::Bool(right)) => left == right,
        (Primitive::Number(left), Primitive::Number(right)) => left == right,
        (Primitive::String(left), Primitive::String(right)) => left == right,
        _ => false,
    }
}

fn same_value_zero(left: &Primitive, right: &Primitive) -> bool {
    match (left, right) {
        (Primitive::Number(left), Primitive::Number(right)) => left == right || (left.is_nan() && right.is_nan()),
        _ => strictly_equal(left, right),
    }
}

pub fn matches_semantic_condition(semantics: &CardSemantics, condition: &Condition) -> bool {
    match condition {
        Condition::All(children) => children.iter().all(|child| matches_semantic_condition(semantics, child)),
        Condition::Any(children) => children.iter().any(|child| matches_semantic_condition(semantics, child)),
        Condition::In { path, values } => match semantics.get(path) {
            Some(SemanticValue::Primitive(value)) => values.iter().any(|candidate| same_value_zero(candidate, value)),
            _ => false,
        },
        Condition::Equals { path, equals } => match semantics.get(path) {
            Some(SemanticValue::Primitive(value)) => strictly_equal(value, equals),
            _ => false,
        },
    }
}

fn card_scalar_or_list(value: Option<&CardValue>, allow_holes: bool) -> std::result::Result<Option<SemanticValue>, ()> {
    let json = match value {
        None => return Ok(None),
        Some(CardValue::Asset(_)) => return Err(()),
        Some(CardValue::Json(json)) => json,
    };
    match json {
        Value::Null => Ok(None),
        Value::String(text) if text.is_empty() => Ok(None),
        Value::Array(entries) => {
            if allow_holes && entries.is_empty() {
                return Ok(None);
            }
            entries.iter().map(Primitive::from_json).collect::<Option<Vec<_>>>().map(|list| Some(SemanticValue::List(list))).ok_or(())
        }
        other => Primitive::from_json(other).map(|primitive| Some(SemanticValue::Primitive(primitive))).ok_or(()),
    }
}

fn source_value(card: &CardData, binding: &SemanticBinding) -> Result<Option<SemanticValue>> {
    match &binding.source {
        SourceValue::Value(value) => Ok(Some(value.clone())),
        SourceValue::Field(field) => card_scalar_or_list(card.get(field), true).map_err(|()| {
            Error::render(format!(
                "Cannot derive semantic path \"{}\": field \"{field}\" must contain a scalar or a list of scalar values.",
                binding.path
            ))
        }),
    }
}

fn transformed_value(value: Option<SemanticValue>, binding: &SemanticBinding) -> Result<Option<SemanticValue>> {
    let path = &binding.path;
    match &binding.transform {
        None => Ok(value),
        Some(SemanticTransform::UniqueList) => match value {
            None => Ok(Some(SemanticValue::List(Vec::new()))),
            Some(SemanticValue::Primitive(_)) => {
                Err(Error::render(format!("Cannot derive semantic path \"{path}\": unique-list requires a list source.")))
            }
            Some(SemanticValue::List(entries)) => {
                let mut unique: Vec<Primitive> = Vec::with_capacity(entries.len());
                for entry in entries {
                    if !unique.iter().any(|existing| same_value_zero(existing, &entry)) {
                        unique.push(entry);
                    }
                }
                Ok(Some(SemanticValue::List(unique)))
            }
        },
        Some(SemanticTransform::Lookup(values)) => match value {
            None => Ok(None),
            Some(SemanticValue::List(_)) => {
                Err(Error::render(format!("Cannot derive semantic path \"{path}\": lookup requires a scalar source.")))
            }
            Some(SemanticValue::Primitive(primitive)) => Ok(values.get(&primitive.to_js_string()).cloned().map(SemanticValue::Primitive)),
        },
        Some(SemanticTransform::Includes(needle)) => match value {
            None => Ok(Some(SemanticValue::Primitive(Primitive::Bool(false)))),
            Some(SemanticValue::Primitive(_)) => {
                Err(Error::render(format!("Cannot derive semantic path \"{path}\": includes requires a list source.")))
            }
            Some(SemanticValue::List(entries)) => Ok(Some(SemanticValue::Primitive(Primitive::Bool(
                entries.iter().any(|entry| matches!(entry, Primitive::String(text) if text == needle)),
            )))),
        },
    }
}

fn fallback_value(card: &CardData, semantics: &CardSemantics, binding: &SemanticBinding) -> Result<Option<SemanticValue>> {
    match &binding.fallback {
        None => Ok(None),
        Some(SemanticFallback::Value(value)) => Ok(Some(SemanticValue::Primitive(value.clone()))),
        Some(SemanticFallback::ListLength { minimum, source }) => {
            let referenced = match source {
                SourceReference::Path(path) => semantics.get(path).cloned(),
                SourceReference::Field(field) => card_scalar_or_list(card.get(field), false).map_err(|()| {
                    Error::render(format!(
                        "Cannot derive semantic path \"{}\": fallback field \"{field}\" must contain a scalar or a list of scalar values.",
                        binding.path
                    ))
                })?,
            };
            let minimum = minimum.unwrap_or(0.0);
            match referenced {
                None => Ok(Some(SemanticValue::Primitive(Primitive::Number(minimum)))),
                Some(SemanticValue::Primitive(_)) => Err(Error::render(format!(
                    "Cannot derive semantic path \"{}\": list-length fallback requires a list source.",
                    binding.path
                ))),
                Some(SemanticValue::List(entries)) => {
                    Ok(Some(SemanticValue::Primitive(Primitive::Number(minimum.max(entries.len() as f64)))))
                }
            }
        }
    }
}

fn should_use_fallback(value: Option<&SemanticValue>, binding: &SemanticBinding) -> bool {
    match value {
        None => true,
        Some(SemanticValue::Primitive(primitive)) => binding.fallback_values.iter().any(|fallback| strictly_equal(primitive, fallback)),
        Some(SemanticValue::List(_)) => false,
    }
}

pub fn derive_card_semantics(card: &CardData, template: &CardTemplate) -> Result<CardSemantics> {
    let mut semantics = CardSemantics::default();
    for binding in &template.bindings {
        let active = binding.when.as_ref().is_none_or(|when| matches_semantic_condition(&semantics, when));
        if !active {
            semantics.values.insert(binding.path.clone(), None);
            continue;
        }
        let mut value = source_value(card, binding)?;
        if should_use_fallback(value.as_ref(), binding) {
            value = fallback_value(card, &semantics, binding)?;
        }
        let transformed = transformed_value(value, binding)?;
        semantics.values.insert(binding.path.clone(), transformed);
    }
    Ok(semantics)
}

//! The synchronous half of the JavaScript `yugilife-core` API: validation, semantics, presentation,
//! rich text and layer-tree queries. Each operation takes JSON and returns `{ "value": ... }` or
//! `{ "error": { "kind", "message" } }`, where `kind` is `validation`, `range` or `render`, so the
//! host can throw the same error classes as before.
//!
//! Card templates and layer arrays are registered once (`registerTemplate`, `registerLayers`) and
//! referred to by key; the host keys them by object identity. Card asset values (images, which a
//! synchronous call cannot read) arrive as `{ "$asset": true }`: validation and semantics only
//! need to know an asset is there.

use indexmap::IndexMap;
use serde_json::{Map, Value, json};
use yugilife_core::Error;
use yugilife_core::assets::AssetSource;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::{OutputSize, resolve_raster_output_dimensions};
use yugilife_core::model::{
    CardTemplate, Condition, Layer, LayerBody, collect_layer_groups, collect_preset_targets, default_layer_visibility,
    default_preset_for_target, is_layer_visible, layer_paths, transform_gate,
};
use yugilife_core::presentation::{
    ResolvedCardPresentation, artwork_transforms_from_json, matches_presentation_gate, resolve_card_presentation,
};
use yugilife_core::rich_text::{
    RichTextDocument, grapheme_count, has_leading_authored_line_fit_split, has_leading_authored_line_fit_split_source, parse_rich_text,
    parse_rich_text_length, parse_rich_text_scale, plain_text_from_rich_text, rich_text_has_formatting, rich_text_line_lengths,
};
use yugilife_core::semantics::{CardSemantics, derive_card_semantics, matches_semantic_condition};
use yugilife_core::source_fields::layer_source_fields;
use yugilife_core::validation::{
    Record, compare_template_versions, create_card_from_template, merge_text_typography, template_version_is_valid, validate_card_data,
    validate_card_template, validate_color_preset_collection, validate_presentation_overrides, validate_template_manifest,
};

use crate::pack::{Pack, Reply};
use crate::session::{self, Registered};

/// The operations this module handles, for the dispatcher.
pub const OPERATIONS: &[&str] = &[
    "registerTemplate",
    "registerLayers",
    "release",
    "parseRichText",
    "plainTextFromRichText",
    "hasLeadingAuthoredLineFitSplit",
    "graphemeCount",
    "richTextLineLengths",
    "richTextHasFormatting",
    "parseRichTextLength",
    "parseRichTextScale",
    "deriveCardSemantics",
    "matchesSemanticCondition",
    "matchesPresentationGate",
    "resolveCardPresentation",
    "layerSourceFields",
    "layerPaths",
    "isLayerVisible",
    "defaultLayerVisibility",
    "collectLayerGroups",
    "defaultPresetForTarget",
    "collectPresetTargets",
    "textTypographies",
    "isTemplateVersion",
    "compareTemplateVersions",
    "validateTemplateManifest",
    "validateCardTemplate",
    "validateColorPresetCollection",
    "validatePresentationOverrides",
    "validateCardData",
    "createCardFromTemplate",
    "resolveRasterOutputDimensions",
];

enum Failure {
    Core(Error),
    Host(String),
}

impl From<Error> for Failure {
    fn from(error: Error) -> Self {
        Self::Core(error)
    }
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Host(message)
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Self::Host(message.to_owned())
    }
}

pub fn call(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let response = match run(pack.str("op").unwrap_or_default(), &pack.header) {
        Ok(value) => json!({ "value": value }),
        Err(Failure::Core(error)) => {
            let kind = match error {
                Error::Validation(_) => "validation",
                Error::Range(_) => "range",
                Error::Render(_) | Error::Aborted => "render",
            };
            json!({ "error": { "kind": kind, "message": error.message() } })
        }
        Err(Failure::Host(message)) => return Err(message),
    };
    Ok(Reply::default().finish(&response))
}

fn input<'a>(header: &'a Value, key: &str) -> Result<&'a Value, Failure> {
    header.get(key).ok_or_else(|| Failure::Host(format!("This operation needs \"{key}\".")))
}

fn text<'a>(header: &'a Value, key: &str) -> Result<&'a str, Failure> {
    input(header, key)?.as_str().ok_or_else(|| Failure::Host(format!("\"{key}\" must be a string.")))
}

fn template(header: &Value) -> Result<std::sync::Arc<CardTemplate>, Failure> {
    Ok(session::registered_template(text(header, "template")?)?)
}

fn layers(header: &Value) -> Result<std::sync::Arc<Vec<Layer>>, Failure> {
    Ok(session::registered_layers(text(header, "layers")?)?)
}

fn record(value: &Value, name: &str) -> Result<Record, Failure> {
    value.as_object().cloned().ok_or_else(|| Failure::Host(format!("\"{name}\" must be an object.")))
}

fn document(header: &Value) -> Result<RichTextDocument, Failure> {
    RichTextDocument::from_json(input(header, "document")?).ok_or_else(|| "\"document\" is not a rich-text document.".into())
}

fn semantics(header: &Value) -> Result<CardSemantics, Failure> {
    Ok(CardSemantics::from_json(input(header, "semantics")?))
}

/// Card data whose asset fields carry `{ "$asset": true }` in place of the asset.
fn card(header: &Value) -> Result<CardData, Failure> {
    let fields = input(header, "card")?.as_object().ok_or("\"card\" must be an object.")?;
    let mut card = CardData::default();
    for (name, value) in fields {
        let value = match value {
            Value::Object(object) if object.contains_key("$asset") => CardValue::Asset(AssetSource::Url(String::new())),
            other => CardValue::Json(other.clone()),
        };
        card.insert(name.clone(), value);
    }
    Ok(card)
}

fn card_json(card: &CardData) -> Value {
    Value::Object(card.fields().filter_map(|(name, value)| value.json().map(|value| (name.clone(), value.clone()))).collect::<Map<_, _>>())
}

fn condition(value: &Value) -> Result<Condition, Failure> {
    Condition::from_json(value).ok_or_else(|| "The semantic condition is malformed.".into())
}

fn run(operation: &str, header: &Value) -> Result<Value, Failure> {
    Ok(match operation {
        "registerTemplate" => {
            let template = CardTemplate::from_normalized(record(input(header, "value")?, "value")?);
            session::register(text(header, "key")?, Registered::Template(std::sync::Arc::new(template)));
            Value::Null
        }
        "registerLayers" => {
            let layers = input(header, "value")?.as_array().ok_or("\"value\" must be an array of layers.")?;
            session::register(text(header, "key")?, Registered::Layers(std::sync::Arc::new(layers.iter().map(Layer::from_json).collect())));
            Value::Null
        }
        "release" => {
            session::release(text(header, "key")?);
            Value::Null
        }
        "parseRichText" => parse_rich_text(text(header, "source")?).to_json(),
        "plainTextFromRichText" => Value::String(plain_text_from_rich_text(&document(header)?)),
        "hasLeadingAuthoredLineFitSplit" => Value::Bool(match header.get("source").and_then(Value::as_str) {
            Some(source) => has_leading_authored_line_fit_split_source(source),
            None => has_leading_authored_line_fit_split(&document(header)?),
        }),
        "graphemeCount" => json!(grapheme_count(text(header, "text")?)),
        "richTextLineLengths" => json!(rich_text_line_lengths(text(header, "source")?)),
        "richTextHasFormatting" => Value::Bool(rich_text_has_formatting(&document(header)?)),
        "parseRichTextLength" => {
            let allow_negative = header.get("allowNegative").and_then(Value::as_bool).unwrap_or(false);
            parse_rich_text_length(text(header, "value")?, allow_negative).map_or(Value::Null, |length| length.to_json())
        }
        "parseRichTextScale" => parse_rich_text_scale(text(header, "value")?).map_or(Value::Null, |scale| json!(scale)),
        "deriveCardSemantics" => derive_card_semantics(&card(header)?, &*template(header)?)?.to_json(),
        "matchesSemanticCondition" => {
            Value::Bool(matches_semantic_condition(&semantics(header)?, &condition(input(header, "condition")?)?))
        }
        "matchesPresentationGate" => {
            let gate = input(header, "gate")?;
            let when = gate.get("when").map(condition).transpose()?;
            let transforms = artwork_transforms_from_json(input(header, "transforms")?);
            Value::Bool(matches_presentation_gate(
                &semantics(header)?,
                &transforms,
                when.as_ref(),
                transform_gate(gate.get("whenTransforms")).as_ref(),
            ))
        }
        "resolveCardPresentation" => {
            let overrides = header.get("overrides").filter(|overrides| !overrides.is_null());
            resolve_card_presentation(&*template(header)?, semantics(header)?, overrides)?.to_json()
        }
        "layerSourceFields" => {
            // The resolver reads only the semantics and the artwork transforms of a presentation.
            let presentation = ResolvedCardPresentation {
                semantics: semantics(header)?,
                artwork_transforms: artwork_transforms_from_json(input(header, "transforms")?),
                ..ResolvedCardPresentation::default()
            };
            let layer = Layer::from_json(input(header, "layer")?);
            json!(layer_source_fields(&*template(header)?, &layer, &presentation))
        }
        "layerPaths" => {
            let drawable = header.get("drawable").and_then(Value::as_bool).unwrap_or(false);
            json!(layer_paths(&layers(header)?, drawable))
        }
        "isLayerVisible" => {
            let visibility: IndexMap<String, bool> = input(header, "visibility")?
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(id, visible)| visible.as_bool().map(|visible| (id.clone(), visible)))
                .collect();
            Value::Bool(is_layer_visible(&Layer::from_json(input(header, "layer")?), &visibility))
        }
        "defaultLayerVisibility" => Value::Object(
            default_layer_visibility(&*template(header)?).into_iter().map(|(id, visible)| (id, Value::Bool(visible))).collect(),
        ),
        "collectLayerGroups" => {
            let fallback = header.get("fallbackLabel").and_then(Value::as_str).unwrap_or("Other");
            Value::Array(collect_layer_groups(&*template(header)?, fallback).iter().map(|group| group.to_json()).collect())
        }
        "defaultPresetForTarget" => {
            default_preset_for_target(&*template(header)?, text(header, "target")?).map_or(Value::Null, Value::String)
        }
        "collectPresetTargets" => json!(collect_preset_targets(&*template(header)?)),
        "textTypographies" => {
            // The layer's own typography, then each semantic style merged over it.
            let layer = Layer::from_json(input(header, "layer")?);
            let LayerBody::Text(text) = &layer.body else {
                return Err("\"layer\" must be a text layer.".into());
            };
            let mut typographies = vec![Value::Object(text.typography.clone())];
            for style in &text.semantic_styles {
                let merged = merge_text_typography(&text.typography, &[style.typography.as_ref()]).map_err(Error::render)?;
                typographies.push(Value::Object(merged));
            }
            Value::Array(typographies)
        }
        "isTemplateVersion" => Value::Bool(template_version_is_valid(text(header, "value")?)),
        "compareTemplateVersions" => {
            let difference = compare_template_versions(text(header, "left")?, text(header, "right")?);
            // JSON has no NaN; the host reads null as NaN.
            if difference.is_nan() { Value::Null } else { yugilife_core::validation::number_value(difference) }
        }
        "validateTemplateManifest" => {
            validate_template_manifest(input(header, "input")?)?;
            Value::Null
        }
        "validateCardTemplate" => Value::Object(validate_card_template(input(header, "input")?)?),
        "validateColorPresetCollection" => {
            validate_color_preset_collection(input(header, "input")?)?;
            Value::Null
        }
        "validatePresentationOverrides" => {
            validate_presentation_overrides(input(header, "input")?, &template(header)?.json)?;
            Value::Null
        }
        "validateCardData" => {
            validate_card_data(&card(header)?, &template(header)?.json)?;
            Value::Null
        }
        "createCardFromTemplate" => card_json(&create_card_from_template(&template(header)?.json)),
        "resolveRasterOutputDimensions" => {
            let dimensions = input(header, "dimensions")?;
            let side = |key: &str| dimensions.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN);
            let size = match header.get("size") {
                None => None,
                Some(Value::Object(size)) => {
                    let mut keys = size.keys();
                    let number = |value: &Value| value.as_f64().unwrap_or(f64::NAN);
                    match (keys.next().map(String::as_str), keys.next()) {
                        (Some("scale"), None) => Some(OutputSize::Scale(number(&size["scale"]))),
                        (Some("width"), None) => Some(OutputSize::Width(number(&size["width"]))),
                        (Some("height"), None) => Some(OutputSize::Height(number(&size["height"]))),
                        _ => {
                            return Err(Error::range("Raster output size must specify exactly one of height, scale, or width.").into());
                        }
                    }
                }
                Some(_) => return Err(Error::range("Raster output size must be an object.").into()),
            };
            let (width, height) = resolve_raster_output_dimensions(side("width"), side("height"), size)?;
            json!({ "width": width, "height": height })
        }
        other => return Err(format!("Unknown operation \"{other}\".").into()),
    })
}

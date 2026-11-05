use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::card::{describe_field_value_violation, initial_field_value};
use super::normalize::normalize_card_template_authoring;
use super::shape::{
    Record, ShapeResult, assert_no_unknown_keys, fail, finite_number, is_integer, json_stringify, non_empty_string, optional_boolean,
    optional_string, positive_number, record, region, string_array, string_of,
};
use super::svg::validate_svg_element_shape;
use super::typography::{TEXT_TYPOGRAPHY_KEYS, validate_text_typography_usage, validate_typography, validate_typography_patch};
use crate::card::CardValue;

const CARD_FIELD_KEYS: &[&str] = &[
    "automaticFitLayer",
    "automaticWhen",
    "advancedOnly",
    "defaultValue",
    "kind",
    "label",
    "max",
    "maxItems",
    "maxLength",
    "min",
    "name",
    "options",
    "required",
    "suggestions",
];
const CARD_FIELD_KINDS: &[&str] = &["text", "multiline", "number", "text-list", "number-pair", "boolean", "image"];
const LAYER_BASE_KEYS: &[&str] = &["defaultVisible", "editorVisible", "group", "id", "kind", "label"];
const CARD_TEMPLATE_KEYS: &[&str] = &[
    "cardFields",
    "dimensions",
    "fitProfileSets",
    "fonts",
    "layers",
    "masks",
    "presentationRules",
    "schemaVersion",
    "semanticBindings",
    "textDefaults",
    "typographyPresets",
];

fn core_layer_keys(kind: &str) -> Option<Vec<&'static str>> {
    let extra: &[&str] = match kind {
        "artwork" => &["field", "fit", "maskField", "maskChannel", "placementRegion", "region", "transformId", "transformMode"],
        "canvas" => &["options", "region", "renderer"],
        "group" => &["layers"],
        "image" => &["assetId", "region"],
        "raster" => &["assetId", "defaultPreset", "options", "presetTarget", "region", "renderer", "sourceRegion"],
        "repeated-image" => &["assetId", "field", "offset", "region"],
        "svg" => &["element"],
        "text" => &[
            "fallbackField",
            "field",
            "format",
            "pairIndex",
            "position",
            "prefix",
            "semanticPath",
            "semanticStyles",
            "separator",
            "suffix",
            "typography",
        ],
        _ => return None,
    };
    Some(LAYER_BASE_KEYS.iter().chain(extra).copied().collect())
}

fn semantic_primitive(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    match value {
        Some(Value::Bool(_) | Value::Number(_) | Value::String(_)) => Ok(()),
        _ => fail(format!("{location} must be a boolean, number, or string.")),
    }
}

fn semantic_primitive_array<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<&'a Vec<Value>> {
    match value {
        Some(Value::Array(entries)) if !entries.is_empty() => {
            for (index, entry) in entries.iter().enumerate() {
                semantic_primitive(Some(entry), &format!("{location}[{index}]"))?;
            }
            Ok(entries)
        }
        _ => fail(format!("{location} must be a non-empty array of booleans, numbers, or strings.")),
    }
}

pub fn validate_semantic_condition(value: Option<&Value>, location: &str, paths: &HashSet<String>) -> ShapeResult<()> {
    let condition = record(value, location)?;
    for combinator in ["all", "any"] {
        if condition.get(combinator).is_some() {
            assert_no_unknown_keys(condition, &[combinator], location)?;
            let Some(Value::Array(children)) = condition.get(combinator) else {
                return fail(format!("{location}.{combinator} must be a non-empty array."));
            };
            if children.is_empty() {
                return fail(format!("{location}.{combinator} must be a non-empty array."));
            }
            for (index, child) in children.iter().enumerate() {
                validate_semantic_condition(Some(child), &format!("{location}.{combinator}[{index}]"), paths)?;
            }
            return Ok(());
        }
    }
    if condition.get("in").is_some() {
        assert_no_unknown_keys(condition, &["in", "path"], location)?;
        let path = non_empty_string(condition.get("path"), &format!("{location}.path"))?;
        if !paths.contains(path) {
            return fail(format!("{location}.path \"{path}\" must reference a declared semantic binding."));
        }
        let values = semantic_primitive_array(condition.get("in"), &format!("{location}.in"))?;
        let mut seen = Vec::<&Value>::new();
        for value in values {
            if seen.iter().any(|previous| same_primitive(previous, value)) {
                return fail(format!("{location}.in must not contain duplicate values."));
            }
            seen.push(value);
        }
        return Ok(());
    }
    assert_no_unknown_keys(condition, &["equals", "path"], location)?;
    let path = non_empty_string(condition.get("path"), &format!("{location}.path"))?;
    if !paths.contains(path) {
        return fail(format!("{location}.path \"{path}\" must reference a declared semantic binding."));
    }
    semantic_primitive(condition.get("equals"), &format!("{location}.equals"))
}

fn same_primitive(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        _ => left == right,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ValueKind {
    List,
    Scalar,
    ScalarOrList,
}

impl ValueKind {
    fn name(self) -> &'static str {
        match self {
            Self::List => "list",
            Self::Scalar => "scalar",
            Self::ScalarOrList => "scalar-or-list",
        }
    }
}

fn semantic_field_kind(field: &Record, location: &str) -> ShapeResult<ValueKind> {
    match field.get("kind").and_then(Value::as_str).unwrap_or("undefined") {
        "text-list" | "number-pair" => Ok(ValueKind::List),
        "multiline" => Ok(ValueKind::ScalarOrList),
        "text" | "number" | "boolean" => Ok(ValueKind::Scalar),
        _ => fail(format!("{location} must reference a scalar or list card field.")),
    }
}

fn validate_semantic_source(value: Option<&Value>, location: &str, fields: &HashMap<String, &Record>) -> ShapeResult<ValueKind> {
    let source = record(value, location)?;
    assert_no_unknown_keys(source, &["field", "value"], location)?;
    let has_field = source.get("field").is_some();
    let has_value = source.get("value").is_some();
    if has_field == has_value {
        return fail(format!("{location} must declare exactly one of field or value."));
    }
    if has_value {
        return match source.get("value") {
            Some(Value::Array(_)) => {
                semantic_primitive_array(source.get("value"), &format!("{location}.value"))?;
                Ok(ValueKind::List)
            }
            constant => {
                semantic_primitive(constant, &format!("{location}.value"))?;
                Ok(ValueKind::Scalar)
            }
        };
    }
    let field_name = non_empty_string(source.get("field"), &format!("{location}.field"))?;
    let Some(field) = fields.get(field_name) else {
        return fail(format!("{location}.field references undeclared card field \"{field_name}\"."));
    };
    semantic_field_kind(field, &format!("{location}.field"))
}

fn validate_semantic_source_reference(
    value: Option<&Value>,
    location: &str,
    fields: &HashMap<String, &Record>,
    paths: &HashMap<String, ValueKind>,
) -> ShapeResult<ValueKind> {
    let source = record(value, location)?;
    assert_no_unknown_keys(source, &["field", "path"], location)?;
    let has_field = source.get("field").is_some();
    let has_path = source.get("path").is_some();
    if has_field == has_path {
        return fail(format!("{location} must declare exactly one of field or path."));
    }
    if has_path {
        let path = non_empty_string(source.get("path"), &format!("{location}.path"))?;
        return match paths.get(path) {
            Some(kind) => Ok(*kind),
            None => fail(format!("{location}.path \"{path}\" must reference a declared semantic binding.")),
        };
    }
    let field_name = non_empty_string(source.get("field"), &format!("{location}.field"))?;
    let Some(field) = fields.get(field_name) else {
        return fail(format!("{location}.field references undeclared card field \"{field_name}\"."));
    };
    semantic_field_kind(field, &format!("{location}.field"))
}

fn validate_semantic_transform(value: Option<&Value>, location: &str, source_kind: ValueKind) -> ShapeResult<ValueKind> {
    let transform = record(value, location)?;
    assert_no_unknown_keys(transform, &["kind", "value", "values"], location)?;
    let kind = non_empty_string(transform.get("kind"), &format!("{location}.kind"))?;
    if !["unique-list", "includes", "lookup"].contains(&kind) {
        return fail(format!("{location}.kind \"{kind}\" is unsupported."));
    }
    if kind == "includes" {
        if source_kind != ValueKind::List {
            return fail(format!("{location} kind \"includes\" requires a list source."));
        }
        non_empty_string(transform.get("value"), &format!("{location}.value"))?;
        return Ok(ValueKind::Scalar);
    }
    if kind == "lookup" {
        if source_kind != ValueKind::Scalar {
            return fail(format!("{location} kind \"lookup\" requires a scalar source."));
        }
        if transform.get("value").is_some() {
            return fail(format!("{location}.value is not allowed for lookup."));
        }
        let values = record(transform.get("values"), &format!("{location}.values"))?;
        if values.is_empty() {
            return fail(format!("{location}.values must not be empty."));
        }
        for (key, mapped) in values {
            if key.is_empty() {
                return fail(format!("{location}.values contains an empty source key."));
            }
            semantic_primitive(Some(mapped), &format!("{location}.values.{key}"))?;
        }
        return Ok(ValueKind::Scalar);
    }
    if source_kind != ValueKind::List {
        return fail(format!("{location} kind \"unique-list\" requires a list source."));
    }
    if transform.get("values").is_some() {
        return fail(format!("{location}.values is not allowed for {kind}."));
    }
    if transform.get("value").is_some() {
        return fail(format!("{location}.value is not allowed for unique-list."));
    }
    Ok(ValueKind::List)
}

fn validate_semantic_fallback(
    value: Option<&Value>,
    location: &str,
    fields: &HashMap<String, &Record>,
    paths: &HashMap<String, ValueKind>,
) -> ShapeResult<ValueKind> {
    let fallback = record(value, location)?;
    assert_no_unknown_keys(fallback, &["kind", "minimum", "source", "value"], location)?;
    let kind = non_empty_string(fallback.get("kind"), &format!("{location}.kind"))?;
    if !["list-length", "value"].contains(&kind) {
        return fail(format!("{location}.kind \"{kind}\" is unsupported."));
    }
    if kind == "value" {
        if fallback.get("minimum").is_some() || fallback.get("source").is_some() {
            return fail(format!("{location} value fallbacks may only declare kind and value."));
        }
        semantic_primitive(fallback.get("value"), &format!("{location}.value"))?;
        return Ok(ValueKind::Scalar);
    }
    if fallback.get("value").is_some() {
        return fail(format!("{location}.value is only allowed for value fallbacks."));
    }
    if fallback.get("minimum").is_some() {
        finite_number(fallback.get("minimum"), &format!("{location}.minimum"))?;
    }
    let source_kind = validate_semantic_source_reference(fallback.get("source"), &format!("{location}.source"), fields, paths)?;
    if source_kind != ValueKind::List {
        return fail(format!("{location}.source must reference a list value."));
    }
    Ok(ValueKind::Scalar)
}

fn validate_semantic_bindings(value: Option<&Value>, fields: &HashMap<String, &Record>) -> ShapeResult<HashMap<String, ValueKind>> {
    let location = "semanticBindings";
    let container = record(value, location)?;
    assert_no_unknown_keys(container, &["bindings"], location)?;
    let Some(Value::Array(bindings)) = container.get("bindings") else {
        return fail(format!("{location}.bindings must be a non-empty array."));
    };
    if bindings.is_empty() {
        return fail(format!("{location}.bindings must be a non-empty array."));
    }
    let mut declared = HashSet::new();
    for (index, entry) in bindings.iter().enumerate() {
        let binding_location = format!("{location}[{index}]");
        let binding = record(Some(entry), &binding_location)?;
        assert_no_unknown_keys(binding, &["fallback", "fallbackValues", "path", "source", "transform", "when"], &binding_location)?;
        let path = non_empty_string(binding.get("path"), &format!("{binding_location}.path"))?;
        if !declared.insert(path.to_owned()) {
            return fail(format!("{location} contains duplicate path \"{path}\"."));
        }
    }
    let mut available: HashMap<String, ValueKind> = HashMap::new();
    let mut available_order: Vec<String> = Vec::new();
    for (index, entry) in bindings.iter().enumerate() {
        let binding_location = format!("{location}[{index}]");
        let binding = record(Some(entry), &binding_location)?;
        let source_kind = validate_semantic_source(binding.get("source"), &format!("{binding_location}.source"), fields)?;
        if binding.get("fallback").is_some() {
            let fallback_kind =
                validate_semantic_fallback(binding.get("fallback"), &format!("{binding_location}.fallback"), fields, &available)?;
            if fallback_kind != source_kind {
                return fail(format!(
                    "{binding_location}.fallback produces a {} value but its source is {}.",
                    fallback_kind.name(),
                    source_kind.name()
                ));
            }
        }
        if binding.get("fallbackValues").is_some() {
            if source_kind != ValueKind::Scalar {
                return fail(format!("{binding_location}.fallbackValues requires a scalar source."));
            }
            semantic_primitive_array(binding.get("fallbackValues"), &format!("{binding_location}.fallbackValues"))?;
        }
        if binding.get("when").is_some() {
            let paths: HashSet<String> = available_order.iter().cloned().collect();
            validate_semantic_condition(binding.get("when"), &format!("{binding_location}.when"), &paths)?;
        }
        let output_kind = match binding.get("transform") {
            None => source_kind,
            Some(transform) => validate_semantic_transform(Some(transform), &format!("{binding_location}.transform"), source_kind)?,
        };
        let path = string_of(binding.get("path"));
        if !available.contains_key(&path) {
            available_order.push(path.clone());
        }
        available.insert(path, output_kind);
    }
    Ok(available)
}

struct LayerRegistry<'a> {
    ids: Vec<String>,
    id_set: HashSet<String>,
    fields: &'a HashMap<String, &'a Record>,
    text_layer_ids: HashSet<String>,
    asset_layer_ids: HashSet<String>,
    options_layer_ids: HashSet<String>,
    non_maskable_layer_ids: HashSet<String>,
    region_layer_ids: HashSet<String>,
    semantic_paths: &'a HashSet<String>,
    transform_ids: &'a HashSet<String>,
}

impl LayerRegistry<'_> {
    fn referenced_field(&self, name: Option<&Value>, location: &str) -> ShapeResult<&Record> {
        let field = non_empty_string(name, location)?;
        match self.fields.get(field) {
            Some(definition) => Ok(definition),
            None => fail(format!("{location} references card field \"{field}\", which the template does not declare.")),
        }
    }

    fn validate_layer(&mut self, value: &Value, location: &str) -> ShapeResult<()> {
        let layer = record(Some(value), location)?;
        let id = non_empty_string(layer.get("id"), &format!("{location}.id"))?.to_owned();
        let kind = non_empty_string(layer.get("kind"), &format!("{location}.kind"))?.to_owned();
        if let Some(allowed) = core_layer_keys(&kind) {
            assert_no_unknown_keys(layer, &allowed, location)?;
        }
        optional_string(layer.get("label"), &format!("{location}.label"))?;
        optional_string(layer.get("group"), &format!("{location}.group"))?;
        optional_boolean(layer.get("defaultVisible"), &format!("{location}.defaultVisible"))?;
        optional_boolean(layer.get("editorVisible"), &format!("{location}.editorVisible"))?;
        if self.id_set.contains(&id) {
            return fail(format!("Duplicate layer ID \"{id}\" at {location}."));
        }
        self.id_set.insert(id.clone());
        self.ids.push(id.clone());
        let kind = kind.as_str();
        if kind == "text" {
            self.text_layer_ids.insert(id.clone());
        }
        if ["image", "repeated-image", "raster"].contains(&kind) {
            self.asset_layer_ids.insert(id.clone());
        }
        if ["artwork", "canvas", "image", "raster", "repeated-image"].contains(&kind) {
            self.region_layer_ids.insert(id.clone());
        }
        if kind == "raster" || kind == "canvas" {
            self.options_layer_ids.insert(id.clone());
        }
        if kind == "text" || kind == "svg" {
            self.non_maskable_layer_ids.insert(id.clone());
        }
        if ["image", "repeated-image", "artwork", "raster", "canvas"].contains(&kind) {
            region(layer.get("region"), &format!("{location}.region"))?;
        }
        if kind == "image" || kind == "repeated-image" {
            non_empty_string(layer.get("assetId"), &format!("{location}.assetId"))?;
        }
        if kind == "repeated-image" {
            let field = self.referenced_field(layer.get("field"), &format!("{location}.field"))?;
            if field.get("kind").and_then(Value::as_str) != Some("number") {
                return fail(format!("{location}.field must reference a number field."));
            }
            let offset_location = format!("{location}.offset");
            let offset = record(layer.get("offset"), &offset_location)?;
            assert_no_unknown_keys(offset, &["x", "y"], &offset_location)?;
            finite_number(offset.get("x"), &format!("{offset_location}.x"))?;
            finite_number(offset.get("y"), &format!("{offset_location}.y"))?;
        }
        if kind == "artwork" {
            let field = self.referenced_field(layer.get("field"), &format!("{location}.field"))?;
            if field.get("kind").and_then(Value::as_str) != Some("image") {
                return fail(format!("{location}.field must reference an image field."));
            }
            if layer.get("fit").is_some() && !matches!(layer.get("fit").and_then(Value::as_str), Some("stretch" | "width")) {
                return fail(format!("{location}.fit must be \"stretch\" or \"width\"."));
            }
            if layer.get("maskField").is_some() {
                let mask_field = self.referenced_field(layer.get("maskField"), &format!("{location}.maskField"))?;
                if mask_field.get("kind").and_then(Value::as_str) != Some("image") {
                    return fail(format!("{location}.maskField must reference an image field."));
                }
            }
            if layer.get("maskChannel").is_some()
                && !matches!(layer.get("maskChannel").and_then(Value::as_str), Some("alpha" | "luminance"))
            {
                return fail(format!("{location}.maskChannel must be \"alpha\" or \"luminance\"."));
            }
            if layer.get("placementRegion").is_some() {
                region(layer.get("placementRegion"), &format!("{location}.placementRegion"))?;
            }
            optional_string(layer.get("transformId"), &format!("{location}.transformId"))?;
            if layer.get("transformMode").is_some() {
                non_empty_string(layer.get("transformMode"), &format!("{location}.transformMode"))?;
            }
        }
        if kind == "raster" || kind == "canvas" {
            non_empty_string(layer.get("renderer"), &format!("{location}.renderer"))?;
            if layer.get("options").is_some() {
                record(layer.get("options"), &format!("{location}.options"))?;
            }
        }
        if kind == "raster" {
            optional_string(layer.get("assetId"), &format!("{location}.assetId"))?;
            optional_string(layer.get("defaultPreset"), &format!("{location}.defaultPreset"))?;
            optional_string(layer.get("presetTarget"), &format!("{location}.presetTarget"))?;
            if layer.get("sourceRegion").is_some() {
                region(layer.get("sourceRegion"), &format!("{location}.sourceRegion"))?;
            }
        }
        if kind == "text" {
            self.validate_text_layer(layer, location)?;
        }
        if kind == "svg" {
            match layer.get("element") {
                Some(element) => validate_svg_element_shape(element, &format!("{location}.element"))?,
                None => return fail(format!("{location}.element must be an object.")),
            }
        }
        if kind == "group" {
            let Some(Value::Array(layers)) = layer.get("layers") else {
                return fail(format!("{location}.layers must be an array."));
            };
            for (index, child) in layers.iter().enumerate() {
                self.validate_layer(child, &format!("{location}.layers[{index}]"))?;
            }
        }
        Ok(())
    }

    fn validate_text_layer(&self, layer: &Record, location: &str) -> ShapeResult<()> {
        let mut source_field: Option<&Record> = None;
        if layer.get("field").is_some() {
            let field = self.referenced_field(layer.get("field"), &format!("{location}.field"))?;
            if field.get("kind").and_then(Value::as_str) == Some("image") {
                return fail(format!("{location}.field must reference a text-serializable field."));
            }
            source_field = Some(field);
        } else if layer.get("semanticPath").is_none() {
            return fail(format!("{location} must declare field or semanticPath."));
        }
        if layer.get("fallbackField").is_some() {
            let fallback = self.referenced_field(layer.get("fallbackField"), &format!("{location}.fallbackField"))?;
            if fallback.get("kind").and_then(Value::as_str) == Some("image") {
                return fail(format!("{location}.fallbackField must reference a text-serializable field."));
            }
        }
        for key in ["prefix", "separator", "suffix"] {
            optional_string(layer.get(key), &format!("{location}.{key}"))?;
        }
        if layer.get("semanticPath").is_some() {
            let path = non_empty_string(layer.get("semanticPath"), &format!("{location}.semanticPath"))?;
            if !self.semantic_paths.contains(path) {
                return fail(format!("{location}.semanticPath \"{path}\" must reference a declared semantic binding."));
            }
        }
        let format = layer.get("format");
        if format.is_some()
            && !format.and_then(Value::as_str).is_some_and(|format| ["plain", "lines", "pair", "type-list"].contains(&format))
        {
            return fail(format!("{location}.format is unsupported."));
        }
        let format = format.and_then(Value::as_str);
        let source_kind = source_field.and_then(|field| field.get("kind")).and_then(Value::as_str);
        if format == Some("pair") && source_kind != Some("number-pair") {
            return fail(format!("{location}.format \"pair\" requires a number-pair field."));
        }
        if format == Some("type-list") && source_kind != Some("text-list") {
            return fail(format!("{location}.format \"type-list\" requires a text-list field."));
        }
        if let Some(pair_index) = layer.get("pairIndex") {
            if format != Some("pair") {
                return fail(format!("{location}.pairIndex requires format \"pair\"."));
            }
            if !matches!(pair_index.as_f64(), Some(value) if value == 0.0 || value == 1.0) {
                return fail(format!("{location}.pairIndex must be 0 or 1."));
            }
        }
        let position_location = format!("{location}.position");
        let position = record(layer.get("position"), &position_location)?;
        assert_no_unknown_keys(position, &["x", "y"], &position_location)?;
        finite_number(position.get("x"), &format!("{position_location}.x"))?;
        finite_number(position.get("y"), &format!("{position_location}.y"))?;
        let typography_location = format!("{location}.typography");
        validate_typography(layer.get("typography"), &typography_location)?;
        let typography = record(layer.get("typography"), &typography_location)?;
        validate_text_typography_usage(typography, format, &typography_location)?;
        if let Some(styles) = layer.get("semanticStyles") {
            let Value::Array(styles) = styles else {
                return fail(format!("{location}.semanticStyles must be a non-empty array."));
            };
            if styles.is_empty() {
                return fail(format!("{location}.semanticStyles must be a non-empty array."));
            }
            let mut style_ids = HashSet::new();
            for (index, value) in styles.iter().enumerate() {
                let style_location = format!("{location}.semanticStyles[{index}]");
                let style = record(Some(value), &style_location)?;
                assert_no_unknown_keys(style, &["id", "label", "typography", "when", "whenTransforms"], &style_location)?;
                let style_id = non_empty_string(style.get("id"), &format!("{style_location}.id"))?;
                if !style_ids.insert(style_id.to_owned()) {
                    return fail(format!("{location}.semanticStyles contains duplicate ID \"{style_id}\"."));
                }
                non_empty_string(style.get("label"), &format!("{style_location}.label"))?;
                if style.get("when").is_none() && style.get("whenTransforms").is_none() {
                    return fail(format!("{style_location} must declare when or whenTransforms."));
                }
                if style.get("when").is_some() {
                    validate_semantic_condition(style.get("when"), &format!("{style_location}.when"), self.semantic_paths)?;
                }
                if style.get("whenTransforms").is_some() {
                    validate_transform_mode_gate(
                        style.get("whenTransforms"),
                        &format!("{style_location}.whenTransforms"),
                        self.transform_ids,
                    )?;
                }
                validate_typography_patch(style.get("typography"), typography, format, &format!("{style_location}.typography"))?;
            }
        }
        Ok(())
    }
}

fn validate_canvas_masks(value: Option<&Value>) -> ShapeResult<Vec<(String, Option<String>)>> {
    let location = "masks";
    let Some(Value::Array(entries)) = value else {
        return fail(format!("{location} must be a non-empty array."));
    };
    if entries.is_empty() {
        return fail(format!("{location} must be a non-empty array."));
    }
    let mut masks: Vec<(String, Option<String>)> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let mask_location = format!("{location}[{index}]");
        let mask = record(Some(entry), &mask_location)?;
        assert_no_unknown_keys(mask, &["assetId", "channel", "coverageLayerId", "id", "invert"], &mask_location)?;
        let id = non_empty_string(mask.get("id"), &format!("{mask_location}.id"))?;
        if masks.iter().any(|(existing, _)| existing == id) {
            return fail(format!("{location} contains duplicate ID \"{id}\"."));
        }
        let coverage = match mask.get("coverageLayerId") {
            None => None,
            Some(value) => Some(non_empty_string(Some(value), &format!("{mask_location}.coverageLayerId"))?.to_owned()),
        };
        masks.push((id.to_owned(), coverage));
        non_empty_string(mask.get("assetId"), &format!("{mask_location}.assetId"))?;
        if mask.get("channel").is_some() && !matches!(mask.get("channel").and_then(Value::as_str), Some("alpha" | "luminance")) {
            return fail(format!("{mask_location}.channel must be \"alpha\" or \"luminance\"."));
        }
        optional_boolean(mask.get("invert"), &format!("{mask_location}.invert"))?;
    }
    Ok(masks)
}

fn assert_coverage_renders_first(
    mask_id: &str,
    layer_id: &str,
    location: &str,
    coverage_layers: &[(String, Option<String>)],
    order: &HashMap<String, usize>,
) -> ShapeResult<()> {
    let Some(coverage) = coverage_layers.iter().find(|(id, _)| id == mask_id).and_then(|(_, coverage)| coverage.as_ref()) else {
        return Ok(());
    };
    let (Some(coverage_order), Some(target_order)) = (order.get(coverage), order.get(layer_id)) else {
        return Ok(());
    };
    if coverage_order >= target_order {
        return fail(format!(
            "{location} assigns mask \"{mask_id}\" to layer \"{layer_id}\", but its coverage layer \"{coverage}\" does not render before that layer."
        ));
    }
    Ok(())
}

fn collect_artwork_transform_ids(layers: Option<&Value>, into: &mut HashSet<String>) {
    let Some(Value::Array(layers)) = layers else {
        return;
    };
    for value in layers {
        let Value::Object(layer) = value else {
            continue;
        };
        if layer.get("kind").and_then(Value::as_str) == Some("artwork") {
            let transform = layer.get("transformId").or_else(|| layer.get("id"));
            if let Some(Value::String(id)) = transform
                && !id.is_empty()
            {
                into.insert(id.clone());
            }
        }
        if layer.get("kind").and_then(Value::as_str) == Some("group") {
            collect_artwork_transform_ids(layer.get("layers"), into);
        }
    }
}

fn validate_transform_mode_gate(value: Option<&Value>, location: &str, transform_ids: &HashSet<String>) -> ShapeResult<()> {
    let gate = record(value, location)?;
    if gate.is_empty() {
        return fail(format!("{location} must not be empty."));
    }
    for (transform_id, mode) in gate {
        if !transform_ids.contains(transform_id) {
            return fail(format!("{location} references unknown artwork transform \"{transform_id}\"."));
        }
        if !mode.is_null() {
            non_empty_string(Some(mode), &format!("{location}.{transform_id}"))?;
        }
    }
    Ok(())
}

fn validate_card_field(value: &Value, location: &str, names: &mut HashSet<String>) -> ShapeResult<()> {
    let field = record(Some(value), location)?;
    assert_no_unknown_keys(field, CARD_FIELD_KEYS, location)?;
    let name = non_empty_string(field.get("name"), &format!("{location}.name"))?;
    if !names.insert(name.to_owned()) {
        return fail(format!("Duplicate card field \"{name}\" at {location}."));
    }
    let kind = non_empty_string(field.get("kind"), &format!("{location}.kind"))?;
    if !CARD_FIELD_KINDS.contains(&kind) {
        return fail(format!("{location}.kind \"{kind}\" is unsupported."));
    }
    non_empty_string(field.get("label"), &format!("{location}.label"))?;
    if field.get("automaticFitLayer").is_some() {
        non_empty_string(field.get("automaticFitLayer"), &format!("{location}.automaticFitLayer"))?;
    }
    optional_boolean(field.get("advancedOnly"), &format!("{location}.advancedOnly"))?;
    optional_boolean(field.get("required"), &format!("{location}.required"))?;
    if kind == "number" || kind == "number-pair" {
        for key in ["min", "max"] {
            if field.get(key).is_some() {
                finite_number(field.get(key), &format!("{location}.{key}"))?;
            }
        }
        if let (Some(minimum), Some(maximum)) = (field.get("min").and_then(Value::as_f64), field.get("max").and_then(Value::as_f64))
            && minimum > maximum
        {
            return fail(format!("{location}.min must not exceed {location}.max."));
        }
    } else if field.get("min").is_some() || field.get("max").is_some() {
        return fail(format!("{location} may only use min and max on numeric fields."));
    }
    if field.get("maxLength").is_some() {
        if !["text", "multiline", "text-list"].contains(&kind) {
            return fail(format!("{location}.maxLength only applies to text fields."));
        }
        positive_number(field.get("maxLength"), &format!("{location}.maxLength"))?;
    }
    if field.get("maxItems").is_some() {
        if !["text-list", "multiline"].contains(&kind) {
            return fail(format!("{location}.maxItems only applies to list fields."));
        }
        positive_number(field.get("maxItems"), &format!("{location}.maxItems"))?;
    }
    if field.get("options").is_some() {
        if kind != "text" && kind != "text-list" {
            return fail(format!("{location}.options only applies to text and text-list fields."));
        }
        let options = string_array(field.get("options"), &format!("{location}.options"), true)?;
        if options.is_empty() {
            return fail(format!("{location}.options must not be empty."));
        }
    }
    if let Some(suggestions) = field.get("suggestions") {
        if kind != "text" {
            return fail(format!("{location}.suggestions only applies to text fields."));
        }
        if field.get("options").is_some() {
            return fail(format!("{location} cannot declare both options and suggestions."));
        }
        let Value::Array(suggestions) = suggestions else {
            return fail(format!("{location}.suggestions must be a non-empty array."));
        };
        if suggestions.is_empty() {
            return fail(format!("{location}.suggestions must be a non-empty array."));
        }
        let mut values = HashSet::new();
        for (index, value) in suggestions.iter().enumerate() {
            let suggestion_location = format!("{location}.suggestions[{index}]");
            let suggestion = record(Some(value), &suggestion_location)?;
            assert_no_unknown_keys(suggestion, &["label", "value"], &suggestion_location)?;
            let suggestion_value = non_empty_string(suggestion.get("value"), &format!("{suggestion_location}.value"))?;
            if !values.insert(suggestion_value.to_owned()) {
                return fail(format!(
                    "{location}.suggestions contains duplicate value {}.",
                    json_stringify(Some(&Value::String(suggestion_value.to_owned())))
                ));
            }
            if suggestion.get("label").is_some() {
                non_empty_string(suggestion.get("label"), &format!("{suggestion_location}.label"))?;
            }
        }
    }
    let subject = if field.get("defaultValue").is_none() { location.to_owned() } else { format!("{location}.defaultValue") };
    let initial = CardValue::Json(initial_field_value(field));
    if let Some(violation) = describe_field_value_violation(field, Some(&initial), &subject, false) {
        return fail(format!("{violation}."));
    }
    Ok(())
}

fn collect_text_layer_records<'a>(layers: &'a [Value], result: &mut HashMap<String, &'a Record>) {
    for value in layers {
        let Value::Object(layer) = value else {
            continue;
        };
        if layer.get("kind").and_then(Value::as_str) == Some("text")
            && let Some(Value::String(id)) = layer.get("id")
        {
            result.insert(id.clone(), layer);
        }
        if let Some(Value::Array(children)) = layer.get("layers") {
            collect_text_layer_records(children, result);
        }
    }
}

fn validate_automatic_fit_layers(card_fields: &[Value], layers: &[Value]) -> ShapeResult<()> {
    let mut text_layers = HashMap::new();
    collect_text_layer_records(layers, &mut text_layers);
    for (index, value) in card_fields.iter().enumerate() {
        let field = record(Some(value), &format!("cardFields[{index}]"))?;
        if field.get("automaticFitLayer").is_none() {
            continue;
        }
        let layer_id = non_empty_string(field.get("automaticFitLayer"), &format!("cardFields[{index}].automaticFitLayer"))?;
        let Some(layer) = text_layers.get(layer_id) else {
            return fail(format!("cardFields[{index}].automaticFitLayer references unknown text layer \"{layer_id}\"."));
        };
        if layer.get("field") != field.get("name") {
            return fail(format!(
                "cardFields[{index}].automaticFitLayer must reference a text layer sourced from field \"{}\".",
                string_of(field.get("name"))
            ));
        }
        let typography = record(layer.get("typography"), &format!("Text layer \"{layer_id}\" typography"))?;
        let styles = layer.get("semanticStyles").and_then(Value::as_array).cloned().unwrap_or_default();
        let has_profiles = typography.get("fitProfiles").is_some_and(Value::is_array)
            || styles
                .iter()
                .any(|style| style.get("typography").and_then(|typography| typography.get("fitProfiles")).is_some_and(Value::is_array));
        if !has_profiles {
            return fail(format!("cardFields[{index}].automaticFitLayer must reference a text layer with fit profiles."));
        }
    }
    Ok(())
}

fn validate_automatic_when(value: Option<&Value>, location: &str, paths: &HashSet<String>) -> ShapeResult<()> {
    match value {
        None => Ok(()),
        Some(Value::Array(conditions)) => {
            if conditions.is_empty() {
                return fail(format!("{location} must not be empty."));
            }
            for (index, condition) in conditions.iter().enumerate() {
                validate_semantic_condition(Some(condition), &format!("{location}[{index}]"), paths)?;
            }
            Ok(())
        }
        Some(condition) => validate_semantic_condition(Some(condition), location, paths),
    }
}

struct RuleTargets<'a> {
    layer_ids: &'a HashSet<String>,
    text_layer_ids: &'a HashSet<String>,
    asset_layer_ids: &'a HashSet<String>,
    options_layer_ids: &'a HashSet<String>,
    non_maskable_layer_ids: &'a HashSet<String>,
    region_layer_ids: &'a HashSet<String>,
    mask_ids: &'a HashSet<String>,
    semantic_paths: &'a HashSet<String>,
    transform_ids: &'a HashSet<String>,
}

fn non_empty_record<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<&'a Record> {
    let parsed = record(value, location)?;
    if parsed.is_empty() {
        return fail(format!("{location} must not be empty."));
    }
    Ok(parsed)
}

fn validate_semantic_presentation_rules(value: Option<&Value>, targets: &RuleTargets) -> ShapeResult<()> {
    let location = "presentationRules";
    let Some(Value::Array(rules)) = value else {
        return fail(format!("{location} must be a non-empty array."));
    };
    if rules.is_empty() {
        return fail(format!("{location} must be a non-empty array."));
    }
    let mut ids = HashSet::new();
    for (index, entry) in rules.iter().enumerate() {
        let rule_location = format!("{location}[{index}]");
        let rule = record(Some(entry), &rule_location)?;
        assert_no_unknown_keys(
            rule,
            &[
                "assetSelections",
                "id",
                "layerVisibility",
                "layerRegions",
                "layerOptions",
                "maskSelections",
                "presets",
                "textPositions",
                "textValues",
                "when",
                "whenTransforms",
            ],
            &rule_location,
        )?;
        let id = non_empty_string(rule.get("id"), &format!("{rule_location}.id"))?;
        if !ids.insert(id.to_owned()) {
            return fail(format!("{location} contains duplicate ID \"{id}\"."));
        }
        if rule.get("when").is_none() && rule.get("whenTransforms").is_none() {
            return fail(format!("{rule_location} must declare when or whenTransforms."));
        }
        if rule.get("when").is_some() {
            validate_semantic_condition(rule.get("when"), &format!("{rule_location}.when"), targets.semantic_paths)?;
        }
        if rule.get("whenTransforms").is_some() {
            validate_transform_mode_gate(rule.get("whenTransforms"), &format!("{rule_location}.whenTransforms"), targets.transform_ids)?;
        }
        let keys = [
            "layerVisibility",
            "layerRegions",
            "layerOptions",
            "maskSelections",
            "assetSelections",
            "presets",
            "textPositions",
            "textValues",
        ];
        if keys.iter().all(|key| rule.get(*key).is_none()) {
            return fail(format!(
                "{rule_location} must declare assetSelections, layerOptions, layerRegions, layerVisibility, maskSelections, presets, textPositions, or textValues."
            ));
        }
        if rule.get("maskSelections").is_some() {
            let selections_location = format!("{rule_location}.maskSelections");
            for (layer_id, mask_id) in non_empty_record(rule.get("maskSelections"), &selections_location)? {
                let parsed = non_empty_string(Some(mask_id), &format!("{selections_location}.{layer_id}"))?;
                if !targets.layer_ids.contains(layer_id) {
                    return fail(format!("{selections_location} references unknown layer \"{layer_id}\"."));
                }
                if targets.non_maskable_layer_ids.contains(layer_id) {
                    return fail(format!("{selections_location} target \"{layer_id}\" is not a raster-output layer."));
                }
                if !targets.mask_ids.contains(parsed) {
                    return fail(format!("{selections_location}.{layer_id} references unknown mask \"{parsed}\"."));
                }
            }
        }
        if rule.get("assetSelections").is_some() {
            let selections_location = format!("{rule_location}.assetSelections");
            for (layer_id, asset_id) in non_empty_record(rule.get("assetSelections"), &selections_location)? {
                if !targets.asset_layer_ids.contains(layer_id) {
                    return fail(format!("{selections_location} references unknown asset-bearing layer \"{layer_id}\"."));
                }
                non_empty_string(Some(asset_id), &format!("{selections_location}.{layer_id}"))?;
            }
        }
        if rule.get("layerVisibility").is_some() {
            let visibility_location = format!("{rule_location}.layerVisibility");
            for (layer_id, visible) in non_empty_record(rule.get("layerVisibility"), &visibility_location)? {
                if !targets.layer_ids.contains(layer_id) {
                    return fail(format!("{visibility_location} references unknown layer \"{layer_id}\"."));
                }
                if !visible.is_boolean() {
                    return fail(format!("{visibility_location}.{layer_id} must be a boolean."));
                }
            }
        }
        if rule.get("layerRegions").is_some() {
            let regions_location = format!("{rule_location}.layerRegions");
            for (layer_id, selected) in non_empty_record(rule.get("layerRegions"), &regions_location)? {
                if !targets.region_layer_ids.contains(layer_id) {
                    return fail(format!("{regions_location} references non-region layer \"{layer_id}\"."));
                }
                region(Some(selected), &format!("{regions_location}.{layer_id}"))?;
            }
        }
        if rule.get("layerOptions").is_some() {
            let options_location = format!("{rule_location}.layerOptions");
            for (layer_id, patch) in non_empty_record(rule.get("layerOptions"), &options_location)? {
                if !targets.options_layer_ids.contains(layer_id) {
                    return fail(format!("{options_location} references layer \"{layer_id}\" without renderer options."));
                }
                non_empty_record(Some(patch), &format!("{options_location}.{layer_id}"))?;
            }
        }
        if rule.get("presets").is_some() {
            let presets_location = format!("{rule_location}.presets");
            for (target, preset) in non_empty_record(rule.get("presets"), &presets_location)? {
                if target.is_empty() {
                    return fail(format!("{presets_location} contains an empty target."));
                }
                non_empty_string(Some(preset), &format!("{presets_location}.{target}"))?;
            }
        }
        if rule.get("textPositions").is_some() {
            let positions_location = format!("{rule_location}.textPositions");
            for (layer_id, position) in non_empty_record(rule.get("textPositions"), &positions_location)? {
                if !targets.text_layer_ids.contains(layer_id) {
                    return fail(format!("{positions_location} references unknown text layer \"{layer_id}\"."));
                }
                let coordinates = record(Some(position), &format!("{positions_location}.{layer_id}"))?;
                finite_number(coordinates.get("x"), &format!("{positions_location}.{layer_id}.x"))?;
                finite_number(coordinates.get("y"), &format!("{positions_location}.{layer_id}.y"))?;
            }
        }
        if rule.get("textValues").is_some() {
            let values_location = format!("{rule_location}.textValues");
            for (layer_id, source) in non_empty_record(rule.get("textValues"), &values_location)? {
                if !targets.text_layer_ids.contains(layer_id) {
                    return fail(format!("{values_location} references unknown text layer \"{layer_id}\"."));
                }
                non_empty_string(Some(source), &format!("{values_location}.{layer_id}"))?;
            }
        }
    }
    Ok(())
}

fn layers_use_semantic_styles(layers: &[Value]) -> bool {
    layers.iter().any(|value| {
        let Value::Object(layer) = value else {
            return false;
        };
        match layer.get("semanticStyles") {
            Some(Value::Array(styles)) => {
                if styles.iter().any(|style| style.is_object() && style.get("when").is_some()) {
                    return true;
                }
            }
            Some(_) => return true,
            None => {}
        }
        matches!(layer.get("layers"), Some(Value::Array(children)) if layers_use_semantic_styles(children))
    })
}

fn validate_template_authoring_registries(template: &Record) -> ShapeResult<()> {
    let uses_registries = ["fitProfileSets", "fonts", "textDefaults", "typographyPresets"].iter().any(|key| template.get(*key).is_some());
    if !uses_registries {
        return Ok(());
    }
    if template.get("fonts").is_some() {
        for (family, asset_id) in record(template.get("fonts"), "fonts")? {
            if family.is_empty() {
                return fail("fonts must not contain an empty family name.");
            }
            non_empty_string(Some(asset_id), &format!("fonts.{family}"))?;
        }
    }
    if template.get("textDefaults").is_some() {
        let defaults = record(template.get("textDefaults"), "textDefaults")?;
        assert_no_unknown_keys(defaults, &["autoScaleXQuantifier", "maxAutoCompressionX"], "textDefaults")?;
        if defaults.get("autoScaleXQuantifier").is_some() {
            let quantifier = positive_number(defaults.get("autoScaleXQuantifier"), "textDefaults.autoScaleXQuantifier")?;
            if quantifier > 1.0 {
                return fail("textDefaults.autoScaleXQuantifier must not exceed 1.");
            }
        }
        if defaults.get("maxAutoCompressionX").is_some() {
            let maximum = finite_number(defaults.get("maxAutoCompressionX"), "textDefaults.maxAutoCompressionX")?;
            if !(0.0..1.0).contains(&maximum) {
                return fail("textDefaults.maxAutoCompressionX must be at least 0 and less than 1.");
            }
        }
    }
    if template.get("fitProfileSets").is_some() {
        for (name, profiles) in record(template.get("fitProfileSets"), "fitProfileSets")? {
            if name.is_empty() {
                return fail("fitProfileSets must not contain an empty name.");
            }
            let probe = serde_json::json!({
                "fill": "#000",
                "fitProfiles": profiles,
                "fontFamily": "validation",
                "fontSize": 1,
            });
            validate_typography(Some(&probe), &format!("fitProfileSets.{name}"))?;
        }
    }
    if template.get("typographyPresets").is_some() {
        for (name, preset) in record(template.get("typographyPresets"), "typographyPresets")? {
            if name.is_empty() {
                return fail("typographyPresets must not contain an empty name.");
            }
            let value = record(Some(preset), &format!("typographyPresets.{name}"))?;
            if value.is_empty() {
                return fail(format!("typographyPresets.{name} must declare at least one property."));
            }
            assert_no_unknown_keys(value, TEXT_TYPOGRAPHY_KEYS, &format!("typographyPresets.{name}"))?;
        }
    }
    Ok(())
}

fn has_presentation_rules(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Array(rules)) => rules.iter().any(|rule| rule.is_object() && rule.get("when").is_some()),
        Some(_) => true,
        None => false,
    }
}

pub fn validate_card_template_shape(input: &Value) -> ShapeResult<Record> {
    let authored = record(Some(input), "Malformed card template: <root>")?;
    assert_no_unknown_keys(authored, CARD_TEMPLATE_KEYS, "Card template")?;
    let Some(schema_version) = authored.get("schemaVersion") else {
        return fail("Malformed card template: schemaVersion is required.");
    };
    if !is_integer(Some(schema_version)) || schema_version.as_f64() != Some(1.0) {
        return fail(format!(
            "Unsupported card template schemaVersion {}; current version is 1. Migrate the template before using it.",
            json_stringify(Some(schema_version))
        ));
    }
    validate_template_authoring_registries(authored)?;
    let template = normalize_card_template_authoring(authored)?;
    let dimensions = record(template.get("dimensions"), "Malformed card template: dimensions")?;
    assert_no_unknown_keys(dimensions, &["height", "width"], "dimensions")?;
    positive_number(dimensions.get("width"), "dimensions.width")?;
    positive_number(dimensions.get("height"), "dimensions.height")?;

    let Some(Value::Array(card_fields)) = template.get("cardFields") else {
        return fail("cardFields must be an array.");
    };
    if card_fields.is_empty() {
        return fail("cardFields must declare at least one field.");
    }
    let mut field_names = HashSet::new();
    for (index, field) in card_fields.iter().enumerate() {
        validate_card_field(field, &format!("cardFields[{index}]"), &mut field_names)?;
    }
    let fields_by_name: HashMap<String, &Record> =
        card_fields.iter().filter_map(Value::as_object).map(|field| (string_of(field.get("name")), field)).collect();
    if !field_names.contains("name") {
        return fail("cardFields must declare the \"name\" field.");
    }
    let name_kind = fields_by_name.get("name").and_then(|field| field.get("kind"));
    if !matches!(name_kind.and_then(Value::as_str), Some("text" | "multiline")) {
        return fail(format!("cardFields \"name\" must use kind \"text\" or \"multiline\"; received \"{}\".", string_of(name_kind)));
    }
    let Some(Value::Array(layers)) = template.get("layers") else {
        return fail("layers must be an array.");
    };
    let canvas_masks = match template.get("masks") {
        None => Vec::new(),
        Some(masks) => validate_canvas_masks(Some(masks))?,
    };
    let mask_ids: HashSet<String> = canvas_masks.iter().map(|(id, _)| id.clone()).collect();
    let semantic_paths: HashSet<String> = match template.get("semanticBindings") {
        Some(bindings) => validate_semantic_bindings(Some(bindings), &fields_by_name)?.into_keys().collect(),
        None => {
            if layers_use_semantic_styles(layers) || has_presentation_rules(template.get("presentationRules")) {
                return fail("semanticBindings is required when the template declares semantic presentation data.");
            }
            HashSet::new()
        }
    };
    for (index, field) in card_fields.iter().enumerate() {
        let field_record = record(Some(field), &format!("cardFields[{index}]"))?;
        validate_automatic_when(field_record.get("automaticWhen"), &format!("cardFields[{index}].automaticWhen"), &semantic_paths)?;
    }
    let mut transform_ids = HashSet::new();
    collect_artwork_transform_ids(template.get("layers"), &mut transform_ids);
    let mut registry = LayerRegistry {
        ids: Vec::new(),
        id_set: HashSet::new(),
        fields: &fields_by_name,
        text_layer_ids: HashSet::new(),
        asset_layer_ids: HashSet::new(),
        options_layer_ids: HashSet::new(),
        non_maskable_layer_ids: HashSet::new(),
        region_layer_ids: HashSet::new(),
        semantic_paths: &semantic_paths,
        transform_ids: &transform_ids,
    };
    for (index, layer) in layers.iter().enumerate() {
        registry.validate_layer(layer, &format!("layers[{index}]"))?;
    }
    for (mask_id, coverage) in &canvas_masks {
        if let Some(coverage) = coverage {
            if !registry.id_set.contains(coverage) {
                return fail(format!("Canvas mask \"{mask_id}\" references unknown coverage layer \"{coverage}\"."));
            }
            if registry.non_maskable_layer_ids.contains(coverage) {
                return fail(format!("Canvas mask \"{mask_id}\" coverage layer \"{coverage}\" is not a raster-output layer."));
            }
        }
    }
    validate_automatic_fit_layers(card_fields, layers)?;
    if template.get("presentationRules").is_some() {
        validate_semantic_presentation_rules(
            template.get("presentationRules"),
            &RuleTargets {
                layer_ids: &registry.id_set,
                text_layer_ids: &registry.text_layer_ids,
                asset_layer_ids: &registry.asset_layer_ids,
                options_layer_ids: &registry.options_layer_ids,
                non_maskable_layer_ids: &registry.non_maskable_layer_ids,
                region_layer_ids: &registry.region_layer_ids,
                mask_ids: &mask_ids,
                semantic_paths: &semantic_paths,
                transform_ids: &transform_ids,
            },
        )?;
        let order: HashMap<String, usize> = registry.ids.iter().enumerate().map(|(index, id)| (id.clone(), index)).collect();
        for (index, rule) in template.get("presentationRules").and_then(Value::as_array).into_iter().flatten().enumerate() {
            let Some(Value::Object(selections)) = rule.get("maskSelections") else {
                continue;
            };
            for (layer_id, mask_id) in selections {
                assert_coverage_renders_first(
                    mask_id.as_str().unwrap_or(""),
                    layer_id,
                    &format!("presentationRules[{index}].maskSelections"),
                    &canvas_masks,
                    &order,
                )?;
            }
        }
    }
    Ok(template)
}

fn version_part(part: &str) -> f64 {
    // JavaScript's Number(): an empty part is 0, and anything but a decimal number is NaN.
    let trimmed = part.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse().unwrap_or(f64::NAN)
}

/// The first difference between two versions' parts, compared as numbers: negative when `left` is
/// older, positive when newer, zero when equal (`compareTemplateVersions` in JavaScript).
pub fn compare_template_versions(left: &str, right: &str) -> f64 {
    let (left, right): (Vec<f64>, Vec<f64>) = (left.split('.').map(version_part).collect(), right.split('.').map(version_part).collect());
    for index in 0..4 {
        let difference = left.get(index).copied().unwrap_or(0.0) - right.get(index).copied().unwrap_or(0.0);
        if difference != 0.0 {
            return difference;
        }
    }
    0.0
}

pub fn template_version_is_valid(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    let valid_shape = (parts.len() == 3 || parts.len() == 4)
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts[..3].iter().all(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
        && parts.get(3).is_none_or(|sequence| {
            !sequence.is_empty() && sequence.bytes().all(|byte| byte.is_ascii_digit()) && !sequence.starts_with('0')
        });
    if !valid_shape {
        return false;
    }
    let year: i64 = parts[0].parse().unwrap_or(0);
    let month: i64 = parts[1].parse().unwrap_or(0);
    let day: i64 = parts[2].parse().unwrap_or(0);
    if year < 100 || month == 0 || day == 0 || month > 12 {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    day <= days[(month - 1) as usize]
}

fn relative_path(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    let parsed = non_empty_string(value, location)?;
    let has_scheme = parsed.split_once(':').is_some_and(|(scheme, _)| {
        let mut characters = scheme.chars();
        characters.next().is_some_and(|first| first.is_ascii_alphabetic())
            && characters.all(|character| character.is_ascii_alphanumeric() || "+.-".contains(character))
    });
    if parsed.starts_with('/') || has_scheme {
        return fail(format!("{location} must be relative to its template directory; received \"{parsed}\"."));
    }
    Ok(())
}

pub fn validate_template_manifest_shape(input: &Value) -> ShapeResult<()> {
    let manifest = record(Some(input), "Malformed template manifest: <root>")?;
    assert_no_unknown_keys(
        manifest,
        &["assets", "colorPresets", "id", "kind", "name", "status", "template", "templateDependencies", "version"],
        "Template manifest",
    )?;
    non_empty_string(manifest.get("id"), "id")?;
    let kind = manifest.get("kind");
    if !matches!(kind.and_then(Value::as_str), Some("card" | "box" | "playmat-board" | "playmat-field")) {
        return fail(format!("kind \"{}\" is unsupported.", string_of(kind)));
    }
    non_empty_string(manifest.get("name"), "name")?;
    if !manifest.get("version").and_then(Value::as_str).is_some_and(template_version_is_valid) {
        return fail("version must use YYYY.MM.DD or YYYY.MM.DD.N.");
    }
    if let Some(status) = manifest.get("status")
        && !matches!(status.as_str(), Some("supported" | "experimental" | "disabled"))
    {
        return fail(format!("status {} is unsupported.", json_stringify(Some(status))));
    }
    relative_path(manifest.get("template"), "Manifest template path")?;
    let assets = record(manifest.get("assets"), "Malformed template manifest: assets")?;
    for (id, asset_path) in assets {
        if id.is_empty() {
            return fail("Asset ID must be a non-empty string.");
        }
        relative_path(Some(asset_path), &format!("Asset \"{id}\" path"))?;
    }
    if manifest.get("colorPresets").is_some() {
        relative_path(manifest.get("colorPresets"), "Manifest color-preset path")?;
    }
    if manifest.get("templateDependencies").is_some() {
        string_array(manifest.get("templateDependencies"), "templateDependencies", true)?;
    }
    Ok(())
}

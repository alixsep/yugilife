use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::shape::{Record, ShapeResult, assert_no_unknown_keys, fail, finite_number, non_empty_string, record};
use super::typography::{merge_text_typography, validate_typography_patch};

fn walk_layers<'a>(layers: &'a Value, visit: &mut impl FnMut(&'a Record)) {
    for layer in layers.as_array().into_iter().flatten() {
        let Some(layer) = layer.as_object() else {
            continue;
        };
        visit(layer);
        if layer.get("kind").and_then(Value::as_str) == Some("group")
            && let Some(children) = layer.get("layers")
        {
            walk_layers(children, visit);
        }
    }
}

fn layer_id(layer: &Record) -> String {
    layer.get("id").and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn typography_for_style(layer: &Record, style_id: &str, location: &str) -> ShapeResult<Record> {
    let base = layer.get("typography").and_then(Value::as_object).cloned().unwrap_or_default();
    if style_id == "default" {
        return Ok(base);
    }
    let style = layer
        .get("semanticStyles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|style| style.get("id").and_then(Value::as_str) == Some(style_id));
    let Some(style) = style else {
        return fail(format!("{location} references unknown semantic style \"{style_id}\"."));
    };
    merge_text_typography(&base, &[style.get("typography").and_then(Value::as_object)])
}

pub fn validate_presentation_overrides_shape(input: &Value, template: &Record) -> ShapeResult<()> {
    let overrides = record(Some(input), "Presentation overrides")?;
    assert_no_unknown_keys(overrides, &["artworkTransforms", "layerMasks", "textFitProfiles", "textTypography"], "Presentation overrides")?;
    let layers = template.get("layers").cloned().unwrap_or(Value::Null);
    let mut text_layers: HashMap<String, &Record> = HashMap::new();
    let mut layer_ids: HashSet<String> = HashSet::new();
    let mut order: HashMap<String, usize> = HashMap::new();
    let mut non_maskable: HashSet<String> = HashSet::new();
    let mut transform_ids: HashSet<String> = HashSet::new();
    walk_layers(&layers, &mut |layer| {
        let id = layer_id(layer);
        let kind = layer.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind == "text" {
            text_layers.insert(id.clone(), layer);
        }
        if kind == "text" || kind == "svg" {
            non_maskable.insert(id.clone());
        }
        if kind == "artwork" {
            let transform = layer.get("transformId").and_then(Value::as_str).map_or_else(|| id.clone(), str::to_owned);
            transform_ids.insert(transform);
        }
        if layer_ids.insert(id.clone()) {
            order.insert(id, order.len());
        }
    });
    let masks: Vec<(String, Option<String>)> = template
        .get("masks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|mask| {
            (
                mask.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
                mask.get("coverageLayerId").and_then(Value::as_str).map(str::to_owned),
            )
        })
        .collect();

    if let Some(value) = overrides.get("artworkTransforms") {
        for (id, value) in record(Some(value), "artworkTransforms")? {
            if !transform_ids.contains(id) {
                return fail(format!("artworkTransforms references unknown transform \"{id}\"."));
            }
            let location = format!("artworkTransforms.{id}");
            let transform = record(Some(value), &location)?;
            assert_no_unknown_keys(transform, &["mode", "scale", "x", "y"], &location)?;
            let scale = finite_number(transform.get("scale"), &format!("{location}.scale"))?;
            let x = finite_number(transform.get("x"), &format!("{location}.x"))?;
            let y = finite_number(transform.get("y"), &format!("{location}.y"))?;
            if transform.get("mode").is_some() {
                non_empty_string(transform.get("mode"), &format!("{location}.mode"))?;
            }
            if !(1.0..=8.0).contains(&scale) {
                return fail(format!("{location}.scale must be between 1 and 8."));
            }
            if !(-2.0..=2.0).contains(&x) || !(-2.0..=2.0).contains(&y) {
                return fail(format!("{location} pan values must be between -2 and 2."));
            }
        }
    }

    if let Some(value) = overrides.get("textTypography") {
        for (layer_id, value) in record(Some(value), "textTypography")? {
            let Some(layer) = text_layers.get(layer_id) else {
                return fail(format!("textTypography references unknown text layer \"{layer_id}\"."));
            };
            let format = layer.get("format").and_then(Value::as_str);
            for (style_id, patch) in record(Some(value), &format!("textTypography.{layer_id}"))? {
                let location = format!("textTypography.{layer_id}.{style_id}");
                let base = typography_for_style(layer, style_id, &location)?;
                validate_typography_patch(Some(patch), &base, format, &location)?;
            }
        }
    }

    if let Some(value) = overrides.get("textFitProfiles") {
        for (layer_id, value) in record(Some(value), "textFitProfiles")? {
            let Some(layer) = text_layers.get(layer_id) else {
                return fail(format!("textFitProfiles references unknown text layer \"{layer_id}\"."));
            };
            for (style_id, profile_id) in record(Some(value), &format!("textFitProfiles.{layer_id}"))? {
                let location = format!("textFitProfiles.{layer_id}.{style_id}");
                let profile = non_empty_string(Some(profile_id), &location)?;
                let typography = typography_for_style(layer, style_id, &location)?;
                let known = typography
                    .get("fitProfiles")
                    .and_then(Value::as_array)
                    .is_some_and(|profiles| profiles.iter().any(|entry| entry.get("id").and_then(Value::as_str) == Some(profile)));
                if !known {
                    return fail(format!("{location} references unknown fit profile \"{profile}\"."));
                }
            }
        }
    }

    if let Some(value) = overrides.get("layerMasks") {
        for (layer_id, mask_id) in record(Some(value), "layerMasks")? {
            if !layer_ids.contains(layer_id) {
                return fail(format!("layerMasks references unknown layer \"{layer_id}\"."));
            }
            if non_maskable.contains(layer_id) {
                return fail(format!("layerMasks cannot assign a mask to non-raster layer \"{layer_id}\"."));
            }
            match mask_id {
                Value::Null => {}
                Value::String(mask) if !mask.is_empty() => {
                    let Some((_, coverage)) = masks.iter().find(|(id, _)| id == mask) else {
                        return fail(format!("layerMasks.{layer_id} references unknown mask \"{mask}\"."));
                    };
                    if let Some(coverage) = coverage
                        && let (Some(coverage_order), Some(target_order)) = (order.get(coverage), order.get(layer_id))
                        && coverage_order >= target_order
                    {
                        return fail(format!(
                            "layerMasks assigns mask \"{mask}\" to layer \"{layer_id}\", but its coverage layer \"{coverage}\" does not render before that layer."
                        ));
                    }
                }
                _ => return fail(format!("layerMasks.{layer_id} must be a non-empty string or null.")),
            }
        }
    }
    Ok(())
}

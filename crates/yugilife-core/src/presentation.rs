use indexmap::IndexMap;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::model::{CardTemplate, Condition, LayerBody, Position, Region, SemanticValue, TextLayer, TransformGate, walk_layers};
use crate::semantics::{CardSemantics, matches_semantic_condition};
use crate::text::typography::TextTypography;
use crate::validation::{Record, merge_text_typography, validate_presentation_overrides};

#[derive(Debug, Clone, PartialEq)]
pub struct ArtworkTransform {
    pub scale: f64,
    pub x: f64,
    pub y: f64,
    pub mode: Option<String>,
}

impl ArtworkTransform {
    pub const IDENTITY: Self = Self { scale: 1.0, x: 0.0, y: 0.0, mode: None };
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedLayerMask {
    pub id: String,
    pub asset_id: String,
    pub luminance: bool,
    pub coverage_layer_id: Option<String>,
    pub invert: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedTextPresentation {
    pub fit_profile_id: Option<String>,
    pub layer_id: String,
    pub position: Position,
    pub value: Option<SemanticValue>,
    pub style_id: String,
    pub style_label: String,
    pub typography: TextTypography,
    /// The merged typography as authored data, which is what JavaScript hosts receive.
    pub typography_record: Record,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ResolvedCardPresentation {
    pub asset_selections: IndexMap<String, String>,
    pub artwork_transforms: IndexMap<String, ArtworkTransform>,
    pub layer_regions: IndexMap<String, Region>,
    pub layer_masks: IndexMap<String, ResolvedLayerMask>,
    pub layer_options: IndexMap<String, Record>,
    pub layer_visibility: IndexMap<String, bool>,
    pub semantics: CardSemantics,
    pub presets: IndexMap<String, String>,
    pub text: IndexMap<String, ResolvedTextPresentation>,
    /// The `artworkTransforms` overrides as given, which is what JavaScript hosts receive.
    pub artwork_transforms_record: Record,
}

pub fn matches_presentation_gate(
    semantics: &CardSemantics,
    transforms: &IndexMap<String, ArtworkTransform>,
    when: Option<&Condition>,
    when_transforms: Option<&TransformGate>,
) -> bool {
    if let Some(when) = when
        && !matches_semantic_condition(semantics, when)
    {
        return false;
    }
    let Some(gate) = when_transforms else {
        return true;
    };
    gate.iter().all(|(transform_id, mode)| transforms.get(transform_id).and_then(|transform| transform.mode.as_ref()) == mode.as_ref())
}

fn resolve_rule_values<T: Clone + PartialEq>(
    rules: &[&crate::model::PresentationRule],
    select: impl Fn(&crate::model::PresentationRule) -> &IndexMap<String, T>,
    subject: &str,
) -> Result<IndexMap<String, T>> {
    let mut values: IndexMap<String, T> = IndexMap::new();
    let mut owners: IndexMap<String, String> = IndexMap::new();
    for rule in rules {
        for (key, value) in select(rule) {
            if let Some(previous) = values.get(key)
                && previous != value
            {
                return Err(Error::render(format!(
                    "Semantic presentation rules \"{}\" and \"{}\" resolve {subject} \"{key}\" differently.",
                    owners[key], rule.id
                )));
            }
            values.insert(key.clone(), value.clone());
            owners.insert(key.clone(), rule.id.clone());
        }
    }
    Ok(values)
}

fn same_option_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Object(_) | Value::Array(_), _) | (_, Value::Object(_) | Value::Array(_)) => false,
        (Value::Number(left), Value::Number(right)) => {
            let (left, right) = (left.as_f64(), right.as_f64());
            left == right && left.is_some_and(|value| value.is_sign_negative()) == right.is_some_and(|value| value.is_sign_negative())
        }
        _ => left == right,
    }
}

fn resolve_layer_options(rules: &[&crate::model::PresentationRule]) -> Result<IndexMap<String, Record>> {
    let mut values: IndexMap<String, Record> = IndexMap::new();
    let mut owners: IndexMap<String, String> = IndexMap::new();
    for rule in rules {
        for (layer_id, patch) in &rule.layer_options {
            let resolved = values.entry(layer_id.clone()).or_default();
            for (key, value) in patch {
                let option_path = format!("{layer_id}.{key}");
                if let Some(previous) = resolved.get(key)
                    && !same_option_value(previous, value)
                {
                    return Err(Error::render(format!(
                        "Semantic presentation rules \"{}\" and \"{}\" resolve layer option \"{option_path}\" differently.",
                        owners.get(&option_path).cloned().unwrap_or_default(),
                        rule.id
                    )));
                }
                resolved.insert(key.clone(), value.clone());
                owners.insert(option_path, rule.id.clone());
            }
        }
    }
    Ok(values)
}

fn resolve_text_positions(rules: &[&crate::model::PresentationRule]) -> Result<IndexMap<String, Position>> {
    let mut positions: IndexMap<String, Position> = IndexMap::new();
    let mut owners: IndexMap<String, String> = IndexMap::new();
    for rule in rules {
        for (layer_id, position) in &rule.text_positions {
            if let Some(previous) = positions.get(layer_id)
                && previous != position
            {
                return Err(Error::render(format!(
                    "Semantic presentation rules \"{}\" and \"{}\" resolve text layer \"{layer_id}\" to different positions.",
                    owners[layer_id], rule.id
                )));
            }
            positions.insert(layer_id.clone(), *position);
            owners.insert(layer_id.clone(), rule.id.clone());
        }
    }
    Ok(positions)
}

fn resolve_layer_regions(rules: &[&crate::model::PresentationRule]) -> Result<IndexMap<String, Region>> {
    let mut regions: IndexMap<String, Region> = IndexMap::new();
    let mut owners: IndexMap<String, String> = IndexMap::new();
    for rule in rules {
        for (layer_id, region) in &rule.layer_regions {
            if let Some(previous) = regions.get(layer_id)
                && previous != region
            {
                return Err(Error::render(format!(
                    "Semantic presentation rules \"{}\" and \"{}\" resolve layer \"{layer_id}\" to different regions.",
                    owners[layer_id], rule.id
                )));
            }
            regions.insert(layer_id.clone(), *region);
            owners.insert(layer_id.clone(), rule.id.clone());
        }
    }
    Ok(regions)
}

fn resolve_layer_masks(
    template: &CardTemplate,
    rules: &[&crate::model::PresentationRule],
    overrides: Option<&Record>,
) -> Result<IndexMap<String, ResolvedLayerMask>> {
    let mut selections = resolve_rule_values(rules, |rule| &rule.mask_selections, "layer mask")?;
    let mut layer_ids = std::collections::HashSet::new();
    walk_layers(&template.layers, &mut |layer, _| {
        layer_ids.insert(layer.id.clone());
    });
    if let Some(Value::Object(masks)) = overrides.and_then(|overrides| overrides.get("layerMasks")) {
        for (layer_id, mask_id) in masks {
            if !layer_ids.contains(layer_id) {
                return Err(Error::render(format!("Presentation mask override references unknown layer \"{layer_id}\".")));
            }
            match mask_id {
                Value::Null => {
                    selections.shift_remove(layer_id);
                }
                Value::String(mask) => {
                    selections.insert(layer_id.clone(), mask.clone());
                }
                _ => {}
            }
        }
    }
    let mut resolved = IndexMap::new();
    for (layer_id, mask_id) in selections {
        let Some(mask) = template.masks.iter().find(|mask| mask.id == mask_id) else {
            return Err(Error::render(format!("Layer \"{layer_id}\" references unknown canvas mask \"{mask_id}\".")));
        };
        resolved.insert(
            layer_id,
            ResolvedLayerMask {
                id: mask.id.clone(),
                asset_id: mask.asset_id.clone(),
                luminance: mask.luminance,
                coverage_layer_id: mask.coverage_layer_id.clone(),
                invert: mask.invert,
            },
        );
    }
    Ok(resolved)
}

fn parse_artwork_transforms(overrides: Option<&Record>) -> IndexMap<String, ArtworkTransform> {
    overrides.and_then(|overrides| overrides.get("artworkTransforms")).map(artwork_transforms_from_json).unwrap_or_default()
}

/// Artwork transform overrides (`artworkTransforms`) by transform ID.
pub fn artwork_transforms_from_json(value: &Value) -> IndexMap<String, ArtworkTransform> {
    let Value::Object(transforms) = value else {
        return IndexMap::new();
    };
    transforms
        .iter()
        .map(|(id, transform)| {
            let number = |key: &str| transform.get(key).and_then(Value::as_f64).unwrap_or(0.0);
            (
                id.clone(),
                ArtworkTransform {
                    scale: number("scale"),
                    x: number("x"),
                    y: number("y"),
                    mode: transform.get("mode").and_then(Value::as_str).map(str::to_owned),
                },
            )
        })
        .collect()
}

pub fn resolve_card_presentation(
    template: &CardTemplate,
    semantics: CardSemantics,
    overrides: Option<&Value>,
) -> Result<ResolvedCardPresentation> {
    if let Some(overrides) = overrides {
        validate_presentation_overrides(overrides, &template.json)?;
    }
    let overrides = overrides.and_then(Value::as_object);
    let artwork_transforms = parse_artwork_transforms(overrides);
    let rules: Vec<&crate::model::PresentationRule> = template
        .rules
        .iter()
        .filter(|rule| matches_presentation_gate(&semantics, &artwork_transforms, rule.when.as_ref(), rule.when_transforms.as_ref()))
        .collect();
    let layer_regions = resolve_layer_regions(&rules)?;
    let text_positions = resolve_text_positions(&rules)?;
    let text_values = resolve_rule_values(&rules, |rule| &rule.text_values, "text value")?;
    let layer_options = resolve_layer_options(&rules)?;
    let mut text = IndexMap::new();
    let mut failure: Option<Error> = None;
    walk_layers(&template.layers, &mut |layer, _| {
        if failure.is_some() {
            return;
        }
        if let LayerBody::Text(text_layer) = &layer.body {
            match resolve_text_layer(
                &layer.id,
                layer.label.as_deref(),
                text_layer,
                &semantics,
                &artwork_transforms,
                overrides,
                &text_positions,
                &text_values,
            ) {
                Ok(resolved) => {
                    text.insert(layer.id.clone(), resolved);
                }
                Err(error) => failure = Some(error),
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    let layer_visibility = resolve_rule_values(&rules, |rule| &rule.layer_visibility, "layer visibility")?;
    let asset_selections = resolve_rule_values(&rules, |rule| &rule.asset_selections, "asset selection")?;
    let layer_masks = resolve_layer_masks(template, &rules, overrides)?;
    let presets = resolve_rule_values(&rules, |rule| &rule.presets, "preset target")?;
    Ok(ResolvedCardPresentation {
        asset_selections,
        artwork_transforms,
        layer_regions,
        layer_masks,
        layer_options,
        layer_visibility,
        semantics,
        presets,
        text,
        artwork_transforms_record: overrides
            .and_then(|overrides| overrides.get("artworkTransforms"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
    })
}

fn string_map(map: &IndexMap<String, String>) -> Value {
    Value::Object(map.iter().map(|(key, value)| (key.clone(), Value::String(value.clone()))).collect())
}

impl ResolvedLayerMask {
    pub fn to_json(&self) -> Value {
        let mut mask = serde_json::Map::new();
        mask.insert("assetId".to_owned(), Value::String(self.asset_id.clone()));
        mask.insert("channel".to_owned(), Value::String(if self.luminance { "luminance" } else { "alpha" }.to_owned()));
        if let Some(coverage) = &self.coverage_layer_id {
            mask.insert("coverageLayerId".to_owned(), Value::String(coverage.clone()));
        }
        mask.insert("id".to_owned(), Value::String(self.id.clone()));
        mask.insert("invert".to_owned(), Value::Bool(self.invert));
        Value::Object(mask)
    }
}

impl ResolvedTextPresentation {
    /// `fitProfileId` and `value` are `null` where JavaScript has `undefined`.
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "fitProfileId": self.fit_profile_id,
            "layerId": self.layer_id,
            "position": self.position.to_json(),
            "value": self.value.as_ref().map_or(Value::Null, SemanticValue::to_json),
            "styleId": self.style_id,
            "styleLabel": self.style_label,
            "typography": Value::Object(self.typography_record.clone()),
        })
    }
}

impl ResolvedCardPresentation {
    /// The JavaScript `ResolvedCardPresentation`, with `semantics` in `CardSemantics::to_json` form.
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "assetSelections": string_map(&self.asset_selections),
            "artworkTransforms": Value::Object(self.artwork_transforms_record.clone()),
            "layerRegions": self.layer_regions.iter().map(|(id, region)| (id.clone(), region.to_json())).collect::<serde_json::Map<_, _>>(),
            "layerMasks": self.layer_masks.iter().map(|(id, mask)| (id.clone(), mask.to_json())).collect::<serde_json::Map<_, _>>(),
            "layerOptions": self.layer_options.iter().map(|(id, options)| (id.clone(), Value::Object(options.clone()))).collect::<serde_json::Map<_, _>>(),
            "layerVisibility": self.layer_visibility.iter().map(|(id, visible)| (id.clone(), Value::Bool(*visible))).collect::<serde_json::Map<_, _>>(),
            "presets": string_map(&self.presets),
            "semantics": self.semantics.to_json(),
            "text": self.text.iter().map(|(id, text)| (id.clone(), text.to_json())).collect::<serde_json::Map<_, _>>(),
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn resolve_text_layer(
    layer_id: &str,
    layer_label: Option<&str>,
    layer: &TextLayer,
    semantics: &CardSemantics,
    transforms: &IndexMap<String, ArtworkTransform>,
    overrides: Option<&Record>,
    text_positions: &IndexMap<String, Position>,
    text_values: &IndexMap<String, String>,
) -> Result<ResolvedTextPresentation> {
    let matching: Vec<_> = layer
        .semantic_styles
        .iter()
        .filter(|style| matches_presentation_gate(semantics, transforms, style.when.as_ref(), style.when_transforms.as_ref()))
        .collect();
    if matching.len() > 1 {
        return Err(Error::render(format!("Text layer \"{layer_id}\" has multiple semantic styles matching the current card.")));
    }
    let style = matching.first();
    let style_id = style.map_or("default", |style| style.id.as_str());
    let user_patch = overrides
        .and_then(|overrides| overrides.get("textTypography"))
        .and_then(|layers| layers.get(layer_id))
        .and_then(|styles| styles.get(style_id))
        .and_then(Value::as_object);
    let typography = merge_text_typography(&layer.typography, &[style.and_then(|style| style.typography.as_ref()), user_patch])
        .map_err(Error::render)?;
    let typography_record = typography;
    let typography = TextTypography::from_record(&typography_record);
    let fit_profile_id = overrides
        .and_then(|overrides| overrides.get("textFitProfiles"))
        .and_then(|layers| layers.get(layer_id))
        .and_then(|styles| styles.get(style_id))
        .and_then(Value::as_str)
        .filter(|profile| !profile.is_empty());
    if let Some(profile_id) = fit_profile_id {
        let known = typography.fit_profiles.as_ref().is_some_and(|profiles| profiles.iter().any(|profile| profile.id == profile_id));
        if !known {
            return Err(Error::render(format!(
                "Text layer \"{layer_id}\" style \"{style_id}\" requested unknown fit profile \"{profile_id}\"."
            )));
        }
    }
    let position = text_positions.get(layer_id).copied().unwrap_or(layer.position);
    let value = match text_values.get(layer_id) {
        Some(source) => Some(SemanticValue::Primitive(crate::model::Primitive::String(source.clone()))),
        None => layer.semantic_path.as_ref().and_then(|path| semantics.get(path).cloned()),
    };
    Ok(ResolvedTextPresentation {
        fit_profile_id: fit_profile_id.map(str::to_owned),
        layer_id: layer_id.to_owned(),
        position,
        value,
        style_id: style_id.to_owned(),
        style_label: style
            .map(|style| style.label.clone())
            .or_else(|| layer_label.map(str::to_owned))
            .unwrap_or_else(|| layer_id.to_owned()),
        typography,
        typography_record,
    })
}

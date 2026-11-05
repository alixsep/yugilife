use serde_json::Value;

use super::shape::{Record, ShapeResult};

fn fail<T>(message: String) -> ShapeResult<T> {
    Err(format!("Malformed card template: {message}"))
}

fn named_record<'a>(value: Option<&'a Value>, location: &str) -> ShapeResult<&'a Record> {
    match value {
        Some(Value::Object(map)) => Ok(map),
        _ => fail(format!("{location} must be an object.")),
    }
}

fn merge_typography(base: &Record, patch: &Record) -> Record {
    let mut merged = base.clone();
    if patch.get("fontFamily").is_some() && patch.get("fontAssetId").is_none() {
        merged.shift_remove("fontAssetId");
    }
    if patch.get("fitProfileSet").is_some() {
        merged.shift_remove("fitProfiles");
    }
    if patch.get("fitProfiles").is_some() {
        merged.shift_remove("fitProfileSet");
    }
    for (key, value) in patch {
        if key == "fitProfileOverrides" && value.is_object() {
            let mut combined = merged.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
            for (id, entry) in value.as_object().into_iter().flatten() {
                combined.insert(id.clone(), entry.clone());
            }
            merged.insert(key.clone(), Value::Object(combined));
        } else if value.is_null() {
            merged.shift_remove(key);
        } else {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

fn merge_typography_patches(base: &Record, patch: &Record) -> Record {
    let mut merged = merge_typography(base, patch);
    for (key, value) in patch {
        if value.is_null() {
            merged.insert(key.clone(), Value::Null);
        }
    }
    merged
}

struct Context<'a> {
    fit_profile_sets: &'a Record,
    fonts: &'a Record,
    text_defaults: &'a Record,
    typography_presets: &'a Record,
}

fn resolve_typography(value: Option<&Value>, context: &Context, location: &str, allow_deferred: bool) -> ShapeResult<Record> {
    let authored = named_record(value, location)?;
    let mut resolved = authored.clone();
    if let Some(set_name) = authored.get("fitProfileSet") {
        let Some(name) = set_name.as_str().filter(|name| !name.is_empty()) else {
            return fail(format!("{location}.fitProfileSet must be a non-empty string."));
        };
        if authored.get("fitProfiles").is_some() {
            return fail(format!("{location} must not declare both fitProfileSet and fitProfiles."));
        }
        let Some(Value::Array(profile_set)) = context.fit_profile_sets.get(name) else {
            return fail(format!("{location}.fitProfileSet references unknown set \"{name}\"."));
        };
        let mut profiles = Vec::with_capacity(profile_set.len());
        for profile in profile_set {
            profiles.push(Value::Object(named_record(Some(profile), location)?.clone()));
        }
        resolved.insert("fitProfiles".to_owned(), Value::Array(profiles));
    }
    let mut applied_overrides = false;
    if let Some(overrides) = authored.get("fitProfileOverrides") {
        let patches = named_record(Some(overrides), &format!("{location}.fitProfileOverrides"))?;
        match resolved.get("fitProfiles") {
            Some(Value::Array(profiles)) => {
                applied_overrides = true;
                let mut seen = std::collections::HashSet::new();
                let mut updated = Vec::with_capacity(profiles.len());
                for (index, profile) in profiles.iter().enumerate() {
                    let current = named_record(Some(profile), &format!("{location}.fitProfiles[{index}]"))?;
                    let Some(id) = current.get("id").and_then(Value::as_str) else {
                        updated.push(Value::Object(current.clone()));
                        continue;
                    };
                    match patches.get(id) {
                        None => updated.push(Value::Object(current.clone())),
                        Some(patch) => {
                            seen.insert(id.to_owned());
                            let patch = named_record(Some(patch), &format!("{location}.fitProfileOverrides.{id}"))?;
                            updated.push(Value::Object(merge_typography(current, patch)));
                        }
                    }
                }
                if let Some(id) = patches.keys().find(|id| !seen.contains(*id)) {
                    return fail(format!("{location}.fitProfileOverrides references unknown profile \"{id}\"."));
                }
                resolved.insert("fitProfiles".to_owned(), Value::Array(updated));
            }
            _ if !allow_deferred => {
                return fail(format!("{location}.fitProfileOverrides requires fitProfiles or fitProfileSet."));
            }
            _ => {}
        }
    }
    resolved.shift_remove("fitProfileSet");
    if applied_overrides {
        resolved.shift_remove("fitProfileOverrides");
    }
    if resolved.get("fitProfiles").is_some() {
        for key in ["autoScaleXQuantifier", "maxAutoCompressionX"] {
            if resolved.get(key).is_none()
                && let Some(default) = context.text_defaults.get(key)
            {
                resolved.insert(key.to_owned(), default.clone());
            }
        }
    }
    if let Some(family) = resolved.get("fontFamily").and_then(Value::as_str).map(str::to_owned)
        && let Some(inherited) = context.fonts.get(&family)
    {
        if resolved.get("fontAssetId").is_some_and(|asset| asset != inherited) {
            return fail(format!("{location}.fontAssetId conflicts with the asset registered for fontFamily \"{family}\"."));
        }
        resolved.insert("fontAssetId".to_owned(), inherited.clone());
    }
    Ok(resolved)
}

fn resolve_style(style: &Value, context: &Context, location: &str) -> ShapeResult<Value> {
    let authored = named_record(Some(style), location)?;
    let mut patch = Record::new();
    if let Some(preset_name) = authored.get("typographyPreset") {
        let Some(name) = preset_name.as_str().filter(|name| !name.is_empty()) else {
            return fail(format!("{location}.typographyPreset must be a non-empty string."));
        };
        let Some(Value::Object(preset)) = context.typography_presets.get(name) else {
            return fail(format!("{location}.typographyPreset references unknown preset \"{name}\"."));
        };
        patch = merge_typography_patches(&patch, preset);
    }
    if let Some(typography) = authored.get("typography") {
        let typography = named_record(Some(typography), &format!("{location}.typography"))?;
        patch = merge_typography_patches(&patch, typography);
    }
    if authored.get("typographyPreset").is_none() && authored.get("typography").is_none() {
        return fail(format!("{location} must declare typographyPreset or typography."));
    }
    let patch_value = Value::Object(patch);
    let typography = resolve_typography(Some(&patch_value), context, &format!("{location}.typography"), true)?;
    let mut normalized = authored.clone();
    normalized.insert("typography".to_owned(), Value::Object(typography));
    normalized.shift_remove("typographyPreset");
    Ok(Value::Object(normalized))
}

fn resolve_layers(layers: &[Value], context: &Context, location: &str) -> ShapeResult<Vec<Value>> {
    let mut resolved_layers = Vec::with_capacity(layers.len());
    for (index, entry) in layers.iter().enumerate() {
        let layer_location = format!("{location}[{index}]");
        let layer = named_record(Some(entry), &layer_location)?;
        let kind = layer.get("kind").and_then(Value::as_str);
        if kind == Some("group")
            && let Some(Value::Array(children)) = layer.get("layers")
        {
            let mut group = layer.clone();
            let children = resolve_layers(children, context, &format!("{layer_location}.layers"))?;
            group.insert("layers".to_owned(), Value::Array(children));
            resolved_layers.push(Value::Object(group));
            continue;
        }
        if kind != Some("text") {
            resolved_layers.push(entry.clone());
            continue;
        }
        let typography = resolve_typography(layer.get("typography"), context, &format!("{layer_location}.typography"), false)?;
        let mut text_layer = layer.clone();
        text_layer.insert("typography".to_owned(), Value::Object(typography));
        if let Some(Value::Array(styles)) = layer.get("semanticStyles") {
            let mut resolved_styles = Vec::with_capacity(styles.len());
            for (style_index, style) in styles.iter().enumerate() {
                resolved_styles.push(resolve_style(style, context, &format!("{layer_location}.semanticStyles[{style_index}]"))?);
            }
            text_layer.insert("semanticStyles".to_owned(), Value::Array(resolved_styles));
        }
        resolved_layers.push(Value::Object(text_layer));
    }
    Ok(resolved_layers)
}

pub fn normalize_card_template_authoring(input: &Record) -> ShapeResult<Record> {
    if input.get("schemaVersion").and_then(Value::as_f64) != Some(1.0) {
        return Ok(input.clone());
    }
    let empty = Record::new();
    let registry = |key: &str| -> ShapeResult<&Record> {
        match input.get(key) {
            None => Ok(&empty),
            Some(value) => named_record(Some(value), key),
        }
    };
    let context = Context {
        fit_profile_sets: registry("fitProfileSets")?,
        fonts: registry("fonts")?,
        text_defaults: registry("textDefaults")?,
        typography_presets: registry("typographyPresets")?,
    };
    let mut normalized = input.clone();
    if let Some(Value::Array(layers)) = input.get("layers") {
        normalized.insert("layers".to_owned(), Value::Array(resolve_layers(layers, &context, "layers")?));
    }
    Ok(normalized)
}

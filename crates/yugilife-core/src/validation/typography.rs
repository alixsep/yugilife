use serde_json::Value;

use super::shape::{
    Record, ShapeResult, assert_no_unknown_keys, fail, finite_number, is_integer, non_empty_string, optional_string, positive_number,
    record,
};

pub const TEXT_TYPOGRAPHY_KEYS: &[&str] = &[
    "autoScaleXQuantifier",
    "fill",
    "stroke",
    "fit",
    "fitBlocks",
    "fitProfileOverrides",
    "fitProfileSet",
    "fitProfiles",
    "fontAssetId",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "maxAutoCompressionX",
    "maxHeight",
    "maxWidth",
    "minFontSize",
    "textAlign",
    "textAnchor",
    "verticalAnchor",
    "wrap",
];

pub fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0 && !number.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn is_one_of(value: Option<&Value>, allowed: &[&str]) -> bool {
    value.and_then(Value::as_str).is_some_and(|text| allowed.contains(&text))
}

pub fn merge_text_typography(base: &Record, patches: &[Option<&Record>]) -> ShapeResult<Record> {
    let mut merged = base.clone();
    for patch in patches.iter().flatten() {
        for (key, value) in patch.iter() {
            if key == "fitProfileOverrides" && (value.is_object() || value.is_array()) {
                let overrides: Record = match value {
                    Value::Array(entries) => entries.iter().enumerate().map(|(index, entry)| (index.to_string(), entry.clone())).collect(),
                    other => other.as_object().cloned().unwrap_or_default(),
                };
                let Some(Value::Array(profiles)) = merged.get("fitProfiles") else {
                    return fail("fitProfileOverrides requires resolved fitProfiles.");
                };
                let mut seen = std::collections::HashSet::new();
                let mut resolved_profiles = Vec::with_capacity(profiles.len());
                for profile in profiles {
                    let current = profile.as_object().cloned().unwrap_or_default();
                    let id = match current.get("id") {
                        Some(Value::String(id)) => id.clone(),
                        other => super::shape::string_of(other),
                    };
                    match overrides.get(&id).filter(|patch| is_truthy(patch)) {
                        Some(profile_patch) => {
                            seen.insert(id);
                            let mut resolved = current;
                            for (profile_key, profile_value) in profile_patch.as_object().into_iter().flatten() {
                                if profile_value.is_null() {
                                    resolved.shift_remove(profile_key);
                                } else {
                                    resolved.insert(profile_key.clone(), profile_value.clone());
                                }
                            }
                            resolved_profiles.push(Value::Object(resolved));
                        }
                        None => resolved_profiles.push(Value::Object(current)),
                    }
                }
                if let Some(id) = overrides.keys().find(|id| !seen.contains(*id)) {
                    return fail(format!("fitProfileOverrides references unknown profile \"{id}\"."));
                }
                merged.insert("fitProfiles".to_owned(), Value::Array(resolved_profiles));
            } else if key == "fitProfileSet" {
                return fail("fitProfileSet is only available while authoring a template.");
            } else if value.is_null() {
                merged.shift_remove(key);
            } else {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    merged.shift_remove("fitProfileOverrides");
    merged.shift_remove("fitProfileSet");
    Ok(merged)
}

fn validate_text_stroke(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    let stroke = record(value, location)?;
    assert_no_unknown_keys(stroke, &["align", "color", "linejoin", "opacity", "width"], location)?;
    non_empty_string(stroke.get("color"), &format!("{location}.color"))?;
    positive_number(stroke.get("width"), &format!("{location}.width"))?;
    if stroke.get("align").is_some() && !is_one_of(stroke.get("align"), &["center", "outer"]) {
        return fail(format!("{location}.align must be \"center\" or \"outer\"."));
    }
    if stroke.get("linejoin").is_some() && !is_one_of(stroke.get("linejoin"), &["bevel", "miter", "round"]) {
        return fail(format!("{location}.linejoin must be \"bevel\", \"miter\", or \"round\"."));
    }
    if stroke.get("opacity").is_some() {
        let opacity = finite_number(stroke.get("opacity"), &format!("{location}.opacity"))?;
        if !(0.0..=1.0).contains(&opacity) {
            return fail(format!("{location}.opacity must be between 0 and 1."));
        }
    }
    Ok(())
}

fn validate_compression(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    if value.is_some() {
        let maximum = finite_number(value, location)?;
        if !(0.0..1.0).contains(&maximum) {
            return fail(format!("{location} must be at least 0 and less than 1."));
        }
    }
    Ok(())
}

pub fn validate_typography(value: Option<&Value>, location: &str) -> ShapeResult<()> {
    let typography = record(value, location)?;
    assert_no_unknown_keys(typography, TEXT_TYPOGRAPHY_KEYS, location)?;
    non_empty_string(typography.get("fill"), &format!("{location}.fill"))?;
    if typography.get("stroke").is_some() {
        validate_text_stroke(typography.get("stroke"), &format!("{location}.stroke"))?;
    }
    non_empty_string(typography.get("fontFamily"), &format!("{location}.fontFamily"))?;
    if typography.get("fit").is_some() && !is_one_of(typography.get("fit"), &["font-size", "scale-x"]) {
        return fail(format!("{location}.fit is unsupported."));
    }
    if typography.get("wrap").is_some() && !is_one_of(typography.get("wrap"), &["word"]) {
        return fail(format!("{location}.wrap is unsupported."));
    }
    let font_size = positive_number(typography.get("fontSize"), &format!("{location}.fontSize"))?;
    if typography.get("autoScaleXQuantifier").is_some() {
        let quantifier = positive_number(typography.get("autoScaleXQuantifier"), &format!("{location}.autoScaleXQuantifier"))?;
        if quantifier > 1.0 {
            return fail(format!("{location}.autoScaleXQuantifier must not exceed 1."));
        }
    }
    validate_compression(typography.get("maxAutoCompressionX"), &format!("{location}.maxAutoCompressionX"))?;
    if let Some(fit_blocks) = typography.get("fitBlocks") {
        let blocks_location = format!("{location}.fitBlocks");
        let blocks = record(Some(fit_blocks), &blocks_location)?;
        assert_no_unknown_keys(blocks, &["leading", "remainder", "split"], &blocks_location)?;
        if blocks.get("split").and_then(Value::as_str) != Some("leading-authored-line") {
            return fail(format!("{blocks_location}.split is unsupported."));
        }
        let leading_location = format!("{blocks_location}.leading");
        let leading = record(blocks.get("leading"), &leading_location)?;
        assert_no_unknown_keys(leading, &["mode", "preferredMaxLines"], &leading_location)?;
        if leading.get("mode").and_then(Value::as_str) != Some("prefer-lines") {
            return fail(format!("{leading_location}.mode is unsupported."));
        }
        let preferred = leading.get("preferredMaxLines");
        if !is_integer(preferred) || preferred.and_then(Value::as_f64).unwrap_or(0.0) <= 0.0 {
            return fail(format!("{leading_location}.preferredMaxLines must be a positive integer."));
        }
        let remainder_location = format!("{blocks_location}.remainder");
        let remainder = record(blocks.get("remainder"), &remainder_location)?;
        assert_no_unknown_keys(remainder, &["mode"], &remainder_location)?;
        if remainder.get("mode").and_then(Value::as_str) != Some("layer-fit") {
            return fail(format!("{remainder_location}.mode is unsupported."));
        }
    }
    optional_string(typography.get("fontAssetId"), &format!("{location}.fontAssetId"))?;
    if typography.get("letterSpacing").is_some() {
        finite_number(typography.get("letterSpacing"), &format!("{location}.letterSpacing"))?;
    }
    for key in ["lineHeight", "maxHeight", "maxWidth"] {
        if typography.get(key).is_some() {
            positive_number(typography.get(key), &format!("{location}.{key}"))?;
        }
    }
    if typography.get("minFontSize").is_some() {
        let minimum = positive_number(typography.get("minFontSize"), &format!("{location}.minFontSize"))?;
        if minimum > font_size {
            return fail(format!("{location}.minFontSize must not exceed fontSize."));
        }
    }
    if let Some(profiles) = typography.get("fitProfiles") {
        validate_fit_profiles(profiles, location)?;
    }
    match typography.get("fontWeight") {
        None => {}
        Some(Value::Number(number)) => {
            let weight = number.as_f64().unwrap_or(f64::NAN);
            if !weight.is_finite() || !(1.0..=1000.0).contains(&weight) {
                return fail(format!("{location}.fontWeight must be between 1 and 1000."));
            }
        }
        Some(Value::String(keyword)) => {
            if !["normal", "bold", "bolder", "lighter"].contains(&keyword.as_str()) {
                return fail(format!("{location}.fontWeight uses an unsupported keyword."));
            }
        }
        Some(_) => return fail(format!("{location}.fontWeight must be text or a number.")),
    }
    if typography.get("fontStyle").is_some() && !is_one_of(typography.get("fontStyle"), &["normal", "italic"]) {
        return fail(format!("{location}.fontStyle is unsupported."));
    }
    if typography.get("textAnchor").is_some() && !is_one_of(typography.get("textAnchor"), &["start", "middle", "end"]) {
        return fail(format!("{location}.textAnchor is unsupported."));
    }
    if typography.get("textAlign").is_some() && !is_one_of(typography.get("textAlign"), &["justify"]) {
        return fail(format!("{location}.textAlign is unsupported."));
    }
    if typography.get("verticalAnchor").is_some() && !is_one_of(typography.get("verticalAnchor"), &["baseline", "top"]) {
        return fail(format!("{location}.verticalAnchor is unsupported."));
    }
    Ok(())
}

fn validate_fit_profiles(value: &Value, location: &str) -> ShapeResult<()> {
    let Value::Array(profiles) = value else {
        return fail(format!("{location}.fitProfiles must be a non-empty array."));
    };
    if profiles.is_empty() {
        return fail(format!("{location}.fitProfiles must be a non-empty array."));
    }
    let mut ids = std::collections::HashSet::new();
    let mut previous_font_size = f64::INFINITY;
    for (index, value) in profiles.iter().enumerate() {
        let profile_location = format!("{location}.fitProfiles[{index}]");
        let profile = record(Some(value), &profile_location)?;
        assert_no_unknown_keys(profile, &["fontSize", "id", "label", "lineHeight", "maxAutoCompressionX", "maxLines"], &profile_location)?;
        let id = non_empty_string(profile.get("id"), &format!("{profile_location}.id"))?;
        if !ids.insert(id.to_owned()) {
            return fail(format!("{location}.fitProfiles contains duplicate ID \"{id}\"."));
        }
        non_empty_string(profile.get("label"), &format!("{profile_location}.label"))?;
        let font_size = positive_number(profile.get("fontSize"), &format!("{profile_location}.fontSize"))?;
        if font_size > previous_font_size {
            return fail(format!("{location}.fitProfiles must be ordered from largest font size to smallest."));
        }
        previous_font_size = font_size;
        if profile.get("lineHeight").is_some() {
            positive_number(profile.get("lineHeight"), &format!("{profile_location}.lineHeight"))?;
        }
        validate_compression(profile.get("maxAutoCompressionX"), &format!("{profile_location}.maxAutoCompressionX"))?;
        if let Some(maximum) = profile.get("maxLines")
            && (!is_integer(Some(maximum)) || maximum.as_f64().unwrap_or(0.0) <= 0.0)
        {
            return fail(format!("{profile_location}.maxLines must be a positive integer."));
        }
    }
    Ok(())
}

pub fn validate_text_typography_usage(typography: &Record, format: Option<&str>, location: &str) -> ShapeResult<()> {
    let text = |key: &str| typography.get(key).and_then(Value::as_str);
    let has = |key: &str| typography.get(key).is_some();
    if text("textAlign") == Some("justify") {
        if format != Some("lines") || text("wrap") != Some("word") {
            return fail(format!("{location}.textAlign \"justify\" requires multiline word wrapping."));
        }
        if !has("maxWidth") {
            return fail(format!("{location}.textAlign \"justify\" requires maxWidth."));
        }
    }
    if text("fit") == Some("scale-x") && format == Some("lines") {
        return fail(format!("{location}.fit \"scale-x\" is unsupported for multiline text."));
    }
    if text("fit") == Some("scale-x") && has("minFontSize") {
        return fail(format!("{location}.minFontSize cannot be used with fit \"scale-x\"."));
    }
    if has("wrap") && format != Some("lines") {
        return fail(format!("{location}.wrap requires format \"lines\"."));
    }
    if has("wrap") && !has("maxWidth") {
        return fail(format!("{location}.wrap requires maxWidth."));
    }
    if has("wrap") && text("fit") == Some("scale-x") {
        return fail(format!("{location}.wrap cannot be used with fit \"scale-x\"."));
    }
    if has("fitProfiles") {
        let wrapped_multiline = format == Some("lines") && text("wrap") == Some("word");
        let single_line_preset = format == Some("type-list") && !has("wrap");
        if !wrapped_multiline && !single_line_preset {
            return fail(format!("{location}.fitProfiles requires multiline word wrapping or a type-list text layer."));
        }
        if !has("maxWidth") {
            return fail(format!("{location}.fitProfiles requires maxWidth."));
        }
        if wrapped_multiline && text("fit") == Some("scale-x") {
            return fail(format!("{location}.fitProfiles cannot be combined with scale-x fitting for multiline text."));
        }
        if has("minFontSize") {
            return fail(format!("{location}.fitProfiles cannot be combined with minFontSize fitting."));
        }
    }
    if has("fitBlocks") {
        if format != Some("lines") || text("wrap") != Some("word") {
            return fail(format!("{location}.fitBlocks requires multiline word wrapping."));
        }
        if !has("fitProfiles") {
            return fail(format!("{location}.fitBlocks requires fitProfiles."));
        }
    }
    if has("autoScaleXQuantifier") && !has("fitProfiles") {
        return fail(format!("{location}.autoScaleXQuantifier requires fitProfiles."));
    }
    if has("maxAutoCompressionX") && !has("fitProfiles") {
        return fail(format!("{location}.maxAutoCompressionX requires fitProfiles."));
    }
    Ok(())
}

pub fn validate_typography_patch(value: Option<&Value>, base: &Record, format: Option<&str>, location: &str) -> ShapeResult<()> {
    let patch = record(value, location)?;
    if patch.is_empty() {
        return fail(format!("{location} must declare at least one typography override."));
    }
    assert_no_unknown_keys(patch, TEXT_TYPOGRAPHY_KEYS, location)?;
    if patch.get("fitProfileSet").is_some() {
        return fail(format!("{location}.fitProfileSet is only available in template source typography."));
    }
    let merged = merge_text_typography(base, &[Some(patch)])?;
    let merged_value = Value::Object(merged);
    validate_typography(Some(&merged_value), location)?;
    validate_text_typography_usage(merged_value.as_object().unwrap_or(&Record::new()), format, location)
}

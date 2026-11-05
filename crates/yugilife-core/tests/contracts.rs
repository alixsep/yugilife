use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::assets::AssetSource;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::number::js_round;
use yugilife_core::raster::grading::{ColorPreset, apply_color_preset};
use yugilife_core::render::{RenderOptions, render_card};
use yugilife_core::validation::{
    Record, create_card_from_template, validate_card_data, validate_card_template, validate_presentation_overrides,
    validate_template_manifest,
};

fn name_field() -> Value {
    json!({ "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true })
}

fn test_template(overrides: Value) -> Value {
    let mut template = json!({
        "schemaVersion": 1,
        "dimensions": { "width": 100, "height": 150 },
        "cardFields": [name_field()],
        "layers": [],
    });
    if let (Some(base), Some(patch)) = (template.as_object_mut(), overrides.as_object()) {
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }
    template
}

fn without_key(mut value: Value, key: &str) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.remove(key);
    }
    value
}

fn test_manifest() -> Value {
    json!({
        "assets": {},
        "id": "card/test",
        "kind": "card",
        "name": "Test template",
        "template": "template.json",
        "version": "2026.01.01",
    })
}

fn test_bundle(template: Value) -> TemplateBundle {
    TemplateBundle::new(test_manifest(), &template, json!({}), IndexMap::new()).expect("test bundle must be valid")
}

fn card(fields: Value) -> CardData {
    CardData::from_json(fields.as_object().expect("card fields must be an object"))
}

fn validated(template: Value) -> Record {
    validate_card_template(&template).expect("template must be valid")
}

fn template_error(template: Value) -> String {
    validate_card_template(&template).expect_err("template must be rejected").message().to_owned()
}

fn card_error(fields: Value, template: &Record) -> String {
    validate_card_data(&card(fields), template).expect_err("card must be rejected").message().to_owned()
}

fn render_error(fields: Value, template: Value) -> String {
    let bundle = test_bundle(template);
    match render_card(&card(fields), &bundle, &RenderOptions::default()) {
        Ok(_) => panic!("render must fail"),
        Err(error) => error.message().to_owned(),
    }
}

fn assert_contains_in_order(message: &str, fragments: &[&str]) {
    let mut remaining = message;
    for fragment in fragments {
        let Some(index) = remaining.find(fragment) else {
            panic!("expected {fragment:?} in order within {message:?}");
        };
        remaining = &remaining[index + fragment.len()..];
    }
}

fn text_layer(id: &str, field: &str, typography: Value) -> Value {
    json!({ "id": id, "kind": "text", "field": field, "position": { "x": 0, "y": 0 }, "typography": typography })
}

fn basic_typography() -> Value {
    json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20 })
}

#[test]
fn accepts_calendar_template_versions_and_rejects_numeric_or_malformed_versions() {
    let manifest = test_manifest();
    let with_version = |version: Value| {
        let mut changed = manifest.clone();
        changed["version"] = version;
        validate_template_manifest(&changed)
    };
    assert!(validate_template_manifest(&manifest).is_ok());
    assert!(with_version(json!("2026.01.01.10")).is_ok());
    for version in [json!(52), json!("2026.02.29"), json!("2026.01.01.0")] {
        let message = with_version(version).expect_err("version must be rejected").message().to_owned();
        assert_eq!(message, "Malformed template manifest: version must use YYYY.MM.DD or YYYY.MM.DD.N.");
    }
}

#[test]
fn rejects_unsupported_template_schema_versions() {
    for schema_version in [0, -1, 2] {
        let message = template_error(test_template(json!({ "schemaVersion": schema_version })));
        assert_eq!(
            message,
            format!(
                "Malformed card template: Unsupported card template schemaVersion {schema_version}; current version is 1. Migrate the template before using it."
            )
        );
    }
}

#[test]
fn requires_a_template_schema_version() {
    let message = template_error(without_key(test_template(json!({})), "schemaVersion"));
    assert_eq!(message, "Malformed card template: schemaVersion is required.");
}

#[test]
fn accepts_the_supported_template_schema_version() {
    assert_eq!(validated(test_template(json!({}))).get("schemaVersion"), Some(&json!(1)));
}

#[test]
fn validates_semantic_region_selections_in_the_current_schema() {
    let template = test_template(json!({
        "layers": [{
            "assetId": "marker.asset",
            "id": "marker",
            "kind": "image",
            "region": { "height": 10, "width": 10, "x": 0, "y": 0 },
        }],
        "presentationRules": [{
            "id": "region-selection",
            "layerRegions": { "marker": { "height": 20, "width": 20, "x": 5, "y": 6 } },
            "when": { "equals": "frame", "path": "frame" },
        }],
        "semanticBindings": { "bindings": [{ "path": "frame", "source": { "value": "frame" } }] },
    }));
    assert_eq!(validated(template).get("schemaVersion"), Some(&json!(1)));
}

#[test]
fn rejects_an_obsolete_semantic_binding_shape() {
    let message = template_error(test_template(json!({ "semanticBindings": { "kind": "document" } })));
    assert!(message.contains("semanticBindings has unsupported fields: kind"), "{message}");
}

#[test]
fn allows_one_combined_frame_and_border_layer() {
    let template = validated(test_template(json!({
        "layers": [{
            "id": "combined-frame",
            "kind": "image",
            "assetId": "custom.frame-and-border",
            "region": { "x": 0, "y": 0, "width": 100, "height": 150 },
        }],
    })));
    assert_eq!(template["layers"].as_array().map(Vec::len), Some(1));
}

#[test]
fn rejects_duplicate_layer_ids_across_nested_groups() {
    let message = template_error(test_template(json!({
        "layers": [{
            "id": "duplicate",
            "kind": "group",
            "layers": [{ "id": "duplicate", "kind": "svg", "element": { "tag": "g" } }],
        }],
    })));
    assert_contains_in_order(&message, &["Duplicate layer ID \"duplicate\"", "layers[0].layers[0]"]);
}

#[test]
fn enforces_strict_shared_template_shape_rules() {
    let duplicate_fields = template_error(test_template(json!({ "cardFields": [name_field(), name_field()] })));
    assert!(duplicate_fields.contains("Duplicate card field \"name\""), "{duplicate_fields}");

    let typography = json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20, "maxWidth": -1 });
    let negative_width = template_error(test_template(json!({ "layers": [text_layer("name", "name", typography)] })));
    assert!(negative_width.contains("maxWidth must be positive"), "{negative_width}");
}

#[test]
fn allows_semantic_only_text_layers_without_a_card_field() {
    let template = validated(test_template(json!({
        "semanticBindings": { "bindings": [{ "path": "label", "source": { "value": "DOCUMENT" } }] },
        "layers": [{
            "id": "label",
            "kind": "text",
            "semanticPath": "label",
            "position": { "x": 0, "y": 20 },
            "typography": basic_typography(),
        }],
    })));
    assert_eq!(template["layers"][0]["id"], json!("label"));
    assert_eq!(template["layers"][0]["semanticPath"], json!("label"));

    let message = template_error(test_template(json!({
        "layers": [{
            "id": "missing-source",
            "kind": "text",
            "position": { "x": 0, "y": 20 },
            "typography": basic_typography(),
        }],
    })));
    assert!(message.contains("must declare field or semanticPath"), "{message}");
}

#[test]
fn validates_justified_text_as_word_wrapped_multiline_presentation() {
    let justified = json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20, "textAlign": "justify" });
    let message = template_error(test_template(json!({ "layers": [text_layer("name", "name", justified)] })));
    assert!(message.contains("textAlign \"justify\" requires multiline word wrapping"), "{message}");

    let right = json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20, "textAlign": "right" });
    let message = template_error(test_template(json!({ "layers": [text_layer("name", "name", right)] })));
    assert!(message.contains("textAlign is unsupported"), "{message}");
}

#[test]
fn rejects_a_layer_that_references_an_undeclared_card_field() {
    let message = template_error(test_template(json!({ "layers": [text_layer("atk", "attack", basic_typography())] })));
    assert!(message.contains("references card field \"attack\", which the template does not declare"), "{message}");
}

#[test]
fn rejects_incompatible_field_kinds_for_core_layer_renderers() {
    let repeated = template_error(test_template(json!({
        "layers": [{
            "assetId": "star",
            "field": "name",
            "id": "stars",
            "kind": "repeated-image",
            "offset": { "x": 1, "y": 0 },
            "region": { "height": 1, "width": 1, "x": 0, "y": 0 },
        }],
    })));
    assert!(repeated.contains("layers[0].field must reference a number field"), "{repeated}");

    let artwork = template_error(test_template(json!({
        "layers": [{ "field": "name", "id": "artwork", "kind": "artwork", "region": { "height": 1, "width": 1, "x": 0, "y": 0 } }],
    })));
    assert!(artwork.contains("layers[0].field must reference an image field"), "{artwork}");
}

#[test]
fn validates_shared_artwork_placement_mask_fields_and_bounded_transforms() {
    let template = validated(test_template(json!({
        "cardFields": [
            name_field(),
            { "kind": "image", "label": "Artwork", "name": "artwork" },
            { "kind": "image", "label": "Alpha", "name": "alpha" },
        ],
        "layers": [{
            "field": "artwork",
            "id": "cutout",
            "kind": "artwork",
            "maskChannel": "luminance",
            "maskField": "alpha",
            "placementRegion": { "height": 80, "width": 80, "x": 10, "y": 10 },
            "region": { "height": 100, "width": 100, "x": 0, "y": 0 },
            "transformId": "shared-artwork",
        }],
    })));
    let expanded = json!({ "artworkTransforms": { "shared-artwork": { "mode": "expanded", "scale": 2, "x": 0.25, "y": -0.25 } } });
    assert!(validate_presentation_overrides(&expanded, &template).is_ok());

    let shrunk = json!({ "artworkTransforms": { "shared-artwork": { "scale": 0.5, "x": 0, "y": 0 } } });
    let message = validate_presentation_overrides(&shrunk, &template).expect_err("scale must be rejected").message().to_owned();
    assert!(message.contains("scale must be between 1 and 8"), "{message}");
}

#[test]
fn rejects_incompatible_semantic_transform_and_fallback_kinds() {
    let unique = template_error(test_template(json!({
        "semanticBindings": {
            "bindings": [{ "path": "bad.list", "source": { "field": "name" }, "transform": { "kind": "unique-list" } }],
        },
    })));
    assert_contains_in_order(&unique, &["unique-list", "requires a list source"]);

    let lookup = template_error(test_template(json!({
        "cardFields": [name_field(), { "kind": "text-list", "label": "Tags", "name": "tags" }],
        "semanticBindings": {
            "bindings": [{
                "path": "bad.lookup",
                "source": { "field": "tags" },
                "transform": { "kind": "lookup", "values": { "a": "A" } },
            }],
        },
    })));
    assert_contains_in_order(&lookup, &["lookup", "requires a scalar source"]);

    let fallback = template_error(test_template(json!({
        "semanticBindings": {
            "bindings": [
                { "path": "scalar", "source": { "field": "name" } },
                {
                    "fallback": { "kind": "list-length", "source": { "path": "scalar" } },
                    "path": "bad.fallback",
                    "source": { "field": "name" },
                },
            ],
        },
    })));
    assert!(fallback.contains("fallback.source must reference a list value"), "{fallback}");
}

#[test]
fn rejects_unknown_keys_on_core_layer_definitions() {
    let dimensions = template_error(test_template(json!({ "dimensions": { "depth": 1, "height": 150, "width": 100 } })));
    assert!(dimensions.contains("dimensions has unsupported fields: depth"), "{dimensions}");

    let opacity = template_error(test_template(json!({
        "layers": [{
            "assetId": "frame",
            "id": "frame",
            "kind": "image",
            "opacity": 0.5,
            "region": { "height": 150, "width": 100, "x": 0, "y": 0 },
        }],
    })));
    assert!(opacity.contains("layers[0] has unsupported fields: opacity"), "{opacity}");

    let typography = json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20, "typo": true });
    let typo = template_error(test_template(json!({ "layers": [text_layer("name", "name", typography)] })));
    assert!(typo.contains("typography has unsupported fields: typo"), "{typo}");
}

#[test]
fn validates_repeated_image_integer_values_before_rendering() {
    let template = validated(test_template(json!({
        "cardFields": [name_field(), { "kind": "number", "label": "Count", "name": "count" }],
        "layers": [{
            "assetId": "marker",
            "field": "count",
            "id": "markers",
            "kind": "repeated-image",
            "offset": { "x": 1, "y": 0 },
            "region": { "height": 1, "width": 1, "x": 0, "y": 0 },
        }],
    })));
    let message = card_error(json!({ "count": 1.5, "name": "Card" }), &template);
    assert_eq!(message, "Card data does not satisfy this template: \"count\" must be a non-negative integer.");
}

#[test]
fn requires_a_name_field_and_rejects_unsupported_field_metadata() {
    let missing_name = template_error(test_template(json!({ "cardFields": [{ "kind": "text", "label": "Code", "name": "cardCode" }] })));
    assert!(missing_name.contains("cardFields must declare the \"name\" field"), "{missing_name}");

    let mut restricted_name = name_field();
    restricted_name["options"] = json!(["A", "B"]);
    restricted_name["defaultValue"] = json!("C");
    let default_outside = template_error(test_template(json!({ "cardFields": [restricted_name] })));
    assert!(default_outside.contains("defaultValue must be one of: A, B"), "{default_outside}");

    let text_minimum = template_error(test_template(json!({
        "cardFields": [name_field(), { "kind": "text", "label": "Level", "name": "level", "min": 1 }],
    })));
    assert!(text_minimum.contains("may only use min and max on numeric fields"), "{text_minimum}");
}

#[test]
fn validates_open_text_suggestions_without_constraining_card_values() {
    let mut suggested_name = name_field();
    suggested_name["suggestions"] = json!([{ "label": "1st Edition", "value": "1<sup>st</sup> Edition" }, { "value": "Limited Edition" }]);
    let template = validated(test_template(json!({ "cardFields": [suggested_name] })));
    assert!(validate_card_data(&card(json!({ "name": "Custom Edition" })), &template).is_ok());

    let mut duplicate = name_field();
    duplicate["suggestions"] = json!([{ "value": "Duplicate" }, { "value": "Duplicate" }]);
    let message = template_error(test_template(json!({ "cardFields": [duplicate] })));
    assert!(message.contains("duplicate value"), "{message}");

    let mut both = name_field();
    both["options"] = json!(["A"]);
    both["suggestions"] = json!([{ "value": "B" }]);
    let message = template_error(test_template(json!({ "cardFields": [both] })));
    assert!(message.contains("cannot declare both options and suggestions"), "{message}");
}

fn fitted_name_layer() -> Value {
    json!({
        "field": "name",
        "format": "lines",
        "id": "fittedName",
        "kind": "text",
        "position": { "x": 0, "y": 0 },
        "typography": {
            "fill": "#000",
            "fitProfiles": [{ "fontSize": 20, "id": "large", "label": "Large", "maxLines": 2 }],
            "fontFamily": "Test",
            "fontSize": 20,
            "maxWidth": 100,
            "wrap": "word",
        },
    })
}

#[test]
fn validates_template_declared_automatic_text_fit_controls() {
    let mut missing = name_field();
    missing["automaticFitLayer"] = json!("missing");
    let message = template_error(test_template(json!({ "cardFields": [missing], "layers": [fitted_name_layer()] })));
    assert!(message.contains("automaticFitLayer references unknown text layer \"missing\""), "{message}");

    let mut fitted = name_field();
    fitted["automaticFitLayer"] = json!("fittedName");
    let template = validated(test_template(json!({ "cardFields": [fitted], "layers": [fitted_name_layer()] })));
    assert_eq!(template["cardFields"][0]["automaticFitLayer"], json!("fittedName"));
}

fn quantified_layer() -> Value {
    json!({
        "field": "name",
        "format": "lines",
        "id": "fittedName",
        "kind": "text",
        "position": { "x": 0, "y": 0 },
        "typography": {
            "autoScaleXQuantifier": 0.01,
            "fill": "#000",
            "fitBlocks": {
                "leading": { "mode": "prefer-lines", "preferredMaxLines": 1 },
                "remainder": { "mode": "layer-fit" },
                "split": "leading-authored-line",
            },
            "fitProfiles": [{ "fontSize": 20, "id": "large", "label": "Large", "maxAutoCompressionX": 0.2, "maxLines": 2 }],
            "fontFamily": "Test",
            "fontSize": 20,
            "maxWidth": 100,
            "wrap": "word",
        },
    })
}

#[test]
fn validates_quantified_automatic_compression_and_authored_line_fit_blocks() {
    assert!(validate_card_template(&test_template(json!({ "layers": [quantified_layer()] }))).is_ok());

    let mut full_compression = quantified_layer();
    full_compression["typography"]["fitProfiles"][0]["maxAutoCompressionX"] = json!(1);
    let message = template_error(test_template(json!({ "layers": [full_compression] })));
    assert!(message.contains("maxAutoCompressionX must be at least 0 and less than 1"), "{message}");

    let mut zero_quantifier = quantified_layer();
    zero_quantifier["typography"]["autoScaleXQuantifier"] = json!(0);
    let message = template_error(test_template(json!({ "layers": [zero_quantifier] })));
    assert!(message.contains("autoScaleXQuantifier must be positive"), "{message}");

    let mut independent = quantified_layer();
    independent["typography"]["fitBlocks"]["remainder"] = json!({ "mode": "independent" });
    let message = template_error(test_template(json!({ "layers": [independent] })));
    assert!(message.contains("fitBlocks.remainder.mode is unsupported"), "{message}");
}

#[test]
fn normalizes_current_schema_typography_authoring_defaults() {
    let authored = test_template(json!({
        "fonts": { "Test": "font.test" },
        "textDefaults": { "autoScaleXQuantifier": 0.01, "maxAutoCompressionX": 0.2 },
        "fitProfileSets": {
            "description": [
                { "id": "large", "label": "Large", "fontSize": 20, "lineHeight": 20, "maxLines": 2 },
                { "id": "small", "label": "Small", "fontSize": 16, "lineHeight": 16, "maxLines": 3 },
            ],
        },
        "typographyPresets": { "compact": { "maxHeight": 40 } },
        "semanticBindings": { "bindings": [{ "path": "variant", "source": { "value": "special" } }] },
        "layers": [{
            "field": "name",
            "format": "lines",
            "id": "fittedName",
            "kind": "text",
            "position": { "x": 0, "y": 0 },
            "typography": {
                "fill": "#000",
                "fitProfileSet": "description",
                "fitProfileOverrides": { "large": { "maxLines": 1 } },
                "fontFamily": "Test",
                "fontSize": 20,
                "maxWidth": 100,
                "wrap": "word",
            },
            "semanticStyles": [{
                "id": "compact",
                "label": "Compact",
                "typographyPreset": "compact",
                "when": { "path": "variant", "in": ["special", "alternate"] },
            }],
        }],
    }));
    let resolved = validated(authored);
    let layer = &resolved["layers"][0];
    assert_eq!(layer["typography"]["autoScaleXQuantifier"], json!(0.01));
    assert_eq!(layer["typography"]["fontAssetId"], json!("font.test"));
    assert_eq!(layer["typography"]["maxAutoCompressionX"], json!(0.2));
    let profiles: Vec<(Value, Value)> = layer["typography"]["fitProfiles"]
        .as_array()
        .expect("fit profiles must be resolved")
        .iter()
        .map(|profile| (profile["id"].clone(), profile["maxLines"].clone()))
        .collect();
    assert_eq!(profiles, vec![(json!("large"), json!(1)), (json!("small"), json!(3))]);
    assert_eq!(layer["semanticStyles"][0]["typography"], json!({ "maxHeight": 40 }));
}

#[test]
fn rejects_unknown_sparse_profile_overrides() {
    let message = template_error(test_template(json!({
        "fitProfileSets": { "one": [{ "id": "large", "label": "Large", "fontSize": 20 }] },
        "layers": [{
            "field": "name",
            "format": "lines",
            "id": "fittedName",
            "kind": "text",
            "position": { "x": 0, "y": 0 },
            "typography": {
                "fill": "#000",
                "fitProfileSet": "one",
                "fitProfileOverrides": { "missing": { "maxLines": 1 } },
                "fontFamily": "Test",
                "fontSize": 20,
                "maxWidth": 100,
                "wrap": "word",
            },
        }],
    })));
    assert!(message.contains("references unknown profile \"missing\""), "{message}");
}

fn card_fields(card: &CardData) -> Vec<(String, Value)> {
    card.fields().map(|(name, value)| (name.clone(), value.json().cloned().unwrap_or(Value::Null))).collect()
}

#[test]
fn builds_a_starting_card_from_declared_field_defaults() {
    let mut named = name_field();
    named["defaultValue"] = json!("Default name");
    let template = test_template(json!({
        "cardFields": [
            named,
            { "kind": "number", "label": "ATK", "name": "attack", "defaultValue": 2500 },
            { "kind": "text-list", "label": "Types", "name": "types" },
            { "kind": "number-pair", "label": "Scales", "name": "scales", "min": 2 },
        ],
    }));
    let created = create_card_from_template(template.as_object().expect("template must be an object"));
    assert_eq!(
        card_fields(&created),
        vec![
            ("name".to_owned(), json!("Default name")),
            ("attack".to_owned(), json!(2500)),
            ("types".to_owned(), json!([])),
            ("scales".to_owned(), json!([2, 2])),
        ]
    );
}

#[test]
fn validates_card_values_against_declared_field_constraints() {
    let template = validated(test_template(json!({
        "cardFields": [
            name_field(),
            { "kind": "number", "label": "ATK", "name": "attack", "min": 0, "max": 9999 },
            { "kind": "text", "label": "Attribute", "name": "attribute", "options": ["DARK", "LIGHT"] },
        ],
    })));
    assert_eq!(card_error(json!({ "name": "" }), &template), "Card data does not satisfy this template: \"name\" is required.");
    assert_eq!(
        card_error(json!({ "name": "Card", "attack": 10_000 }), &template),
        "Card data does not satisfy this template: \"attack\" must be at most 9999."
    );
    assert_eq!(
        card_error(json!({ "name": "Card", "attribute": "WATER" }), &template),
        "Card data does not satisfy this template: \"attribute\" must be one of: DARK, LIGHT."
    );
    assert!(validate_card_data(&card(json!({ "name": "Card", "attack": 2500, "attribute": "DARK" })), &template).is_ok());
}

#[test]
fn rejects_template_defaults_that_violate_field_constraints() {
    let cases = [
        (json!({ "kind": "text", "label": "Required", "name": "required", "required": true }), "cardFields[1] is required"),
        (json!({ "defaultValue": "many", "kind": "number", "label": "Count", "name": "count" }), "defaultValue must be a finite number"),
        (json!({ "defaultValue": 0, "kind": "number", "label": "Count", "min": 1, "name": "count" }), "defaultValue must be at least 1"),
        (json!({ "defaultValue": 2, "kind": "number", "label": "Count", "max": 1, "name": "count" }), "defaultValue must be at most 1"),
        (
            json!({ "defaultValue": "long", "kind": "text", "label": "Code", "maxLength": 3, "name": "code" }),
            "defaultValue must not exceed 3 characters",
        ),
        (
            json!({ "defaultValue": ["a", "b"], "kind": "text-list", "label": "Types", "maxItems": 1, "name": "types" }),
            "defaultValue must contain at most 1 entries",
        ),
        (
            json!({ "defaultValue": "WATER", "kind": "text", "label": "Attribute", "name": "attribute", "options": ["DARK"] }),
            "defaultValue must be one of: DARK",
        ),
        (json!({ "defaultValue": 42, "kind": "image", "label": "Artwork", "name": "artwork" }), "defaultValue must be an image source"),
    ];
    for (field, expected) in cases {
        let message = template_error(test_template(json!({ "cardFields": [name_field(), field] })));
        assert!(message.contains(expected), "expected {expected:?} in {message:?}");
    }
}

#[test]
fn guarantees_a_validated_template_creates_immediately_valid_card_data() {
    let template = validated(test_template(json!({
        "cardFields": [
            name_field(),
            { "kind": "number", "label": "Level", "max": 12, "min": 1, "name": "level", "required": true },
            { "kind": "text", "label": "Attribute", "name": "attribute", "options": ["DARK", "LIGHT"], "required": true },
            { "defaultValue": "artwork.png", "kind": "image", "label": "Artwork", "name": "artwork", "required": true },
        ],
    })));
    let created = create_card_from_template(&template);
    assert_eq!(created.json("artwork"), Some(&json!("artwork.png")));
    assert_eq!(created.json("attribute"), Some(&json!("DARK")));
    assert_eq!(created.json("level"), Some(&json!(1)));
    assert!(validate_card_data(&created, &template).is_ok());
}

#[test]
fn validates_runtime_image_fields_as_image_sources() {
    let template = validated(test_template(json!({
        "cardFields": [
            name_field(),
            { "defaultValue": "artwork.png", "kind": "image", "label": "Artwork", "name": "artwork", "required": true },
        ],
    })));
    assert_eq!(
        card_error(json!({ "artwork": 42, "name": "Card" }), &template),
        "Card data does not satisfy this template: \"artwork\" must be an image source."
    );
    let mut with_asset = card(json!({ "name": "Card" }));
    with_asset.insert("artwork", CardValue::Asset(AssetSource::from_bytes(b"image".to_vec(), None, "blob")));
    assert!(validate_card_data(&with_asset, &template).is_ok());
}

#[test]
fn enforces_every_constraint_the_field_schema_accepts() {
    let template = validated(test_template(json!({
        "cardFields": [
            name_field(),
            { "kind": "multiline", "label": "Effect", "name": "effect", "maxItems": 2, "maxLength": 8 },
            { "kind": "text-list", "label": "Types", "name": "types", "maxLength": 4 },
            { "kind": "number-pair", "label": "Scales", "name": "scales", "min": 0, "max": 13 },
        ],
    })));
    let accepts = |fields: Value| validate_card_data(&card(fields), &template).is_ok();
    let prefix = "Card data does not satisfy this template: ";

    assert_eq!(
        card_error(json!({ "name": "C", "effect": ["a", "b", "c"] }), &template),
        format!("{prefix}\"effect\" must contain at most 2 lines.")
    );
    assert_eq!(
        card_error(json!({ "name": "C", "effect": "a\nb\nc" }), &template),
        format!("{prefix}\"effect\" must contain at most 2 lines.")
    );
    assert!(accepts(json!({ "name": "C", "effect": "ok\nok" })));
    assert_eq!(
        card_error(json!({ "name": "C", "effect": "far too long" }), &template),
        format!("{prefix}\"effect\" must not exceed 8 characters.")
    );
    assert!(accepts(json!({ "effect": "<color value=\"#ff0000\">1234\n5678</color>", "name": "C" })));
    assert_eq!(
        card_error(json!({ "effect": "<color value=\"#ff0000\">123456789</color>", "name": "C" }), &template),
        format!("{prefix}\"effect\" must not exceed 8 characters.")
    );
    assert_eq!(
        card_error(json!({ "name": "C", "types": ["Dragon"] }), &template),
        format!("{prefix}\"types\" must not exceed 4 characters.")
    );
    assert!(accepts(json!({ "name": "C", "types": ["Rock"] })));
    assert!(accepts(json!({ "name": "C", "types": ["<color value=\"#ff0000\">Rock</color>"] })));
    assert_eq!(card_error(json!({ "name": "C", "scales": [0, 99] }), &template), format!("{prefix}\"scales\"[1] must be at most 13."));
    assert_eq!(card_error(json!({ "name": "C", "scales": [-1, 4] }), &template), format!("{prefix}\"scales\"[0] must be at least 0."));
    assert!(accepts(json!({ "name": "C", "scales": [2, 9] })));
}

#[test]
fn guarantees_the_name_field_matches_the_card_data_contract() {
    let message = template_error(test_template(json!({
        "cardFields": [{ "kind": "number", "label": "Name", "name": "name", "required": true }],
    })));
    assert!(message.contains("\"name\" must use kind \"text\" or \"multiline\""), "{message}");
    assert!(validate_card_template(&test_template(json!({ "cardFields": [{ "kind": "text", "label": "Name", "name": "name" }] }))).is_ok());
}

#[test]
fn keeps_generated_numeric_fallbacks_inside_declared_bounds() {
    let template = test_template(json!({
        "cardFields": [
            name_field(),
            { "kind": "number", "label": "Level", "name": "level", "min": 3, "max": 12 },
            { "kind": "number-pair", "label": "Scales", "name": "scales", "min": 2, "max": 9 },
        ],
    }));
    let created = create_card_from_template(template.as_object().expect("template must be an object"));
    assert_eq!(created.json("level"), Some(&json!(3)));
    assert_eq!(created.json("scales"), Some(&json!([2, 2])));
}

#[test]
fn fails_before_rendering_unknown_layers_unresolved_assets_and_missing_fields() {
    let unknown =
        render_error(json!({ "name": "Test" }), test_template(json!({ "layers": [{ "id": "custom", "kind": "not-registered" }] })));
    assert_eq!(
        unknown,
        "Unknown layer kind or renderer \"not-registered\" on layer \"custom\". Register a renderer through RenderOptions.layerRenderers."
    );

    let unresolved = render_error(
        json!({ "name": "Test" }),
        test_template(json!({
            "layers": [{
                "id": "combined",
                "kind": "image",
                "assetId": "missing.asset",
                "region": { "x": 0, "y": 0, "width": 100, "height": 150 },
            }],
        })),
    );
    assert_eq!(unresolved, "Layer \"combined\" has unresolved semantic asset ID \"missing.asset\".");

    let unvalidated = test_template(json!({
        "cardFields": [name_field(), { "kind": "multiline", "label": "Effect", "name": "effect", "required": true }],
    }));
    let template = unvalidated.as_object().expect("template must be an object");
    assert_eq!(card_error(json!({ "name": "Test" }), template), "Card data does not satisfy this template: \"effect\" is required.");

    let zero_width = template_error(test_template(json!({ "dimensions": { "width": 0, "height": 150 } })));
    assert_contains_in_order(&zero_width, &["Malformed card template", "dimensions.width"]);
}

#[test]
fn does_not_resolve_inherited_object_properties_as_renderers_or_assets() {
    let renderer = render_error(json!({ "name": "Test" }), test_template(json!({ "layers": [{ "id": "polluted", "kind": "toString" }] })));
    assert!(renderer.contains("Unknown layer kind or renderer \"toString\""), "{renderer}");

    let asset = render_error(
        json!({ "name": "Test" }),
        test_template(json!({
            "layers": [{
                "id": "polluted-asset",
                "kind": "image",
                "assetId": "toString",
                "region": { "x": 0, "y": 0, "width": 100, "height": 150 },
            }],
        })),
    );
    assert!(asset.contains("unresolved semantic asset ID \"toString\""), "{asset}");
}

fn polynomial_preset(exponents: &[[u32; 3]], coefficients: &[[f64; 3]]) -> Value {
    json!({ "method": "rgb-polynomial", "exponents": exponents, "coefficients": coefficients })
}

fn apply_polynomial_reference(pixels: &mut [u8], exponents: &[[u32; 3]], coefficients: &[[f64; 3]]) {
    for pixel in pixels.as_chunks_mut::<4>().0 {
        let channels = [f64::from(pixel[0]) / 255.0, f64::from(pixel[1]) / 255.0, f64::from(pixel[2]) / 255.0];
        let terms: Vec<f64> = exponents
            .iter()
            .map(|exponent| exponent.iter().zip(channels).fold(1.0, |value, (power, channel)| value * channel.powf(f64::from(*power))))
            .collect();
        for channel in 0..3 {
            let value: f64 = terms.iter().zip(coefficients).map(|(term, coefficient)| term * coefficient[channel]).sum();
            pixel[channel] = js_round(value * 255.0).clamp(0.0, 255.0) as u8;
        }
    }
}

#[test]
fn applies_a_polynomial_preset_without_changing_alpha() {
    let identity_terms = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let identity_coefficients = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let preset = ColorPreset::from_json(&polynomial_preset(&identity_terms, &identity_coefficients)).expect("preset must be valid");
    let mut pixels = [100, 150, 200, 127];
    apply_color_preset(&mut pixels, &preset).expect("grading must succeed");
    assert_eq!(pixels, [100, 150, 200, 127]);
}

const CANONICAL_EXPONENTS: [[u32; 3]; 20] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [2, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 2, 0],
    [0, 1, 1],
    [0, 0, 2],
    [3, 0, 0],
    [2, 1, 0],
    [2, 0, 1],
    [1, 2, 0],
    [1, 1, 1],
    [1, 0, 2],
    [0, 3, 0],
    [0, 2, 1],
    [0, 1, 2],
    [0, 0, 3],
];

#[test]
fn keeps_optimized_canonical_transforms_byte_identical_to_the_generic_polynomial() {
    let source: Vec<u8> = (0..256_usize)
        .flat_map(|index| [index as u8, ((index * 73) % 256) as u8, ((index * 151) % 256) as u8, ((index * 37) % 256) as u8])
        .collect();
    for term_count in [4, 10, 20] {
        let exponents = &CANONICAL_EXPONENTS[..term_count];
        let coefficients: Vec<[f64; 3]> = (0..term_count)
            .map(|term| {
                [((term * 3) % 11) as f64 / 10.0 - 0.5, ((term * 5) % 13) as f64 / 10.0 - 0.6, ((term * 7) % 17) as f64 / 10.0 - 0.8]
            })
            .collect();
        let preset = ColorPreset::from_json(&polynomial_preset(exponents, &coefficients)).expect("preset must be valid");
        let mut expected = source.clone();
        let mut actual = source.clone();
        apply_polynomial_reference(&mut expected, exponents, &coefficients);
        apply_color_preset(&mut actual, &preset).expect("grading must succeed");
        assert_eq!(actual, expected, "{term_count} terms");
    }
}

#[test]
fn rejects_malformed_runtime_color_presets_through_the_shared_schema() {
    let error = |preset: Value| ColorPreset::from_json(&preset).expect_err("preset must be rejected").message().to_owned();
    assert_eq!(
        error(json!({ "method": "skimage-histogram-rgb-lut", "channels": { "r": [], "g": [], "b": [] } })),
        "Color preset.channels.r must contain 256 values from 0–255."
    );
    assert_eq!(
        error(json!({ "method": "rgb-polynomial", "exponents": [[0, 0, 0]], "coefficients": [] })),
        "Color preset must contain equally sized exponent and coefficient arrays."
    );
    assert_eq!(error(json!({ "method": "javascript" })), "Color preset uses unsupported method \"javascript\".");
}

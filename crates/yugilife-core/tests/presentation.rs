use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::card::CardData;
use yugilife_core::model::{CardTemplate, Primitive, SemanticValue};
use yugilife_core::presentation::{ResolvedCardPresentation, resolve_card_presentation};
use yugilife_core::raster::masks::scope_mask_alpha;
use yugilife_core::semantics::{CardSemantics, derive_card_semantics};
use yugilife_core::source_fields::layer_source_fields;
use yugilife_core::text::typography::TextAnchor;
use yugilife_core::validation::{validate_card_template, validate_presentation_overrides};

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

fn card_template(template: Value) -> CardTemplate {
    CardTemplate::from_normalized(validate_card_template(&template).expect("template must be valid"))
}

fn template_error(template: Value) -> String {
    validate_card_template(&template).expect_err("template must be rejected").message().to_owned()
}

fn card(fields: Value) -> CardData {
    CardData::from_json(fields.as_object().expect("card fields must be an object"))
}

fn semantics_for(template: &CardTemplate, fields: Value) -> CardSemantics {
    derive_card_semantics(&card(fields), template).expect("semantics must derive")
}

fn presentation(template: &CardTemplate, fields: Value, overrides: Option<Value>) -> ResolvedCardPresentation {
    resolve_card_presentation(template, semantics_for(template, fields), overrides.as_ref()).expect("presentation must resolve")
}

fn presentation_error(template: &CardTemplate, fields: Value, overrides: Value) -> String {
    resolve_card_presentation(template, semantics_for(template, fields), Some(&overrides))
        .expect_err("presentation must be rejected")
        .message()
        .to_owned()
}

fn text_value(text: &str) -> Option<SemanticValue> {
    Some(SemanticValue::Primitive(Primitive::String(text.to_owned())))
}

fn semantic_values(entries: &[(&str, Option<SemanticValue>)]) -> IndexMap<String, Option<SemanticValue>> {
    entries.iter().map(|(path, value)| ((*path).to_owned(), value.clone())).collect()
}

fn semantic_template() -> CardTemplate {
    card_template(test_template(json!({
        "cardFields": [
            name_field(),
            {
                "defaultValue": "plain",
                "kind": "text",
                "label": "Layout variant",
                "name": "layoutVariant",
                "options": ["annotated", "plain"],
                "required": true,
            },
            { "kind": "multiline", "label": "Description", "name": "description" },
        ],
        "semanticBindings": {
            "bindings": [
                { "path": "kind", "source": { "value": "document" } },
                { "path": "document.layout", "source": { "field": "layoutVariant" } },
            ],
        },
        "layers": [{
            "field": "description",
            "format": "lines",
            "id": "description",
            "kind": "text",
            "position": { "x": 0, "y": 20 },
            "semanticStyles": [{
                "id": "annotation",
                "label": "Annotation text",
                "typography": {
                    "fitProfiles": [
                        { "fontSize": 28, "id": "large", "label": "Large", "maxLines": 2 },
                        { "fontSize": 25, "id": "small", "label": "Small", "maxLines": 4 },
                    ],
                    "fontFamily": "Annotation",
                    "fontSize": 28,
                    "maxWidth": 100,
                },
                "when": { "equals": "annotated", "path": "document.layout" },
            }],
            "typography": {
                "fill": "#000",
                "fitProfiles": [
                    { "fontSize": 30, "id": "large", "label": "Large", "maxLines": 4 },
                    { "fontSize": 20, "id": "small", "label": "Small", "maxLines": 8 },
                ],
                "fontFamily": "Body",
                "fontSize": 30,
                "maxWidth": 100,
                "wrap": "word",
            },
        }],
    })))
}

#[test]
fn derives_template_owned_meaning_from_bindings_rather_than_display_text() {
    let semantics = semantics_for(&semantic_template(), json!({ "description": "Note", "layoutVariant": "annotated", "name": "Document" }));
    assert_eq!(semantics.values, semantic_values(&[("kind", text_value("document")), ("document.layout", text_value("annotated"))]));
}

#[test]
fn accepts_semantic_values_introduced_only_by_the_template() {
    let template = card_template(test_template(json!({
        "cardFields": [
            name_field(),
            {
                "defaultValue": "future-layout",
                "kind": "text",
                "label": "Template variant",
                "name": "variant",
                "options": ["legacy-layout", "future-layout"],
                "required": true,
            },
        ],
        "semanticBindings": { "bindings": [{ "path": "card.variant", "source": { "field": "variant" } }] },
    })));
    let semantics = semantics_for(&template, json!({ "name": "Document", "variant": "future-layout" }));
    assert_eq!(semantics.values, semantic_values(&[("card.variant", text_value("future-layout"))]));
}

#[test]
fn supports_template_declared_scalar_lookup_transforms() {
    let template = card_template(test_template(json!({
        "cardFields": [
            name_field(),
            {
                "defaultValue": "print",
                "kind": "text",
                "label": "Card variant",
                "name": "variant",
                "options": ["print", "screen"],
                "required": true,
            },
        ],
        "semanticBindings": {
            "bindings": [{
                "path": "kind",
                "source": { "field": "variant" },
                "transform": { "kind": "lookup", "values": { "print": "static", "screen": "interactive" } },
            }],
        },
    })));
    let semantics = semantics_for(&template, json!({ "name": "Document", "variant": "screen" }));
    assert_eq!(semantics.values, semantic_values(&[("kind", text_value("interactive"))]));
}

#[test]
fn maps_semantics_to_a_template_style_before_applying_per_style_overrides() {
    let template = semantic_template();
    let overrides = json!({
        "textTypography": { "description": { "annotation": { "fill": "#f00" } } },
        "textFitProfiles": { "description": { "annotation": "small", "default": "large" } },
    });

    let annotated = presentation(&template, json!({ "layoutVariant": "annotated", "name": "Document" }), Some(overrides.clone()));
    let annotated_text = &annotated.text["description"];
    assert_eq!(annotated_text.fit_profile_id.as_deref(), Some("small"));
    assert_eq!(annotated_text.style_id, "annotation");
    assert_eq!(annotated_text.style_label, "Annotation text");
    assert_eq!(annotated_text.typography.fill, "#f00");
    assert_eq!(annotated_text.typography.font_family, "Annotation");

    let plain = presentation(&template, json!({ "layoutVariant": "plain", "name": "Document" }), Some(overrides));
    let plain_text = &plain.text["description"];
    assert_eq!(plain_text.fit_profile_id.as_deref(), Some("large"));
    assert_eq!(plain_text.style_id, "default");
    assert_eq!(plain_text.style_label, "description");
    assert_eq!(plain_text.typography.fill, "#000");
    assert_eq!(plain_text.typography.font_family, "Body");
}

#[test]
fn inherits_default_typography_fields_through_partial_semantic_styles() {
    let resolved = presentation(&semantic_template(), json!({ "layoutVariant": "annotated", "name": "Document" }), None);
    let typography = &resolved.text["description"].typography;
    assert_eq!(typography.fill, "#000");
    assert_eq!(typography.font_family, "Annotation");
    assert!(typography.wrap_word);
}

#[test]
fn allows_a_semantic_patch_to_clear_an_optional_default_property() {
    let template = card_template(test_template(json!({
        "cardFields": [name_field(), { "kind": "text", "label": "Frame", "name": "frame" }],
        "semanticBindings": { "bindings": [{ "path": "frame", "source": { "field": "frame" } }] },
        "layers": [{
            "field": "name",
            "format": "plain",
            "id": "name",
            "kind": "text",
            "position": { "x": 0, "y": 20 },
            "semanticStyles": [{
                "id": "plain",
                "label": "Plain",
                "typography": { "textAnchor": null },
                "when": { "equals": "plain", "path": "frame" },
            }],
            "typography": { "fill": "#000", "fontFamily": "Test", "fontSize": 20, "textAnchor": "end" },
        }],
    })));
    let cleared = presentation(&template, json!({ "frame": "plain", "name": "Card" }), None);
    assert_eq!(cleared.text["name"].typography.text_anchor, None);
    let kept = presentation(&template, json!({ "frame": "ornate", "name": "Card" }), None);
    assert_eq!(kept.text["name"].typography.text_anchor, Some(TextAnchor::End));
}

#[test]
fn lets_editor_typography_patches_override_semantic_patches() {
    let overrides = json!({ "textTypography": { "description": { "annotation": { "fill": "#0f0", "fontSize": 18 } } } });
    let resolved = presentation(&semantic_template(), json!({ "layoutVariant": "annotated", "name": "Document" }), Some(overrides));
    let typography = &resolved.text["description"].typography;
    assert_eq!(typography.fill, "#0f0");
    assert_eq!(typography.font_family, "Annotation");
    assert_eq!(typography.font_size, 18.0);
}

#[test]
fn validates_persisted_presentation_overrides_before_resolving_them() {
    let template = semantic_template();
    let fields = || json!({ "layoutVariant": "plain", "name": "Document" });

    let null_fill =
        presentation_error(&template, fields(), json!({ "textTypography": { "description": { "default": { "fill": null } } } }));
    assert!(null_fill.contains("textTypography.description.default.fill must be a non-empty string"), "{null_fill}");

    let unknown_layer =
        presentation_error(&template, fields(), json!({ "textTypography": { "missing": { "default": { "fill": "#fff" } } } }));
    assert!(unknown_layer.contains("textTypography references unknown text layer \"missing\""), "{unknown_layer}");

    let unknown_profile =
        presentation_error(&template, fields(), json!({ "textFitProfiles": { "description": { "default": "missing" } } }));
    assert!(unknown_profile.contains("references unknown fit profile \"missing\""), "{unknown_profile}");

    let unexpected = presentation_error(&template, fields(), json!({ "unexpected": true }));
    assert!(unexpected.contains("Presentation overrides has unsupported fields: unexpected"), "{unexpected}");
}

fn raster_and_label_template() -> CardTemplate {
    card_template(test_template(json!({
        "masks": [{ "assetId": "mask", "id": "shape" }],
        "layers": [
            { "id": "paint", "kind": "raster", "region": { "height": 10, "width": 10, "x": 0, "y": 0 }, "renderer": "gradient" },
            {
                "field": "name",
                "id": "label",
                "kind": "text",
                "position": { "x": 0, "y": 20 },
                "typography": { "fill": "#000", "fontFamily": "Test", "fontSize": 20 },
            },
        ],
    })))
}

#[test]
fn validates_persisted_mask_overrides_against_template_owned_layers_and_masks() {
    let template = raster_and_label_template();
    let fields = || json!({ "name": "Card" });

    let missing_layer = presentation_error(&template, fields(), json!({ "layerMasks": { "missing": "shape" } }));
    assert!(missing_layer.contains("layerMasks references unknown layer \"missing\""), "{missing_layer}");

    let text_target = presentation_error(&template, fields(), json!({ "layerMasks": { "label": "shape" } }));
    assert!(text_target.contains("cannot assign a mask to non-raster layer \"label\""), "{text_target}");

    let missing_mask = presentation_error(&template, fields(), json!({ "layerMasks": { "paint": "missing" } }));
    assert!(missing_mask.contains("references unknown mask \"missing\""), "{missing_mask}");

    let resolved = presentation(&template, fields(), Some(json!({ "layerMasks": { "paint": "shape" } })));
    assert_eq!(resolved.layer_masks["paint"].id, "shape");
}

#[test]
fn rejects_an_empty_semantic_typography_patch() {
    let message = template_error(test_template(json!({
        "cardFields": [name_field(), { "kind": "text", "label": "Frame", "name": "frame" }],
        "semanticBindings": { "bindings": [{ "path": "frame", "source": { "field": "frame" } }] },
        "layers": [{
            "field": "name",
            "id": "name",
            "kind": "text",
            "position": { "x": 0, "y": 20 },
            "semanticStyles": [{ "id": "plain", "label": "Plain", "typography": {}, "when": { "equals": "plain", "path": "frame" } }],
            "typography": { "fill": "#000", "fontFamily": "Test", "fontSize": 20 },
        }],
    })));
    assert!(message.contains("must declare at least one typography override"), "{message}");
}

#[test]
fn requires_semantic_conditions_to_reference_template_declared_paths() {
    let message = template_error(test_template(json!({
        "presentationRules": [{
            "id": "unknown-path",
            "layerVisibility": { "missing": true },
            "when": { "equals": "anything", "path": "missing.path" },
        }],
        "semanticBindings": { "bindings": [{ "path": "kind", "source": { "value": "anything" } }] },
    })));
    assert!(message.contains("must reference a declared semantic binding"), "{message}");
}

#[test]
fn finds_direct_fields_and_transitive_semantic_presentation_dependencies() {
    let template = CardTemplate::from_normalized(
        test_template(json!({
            "cardFields": [name_field(), { "kind": "text", "label": "Status", "name": "status", "options": ["pending", "complete"] }],
            "layers": [{
                "assetId": "status.pending",
                "defaultVisible": false,
                "id": "pendingStatus",
                "kind": "image",
                "region": { "height": 10, "width": 10, "x": 0, "y": 0 },
            }],
            "presentationRules": [{
                "id": "pending-status",
                "layerVisibility": { "pendingStatus": true },
                "when": { "equals": "pending", "path": "display.status" },
            }],
            "semanticBindings": {
                "bindings": [
                    { "path": "status", "source": { "field": "status" } },
                    { "path": "display.status", "source": { "value": "pending" }, "when": { "equals": "pending", "path": "status" } },
                ],
            },
        }))
        .as_object()
        .cloned()
        .expect("template must be an object"),
    );
    let resolved = presentation(&template, json!({ "name": "Test", "status": "pending" }), None);
    assert_eq!(layer_source_fields(&template, &template.layers[0], &resolved), vec!["status".to_owned()]);
}

fn gated_title_template(gate: Value, when: Option<Value>) -> Value {
    let mut style = json!({
        "id": "gated",
        "label": "Gated title",
        "whenTransforms": gate,
        "typography": { "fill": "#ffffff", "stroke": { "color": "#000000", "width": 3 } },
    });
    let mut overrides = json!({
        "cardFields": [name_field(), { "kind": "image", "label": "Artwork", "name": "artwork" }],
        "layers": [
            { "id": "artwork", "kind": "artwork", "field": "artwork", "region": { "x": 0, "y": 0, "width": 100, "height": 100 } },
            {
                "id": "title",
                "kind": "text",
                "field": "name",
                "position": { "x": 10, "y": 20 },
                "typography": { "fill": "#111111", "fontFamily": "Test", "fontSize": 20 },
            },
        ],
    });
    if let Some(when) = when {
        style["when"] = when;
        overrides["semanticBindings"] = json!({ "bindings": [{ "path": "gate.on", "source": { "value": false } }] });
    }
    overrides["layers"][1]["semanticStyles"] = json!([style]);
    test_template(overrides)
}

fn title_style(template: &Value, mode: Option<&str>) -> String {
    let template = card_template(template.clone());
    let overrides = mode.map(|mode| json!({ "artworkTransforms": { "artwork": { "mode": mode, "scale": 1, "x": 0, "y": 0 } } }));
    presentation(&template, json!({ "artwork": "", "name": "Test card" }), overrides).text["title"].style_id.clone()
}

#[test]
fn selects_a_style_only_while_the_transform_carries_the_declared_mode() {
    let template = gated_title_template(json!({ "artwork": "full-art" }), None);
    assert_eq!(title_style(&template, None), "default");
    assert_eq!(title_style(&template, Some("full-art")), "gated");
    assert_eq!(title_style(&template, Some("other")), "default");
}

#[test]
fn matches_a_null_gate_only_when_the_transform_carries_no_mode() {
    let template = gated_title_template(json!({ "artwork": null }), None);
    assert_eq!(title_style(&template, None), "gated");
    assert_eq!(title_style(&template, Some("full-art")), "default");
}

#[test]
fn requires_the_semantic_and_transform_clauses_to_match_together() {
    let template = gated_title_template(json!({ "artwork": "full-art" }), Some(json!({ "path": "gate.on", "equals": true })));
    assert_eq!(title_style(&template, Some("full-art")), "default");
}

#[test]
fn rejects_a_gate_referencing_an_undeclared_artwork_transform() {
    let message = template_error(gated_title_template(json!({ "nope": "full-art" }), None));
    assert!(message.contains("unknown artwork transform \"nope\""), "{message}");
}

#[test]
fn rejects_a_style_without_a_semantic_or_transform_clause() {
    let mut template = gated_title_template(json!({ "artwork": "full-art" }), None);
    template["layers"][1]["semanticStyles"] = json!([{ "id": "empty", "label": "Empty", "typography": { "fill": "#fff" } }]);
    let message = template_error(template);
    assert!(message.contains("must declare when or whenTransforms"), "{message}");
}

#[test]
fn rejects_malformed_stroke_values_at_the_template_boundary() {
    let with_stroke = |stroke: Value| {
        let mut template = gated_title_template(json!({ "artwork": "full-art" }), None);
        template["layers"][1]["typography"]["stroke"] = stroke;
        template_error(template)
    };
    let cases = [
        (json!({ "color": "#000", "width": 0 }), "width"),
        (json!({ "color": "", "width": 2 }), "color"),
        (json!({ "color": "#000", "width": 2, "align": "inner" }), "align"),
        (json!({ "color": "#000", "width": 2, "opacity": 2 }), "opacity"),
        (json!({ "color": "#000", "width": 2, "glow": 3 }), "glow"),
    ];
    for (stroke, expected) in cases {
        let message = with_stroke(stroke);
        assert!(message.contains(expected), "expected {expected:?} in {message:?}");
    }
}

fn mask_template(overrides: Value) -> Value {
    let mut base = json!({
        "cardFields": [
            name_field(),
            { "defaultValue": "masked", "kind": "text", "label": "Variant", "name": "variant", "options": ["masked", "plain"] },
        ],
        "layers": [
            { "id": "before", "kind": "test-raster" },
            { "id": "masked-a", "kind": "test-raster" },
            { "id": "middle", "kind": "test-raster" },
            { "id": "masked-b", "kind": "test-raster" },
            { "id": "after", "kind": "test-raster" },
        ],
        "masks": [{ "assetId": "mask.asset", "id": "bottom-half" }],
        "presentationRules": [{
            "id": "masked-variant",
            "maskSelections": { "masked-a": "bottom-half", "masked-b": "bottom-half" },
            "when": { "equals": "masked", "path": "variant" },
        }],
        "semanticBindings": { "bindings": [{ "path": "variant", "source": { "field": "variant" } }] },
    });
    if let (Some(base), Some(patch)) = (base.as_object_mut(), overrides.as_object()) {
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }
    test_template(base)
}

#[test]
fn scopes_mask_attenuation_to_actual_source_layer_alpha() {
    assert_eq!(scope_mask_alpha(204, 255), 204);
    assert_eq!(scope_mask_alpha(204, 128), 229);
    assert_eq!(scope_mask_alpha(204, 0), 255);
}

#[test]
fn resolves_arbitrary_mask_assignments_and_advanced_removals() {
    let template = card_template(mask_template(json!({})));
    let fields = || json!({ "name": "Card", "variant": "masked" });

    let automatic = presentation(&template, fields(), None);
    let assigned: Vec<(&str, &str, bool, bool)> =
        automatic.layer_masks.iter().map(|(layer, mask)| (layer.as_str(), mask.id.as_str(), mask.luminance, mask.invert)).collect();
    assert_eq!(assigned, vec![("masked-a", "bottom-half", true, false), ("masked-b", "bottom-half", true, false)]);

    let overridden = presentation(&template, fields(), Some(json!({ "layerMasks": { "masked-a": null, "after": "bottom-half" } })));
    let layers: Vec<&str> = overridden.layer_masks.keys().map(String::as_str).collect();
    assert_eq!(layers, vec!["masked-b", "after"]);
}

#[test]
fn validates_mask_definitions_and_rule_references() {
    let red_channel = template_error(mask_template(json!({ "masks": [{ "assetId": "mask.asset", "id": "mask", "channel": "red" }] })));
    assert!(red_channel.contains("channel must be \"alpha\" or \"luminance\""), "{red_channel}");

    let missing_coverage =
        template_error(mask_template(json!({ "masks": [{ "assetId": "mask.asset", "coverageLayerId": "missing", "id": "mask" }] })));
    assert!(missing_coverage.contains("references unknown coverage layer \"missing\""), "{missing_coverage}");

    let late_coverage =
        template_error(mask_template(json!({ "masks": [{ "assetId": "mask.asset", "coverageLayerId": "after", "id": "bottom-half" }] })));
    assert!(late_coverage.contains("coverage layer \"after\" does not render before that layer"), "{late_coverage}");

    let unknown_mask = template_error(mask_template(json!({
        "presentationRules": [{
            "id": "unknown-mask",
            "maskSelections": { "masked-a": "missing" },
            "when": { "equals": "masked", "path": "variant" },
        }],
    })));
    assert!(unknown_mask.contains("references unknown mask \"missing\""), "{unknown_mask}");
}

#[test]
fn rejects_an_override_that_consults_coverage_which_has_not_rendered_yet() {
    let template = validate_card_template(&mask_template(json!({
        "masks": [
            { "assetId": "mask.asset", "id": "bottom-half" },
            { "assetId": "mask.asset", "coverageLayerId": "middle", "id": "scoped" },
        ],
    })))
    .expect("template must be valid");

    assert!(validate_presentation_overrides(&json!({ "layerMasks": { "masked-b": "scoped" } }), &template).is_ok());
    let message = validate_presentation_overrides(&json!({ "layerMasks": { "masked-a": "scoped" } }), &template)
        .expect_err("override must be rejected")
        .message()
        .to_owned();
    assert!(message.contains("coverage layer \"middle\" does not render before that layer"), "{message}");
}

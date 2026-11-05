use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::Error;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::model::Layer;
use yugilife_core::render::{LayerRenderer, LayerTarget, RenderOptions, RendererOutput, render_card};
use yugilife_core::svg::{SvgElement, escape_xml};
use yugilife_core::validation::validate_svg_element;

fn svg_error(element: Value) -> String {
    validate_svg_element(&element, None).expect_err("SVG element must be rejected").message().to_owned()
}

fn serialize_safe(element: Value) -> String {
    validate_svg_element(&element, None).expect("SVG element must be accepted");
    SvgElement::from_json(&element).serialize()
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

fn test_bundle(layers: Value) -> TemplateBundle {
    let template = json!({
        "schemaVersion": 1,
        "dimensions": { "width": 100, "height": 150 },
        "cardFields": [{ "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true }],
        "layers": layers,
    });
    let manifest = json!({
        "assets": {},
        "id": "card/test",
        "kind": "card",
        "name": "Test template",
        "template": "template.json",
        "version": "2026.01.01",
    });
    TemplateBundle::new(manifest, &template, json!({}), IndexMap::new()).expect("test bundle must be valid")
}

fn named_card() -> CardData {
    CardData::from_json(json!({ "name": "Test" }).as_object().expect("card must be an object"))
}

#[test]
fn rejects_active_mixed_case_and_namespaced_svg_tags() {
    for tag in ["script", "SCRIPT", "foreignObject", "image", "use", "a", "animate", "set", "iframe", "svg:script"] {
        assert_eq!(svg_error(json!({ "tag": tag })), format!("SVG element.tag must be a supported inert SVG element; received \"{tag}\"."));
    }
}

#[test]
fn rejects_event_attributes() {
    for attribute in ["onload", "OnLoad", "ONCLICK"] {
        let message = svg_error(json!({ "tag": "rect", "attributes": { attribute: "alert(1)" } }));
        assert_eq!(message, format!("SVG element must not use event attribute \"{attribute}\"."));
    }
}

#[test]
fn rejects_url_namespace_and_style_bearing_attributes() {
    for attribute in ["href", "xlink:href", "xmlns:xlink", "style", "clip-path", "class"] {
        let message = svg_error(json!({ "tag": "rect", "attributes": { attribute: "https://attacker.invalid/payload" } }));
        assert!(message.contains("unsupported SVG attribute") || message.contains("namespaced attribute"), "{attribute}: {message}");
    }
}

#[test]
fn rejects_active_or_url_bearing_css_values() {
    let values = [
        "url(javascript:alert(1))",
        "URL( data:text/html,<script>alert(1)</script> )",
        "url(https://attacker.invalid/image.svg)",
        "url(#local-reference)",
        "javascript:alert(1)",
        "data:image/svg+xml,<svg/>",
        "https://attacker.invalid/style.css",
        "@import 'https://attacker.invalid/style.css'",
        "expression(alert(1))",
        "var(--external-paint)",
        "u\\72l(javascript:alert(1))",
        "u/**/rl(java/**/script:alert(1))",
    ];
    for value in values {
        let message = svg_error(json!({ "tag": "rect", "attributes": { "fill": value } }));
        assert_eq!(message, "SVG element.attributes.fill must not contain URL or active CSS content.", "{value}");
    }
}

#[test]
fn accepts_inert_presentation_only_svg() {
    let serialized = serialize_safe(json!({
        "tag": "g",
        "attributes": { "opacity": 0.5, "transform": "translate(2 3)" },
        "children": [{ "tag": "path", "attributes": { "d": "M0 0h1v1z", "fill": "#fff" } }],
    }));
    assert!(serialized.contains("<path d=\"M0 0h1v1z\" fill=\"#fff\">"), "{serialized}");
    assert!(serialized.contains("opacity=\"0.5\""), "{serialized}");
}

#[test]
fn escapes_text_and_attribute_markup_during_serialization() {
    let serialized = serialize_safe(json!({ "tag": "text", "attributes": { "id": "a\"b" }, "text": "<b>&'" }));
    assert_eq!(serialized, "<text id=\"a&quot;b\">&lt;b&gt;&amp;&apos;</text>");
    assert_eq!(escape_xml("<&>\"'"), "&lt;&amp;&gt;&quot;&apos;");
}

#[test]
fn rejects_unsafe_svg_nested_inside_an_otherwise_safe_tree() {
    let message = svg_error(json!({
        "tag": "g",
        "children": [{ "tag": "g", "children": [{ "tag": "script", "text": "alert(1)" }] }],
    }));
    assert_contains_in_order(&message, &["children[0].children[0]", "supported inert SVG element"]);
}

struct UnsafeVectorRenderer;

impl LayerRenderer for UnsafeVectorRenderer {
    fn output(&self) -> RendererOutput {
        RendererOutput::Vector
    }

    fn render(&self, target: &mut LayerTarget, _layer: &Layer) -> yugilife_core::Result<bool> {
        let mut rectangle = SvgElement::new("rect");
        rectangle.set("fill", "url(javascript:alert(1))");
        let mut group = SvgElement::new("g");
        group.children.push(rectangle);
        target.vectors.push(group);
        Ok(true)
    }
}

#[test]
fn rejects_unsafe_vectors_produced_by_custom_renderers() {
    let bundle = test_bundle(json!([{ "id": "custom", "kind": "custom-vector" }]));
    let mut layer_renderers: IndexMap<String, Arc<dyn LayerRenderer>> = IndexMap::new();
    layer_renderers.insert("custom-vector".to_owned(), Arc::new(UnsafeVectorRenderer));
    let options = RenderOptions { layer_renderers, ..RenderOptions::default() };
    let Err(error) = render_card(&named_card(), &bundle, &options) else {
        panic!("unsafe custom vector output must be rejected");
    };
    assert_contains_in_order(error.message(), &["Rendered vector layer 0.children[0]", "URL or active CSS content"]);
}

#[test]
fn stops_immediately_when_rendering_is_already_cancelled() {
    let bundle = test_bundle(json!([]));
    let cancelled = AtomicBool::new(true);
    let options = RenderOptions { cancel: Some(&cancelled), ..RenderOptions::default() };
    let Err(error) = render_card(&named_card(), &bundle, &options) else {
        panic!("a cancelled render must fail");
    };
    assert_eq!(error, Error::Aborted);
    assert_eq!(error.message(), "Rendering was aborted.");
}

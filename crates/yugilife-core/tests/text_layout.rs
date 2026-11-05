use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::card::CardData;
use yugilife_core::model::{Layer, LayerBody, Primitive, SemanticValue};
use yugilife_core::rich_text::RichTextWarning;
use yugilife_core::svg::{AttributeValue, SvgElement};
use yugilife_core::text::layout::{TextLayoutRequest, create_text_element};
use yugilife_core::text::measure::{FontBook, Measurer};
use yugilife_core::text::typography::TextTypography;

fn basic_typography() -> Value {
    json!({ "fill": "#000", "fontFamily": "Test", "fontSize": 20 })
}

fn text_layer(overrides: Value) -> Value {
    let mut layer = json!({
        "id": "name",
        "kind": "text",
        "field": "name",
        "position": { "x": 10, "y": 20 },
        "typography": basic_typography(),
    });
    if let (Some(base), Some(patch)) = (layer.as_object_mut(), overrides.as_object()) {
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }
    layer
}

fn layout_with_semantic_value(card: Value, layer: Value, semantic_value: Option<SemanticValue>) -> (SvgElement, Vec<RichTextWarning>) {
    let card = CardData::from_json(card.as_object().expect("card must be an object"));
    let layer = Layer::from_json(&layer);
    let LayerBody::Text(text) = &layer.body else {
        panic!("the layer must be a text layer");
    };
    let typography = TextTypography::from_record(&text.typography);
    let request = TextLayoutRequest {
        card: &card,
        layer_id: &layer.id,
        layer: text,
        position: text.position,
        typography: &typography,
        fit_profile_id: None,
        semantic_value: semantic_value.as_ref(),
    };
    let fonts = FontBook::new(IndexMap::new());
    let mut measurer = Measurer::new(&fonts);
    let mut warnings = Vec::new();
    let element = create_text_element(&request, &mut measurer, &mut warnings).expect("text must lay out");
    (element, warnings)
}

fn layout(card: Value, layer: Value) -> SvgElement {
    layout_with_semantic_value(card, layer, None).0
}

fn child_texts(element: &SvgElement) -> Vec<Option<&str>> {
    element.children.iter().map(|child| child.text.as_deref()).collect()
}

fn attribute(element: &SvgElement, name: &str) -> Option<AttributeValue> {
    element.attribute(name).cloned()
}

fn stroke_typography(stroke: Value) -> Value {
    json!({ "fill": "#ffffff", "fontFamily": "Test", "fontSize": 20, "stroke": stroke })
}

#[test]
fn preserves_a_leading_zero_in_text_fields() {
    let element =
        layout(json!({ "name": "Card", "serialNumber": "01111111" }), text_layer(json!({ "field": "serialNumber", "id": "serialNumber" })));
    assert_eq!(element.text.as_deref(), Some("01111111"));
}

#[test]
fn omits_an_empty_type_list_instead_of_serializing_brackets() {
    let element = layout(json!({ "name": "", "types": [] }), text_layer(json!({ "field": "types", "format": "type-list", "id": "types" })));
    assert_eq!(element.text.as_deref(), Some(""));

    let listed =
        layout(json!({ "name": "", "types": ["Dragon", "", "Effect"] }), text_layer(json!({ "field": "types", "format": "type-list" })));
    assert_eq!(listed.text.as_deref(), Some("[Dragon/Effect]"));
}

#[test]
fn keeps_empty_number_pair_slots_aligned_with_their_declared_side() {
    let card = json!({ "name": "Card", "scales": ["", 7] });
    let left = layout(card.clone(), text_layer(json!({ "field": "scales", "format": "pair", "id": "left-scale", "pairIndex": 0 })));
    let right = layout(card, text_layer(json!({ "field": "scales", "format": "pair", "id": "right-scale", "pairIndex": 1 })));
    assert_eq!(left.text.as_deref(), Some(""));
    assert_eq!(right.text.as_deref(), Some("7"));
}

#[test]
fn renders_a_template_declared_semantic_value_with_its_prefix() {
    let (element, _) = layout_with_semantic_value(
        json!({ "name": "Referenced document" }),
        text_layer(json!({ "field": "reference", "id": "reference", "prefix": "REF-", "semanticPath": "document.reference.count" })),
        Some(SemanticValue::Primitive(Primitive::Number(2.0))),
    );
    assert_eq!(element.text.as_deref(), Some("REF-2"));
}

#[test]
fn preserves_repeated_spaces_in_rendered_text() {
    let element = layout(json!({ "name": "A  B" }), text_layer(json!({})));
    assert_eq!(element.text.as_deref(), Some("A  B"));
    assert_eq!(attribute(&element, "white-space"), Some(AttributeValue::from("pre")));
    assert_eq!(attribute(&element, "xml:space"), Some(AttributeValue::from("preserve")));
}

#[test]
fn renders_rich_text_styles_and_exact_horizontal_space_in_one_vector_model() {
    let (element, warnings) =
        layout_with_semantic_value(json!({ "name": "<b>ATK</b><space width=\"1px\"/><i>/</i>" }), text_layer(json!({})), None);
    let svg = element.serialize();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert!(svg.contains("font-weight=\"bold\""), "{svg}");
    assert!(svg.contains("font-style=\"italic\""), "{svg}");
    assert!(svg.contains("dx=\"1\""), "{svg}");
    assert!(svg.contains("xml:space=\"preserve\""), "{svg}");
}

#[test]
fn renders_shift_as_scoped_text_position_offsets() {
    let element = layout(json!({ "name": "Before <shift x=\"2px\" y=\"-1px\">Shifted</shift> after" }), text_layer(json!({})));
    let spans = &element.children[0].children;
    let texts: Vec<Option<&str>> = spans.iter().map(|span| span.text.as_deref()).collect();
    assert_eq!(texts, vec![Some("Before "), Some("Shifted"), Some(" "), Some("after")]);
    assert_eq!(attribute(&spans[1], "dx"), Some(AttributeValue::Number(2.0)));
    assert_eq!(attribute(&spans[1], "dy"), Some(AttributeValue::Number(-1.0)));
    assert_eq!(attribute(&spans[2], "dx"), Some(AttributeValue::Number(-2.0)));
    assert_eq!(attribute(&spans[2], "dy"), Some(AttributeValue::Number(1.0)));
    assert!(!element.serialize().contains("transform="));
}

#[test]
fn renders_normal_editor_line_breaks_even_without_the_lines_format() {
    let element = layout(json!({ "name": "First\nSecond" }), text_layer(json!({})));
    assert_eq!(child_texts(&element), vec![Some("First"), Some("Second")]);
}

#[test]
fn normalizes_explicit_newlines_in_strings_and_array_entries() {
    let layer = text_layer(json!({ "id": "effect", "field": "effect", "format": "lines" }));
    let string_lines = layout(json!({ "name": "Test", "effect": "First\r\nSecond" }), layer.clone());
    let array_lines = layout(json!({ "name": "Test", "effect": ["First\nSecond", "Third"] }), layer);
    assert_eq!(child_texts(&string_lines), vec![Some("First"), Some("Second")]);
    assert_eq!(child_texts(&array_lines), vec![Some("First"), Some("Second"), Some("Third")]);
}

#[test]
fn reports_malformed_rich_text_as_warnings_without_failing_layout() {
    let (element, warnings) = layout_with_semantic_value(json!({ "name": "<b>Open <big>" }), text_layer(json!({})), None);
    let codes: Vec<&str> = warnings.iter().map(|warning| warning.code.as_str()).collect();
    assert_eq!(codes, vec!["unknown-tag", "unclosed-tag"]);
    assert!(element.serialize().contains("&lt;big&gt;"));
}

#[test]
fn rejects_card_values_that_cannot_be_serialized_as_text() {
    let card = CardData::from_json(json!({ "name": { "nested": true } }).as_object().expect("card must be an object"));
    let layer = Layer::from_json(&text_layer(json!({})));
    let LayerBody::Text(text) = &layer.body else {
        panic!("the layer must be a text layer");
    };
    let typography = TextTypography::from_record(&text.typography);
    let request = TextLayoutRequest {
        card: &card,
        layer_id: &layer.id,
        layer: text,
        position: text.position,
        typography: &typography,
        fit_profile_id: None,
        semantic_value: None,
    };
    let fonts = FontBook::new(IndexMap::new());
    let error = create_text_element(&request, &mut Measurer::new(&fonts), &mut Vec::new()).expect_err("object values must be rejected");
    assert_eq!(error.message(), "Text layer \"name\" cannot serialize card field \"name\".");
}

#[test]
fn paints_an_outer_stroke_under_the_fill_at_double_the_authored_width() {
    let element = layout(
        json!({ "name": "Test card" }),
        text_layer(json!({ "typography": stroke_typography(json!({ "color": "#000000", "width": 3 })) })),
    );
    assert_eq!(attribute(&element, "stroke"), Some(AttributeValue::from("#000000")));
    assert_eq!(attribute(&element, "stroke-width"), Some(AttributeValue::Number(6.0)));
    assert_eq!(attribute(&element, "paint-order"), Some(AttributeValue::from("stroke fill")));
}

#[test]
fn keeps_a_centred_stroke_at_its_authored_width_and_paint_order() {
    let stroke = json!({ "color": "#000", "width": 3, "align": "center" });
    let element = layout(json!({ "name": "Test card" }), text_layer(json!({ "typography": stroke_typography(stroke) })));
    assert_eq!(attribute(&element, "stroke-width"), Some(AttributeValue::Number(3.0)));
    assert_eq!(attribute(&element, "paint-order"), Some(AttributeValue::from("fill stroke")));
}

#[test]
fn emits_no_stroke_attributes_when_the_typography_declares_none() {
    let element = layout(
        json!({ "name": "Test card" }),
        text_layer(json!({ "typography": { "fill": "#111111", "fontFamily": "Test", "fontSize": 20 } })),
    );
    assert_eq!(attribute(&element, "stroke"), None);
    assert_eq!(attribute(&element, "paint-order"), None);
}

#[test]
fn paints_the_stroke_without_changing_the_fitted_layout() {
    let plain = layout(
        json!({ "name": "Test card" }),
        text_layer(json!({ "typography": { "fill": "#111111", "fontFamily": "Test", "fontSize": 20, "maxWidth": 30 } })),
    );
    let stroked = layout(
        json!({ "name": "Test card" }),
        text_layer(json!({
            "typography": { "fill": "#111111", "fontFamily": "Test", "fontSize": 20, "maxWidth": 30, "stroke": { "color": "#000000", "width": 12 } },
        })),
    );
    assert_eq!(attribute(&stroked, "font-size"), attribute(&plain, "font-size"));
    assert_eq!(stroked.text, plain.text);
    assert_eq!(stroked.children, plain.children);
}

use std::sync::Arc;

use serde_json::{Value, json};
use yugilife_cli::templates::resolve_template;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::{SvgExportOptions, TextMode};
use yugilife_core::model::{flatten_drawable_layers, is_layer_visible};
use yugilife_core::render::{RenderOptions, RenderWarning, RenderWarningKind, RenderedCard, create_render_manifest, render_card};
use yugilife_core::validation::{create_card_from_template, validate_card_data};

fn series_10() -> Arc<TemplateBundle> {
    resolve_template(None).expect("the packaged default template must load")
}

fn default_card(bundle: &TemplateBundle) -> CardData {
    create_card_from_template(&bundle.template.json)
}

fn card_with(bundle: &TemplateBundle, fields: Value) -> CardData {
    let mut card = default_card(bundle);
    for (name, value) in fields.as_object().expect("card fields must be an object") {
        card.insert(name.clone(), CardValue::Json(value.clone()));
    }
    card
}

fn render<'a>(bundle: &'a TemplateBundle, card: &CardData) -> RenderedCard<'a> {
    render_card(card, bundle, &RenderOptions::default()).expect("the card must render")
}

fn svg(rendered: &RenderedCard, text_mode: TextMode) -> String {
    rendered.to_svg(&SvgExportOptions { text_mode: Some(text_mode), ..SvgExportOptions::default() }).expect("SVG must serialize")
}

fn png_pixels(png: &[u8]) -> (u32, u32, Vec<u8>) {
    let decoded = image::load_from_memory(png).expect("PNG must decode").to_rgba8();
    (decoded.width(), decoded.height(), decoded.into_raw())
}

fn warning_summary(warnings: &[RenderWarning]) -> Vec<(String, &'static str, usize, usize)> {
    warnings
        .iter()
        .filter_map(|warning| match &warning.kind {
            RenderWarningKind::RichText(rich_text) => Some((warning.layer_id.clone(), warning.code(), rich_text.offset, rich_text.length)),
            RenderWarningKind::MissingGlyph(_) => None,
        })
        .collect()
}

fn missing_glyph_summary(warnings: &[RenderWarning]) -> Vec<(String, char, String)> {
    warnings
        .iter()
        .filter_map(|warning| match &warning.kind {
            RenderWarningKind::MissingGlyph(missing) => Some((warning.layer_id.clone(), missing.character, missing.font_family.clone())),
            RenderWarningKind::RichText(_) => None,
        })
        .collect()
}

#[test]
fn creates_a_valid_default_card_from_the_packaged_template() {
    let bundle = series_10();
    let card = default_card(&bundle);
    assert!(validate_card_data(&card, &bundle.template.json).is_ok());
    assert_eq!(card.json("name"), Some(&json!("Sample Card Title")));
    assert_eq!(bundle.id(), "card/series-10");
    assert_eq!(bundle.version(), "2026.09.23");
}

#[test]
fn renders_a_text_only_card_at_template_dimensions_without_warnings() {
    let bundle = series_10();
    let rendered = render(&bundle, &card_with(&bundle, json!({ "name": "Regression Dragon", "description": "A <b>bold</b> effect." })));
    assert_eq!((rendered.width(), rendered.height()), (813, 1185));
    assert!(rendered.warnings.is_empty(), "{:?}", rendered.warnings);
    let (width, height, _) = png_pixels(&rendered.to_png(None).expect("PNG must export"));
    assert_eq!((width, height), (813, 1185));
}

#[test]
fn reports_malformed_rich_text_with_utf16_offsets_per_layer() {
    let bundle = series_10();
    let card = card_with(&bundle, json!({ "name": "😀 <big>Name", "description": "Effect <b>unclosed" }));
    let rendered = render(&bundle, &card);
    assert_eq!(
        warning_summary(&rendered.warnings),
        vec![("name".to_owned(), "unknown-tag", 3, 5), ("description".to_owned(), "unclosed-tag", 7, 11)]
    );
    assert_eq!(missing_glyph_summary(&rendered.warnings), vec![("name".to_owned(), '😀', "MatrixRegularSmallCaps".to_owned())]);
}

#[test]
fn draws_characters_missing_from_the_font_and_warns_once_per_character() {
    let bundle = series_10();
    let card = card_with(
        &bundle,
        json!({ "cardVariant": "spell", "name": "Yummy☆Surprise", "description": "Target 1 \"Ace★Spades\" card; then 1 more ★, and ☆." }),
    );
    let rendered = render(&bundle, &card);
    assert_eq!(
        missing_glyph_summary(&rendered.warnings),
        vec![
            ("name".to_owned(), '☆', "MatrixRegularSmallCaps".to_owned()),
            ("description".to_owned(), '★', "MatrixBook".to_owned()),
            ("description".to_owned(), '☆', "MatrixBook".to_owned()),
        ]
    );
    assert_eq!(
        rendered.warnings[0].to_json(),
        json!({
            "character": "☆",
            "code": "missing-glyph",
            "fontFamily": "MatrixRegularSmallCaps",
            "layerId": "name",
            "message": "Font \"MatrixRegularSmallCaps\" has no glyph for \"☆\" (U+2606), so it is drawn as the font's missing-glyph placeholder.",
        })
    );
    let (width, height, _) = png_pixels(&rendered.to_png(None).expect("PNG must export"));
    assert_eq!((width, height), (813, 1185));
    let paths = svg(&rendered, TextMode::Paths);
    assert!(paths.contains("<path ") && !paths.contains("<text"));
}

#[test]
fn keeps_card_text_live_in_text_mode_svg() {
    let bundle = series_10();
    let rendered = render(&bundle, &card_with(&bundle, json!({ "name": "Regression Dragon" })));
    let text = svg(&rendered, TextMode::Text);
    assert!(text.contains("data-yugilife-text-mode=\"text\""));
    assert!(text.contains("<text "));
    assert!(text.contains("Regression Dragon"));
    assert!(text.contains("<image href=\"data:image/png;base64,"));
}

#[test]
fn outlines_card_text_in_paths_mode_svg() {
    let bundle = series_10();
    let rendered = render(&bundle, &card_with(&bundle, json!({ "name": "Regression Dragon" })));
    let paths = svg(&rendered, TextMode::Paths);
    assert!(paths.contains("data-yugilife-text-mode=\"paths\""));
    assert!(paths.contains("<path "));
    assert!(!paths.contains("<text"));
    assert!(!paths.contains("<tspan"));
}

#[test]
fn renders_the_same_card_to_identical_bytes_twice() {
    let bundle = series_10();
    let card = card_with(&bundle, json!({ "name": "Deterministic", "cardVariant": "spell" }));
    let first = render(&bundle, &card);
    let second = render(&bundle, &card);
    assert_eq!(first.to_png(None).expect("PNG must export"), second.to_png(None).expect("PNG must export"));
    assert_eq!(svg(&first, TextMode::Paths), svg(&second, TextMode::Paths));
    assert_eq!(svg(&first, TextMode::Text), svg(&second, TextMode::Text));
}

#[test]
fn creates_an_ordered_render_manifest_of_visible_layers() {
    let bundle = series_10();
    let card = card_with(&bundle, json!({ "name": "Manifest" }));
    let manifest = create_render_manifest(&card, &bundle, &RenderOptions::default()).expect("the manifest must be created");
    let rendered = render(&bundle, &card);
    let layers = flatten_drawable_layers(&bundle.template.layers);

    assert!(!manifest.elements.is_empty());
    let orders: Vec<usize> = manifest.elements.iter().map(|element| element.order).collect();
    assert_eq!(orders, (0..manifest.elements.len()).collect::<Vec<_>>());
    for element in &manifest.elements {
        let layer = layers.iter().find(|layer| layer.id == element.layer_id).expect("manifest layers must exist in the template");
        assert!(is_layer_visible(layer, &rendered.presentation.layer_visibility), "{}", element.layer_id);
        let bounds = element.absolute_bounds.expect("rendered layers must have coverage");
        for y in (0..1185).step_by(37) {
            for x in (0..813).step_by(29) {
                let (x, y) = (f64::from(x), f64::from(y));
                assert!(element.absolute_alpha.alpha_at(x, y) >= element.alpha.alpha_at(x, y), "{} at {x},{y}", element.layer_id);
            }
        }
        if let Some(visible) = element.bounds {
            assert!(visible.x >= bounds.x && visible.y >= bounds.y, "{}", element.layer_id);
            assert!(visible.x + visible.width <= bounds.x + bounds.width, "{}", element.layer_id);
            assert!(visible.y + visible.height <= bounds.y + bounds.height, "{}", element.layer_id);
        }
    }
    let name = manifest.elements.iter().find(|element| element.layer_id == "name").expect("the name layer must be captured");
    assert_eq!(name.source_fields, vec!["name".to_owned()]);
}

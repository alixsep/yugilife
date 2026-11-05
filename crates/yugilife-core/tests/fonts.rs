use std::path::PathBuf;

use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::assets::AssetSource;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::export::{SvgExportOptions, TextMode};
use yugilife_core::render::{RenderOptions, RenderedCard, render_card};
use yugilife_core::text::fonts::load_font;
use yugilife_core::text::measure::FontBook;

fn font_layer(id: &str, font_asset_id: Option<&str>) -> Value {
    let mut typography = json!({ "fill": "#000", "fontFamily": "TestFont", "fontSize": 20, "maxWidth": 80 });
    if let Some(asset_id) = font_asset_id {
        typography["fontAssetId"] = json!(asset_id);
    }
    json!({ "id": id, "kind": "text", "field": "name", "position": { "x": 10, "y": 20 }, "typography": typography })
}

fn font_bundle(layers: Value) -> TemplateBundle {
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

fn packaged_font() -> AssetSource {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../yugilife-cli/templates/shared/fonts/MatrixBook.woff2");
    let bytes = std::fs::read(&path).expect("the packaged font must be readable");
    AssetSource::from_bytes(bytes, Some("font/woff2".to_owned()), "MatrixBook.woff2")
}

fn broken_font() -> AssetSource {
    AssetSource::from_bytes(b"not a font".to_vec(), Some("font/woff2".to_owned()), "broken.woff2")
}

fn named_card() -> CardData {
    CardData::from_json(json!({ "name": "Font card" }).as_object().expect("card must be an object"))
}

fn assets(entries: Vec<(&str, AssetSource)>) -> IndexMap<String, AssetSource> {
    entries.into_iter().map(|(id, source)| (id.to_owned(), source)).collect()
}

fn render_error(bundle: &TemplateBundle, options: &RenderOptions) -> String {
    match render_card(&named_card(), bundle, options) {
        Ok(_) => panic!("the render must fail"),
        Err(error) => error.message().to_owned(),
    }
}

fn svg(rendered: &RenderedCard, text_mode: TextMode) -> yugilife_core::Result<String> {
    rendered.to_svg(&SvgExportOptions { text_mode: Some(text_mode), ..SvgExportOptions::default() })
}

#[test]
fn rejects_conflicting_assets_assigned_to_one_font_family() {
    let bundle = font_bundle(json!([font_layer("name", Some("font.test")), font_layer("other-name", Some("font.other"))]));
    let options = RenderOptions {
        assets: assets(vec![
            ("font.other", AssetSource::Url("/other.woff2".to_owned())),
            ("font.test", AssetSource::Url("/test.woff2".to_owned())),
        ]),
        ..RenderOptions::default()
    };
    assert_eq!(render_error(&bundle, &options), "Font family \"TestFont\" maps to both \"font.test\" and \"font.other\".");
}

#[test]
fn rejects_an_unresolved_font_asset_before_rendering() {
    let bundle = font_bundle(json!([font_layer("name", Some("font.test"))]));
    assert_eq!(render_error(&bundle, &RenderOptions::default()), "Layer \"name\" has unresolved font asset ID \"font.test\".");
}

#[test]
fn fails_instead_of_measuring_with_an_unreadable_font() {
    let bundle = font_bundle(json!([font_layer("name", Some("font.test"))]));
    let options = RenderOptions { assets: assets(vec![("font.test", broken_font())]), ..RenderOptions::default() };
    assert!(render_card(&named_card(), &bundle, &options).is_err());
}

#[test]
fn loads_the_font_selected_by_resolved_presentation_overrides() {
    let bundle = font_bundle(json!([font_layer("name", Some("font.test"))]));
    let overrides = json!({
        "textTypography": { "name": { "default": { "fontAssetId": "font.override", "fontFamily": "OverrideFont" } } },
    });
    let options = RenderOptions {
        assets: assets(vec![("font.override", packaged_font()), ("font.test", broken_font())]),
        presentation_overrides: Some(&overrides),
        ..RenderOptions::default()
    };
    let rendered = render_card(&named_card(), &bundle, &options).expect("the override font must be the only font loaded");

    let text = svg(&rendered, TextMode::Text).expect("text SVG must serialize");
    assert!(text.contains("OverrideFont"), "{text}");
    assert!(text.contains(">Font card</text>"), "{text}");
    let paths = svg(&rendered, TextMode::Paths).expect("path SVG must serialize");
    assert!(paths.contains("<path "));
    assert!(!paths.contains("<text"));
}

#[test]
fn refuses_to_outline_text_without_a_resolved_font_asset() {
    let bundle = font_bundle(json!([font_layer("name", None)]));
    let rendered = render_card(&named_card(), &bundle, &RenderOptions::default()).expect("text mode render must succeed");
    assert!(svg(&rendered, TextMode::Text).is_ok());
    let error = svg(&rendered, TextMode::Paths).expect_err("outlining without a font must fail");
    assert!(error.message().starts_with("Cannot outline SVG text using font-family "), "{}", error.message());
    assert!(
        error
            .message()
            .ends_with("because it has no resolved fontAssetId. Use textMode \"text\" or declare the font asset in template typography."),
        "{}",
        error.message()
    );
}

#[test]
fn resolves_the_first_listed_family_the_book_has_like_a_browser() {
    let font = load_font(&packaged_font(), "font.matrix-book").expect("the packaged font must load");
    let book = FontBook::new(IndexMap::from([("MatrixBook".to_owned(), font.clone()), ("Stone Serif".to_owned(), font)]));
    let family = |value: &str| book.resolve(value).map(|(family, _)| family);
    assert_eq!(family("MatrixBook"), Some("MatrixBook"));
    assert_eq!(family("Missing, \"Stone Serif\", MatrixBook"), Some("Stone Serif"));
    assert_eq!(family("'Missing', MatrixBook"), Some("MatrixBook"));
    assert_eq!(family("Missing"), None);
}

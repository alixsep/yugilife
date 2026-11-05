use std::sync::Arc;

use image::GenericImageView;
use indexmap::IndexMap;
use serde_json::json;
use tiny_skia::{Color, Pixmap};
use yugilife_core::Error;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::export::{
    ExportSegment, FontSmoothing, ImageExportOptions, ImageFormat, OutputSize, SvgExportOptions, TextMode,
    resolve_raster_output_dimensions, serialize_card_svg,
};
use yugilife_core::render::{RenderOptions, RenderedCard, render_card};
use yugilife_core::svg::SvgElement;

fn empty_bundle() -> TemplateBundle {
    let template = json!({
        "schemaVersion": 1,
        "dimensions": { "width": 100, "height": 150 },
        "cardFields": [{ "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true }],
        "layers": [],
    });
    let manifest = json!({
        "assets": {},
        "id": "card/png-test",
        "kind": "card",
        "name": "PNG test",
        "template": "template.json",
        "version": "2026.01.01",
    });
    TemplateBundle::new(manifest, &template, json!({}), IndexMap::new()).expect("test bundle must be valid")
}

fn render_empty(bundle: &TemplateBundle) -> RenderedCard<'_> {
    let card = CardData::from_json(json!({ "name": "PNG" }).as_object().expect("card must be an object"));
    render_card(&card, bundle, &RenderOptions::default()).expect("render must succeed")
}

fn raster_segment(color: Color) -> ExportSegment {
    let mut pixmap = Pixmap::new(100, 150).expect("pixmap must allocate");
    pixmap.fill(color);
    ExportSegment::Raster(Arc::new(pixmap))
}

fn text_element(text: &str) -> SvgElement {
    let mut element = SvgElement::new("text");
    element.set("x", 10.0);
    element.set("y", 20.0);
    element.text = Some(text.to_owned());
    element
}

fn path_element() -> SvgElement {
    let mut element = SvgElement::new("path");
    element.set("d", "M0 0L1 1Z");
    element.set("fill", "#000");
    element
}

fn text_mode_options() -> SvgExportOptions {
    SvgExportOptions { text_mode: Some(TextMode::Text), ..SvgExportOptions::default() }
}

fn range_error(result: yugilife_core::Result<impl std::fmt::Debug>) -> String {
    match result.expect_err("the request must be rejected") {
        Error::Range(message) => message,
        other => panic!("expected a range error, received {other:?}"),
    }
}

#[test]
fn serializes_ordered_segments_and_marks_the_text_mode() {
    let segments = [raster_segment(Color::from_rgba8(255, 0, 0, 255)), ExportSegment::Vector(vec![text_element("Vector name")])];
    let svg = serialize_card_svg(100, 150, &segments, TextMode::Text, &text_mode_options()).expect("SVG must serialize");

    assert_eq!(svg.matches("<image ").count(), 1);
    assert!(svg.find("<image ") < svg.find("<text "));
    assert!(svg.contains("href=\"data:image/png;base64,"));
    assert!(svg.contains("<text x=\"10\" y=\"20\">Vector name</text>"));
    assert!(svg.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    assert!(svg.contains("data-yugilife-text-mode=\"text\""));
    assert!(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"150\" viewBox=\"0 0 100 150\""));
    assert!(svg.ends_with("</svg>"));
}

#[test]
fn serializes_the_title_and_font_smoothing_style() {
    let options = SvgExportOptions {
        font_smoothing: Some(FontSmoothing::Subpixel),
        text_mode: Some(TextMode::Text),
        title: Some("A & B".to_owned()),
    };
    let svg = serialize_card_svg(100, 150, &[], TextMode::Text, &options).expect("SVG must serialize");
    assert!(svg.contains("<title>A &amp; B</title>"), "{svg}");
    assert!(svg.contains("style=\"-webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto\""), "{svg}");

    let grayscale = serialize_card_svg(100, 150, &[], TextMode::Paths, &SvgExportOptions::default()).expect("SVG must serialize");
    assert!(grayscale.contains("style=\"-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale\""));
    assert!(!grayscale.contains("<title>"));
}

#[test]
fn serializes_outlined_path_mode_only_when_no_live_text_remains() {
    let svg = serialize_card_svg(100, 150, &[ExportSegment::Vector(vec![path_element()])], TextMode::Paths, &SvgExportOptions::default())
        .expect("SVG must serialize");
    assert!(svg.contains("data-yugilife-text-mode=\"paths\""));
    assert!(svg.contains("<path d=\"M0 0L1 1Z\" fill=\"#000\"></path>"));
    assert!(!svg.contains("<text"));

    let Err(error) = serialize_card_svg(
        100,
        150,
        &[ExportSegment::Vector(vec![text_element("Still live")])],
        TextMode::Paths,
        &SvgExportOptions::default(),
    ) else {
        panic!("residual text must be rejected in paths mode");
    };
    assert_eq!(
        error.message(),
        "SVG text mode \"paths\" cannot serialize residual <text> or <tspan> elements. Use exportCardToSvg so fonts can be loaded and outlined asynchronously."
    );
}

#[test]
fn encodes_raster_segments_separated_by_vectors_as_separate_images() {
    let segments = [
        raster_segment(Color::from_rgba8(255, 0, 0, 255)),
        ExportSegment::Vector(vec![text_element("Between")]),
        raster_segment(Color::from_rgba8(0, 0, 255, 255)),
    ];
    let svg = serialize_card_svg(100, 150, &segments, TextMode::Text, &text_mode_options()).expect("SVG must serialize");
    assert_eq!(svg.matches("<image ").count(), 2);
    assert_eq!(svg.matches("x=\"0\" y=\"0\" width=\"100\" height=\"150\"/>").count(), 2);
}

#[test]
fn flattens_contiguous_raster_segments_without_crossing_vector_content() {
    let segments = [
        raster_segment(Color::from_rgba8(255, 0, 0, 255)),
        raster_segment(Color::from_rgba8(0, 255, 0, 255)),
        ExportSegment::Vector(vec![path_element()]),
        raster_segment(Color::from_rgba8(0, 0, 255, 255)),
    ];
    let svg = serialize_card_svg(100, 150, &segments, TextMode::Text, &text_mode_options()).expect("SVG must serialize");
    assert_eq!(svg.matches("<image ").count(), 2);
    let first_image = svg.find("<image ").expect("the flattened raster must be embedded");
    let path = svg.find("<path ").expect("the vector must be embedded");
    let last_image = svg.rfind("<image ").expect("the trailing raster must be embedded");
    assert!(first_image < path && path < last_image);
}

#[test]
fn rasterizes_the_complete_rendered_card_to_a_scaled_png() {
    let bundle = empty_bundle();
    let png = render_empty(&bundle).to_png(Some(2.0)).expect("PNG must export");
    assert!(png.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]));
    let decoded = image::load_from_memory(&png).expect("PNG must decode");
    assert_eq!(decoded.dimensions(), (200, 300));
    assert!(decoded.to_rgba8().pixels().all(|pixel| pixel.0[3] == 0));
}

#[test]
fn encodes_jpeg_with_an_explicit_matte_output_width_and_quality() {
    let bundle = empty_bundle();
    let options = ImageExportOptions {
        background_color: Some("#abc".to_owned()),
        format: Some(ImageFormat::Jpeg),
        quality: Some(0.8),
        size: Some(OutputSize::Width(250.0)),
    };
    let jpeg = render_empty(&bundle).to_image(&options).expect("JPEG must export");
    assert!(jpeg.starts_with(&[0xff, 0xd8, 0xff]));
    let decoded = image::load_from_memory(&jpeg).expect("JPEG must decode").to_rgb8();
    assert_eq!(decoded.dimensions(), (250, 375));
    let center = decoded.get_pixel(125, 187).0;
    for (channel, expected) in center.iter().zip([0xaa_u8, 0xbb, 0xcc]) {
        assert!(channel.abs_diff(expected) <= 2, "{center:?}");
    }
}

#[test]
fn rasterizes_below_native_output_to_the_requested_size() {
    let bundle = empty_bundle();
    let png = render_empty(&bundle).to_png(Some(0.5)).expect("PNG must export");
    assert_eq!(image::load_from_memory(&png).expect("PNG must decode").dimensions(), (50, 75));
}

#[test]
fn encodes_webp_output_with_its_container_signature() {
    let bundle = empty_bundle();
    let options = ImageExportOptions { format: Some(ImageFormat::Webp), ..ImageExportOptions::default() };
    let webp = render_empty(&bundle).to_image(&options).expect("WebP must export");
    assert_eq!(&webp[0..4], b"RIFF");
    assert_eq!(&webp[8..12], b"WEBP");
    assert_eq!(image::load_from_memory(&webp).expect("WebP must decode").dimensions(), (100, 150));
}

#[test]
fn rejects_invalid_output_scales_before_encoding() {
    let bundle = empty_bundle();
    let message = range_error(render_empty(&bundle).to_png(Some(0.0)));
    assert_eq!(message, "Raster output scale must be finite and greater than zero; received 0.");
}

#[test]
fn rejects_encoder_options_that_do_not_apply_to_the_format() {
    let bundle = empty_bundle();
    let rendered = render_empty(&bundle);
    let export = |options: ImageExportOptions| range_error(rendered.to_image(&options));

    assert_eq!(
        export(ImageExportOptions { quality: Some(0.5), ..ImageExportOptions::default() }),
        "PNG output does not accept a quality value."
    );
    assert_eq!(
        export(ImageExportOptions { format: Some(ImageFormat::Jpeg), quality: Some(1.5), ..ImageExportOptions::default() }),
        "Raster output quality must be from 0 through 1; received 1.5."
    );
    assert_eq!(
        export(ImageExportOptions {
            format: Some(ImageFormat::Webp),
            background_color: Some("#fff".to_owned()),
            ..ImageExportOptions::default()
        }),
        "A raster background color is supported only for JPEG output."
    );
    assert_eq!(
        export(ImageExportOptions {
            format: Some(ImageFormat::Jpeg),
            background_color: Some("red".to_owned()),
            ..ImageExportOptions::default()
        }),
        "JPEG backgroundColor must be an opaque #RGB or #RRGGBB color."
    );
}

#[test]
fn resolves_aspect_preserving_width_height_and_scale_sizes_within_the_budget() {
    assert_eq!(resolve_raster_output_dimensions(813.0, 1185.0, None), Ok((813, 1185)));
    assert_eq!(resolve_raster_output_dimensions(813.0, 1185.0, Some(OutputSize::Width(1200.0))), Ok((1200, 1749)));
    assert_eq!(resolve_raster_output_dimensions(813.0, 1185.0, Some(OutputSize::Height(600.0))), Ok((412, 600)));
    assert_eq!(resolve_raster_output_dimensions(813.0, 1185.0, Some(OutputSize::Scale(2.0))), Ok((1626, 2370)));
    assert_eq!(
        range_error(resolve_raster_output_dimensions(813.0, 1185.0, Some(OutputSize::Scale(9.0)))),
        "Raster output cannot exceed 64000000 pixels."
    );
    assert_eq!(resolve_raster_output_dimensions(100.4, 150.4, None), Ok((100, 150)));
}

#[test]
fn rejects_raster_sizes_outside_the_edge_and_integer_rules() {
    assert_eq!(
        range_error(resolve_raster_output_dimensions(100.0, 150.0, Some(OutputSize::Width(20_000.0)))),
        "Raster output dimensions cannot exceed 16384 pixels."
    );
    assert_eq!(
        range_error(resolve_raster_output_dimensions(100.0, 150.0, Some(OutputSize::Width(12.5)))),
        "Raster output width must be a positive integer; received 12.5."
    );
    assert_eq!(
        range_error(resolve_raster_output_dimensions(100.0, 150.0, Some(OutputSize::Height(-3.0)))),
        "Raster output height must be a positive integer; received -3."
    );
    assert_eq!(
        range_error(resolve_raster_output_dimensions(100.0, 150.0, Some(OutputSize::Scale(0.001)))),
        "Raster output size produces a dimension smaller than one pixel."
    );
    assert_eq!(
        range_error(resolve_raster_output_dimensions(0.0, 150.0, None)),
        "Template width must be finite and greater than zero; received 0."
    );
}

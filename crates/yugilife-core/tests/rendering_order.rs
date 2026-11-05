use std::sync::{Arc, Mutex};

use image::RgbaImage;
use indexmap::IndexMap;
use serde_json::{Value, json};
use tiny_skia::Color;
use yugilife_core::assets::AssetSource;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::export::{SvgExportOptions, TextMode, encode_png};
use yugilife_core::model::{Layer, Region};
use yugilife_core::render::{LayerRenderer, LayerTarget, RenderOptions, RenderSegment, RenderedCard, RendererOutput, render_card};
use yugilife_core::svg::SvgElement;

fn name_field() -> Value {
    json!({ "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true })
}

fn layout_field() -> Value {
    json!({ "defaultValue": "featured", "kind": "text", "label": "Layout", "name": "layout", "options": ["featured"], "required": true })
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

fn bundle_with_assets(template: Value, assets: IndexMap<String, AssetSource>) -> TemplateBundle {
    let manifest = json!({
        "assets": {},
        "id": "card/test",
        "kind": "card",
        "name": "Test template",
        "template": "template.json",
        "version": "2026.01.01",
    });
    TemplateBundle::new(manifest, &template, json!({}), assets).expect("test bundle must be valid")
}

fn test_bundle(template: Value) -> TemplateBundle {
    bundle_with_assets(template, IndexMap::new())
}

fn card(fields: Value) -> CardData {
    CardData::from_json(fields.as_object().expect("card fields must be an object"))
}

fn text_layer(id: &str) -> Value {
    json!({
        "field": "name",
        "id": id,
        "kind": "text",
        "position": { "x": 1, "y": 2 },
        "typography": { "fill": "#000", "fontFamily": "Test", "fontSize": 10 },
    })
}

fn renderers(entries: Vec<(&str, Arc<dyn LayerRenderer>)>) -> IndexMap<String, Arc<dyn LayerRenderer>> {
    entries.into_iter().map(|(key, renderer)| (key.to_owned(), renderer)).collect()
}

fn segment_kinds(rendered: &RenderedCard) -> Vec<&'static str> {
    rendered
        .segments
        .iter()
        .map(|segment| match segment {
            RenderSegment::Raster(_) => "raster",
            RenderSegment::Vector(_) => "vector",
        })
        .collect()
}

fn text_svg(rendered: &RenderedCard) -> String {
    rendered.to_svg(&SvgExportOptions { text_mode: Some(TextMode::Text), ..SvgExportOptions::default() }).expect("text SVG must export")
}

fn position_of(haystack: &str, needle: &str, from: usize) -> usize {
    haystack[from..].find(needle).map(|index| index + from).unwrap_or_else(|| panic!("{needle:?} must appear after {from}"))
}

fn decoded_png(rendered: &RenderedCard) -> RgbaImage {
    let png = rendered.to_png(None).expect("PNG must export");
    image::load_from_memory(&png).expect("PNG must decode").to_rgba8()
}

fn solid_png(pixels: &[[u8; 4]], width: u32, height: u32) -> AssetSource {
    let bytes = encode_png(&pixels.concat(), width, height).expect("PNG must encode");
    AssetSource::from_bytes(bytes, Some("image/png".to_owned()), "test.png")
}

struct EmptyRaster {
    reports_output: bool,
}

impl LayerRenderer for EmptyRaster {
    fn output(&self) -> RendererOutput {
        RendererOutput::Raster
    }

    fn render(&self, _target: &mut LayerTarget, _layer: &Layer) -> yugilife_core::Result<bool> {
        Ok(self.reports_output)
    }
}

struct FillRaster {
    color: Color,
}

impl LayerRenderer for FillRaster {
    fn output(&self) -> RendererOutput {
        RendererOutput::Raster
    }

    fn render(&self, target: &mut LayerTarget, _layer: &Layer) -> yugilife_core::Result<bool> {
        let (width, height) = (f64::from(target.surface.width()), f64::from(target.surface.height()));
        target.surface.pixmap.fill(self.color);
        target.surface.mark(0.0, 0.0, width, height);
        Ok(true)
    }
}

struct GroupVector;

impl LayerRenderer for GroupVector {
    fn output(&self) -> RendererOutput {
        RendererOutput::Vector
    }

    fn render(&self, target: &mut LayerTarget, layer: &Layer) -> yugilife_core::Result<bool> {
        let mut group = SvgElement::new("g");
        group.set("id", layer.id.as_str());
        target.vectors.push(group);
        Ok(true)
    }
}

struct TextFromRaster;

impl LayerRenderer for TextFromRaster {
    fn output(&self) -> RendererOutput {
        RendererOutput::Raster
    }

    fn render(&self, target: &mut LayerTarget, _layer: &Layer) -> yugilife_core::Result<bool> {
        let mut text = SvgElement::new("text");
        text.text = Some("not raster".to_owned());
        target.vectors.push(text);
        Ok(true)
    }
}

#[derive(Default)]
struct Observer {
    observations: Mutex<Vec<String>>,
    regions: Mutex<Vec<Option<Region>>>,
}

impl LayerRenderer for Observer {
    fn output(&self) -> RendererOutput {
        RendererOutput::Vector
    }

    fn render(&self, target: &mut LayerTarget, layer: &Layer) -> yugilife_core::Result<bool> {
        let selection = target.presentation.asset_selections.get(&layer.id).cloned();
        if let Ok(mut observations) = self.observations.lock() {
            observations.push(format!("{}:{}", layer.id, selection.unwrap_or_else(|| "layer-default".to_owned())));
        }
        if let Ok(mut regions) = self.regions.lock() {
            regions.push(layer.region);
        }
        Ok(true)
    }
}

fn empty_raster() -> Arc<dyn LayerRenderer> {
    Arc::new(EmptyRaster { reports_output: true })
}

#[test]
fn applies_semantic_frame_presentation_before_explicit_render_overrides() {
    let bundle = test_bundle(test_template(json!({
        "cardFields": [name_field(), layout_field(), { "kind": "number", "label": "Priority", "max": 8, "min": 1, "name": "priority" }],
        "layers": [
            { "defaultVisible": false, "id": "frameTexture", "kind": "observed" },
            { "defaultVisible": false, "id": "featuredFrame", "kind": "observed" },
        ],
        "presentationRules": [{
            "id": "featured-frame",
            "layerVisibility": { "featuredFrame": true, "frameTexture": false },
            "presets": { "frame": "automatic-frame" },
            "when": { "equals": "featured", "path": "document.layout" },
        }],
        "semanticBindings": {
            "bindings": [
                { "path": "kind", "source": { "value": "document" } },
                { "path": "document.layout", "source": { "field": "layout" } },
            ],
        },
    })));
    let observer = Arc::new(Observer::default());
    let options = RenderOptions {
        layers: [("frameTexture".to_owned(), true)].into_iter().collect(),
        preset_overrides: [("frame".to_owned(), "manual-frame".to_owned())].into_iter().collect(),
        layer_renderers: renderers(vec![("observed", observer.clone())]),
        ..RenderOptions::default()
    };
    let rendered = render_card(&card(json!({ "layout": "featured", "name": "Featured document", "priority": 1 })), &bundle, &options)
        .expect("render must succeed");

    let presets: Vec<(&str, &str)> = rendered.presentation.presets.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
    assert_eq!(presets, vec![("frame", "automatic-frame")]);
    let observed = observer.observations.lock().expect("observations must be readable").clone();
    assert_eq!(observed, vec!["frameTexture:layer-default", "featuredFrame:layer-default"]);
}

#[test]
fn passes_declarative_layer_asset_selections_to_renderers() {
    let bundle = test_bundle(test_template(json!({
        "cardFields": [name_field(), layout_field()],
        "layers": [{ "assetId": "base.asset", "id": "frameTexture", "kind": "image", "region": { "height": 10, "width": 10, "x": 0, "y": 0 } }],
        "presentationRules": [{
            "assetSelections": { "frameTexture": "selected.asset" },
            "id": "featured-frame",
            "when": { "equals": "featured", "path": "document.layout" },
        }],
        "semanticBindings": { "bindings": [{ "path": "document.layout", "source": { "field": "layout" } }] },
    })));
    let observer = Arc::new(Observer::default());
    let options = RenderOptions {
        assets: [
            ("base.asset".to_owned(), AssetSource::Url("base".to_owned())),
            ("selected.asset".to_owned(), AssetSource::Url("selected".to_owned())),
        ]
        .into_iter()
        .collect(),
        layer_renderers: renderers(vec![("image", observer.clone())]),
        ..RenderOptions::default()
    };
    render_card(&card(json!({ "layout": "featured", "name": "Featured document" })), &bundle, &options).expect("render must succeed");
    assert_eq!(*observer.observations.lock().expect("observations must be readable"), vec!["frameTexture:selected.asset"]);
}

#[test]
fn passes_semantic_region_selections_to_region_bearing_renderers() {
    let bundle = test_bundle(test_template(json!({
        "cardFields": [name_field(), layout_field()],
        "layers": [{ "assetId": "marker.asset", "id": "marker", "kind": "image", "region": { "height": 10, "width": 10, "x": 0, "y": 0 } }],
        "presentationRules": [{
            "id": "featured-marker-region",
            "layerRegions": { "marker": { "height": 20, "width": 30, "x": 4, "y": 5 } },
            "when": { "equals": "featured", "path": "document.layout" },
        }],
        "semanticBindings": { "bindings": [{ "path": "document.layout", "source": { "field": "layout" } }] },
    })));
    let observer = Arc::new(Observer::default());
    let options = RenderOptions {
        assets: [("marker.asset".to_owned(), AssetSource::Url("marker".to_owned()))].into_iter().collect(),
        layer_renderers: renderers(vec![("image", observer.clone())]),
        ..RenderOptions::default()
    };
    render_card(&card(json!({ "layout": "featured", "name": "Featured document" })), &bundle, &options).expect("render must succeed");
    let regions = observer.regions.lock().expect("regions must be readable").clone();
    assert_eq!(regions, vec![Some(Region { x: 4.0, y: 5.0, width: 30.0, height: 20.0 })]);
}

#[test]
fn preserves_raster_text_raster_order_in_segments_and_svg_export() {
    let bundle = test_bundle(test_template(json!({
        "layers": [{ "id": "before", "kind": "test-raster" }, text_layer("middle"), { "id": "after", "kind": "test-raster" }],
    })));
    let options = RenderOptions { layer_renderers: renderers(vec![("test-raster", empty_raster())]), ..RenderOptions::default() };
    let rendered = render_card(&card(json!({ "name": "Ordered text" })), &bundle, &options).expect("render must succeed");

    assert_eq!(segment_kinds(&rendered), vec!["raster", "vector", "raster"]);
    let svg = text_svg(&rendered);
    let first_image = position_of(&svg, "<image ", 0);
    let text = position_of(&svg, "<text ", first_image);
    position_of(&svg, "<image ", text);
}

#[test]
fn preserves_svg_raster_text_order_in_segments_and_svg_export() {
    let bundle = test_bundle(test_template(json!({
        "layers": [
            { "element": { "attributes": { "id": "vector-first" }, "tag": "g" }, "id": "svg", "kind": "svg" },
            { "id": "middle", "kind": "test-raster" },
            text_layer("text"),
        ],
    })));
    let options = RenderOptions { layer_renderers: renderers(vec![("test-raster", empty_raster())]), ..RenderOptions::default() };
    let rendered = render_card(&card(json!({ "name": "Ordered text" })), &bundle, &options).expect("render must succeed");

    assert_eq!(segment_kinds(&rendered), vec!["vector", "raster", "vector"]);
    let svg = text_svg(&rendered);
    let vector = position_of(&svg, "id=\"vector-first\"", 0);
    let image = position_of(&svg, "<image ", vector);
    position_of(&svg, "<text ", image);
}

#[test]
fn rejects_vector_output_from_a_renderer_declared_as_raster() {
    let bundle = test_bundle(test_template(json!({ "layers": [{ "id": "mixed", "kind": "mixed" }] })));
    let options = RenderOptions { layer_renderers: renderers(vec![("mixed", Arc::new(TextFromRaster))]), ..RenderOptions::default() };
    let Err(error) = render_card(&card(json!({ "name": "Mixed" })), &bundle, &options) else {
        panic!("mixed output must be rejected");
    };
    assert_eq!(
        error.message(),
        "Raster renderer for layer \"mixed\" emitted vector output. Split mixed output into separate ordered layers."
    );
}

#[test]
fn removes_empty_planes_and_coalesces_consecutive_compatible_output() {
    let bundle = test_bundle(test_template(json!({
        "layers": [
            { "id": "raster-a", "kind": "test-raster" },
            { "id": "empty-vector", "kind": "empty-vector" },
            { "id": "empty-group", "kind": "group", "layers": [] },
            { "id": "raster-b", "kind": "test-raster" },
            text_layer("text-a"),
            text_layer("text-b"),
        ],
    })));
    let options = RenderOptions {
        layer_renderers: renderers(vec![("empty-vector", Arc::new(Observer::default())), ("test-raster", empty_raster())]),
        ..RenderOptions::default()
    };
    let rendered = render_card(&card(json!({ "name": "Coalesced" })), &bundle, &options).expect("render must succeed");

    assert_eq!(segment_kinds(&rendered), vec!["raster", "vector"]);
    let RenderSegment::Vector(elements) = &rendered.segments[1] else {
        panic!("the second segment must be vector output");
    };
    let tags: Vec<&str> = elements.iter().map(|element| element.tag.as_str()).collect();
    assert_eq!(tags, vec!["text", "text"]);
}

#[test]
fn allows_an_unmasked_group_to_emit_vector_output() {
    let bundle = test_bundle(test_template(json!({
        "layers": [{ "id": "vector-group", "kind": "group", "layers": [{ "id": "vector-child", "kind": "test-vector" }] }],
    })));
    let options = RenderOptions { layer_renderers: renderers(vec![("test-vector", Arc::new(GroupVector))]), ..RenderOptions::default() };
    let rendered = render_card(&card(json!({ "name": "Vector group" })), &bundle, &options).expect("render must succeed");
    assert_eq!(segment_kinds(&rendered), vec!["vector"]);
}

#[test]
fn does_not_emit_a_raster_segment_when_a_raster_renderer_reports_no_output() {
    let bundle = test_bundle(test_template(json!({ "layers": [{ "id": "empty-raster", "kind": "empty-raster" }, text_layer("text")] })));
    let options = RenderOptions {
        layer_renderers: renderers(vec![("empty-raster", Arc::new(EmptyRaster { reports_output: false }))]),
        ..RenderOptions::default()
    };
    let rendered = render_card(&card(json!({ "name": "No raster" })), &bundle, &options).expect("render must succeed");
    assert_eq!(segment_kinds(&rendered), vec!["vector"]);
}

#[test]
fn does_not_emit_a_raster_segment_for_missing_artwork() {
    let bundle = test_bundle(test_template(json!({
        "cardFields": [name_field(), { "kind": "image", "label": "Artwork", "name": "artwork" }],
        "layers": [{ "field": "artwork", "id": "artwork", "kind": "artwork", "region": { "height": 10, "width": 10, "x": 0, "y": 0 } }],
    })));
    let rendered = render_card(&card(json!({ "name": "No artwork" })), &bundle, &RenderOptions::default()).expect("render must succeed");
    assert!(rendered.segments.is_empty());
}

#[test]
fn draws_one_repeated_image_per_field_value_using_the_declared_offset() {
    let red = [255, 0, 0, 255];
    let assets = [("star.level".to_owned(), solid_png(&[red; 4], 2, 2))].into_iter().collect();
    let bundle = bundle_with_assets(
        test_template(json!({
            "cardFields": [name_field(), { "kind": "number", "label": "Level", "max": 13, "min": 1, "name": "level", "required": true }],
            "layers": [{
                "assetId": "star.level",
                "field": "level",
                "id": "levelStars",
                "kind": "repeated-image",
                "offset": { "x": -10, "y": 0 },
                "region": { "height": 4, "width": 4, "x": 80, "y": 10 },
            }],
        })),
        assets,
    );
    let rendered =
        render_card(&card(json!({ "level": 3, "name": "Three stars" })), &bundle, &RenderOptions::default()).expect("render must succeed");
    let pixels = decoded_png(&rendered);

    for x in [60, 63, 70, 73, 80, 83] {
        assert_eq!(pixels.get_pixel(x, 12).0, red, "x = {x}");
    }
    for x in [50, 59, 64, 69, 84] {
        assert_eq!(pixels.get_pixel(x, 12).0[3], 0, "x = {x}");
    }
    assert_eq!(pixels.get_pixel(81, 9).0[3], 0);
    assert_eq!(pixels.get_pixel(81, 14).0[3], 0);
}

fn mask_template(overrides: Value) -> Value {
    let mut base = json!({
        "cardFields": [
            name_field(),
            { "defaultValue": "masked", "kind": "text", "label": "Variant", "name": "variant", "options": ["masked", "plain"] },
        ],
        "layers": [{ "id": "masked-a", "kind": "test-raster" }],
        "masks": [{ "assetId": "mask.asset", "id": "bottom-half" }],
        "presentationRules": [{
            "id": "masked-variant",
            "maskSelections": { "masked-a": "bottom-half" },
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

fn mask_assets() -> IndexMap<String, AssetSource> {
    [("mask.asset".to_owned(), solid_png(&[[255, 255, 255, 255], [0, 0, 0, 255]], 2, 1))].into_iter().collect()
}

#[test]
fn converts_opaque_black_and_white_luminance_into_alpha_coverage() {
    let bundle = bundle_with_assets(mask_template(json!({ "dimensions": { "width": 2, "height": 1 } })), mask_assets());
    let options = RenderOptions {
        layer_renderers: renderers(vec![("test-raster", Arc::new(FillRaster { color: Color::from_rgba8(0, 0, 255, 255) }))]),
        ..RenderOptions::default()
    };
    let masked =
        render_card(&card(json!({ "name": "Coverage card", "variant": "masked" })), &bundle, &options).expect("render must succeed");
    let pixels = decoded_png(&masked);
    assert_eq!(pixels.get_pixel(0, 0).0, [0, 0, 255, 255]);
    assert_eq!(pixels.get_pixel(1, 0).0[3], 0);

    let plain = render_card(&card(json!({ "name": "Coverage card", "variant": "plain" })), &bundle, &options).expect("render must succeed");
    let pixels = decoded_png(&plain);
    assert_eq!(pixels.get_pixel(1, 0).0, [0, 0, 255, 255]);
}

#[test]
fn rejects_a_masked_group_with_vector_descendants() {
    let template = mask_template(json!({
        "layers": [{ "id": "masked-group", "kind": "group", "layers": [{ "id": "vector-child", "kind": "test-vector" }] }],
        "presentationRules": [{
            "id": "masked-variant",
            "maskSelections": { "masked-group": "bottom-half" },
            "when": { "equals": "masked", "path": "variant" },
        }],
    }));
    let bundle = bundle_with_assets(template, mask_assets());
    let options = RenderOptions { layer_renderers: renderers(vec![("test-vector", Arc::new(GroupVector))]), ..RenderOptions::default() };
    let Err(error) = render_card(&card(json!({ "name": "Invalid masked group", "variant": "masked" })), &bundle, &options) else {
        panic!("masked vector group must be rejected");
    };
    assert_eq!(error.message(), "Canvas mask \"bottom-half\" can only target a raster-only group \"masked-group\".");
}

#[test]
fn rejects_a_vector_output_mask_target_at_the_render_boundary() {
    let template = mask_template(json!({
        "layers": [{ "id": "vector-target", "kind": "test-vector" }],
        "presentationRules": [{
            "id": "mask-vector",
            "maskSelections": { "vector-target": "bottom-half" },
            "when": { "equals": "masked", "path": "variant" },
        }],
    }));
    let bundle = bundle_with_assets(template, mask_assets());
    let options = RenderOptions { layer_renderers: renderers(vec![("test-vector", Arc::new(GroupVector))]), ..RenderOptions::default() };
    let Err(error) = render_card(&card(json!({ "name": "Invalid target", "variant": "masked" })), &bundle, &options) else {
        panic!("vector mask target must be rejected");
    };
    assert_eq!(error.message(), "Canvas mask \"bottom-half\" can only target raster-output layer \"vector-target\".");
}

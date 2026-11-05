use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::json;
use tiny_skia::{Color, Paint, Rect, Transform};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::manifest::{Capture, CaptureContent, ElementKind, PreparedCoverage, RenderManifest, build_manifest};
use yugilife_core::model::{Layer, Region};
use yugilife_core::render::{LayerRenderer, LayerTarget, RenderOptions, RendererOutput, create_render_manifest};

fn coverage(layer_id: &str, order: usize, source_fields: &[&str], alpha: &[u8]) -> PreparedCoverage {
    PreparedCoverage {
        capture: Capture {
            layer_id: layer_id.to_owned(),
            order,
            source_fields: source_fields.iter().map(|field| (*field).to_owned()).collect(),
            content: CaptureContent::Image(Arc::new(alpha.to_vec())),
        },
        alpha: Arc::new(alpha.to_vec()),
        outlined: Arc::new(Vec::new()),
    }
}

fn layer_ids(manifest: &RenderManifest) -> Vec<&str> {
    manifest.elements.iter().map(|element| element.layer_id.as_str()).collect()
}

fn region(x: f64, y: f64, width: f64, height: f64) -> Option<Region> {
    Some(Region { x, y, width, height })
}

#[test]
fn retains_exact_final_visible_alpha_and_tight_bounds_after_overlapping_layers_coalesce() {
    let manifest = build_manifest(vec![coverage("bottom", 0, &["name"], &[255, 128]), coverage("top", 1, &[], &[255, 0])], 2, 1);

    assert_eq!(layer_ids(&manifest), vec!["bottom", "top"]);
    let bottom = &manifest.elements[0];
    let top = &manifest.elements[1];
    assert_eq!(bottom.bounds, region(1.0, 0.0, 1.0, 1.0));
    assert_eq!(bottom.alpha.alpha_at(0.0, 0.0), 0);
    assert_eq!(bottom.alpha.alpha_at(1.0, 0.0), 128);
    assert_eq!(bottom.absolute_bounds, region(0.0, 0.0, 2.0, 1.0));
    assert_eq!(bottom.absolute_alpha.alpha_at(0.0, 0.0), 255);
    assert_eq!(bottom.absolute_alpha.alpha_at(1.0, 0.0), 128);
    assert_eq!(bottom.source_fields, vec!["name".to_owned()]);
    assert_eq!(top.bounds, region(0.0, 0.0, 1.0, 1.0));
    assert_eq!(top.alpha.alpha_at(0.0, 0.0), 255);
    assert_eq!(top.alpha.alpha_at(1.0, 0.0), 0);
}

#[test]
fn accounts_for_partial_alpha_from_every_higher_layer() {
    let manifest =
        build_manifest(vec![coverage("bottom", 0, &[], &[255]), coverage("middle", 1, &[], &[128]), coverage("top", 2, &[], &[128])], 1, 1);
    let visible: Vec<u8> = manifest.elements.iter().map(|element| element.alpha.alpha_at(0.0, 0.0)).collect();
    assert_eq!(visible, vec![63, 64, 128]);
}

#[test]
fn retains_fully_occluded_layers_with_empty_final_visible_coverage() {
    let manifest = build_manifest(vec![coverage("bottom", 0, &["name"], &[255]), coverage("top", 1, &[], &[255])], 1, 1);

    assert_eq!(layer_ids(&manifest), vec!["bottom", "top"]);
    let bottom = &manifest.elements[0];
    assert_eq!(bottom.bounds, None);
    assert_eq!(bottom.alpha.alpha_at(0.0, 0.0), 0);
    assert_eq!(bottom.absolute_bounds, region(0.0, 0.0, 1.0, 1.0));
    assert_eq!(bottom.absolute_alpha.alpha_at(0.0, 0.0), 255);
}

#[test]
fn reads_alpha_outside_the_card_as_transparent() {
    let manifest = build_manifest(vec![coverage("only", 0, &[], &[255])], 1, 1);
    let alpha = &manifest.elements[0].alpha;
    assert_eq!(alpha.alpha_at(-1.0, 0.0), 0);
    assert_eq!(alpha.alpha_at(0.0, 1.0), 0);
    assert_eq!(alpha.alpha_at(0.9, 0.9), 255);
    assert_eq!(alpha.kind(), ElementKind::Image);
    assert_eq!(alpha.mime_type(), "image/png");
}

struct RectangleRaster {
    left: f32,
    width: f32,
}

impl LayerRenderer for RectangleRaster {
    fn output(&self) -> RendererOutput {
        RendererOutput::Raster
    }

    fn render(&self, target: &mut LayerTarget, _layer: &Layer) -> yugilife_core::Result<bool> {
        let height = target.surface.height() as f32;
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(255, 0, 0, 255));
        if let Some(rectangle) = Rect::from_xywh(self.left, 0.0, self.width, height) {
            target.surface.pixmap.fill_rect(rectangle, &paint, Transform::identity(), None);
        }
        target.surface.mark(f64::from(self.left), 0.0, f64::from(self.width), f64::from(height));
        Ok(true)
    }
}

fn manifest_bundle() -> TemplateBundle {
    let template = json!({
        "schemaVersion": 1,
        "dimensions": { "width": 4, "height": 2 },
        "cardFields": [
            { "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true },
            { "kind": "text", "label": "Status", "name": "status" },
        ],
        "layers": [
            { "id": "left", "kind": "left-half" },
            { "id": "hidden", "kind": "right-half", "defaultVisible": false },
            { "id": "right", "kind": "right-half" },
        ],
        "presentationRules": [{ "id": "flagged", "layerVisibility": { "right": true }, "when": { "equals": "flagged", "path": "status" } }],
        "semanticBindings": { "bindings": [{ "path": "status", "source": { "field": "status" } }] },
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

#[test]
fn creates_ordered_manifest_entries_for_visible_rendered_layers() {
    let bundle = manifest_bundle();
    let layer_renderers: IndexMap<String, Arc<dyn LayerRenderer>> = [
        ("left-half".to_owned(), Arc::new(RectangleRaster { left: 0.0, width: 3.0 }) as Arc<dyn LayerRenderer>),
        ("right-half".to_owned(), Arc::new(RectangleRaster { left: 2.0, width: 2.0 }) as Arc<dyn LayerRenderer>),
    ]
    .into_iter()
    .collect();
    let options = RenderOptions { layer_renderers, ..RenderOptions::default() };
    let card = CardData::from_json(json!({ "name": "Manifest", "status": "flagged" }).as_object().expect("card must be an object"));
    let manifest = create_render_manifest(&card, &bundle, &options).expect("manifest must be created");

    assert_eq!(layer_ids(&manifest), vec!["left", "right"]);
    let orders: Vec<usize> = manifest.elements.iter().map(|element| element.order).collect();
    assert_eq!(orders, vec![0, 1]);
    let left = &manifest.elements[0];
    let right = &manifest.elements[1];
    assert_eq!(left.absolute_bounds, region(0.0, 0.0, 3.0, 2.0));
    assert_eq!(left.bounds, region(0.0, 0.0, 2.0, 2.0));
    assert_eq!(left.alpha.alpha_at(2.0, 1.0), 0);
    assert_eq!(left.absolute_alpha.alpha_at(2.0, 1.0), 255);
    assert_eq!(right.bounds, region(2.0, 0.0, 2.0, 2.0));
    assert!(left.source_fields.is_empty());
    assert_eq!(right.source_fields, vec!["status".to_owned()]);
}

use image::RgbaImage;
use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::assets::AssetSource;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::encode_png;
use yugilife_core::render::{DecodedAssetCache, RenderOptions, RenderedCard, render_card};

fn bundle(dimensions: Value, card_fields: Value, layers: Value) -> TemplateBundle {
    let template = json!({ "schemaVersion": 1, "dimensions": dimensions, "cardFields": card_fields, "layers": layers });
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

fn name_field() -> Value {
    json!({ "defaultValue": "Test card", "kind": "text", "label": "Name", "name": "name", "required": true })
}

fn pixels(rendered: &RenderedCard) -> RgbaImage {
    let png = rendered.to_png(None).expect("PNG must export");
    image::load_from_memory(&png).expect("PNG must decode").to_rgba8()
}

fn assert_alpha_near(actual: u8, expected: u8) {
    assert!(actual.abs_diff(expected) <= 2, "alpha {actual} is not near {expected}");
}

fn bevel_pixels(options: Value) -> RgbaImage {
    let bevel = bundle(
        json!({ "width": 10, "height": 10 }),
        json!([name_field()]),
        json!([{ "id": "bevel", "kind": "canvas", "options": options, "region": { "height": 10, "width": 10, "x": 0, "y": 0 }, "renderer": "bevel" }]),
    );
    let card = CardData::from_json(json!({ "name": "Bevel" }).as_object().expect("card must be an object"));
    pixels(&render_card(&card, &bevel, &RenderOptions::default()).expect("bevel must render"))
}

#[test]
fn defaults_omitted_bevel_opacity_options_to_one() {
    let image = bevel_pixels(json!({
        "highlightColor": "#ffffff52",
        "shadowColor": "#0000005e",
        "thickness": { "bottom": 1, "left": 1, "right": 1, "top": 1 },
    }));
    assert_alpha_near(image.get_pixel(5, 0).0[3], 0x52);
    assert_alpha_near(image.get_pixel(0, 5).0[3], 0x52);
    assert_alpha_near(image.get_pixel(5, 9).0[3], 0x5e);
    assert_alpha_near(image.get_pixel(9, 5).0[3], 0x5e);
    assert_eq!(image.get_pixel(5, 5).0[3], 0);
}

#[test]
fn honors_numeric_bevel_opacity_options() {
    let image = bevel_pixels(json!({
        "highlightColor": "#ffffff",
        "highlightOpacity": 0.32,
        "shadowColor": "#000000",
        "shadowOpacity": 0.37,
        "thickness": { "bottom": 1, "left": 1, "right": 1, "top": 1 },
    }));
    assert_alpha_near(image.get_pixel(5, 0).0[3], 82);
    assert_eq!(&image.get_pixel(5, 0).0[..3], &[255, 255, 255]);
    assert_alpha_near(image.get_pixel(5, 9).0[3], 94);
    assert_eq!(&image.get_pixel(5, 9).0[..3], &[0, 0, 0]);
}

#[test]
fn rejects_bevel_layers_without_thickness() {
    let image_error = {
        let bevel = bundle(
            json!({ "width": 10, "height": 10 }),
            json!([name_field()]),
            json!([{ "id": "bevel", "kind": "canvas", "options": { "highlightColor": "#fff", "shadowColor": "#000" }, "region": { "height": 10, "width": 10, "x": 0, "y": 0 }, "renderer": "bevel" }]),
        );
        let card = CardData::from_json(json!({ "name": "Bevel" }).as_object().expect("card must be an object"));
        match render_card(&card, &bevel, &RenderOptions::default()) {
            Ok(_) => panic!("a bevel without thickness must fail"),
            Err(error) => error.message().to_owned(),
        }
    };
    assert_eq!(image_error, "Bevel layer \"bevel\" is missing options.thickness.");
}

fn red_artwork(width: u32, height: u32) -> CardValue {
    let pixels: Vec<u8> = [255, 0, 0, 255].repeat((width * height) as usize);
    CardValue::Asset(AssetSource::from_bytes(
        encode_png(&pixels, width, height).expect("PNG must encode"),
        Some("image/png".to_owned()),
        "art.png",
    ))
}

fn artwork_bundle(layer: Value) -> TemplateBundle {
    bundle(
        json!({ "width": 800, "height": 1000 }),
        json!([name_field(), { "kind": "image", "label": "Artwork", "name": "artwork" }]),
        json!([layer]),
    )
}

fn artwork_card() -> CardData {
    let mut card = CardData::from_json(json!({ "name": "Artwork" }).as_object().expect("card must be an object"));
    card.insert("artwork", red_artwork(600, 300));
    card
}

#[test]
fn shares_a_normalized_crop_transform_while_retaining_placement_and_clipping() {
    let bundle = artwork_bundle(json!({
        "field": "artwork",
        "fit": "width",
        "id": "artwork",
        "kind": "artwork",
        "placementRegion": { "height": 400, "width": 300, "x": 100, "y": 200 },
        "region": { "height": 900, "width": 700, "x": 50, "y": 60 },
        "transformId": "shared",
    }));
    let overrides = json!({ "artworkTransforms": { "shared": { "scale": 2, "x": 0.25, "y": -0.5 } } });
    let options = RenderOptions { presentation_overrides: Some(&overrides), ..RenderOptions::default() };
    let image = pixels(&render_card(&artwork_card(), &bundle, &options).expect("artwork must render"));

    assert_eq!(image.get_pixel(50, 60).0, [255, 0, 0, 255]);
    assert_eq!(image.get_pixel(624, 224).0, [255, 0, 0, 255]);
    assert_eq!(image.get_pixel(49, 100).0[3], 0);
    assert_eq!(image.get_pixel(100, 59).0[3], 0);
    assert_eq!(image.get_pixel(625, 100).0[3], 0);
    assert_eq!(image.get_pixel(100, 225).0[3], 0);
}

#[test]
fn emits_a_mode_gated_artwork_layer_only_for_the_matching_transform_mode() {
    let bundle = artwork_bundle(json!({
        "field": "artwork",
        "id": "overlay",
        "kind": "artwork",
        "placementRegion": { "height": 400, "width": 300, "x": 100, "y": 200 },
        "region": { "height": 900, "width": 700, "x": 50, "y": 60 },
        "transformId": "shared",
        "transformMode": "expanded",
    }));
    let plain = json!({ "artworkTransforms": { "shared": { "scale": 1, "x": 0, "y": 0 } } });
    let disabled =
        render_card(&artwork_card(), &bundle, &RenderOptions { presentation_overrides: Some(&plain), ..RenderOptions::default() })
            .expect("artwork must render");
    assert!(disabled.segments.is_empty());

    let expanded = json!({ "artworkTransforms": { "shared": { "mode": "expanded", "scale": 1, "x": 0, "y": 0 } } });
    let enabled =
        render_card(&artwork_card(), &bundle, &RenderOptions { presentation_overrides: Some(&expanded), ..RenderOptions::default() })
            .expect("artwork must render");
    assert_eq!(enabled.segments.len(), 1);
    let image = pixels(&enabled);
    assert_eq!(image.get_pixel(250, 400).0, [255, 0, 0, 255]);
    assert_eq!(image.get_pixel(40, 400).0[3], 0);
}

#[test]
fn reuses_decoded_card_assets_across_renders_and_keeps_only_the_last_renders() {
    let bundle = artwork_bundle(json!({
        "field": "artwork",
        "fit": "width",
        "id": "artwork",
        "kind": "artwork",
        "region": { "height": 900, "width": 700, "x": 50, "y": 60 },
    }));
    let card = artwork_card();
    let uncached = pixels(&render_card(&card, &bundle, &RenderOptions::default()).expect("artwork must render"));
    let cache = DecodedAssetCache::new();
    let options = RenderOptions { decoded_assets: Some(&cache), ..RenderOptions::default() };
    let first = pixels(&render_card(&card, &bundle, &options).expect("artwork must render"));
    assert_eq!(cache.len(), 1);
    let second = pixels(&render_card(&card, &bundle, &options).expect("artwork must render"));
    assert_eq!(cache.len(), 1);
    assert_eq!(first, uncached);
    assert_eq!(second, uncached);

    let mut other = CardData::from_json(json!({ "name": "Artwork" }).as_object().expect("card must be an object"));
    other.insert("artwork", red_artwork(20, 10));
    render_card(&other, &bundle, &options).expect("artwork must render");
    assert_eq!(cache.len(), 1, "the first card's artwork is released once a render no longer uses it");
}

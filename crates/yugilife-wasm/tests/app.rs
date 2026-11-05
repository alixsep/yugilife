use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::{Value, json};
use yugilife_core::assets::{AssetSource, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::{ImageExportOptions, SvgExportOptions, encode_png};
use yugilife_core::render::{RenderOptions, render_card};
use yugilife_core::validation::create_card_from_template;
use yugilife_wasm::app::call;

fn template_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../yugilife-cli/templates/templates/card/series-10")
}

fn pack(mut header: Value, files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut entries = serde_json::Map::new();
    let mut payload = Vec::new();
    for (name, bytes) in files {
        entries.insert(name.clone(), json!([payload.len(), bytes.len()]));
        payload.extend_from_slice(bytes);
    }
    header["files"] = Value::Object(entries);
    let json = header.to_string().into_bytes();
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json);
    bytes.extend(payload);
    bytes
}

struct Reply {
    response: Value,
    buffers: Vec<Vec<u8>>,
}

fn send(header: Value, files: &[(String, Vec<u8>)]) -> Reply {
    let mut outputs = call(&pack(header, files)).expect("the call must succeed");
    let response = serde_json::from_slice(&outputs.remove(0)).expect("the response must be JSON");
    Reply { response, buffers: outputs }
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).expect("template file must exist")).expect("template file must be JSON")
}

/// The packaged template's parts and assets, as the app's template loader has them.
fn template_parts() -> (Value, Value, Value, Vec<(String, PathBuf)>) {
    let directory = template_directory();
    let manifest = read_json(&directory.join("manifest.json"));
    let template = read_json(&directory.join("template.json"));
    let presets = read_json(&directory.join("color-presets.json"));
    let assets = manifest["assets"]
        .as_object()
        .expect("manifest assets")
        .iter()
        .map(|(id, path)| (id.clone(), directory.join(path.as_str().expect("asset path"))))
        .collect();
    (manifest, template, presets, assets)
}

fn load_template(key: &str) {
    let (manifest, template, presets, assets) = template_parts();
    let mut entries = serde_json::Map::new();
    let mut files = Vec::new();
    for (id, path) in assets {
        let file = format!("asset:{id}");
        entries.insert(id, json!({ "file": file, "mediaType": media_type_for_path(&path.display().to_string()) }));
        files.push((file, std::fs::read(&path).expect("asset must be readable")));
    }
    send(
        json!({ "op": "loadTemplate", "key": key, "manifest": manifest, "template": template, "colorPresets": presets, "assets": entries }),
        &files,
    );
}

fn native_bundle() -> TemplateBundle {
    let (manifest, template, presets, assets) = template_parts();
    let assets: IndexMap<String, AssetSource> = assets
        .into_iter()
        .map(|(id, path)| {
            let label = path.display().to_string();
            let source = AssetSource::from_bytes(std::fs::read(&path).unwrap(), Some(media_type_for_path(&label).to_owned()), label);
            (id, source)
        })
        .collect();
    TemplateBundle::new(manifest, &template, presets, assets).expect("the packaged template must load")
}

fn artwork() -> Vec<u8> {
    let pixels: Vec<u8> = (0..64 * 48).flat_map(|index| [(index % 251) as u8, 90, 200, 255]).collect();
    encode_png(&pixels, 64, 48).expect("PNG must encode")
}

/// A complete card, as the app's editor creates one, with a name and a description.
fn card_json() -> Value {
    let (_, template, _, _) = template_parts();
    let mut fields = serde_json::Map::new();
    for (name, value) in create_card_from_template(template.as_object().unwrap()).fields() {
        if let Some(value) = value.json() {
            fields.insert(name.clone(), value.clone());
        }
    }
    fields.insert("name".to_owned(), json!("Wasm Dragon"));
    fields.insert("description".to_owned(), json!("A test card."));
    Value::Object(fields)
}

fn render_header(outputs: Value) -> Value {
    json!({
        "op": "render",
        "template": "series-10",
        "card": card_json(),
        "cardAssets": { "artwork": { "file": "artwork", "mediaType": "image/png" } },
        "outputs": outputs,
    })
}

#[test]
fn renders_the_same_bytes_as_the_native_api() {
    load_template("series-10");
    let files = [("artwork".to_owned(), artwork())];
    let reply = send(render_header(json!([{ "kind": "image", "format": "png" }, { "kind": "svg", "title": "Wasm Dragon" }])), &files);
    let outputs = reply.response["outputs"].as_array().unwrap();
    assert_eq!(outputs[0]["mimeType"], "image/png");

    let bundle = native_bundle();
    let mut card = CardData::from_json(card_json().as_object().unwrap());
    card.insert("artwork", CardValue::Asset(AssetSource::from_bytes(artwork(), Some("image/png".to_owned()), "artwork")));
    let rendered = render_card(&card, &bundle, &RenderOptions::default()).expect("native render");
    let png = rendered.to_image(&ImageExportOptions::default()).unwrap();
    let svg = rendered.to_svg(&SvgExportOptions { title: Some("Wasm Dragon".to_owned()), ..SvgExportOptions::default() }).unwrap();
    assert!(reply.buffers[outputs[0]["buffer"].as_u64().unwrap() as usize] == png);
    assert!(reply.buffers[outputs[1]["buffer"].as_u64().unwrap() as usize] == svg.into_bytes());
}

#[test]
fn returns_live_and_outlined_segments_sharing_raster_planes() {
    load_template("series-10");
    let reply = send(render_header(json!([{ "kind": "segments" }])), &[("artwork".to_owned(), artwork())]);
    let segments = &reply.response["outputs"][0];
    let live = segments["segments"].as_array().unwrap();
    let outlined = segments["outlinedSegments"].as_array().unwrap();
    assert_eq!(live.len(), outlined.len());
    let rasters: Vec<&Value> = live.iter().filter(|segment| segment["kind"] == "raster").collect();
    assert!(!rasters.is_empty());
    assert_eq!(reply.buffers.len(), rasters.len(), "each raster plane is sent once");
    for raster in rasters {
        let buffer = &reply.buffers[raster["buffer"].as_u64().unwrap() as usize];
        assert_eq!(buffer.len() as u64, raster["width"].as_u64().unwrap() * raster["height"].as_u64().unwrap() * 4);
    }
    let live_text = live
        .iter()
        .filter(|segment| segment["kind"] == "vector")
        .flat_map(|segment| segment["elements"].as_array().unwrap())
        .filter(|element| element["tag"] == "text")
        .count();
    assert!(live_text > 0, "live segments keep SVG text");
    let outlined_text = outlined
        .iter()
        .filter(|segment| segment["kind"] == "vector")
        .flat_map(|segment| segment["elements"].as_array().unwrap())
        .filter(|element| element["tag"] == "text")
        .count();
    assert_eq!(outlined_text, 0, "outlined segments replace text with paths");
}

#[test]
fn returns_webp_requests_as_pixels_and_rejects_invalid_options_first() {
    load_template("series-10");
    let files = [("artwork".to_owned(), artwork())];
    let reply = send(render_header(json!([{ "kind": "image", "format": "webp", "quality": 0.8, "size": { "width": 203 } }])), &files);
    let output = &reply.response["outputs"][0];
    assert_eq!(output["kind"], "pixels");
    let (width, height) = (output["width"].as_u64().unwrap(), output["height"].as_u64().unwrap());
    assert_eq!(width, 203);
    assert_eq!(reply.buffers[0].len() as u64, width * height * 4);

    let error = call(&pack(render_header(json!([{ "kind": "image", "format": "webp", "backgroundColor": "#000" }])), &files)).unwrap_err();
    assert!(error.contains("JPEG") || error.to_lowercase().contains("background"), "{error}");
}

#[test]
fn serves_manifest_alpha_cropped_to_bounds_and_encodes_it_on_demand() {
    load_template("series-10");
    let files = [("artwork".to_owned(), artwork())];
    let mut header = render_header(json!([]));
    header["op"] = json!("manifest");
    header["serial"] = json!(7);
    let reply = send(header, &files);
    let elements = reply.response["elements"].as_array().unwrap();
    assert!(!elements.is_empty());
    let (index, element) = elements.iter().enumerate().find(|(_, element)| !element["bounds"].is_null()).expect("a visible element");
    let crop = &element["alpha"]["crop"];
    assert_eq!(crop["width"].as_f64(), element["bounds"]["width"].as_f64());
    let plane = &reply.buffers[crop["buffer"].as_u64().unwrap() as usize];
    assert_eq!(plane.len() as u64, crop["width"].as_u64().unwrap() * crop["height"].as_u64().unwrap());
    assert!(plane.iter().any(|alpha| *alpha != 0));

    let alpha = send(json!({ "op": "manifestAlpha", "serial": 7, "element": index, "absolute": false }), &[]);
    let bytes = &alpha.buffers[0];
    match alpha.response["mimeType"].as_str().unwrap() {
        "image/png" => assert_eq!(&bytes[1..4], b"PNG"),
        _ => assert!(String::from_utf8_lossy(bytes).contains("<svg")),
    }
    assert!(call(&pack(json!({ "op": "manifestAlpha", "serial": 6, "element": 0 }), &[])).unwrap_err().contains("no longer available"));
}

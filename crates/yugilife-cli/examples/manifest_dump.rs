use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{Value, json};
use yugilife_cli::input::{RenderSettings, load_render_request};
use yugilife_core::manifest::ElementKind;
use yugilife_core::model::Region;
use yugilife_core::render::{RenderOptions, create_render_manifest};

fn region(region: Option<Region>) -> Value {
    region.map_or(Value::Null, |region| json!({ "height": region.height, "width": region.width, "x": region.x, "y": region.y }))
}

fn main() -> Result<(), String> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [input, directory] = arguments.as_slice() else {
        return Err("usage: manifest_dump <card.json> <output-directory>".to_owned());
    };
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let request = load_render_request(input, Path::new("dump.png"), &RenderSettings::default()).map_err(|error| error.to_string())?;
    let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    let options = RenderOptions {
        assets: request.assets.clone(),
        presentation_overrides: request.presentation_overrides.as_ref(),
        ..RenderOptions::default()
    };
    let manifest = create_render_manifest(&request.card, &request.bundle, &options).map_err(|error| error.message().to_owned())?;
    let elements: Vec<Value> = manifest
        .elements
        .iter()
        .map(|element| {
            json!({
                "layerId": element.layer_id,
                "order": element.order,
                "sourceFields": element.source_fields,
                "bounds": region(element.bounds),
                "absoluteBounds": region(element.absolute_bounds),
                "kind": if element.alpha.kind() == ElementKind::Svg { "svg" } else { "image" },
                "alpha": encode(element.alpha.alpha()),
                "absoluteAlpha": encode(element.absolute_alpha.alpha()),
            })
        })
        .collect();
    std::fs::write(directory.join("manifest.json"), Value::Array(elements).to_string()).map_err(|error| error.to_string())
}

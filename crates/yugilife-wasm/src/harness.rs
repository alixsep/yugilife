//! The reference tooling's entry points (`reference/browser-harness.mjs`): a template from its
//! directory layout and renders driven by CLI input documents, to compare with the native CLI.

use indexmap::IndexMap;
use serde_json::Value;
use yugilife_core::assets::{AssetSource, encode_data_url, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::{ImageExportOptions, ImageFormat, SvgExportOptions, TextMode};
use yugilife_core::render::{RenderOptions, render_card};

use crate::pack::Pack;
use crate::session::{self, Sources};

const TEMPLATE: &str = "harness";

fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// Header: `{ "directory": "templates/card/series-10", "files": { "<path>": [offset, length] } }`.
pub fn load_bundle(bytes: &[u8]) -> Result<(), String> {
    let pack = Pack::parse(bytes)?;
    let directory = pack.str("directory").ok_or("Bundle pack needs a directory.")?;
    let read_json = |relative: &str| -> Result<Value, String> {
        let path = normalize(&format!("{directory}/{relative}"));
        let bytes = pack.file(&path).ok_or_else(|| format!("Template file \"{path}\" is missing."))?;
        serde_json::from_slice(bytes).map_err(|_| format!("Template file \"{path}\" is not JSON."))
    };
    let manifest = read_json("manifest.json")?;
    let template = read_json(manifest.get("template").and_then(Value::as_str).unwrap_or("template.json"))?;
    let presets = match manifest.get("colorPresets").and_then(Value::as_str) {
        Some(path) => read_json(path)?,
        None => Value::Object(serde_json::Map::new()),
    };
    let mut assets = IndexMap::new();
    for (asset_id, relative) in manifest.get("assets").and_then(Value::as_object).into_iter().flatten() {
        let path = normalize(&format!("{directory}/{}", relative.as_str().unwrap_or_default()));
        let bytes = pack.file(&path).ok_or_else(|| format!("Template asset \"{asset_id}\" is missing."))?;
        assets.insert(asset_id.clone(), AssetSource::from_bytes(bytes.to_vec(), Some(media_type_for_path(&path).to_owned()), path));
    }
    let bundle = TemplateBundle::new(manifest, &template, presets, assets).map_err(|error| error.message().to_owned())?;
    session::store_template(TEMPLATE, bundle);
    Ok(())
}

/// Renders one card and returns one payload per requested format, as `yugilife-cli render-batch`.
/// Header: `{ "input": <CLI input document>, "formats": ["png", "svg", "text.svg", "jpg", "warnings.json"],
/// "files": { "<reference from input.files>": [offset, length] } }`.
pub fn render(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let pack = Pack::parse(bytes)?;
    let bundle = session::template(TEMPLATE)?;
    let input = pack.header.get("input").ok_or("Render pack needs an input.")?;
    let card_fields = input.get("card").and_then(Value::as_object).ok_or("Input must contain a \"card\" object.")?;
    let text_fields: Vec<String> = bundle
        .template
        .card_fields()
        .filter(|field| field.get("kind").and_then(Value::as_str) != Some("image"))
        .filter_map(|field| field.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let mut card = CardData::from_json(card_fields);
    let mut assets = IndexMap::new();
    let mut sources = Sources::default();
    for (key, reference) in input.get("files").and_then(Value::as_object).into_iter().flatten() {
        let reference = reference.as_str().ok_or_else(|| format!("File reference \"{key}\" must be a string."))?;
        let bytes = pack.file(reference).ok_or_else(|| format!("File \"{reference}\" is missing from the pack."))?;
        let media_type = media_type_for_path(reference);
        let source = sources.source(reference, bytes, Some(media_type));
        if text_fields.contains(key) {
            card.insert(key.clone(), CardValue::Json(Value::String(encode_data_url(media_type, bytes))));
        } else {
            card.insert(key.clone(), CardValue::Asset(source.clone()));
        }
        assets.insert(key.clone(), source);
    }
    sources.commit();
    let presentation_overrides = input.get("presentationOverrides").filter(|value| value.is_object());
    let formats = pack.header.get("formats").and_then(Value::as_array).ok_or("Render pack needs formats.")?;
    session::with_decoded(|decoded| {
        let options = RenderOptions { assets, presentation_overrides, decoded_assets: Some(decoded), ..RenderOptions::default() };
        let rendered = render_card(&card, &bundle, &options).map_err(|error| error.message().to_owned())?;
        formats
            .iter()
            .map(|format| {
                let svg = |text_mode| {
                    rendered
                        .to_svg(&SvgExportOptions { font_smoothing: None, text_mode, title: None })
                        .map(String::into_bytes)
                        .map_err(|error| error.message().to_owned())
                };
                let image = |format| {
                    rendered
                        .to_image(&ImageExportOptions { format: Some(format), ..ImageExportOptions::default() })
                        .map_err(|error| error.message().to_owned())
                };
                match format.as_str() {
                    Some("svg") => svg(None),
                    Some("text.svg") => svg(Some(TextMode::Text)),
                    Some("png") => image(ImageFormat::Png),
                    Some("jpg") => image(ImageFormat::Jpeg),
                    Some("warnings.json") => Ok(crate::app::warnings_text(&rendered.warnings).into_bytes()),
                    other => Err(format!("Unsupported format {other:?}.")),
                }
            })
            .collect()
    })
}

//! The operations behind the JavaScript `yugilife-core-wasm` package. Each call is one pack whose
//! header names an `op`; the reply is a JSON response plus the binary buffers it refers to.
//!
//! - `loadTemplate` `{ key, manifest, template, colorPresets, assets: { id: asset } }`
//! - `dropTemplate` `{ key }`
//! - `render` `{ template, card, cardAssets: { field: asset }, assets: { id: asset }, layers,
//!   presetOverrides, presentationOverrides, outputs: [output] }`, where an output is
//!   `{ kind: "segments" }`, `{ kind: "svg", textMode, title, fontSmoothing }` or
//!   `{ kind: "image", format, quality, backgroundColor, size }`
//! - `manifest` the `render` inputs plus `serial`
//! - `manifestAlpha` `{ serial, element, absolute }`
//!
//! An asset is `{ file, mediaType }`, `file` naming a file of the pack.

use std::collections::HashMap;

use indexmap::IndexMap;
use serde_json::{Map, Value, json};
use yugilife_core::assets::AssetSource;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::ExportSegment;
use yugilife_core::export::{
    FontSmoothing, ImageExportOptions, ImageFormat, OutputSize, SvgExportOptions, TextMode, validate_image_export_options,
};
use yugilife_core::manifest::{AlphaChannel, ElementKind};
use yugilife_core::model::Region;
use yugilife_core::raster::canvas::unpremultiplied;
use yugilife_core::render::{RenderOptions, RenderSegment, RenderWarning, RenderedCard, create_render_manifest, render_card};
use yugilife_core::svg::SvgElement;

use crate::pack::{Pack, Reply};
use crate::session::{self, Sources};

pub fn call(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let pack = Pack::parse(bytes)?;
    match pack.str("op") {
        Some("loadTemplate") => load_template(&pack),
        Some("dropTemplate") => {
            session::drop_template(pack.str("key").ok_or("dropTemplate needs a key.")?);
            Ok(Reply::default().finish(&json!({})))
        }
        Some("render") => render(&pack),
        Some("manifest") => manifest(&pack),
        Some("manifestAlpha") => manifest_alpha(&pack),
        Some("avifItems") => crate::avif::items(&pack),
        Some("provideAvif") => crate::avif::provide(&pack),
        Some(operation) if crate::sync::OPERATIONS.contains(&operation) => crate::sync::call(&pack),
        other => Err(format!("Unknown operation {other:?}.")),
    }
}

pub fn warnings_json(warnings: &[RenderWarning]) -> Value {
    Value::Array(warnings.iter().map(RenderWarning::to_json).collect())
}

pub fn warnings_text(warnings: &[RenderWarning]) -> String {
    format!("{}\n", serde_json::to_string_pretty(&warnings_json(warnings)).unwrap_or_default())
}

fn asset(pack: &Pack, entry: &Value, label: &str) -> Result<(String, Vec<u8>, Option<String>), String> {
    let file = entry.get("file").and_then(Value::as_str).ok_or_else(|| format!("Asset \"{label}\" needs a file."))?;
    let bytes = pack.file(file).ok_or_else(|| format!("Asset \"{label}\" is missing from the pack."))?;
    let media_type = entry.get("mediaType").and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_owned);
    Ok((file.to_owned(), bytes.to_vec(), media_type))
}

fn load_template(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let key = pack.str("key").ok_or("loadTemplate needs a key.")?;
    let header = &pack.header;
    let mut assets = IndexMap::new();
    for (id, entry) in header.get("assets").and_then(Value::as_object).into_iter().flatten() {
        let (_, bytes, media_type) = asset(pack, entry, id)?;
        assets.insert(id.clone(), AssetSource::from_bytes(bytes, media_type, id.clone()));
    }
    let manifest = header.get("manifest").cloned().unwrap_or(Value::Null);
    let template = header.get("template").cloned().unwrap_or(Value::Null);
    let presets = header.get("colorPresets").cloned().unwrap_or_else(|| Value::Object(Map::new()));
    let bundle = TemplateBundle::new(manifest, &template, presets, assets).map_err(|error| error.message().to_owned())?;
    session::store_template(key, bundle);
    Ok(Reply::default().finish(&json!({})))
}

struct Inputs {
    card: CardData,
    assets: IndexMap<String, AssetSource>,
    layers: IndexMap<String, bool>,
    preset_overrides: IndexMap<String, String>,
    /// Sources the host already decoded (see `provideAvif`).
    predecoded: Vec<(AssetSource, yugilife_core::raster::decode::SharedDecoded)>,
}

fn inputs(pack: &Pack) -> Result<Inputs, String> {
    let header = &pack.header;
    let fields = header.get("card").and_then(Value::as_object).ok_or("A render needs a card object.")?;
    let mut card = CardData::from_json(fields);
    let mut sources = Sources::default();
    let mut predecoded = Vec::new();
    let mut source = |file: &str, bytes: &[u8], media_type: Option<&str>| {
        let source = sources.source(file, bytes, media_type);
        if let Some(decoded) = session::take_predecoded(file, bytes) {
            predecoded.push((source.clone(), decoded));
        }
        source
    };
    for (field, entry) in header.get("cardAssets").and_then(Value::as_object).into_iter().flatten() {
        let (file, bytes, media_type) = asset(pack, entry, field)?;
        card.insert(field.clone(), CardValue::Asset(source(&file, &bytes, media_type.as_deref())));
    }
    let mut assets = IndexMap::new();
    for (id, entry) in header.get("assets").and_then(Value::as_object).into_iter().flatten() {
        let (file, bytes, media_type) = asset(pack, entry, id)?;
        assets.insert(id.clone(), source(&file, &bytes, media_type.as_deref()));
    }
    sources.commit();
    let layers = header
        .get("layers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, visible)| visible.as_bool().map(|visible| (id.clone(), visible)))
        .collect();
    let preset_overrides = header
        .get("presetOverrides")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(target, preset)| preset.as_str().map(|preset| (target.clone(), preset.to_owned())))
        .collect();
    Ok(Inputs { card, assets, layers, preset_overrides, predecoded })
}

/// Runs `run` with the render options a pack describes.
fn with_options<T>(pack: &Pack, run: impl FnOnce(&CardData, &TemplateBundle, &RenderOptions) -> Result<T, String>) -> Result<T, String> {
    let bundle = session::template(pack.str("template").ok_or("A render needs a template key.")?)?;
    let Inputs { card, assets, layers, preset_overrides, predecoded } = inputs(pack)?;
    let presentation_overrides = pack.header.get("presentationOverrides").filter(|value| value.is_object());
    session::with_decoded(|decoded| {
        for (source, image) in predecoded {
            decoded.provide(&source, image);
        }
        let options = RenderOptions {
            assets,
            layers,
            preset_overrides,
            presentation_overrides,
            decoded_assets: Some(decoded),
            ..RenderOptions::default()
        };
        run(&card, &bundle, &options)
    })
}

fn message(error: yugilife_core::Error) -> String {
    error.message().to_owned()
}

fn render(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let outputs = pack.header.get("outputs").and_then(Value::as_array).cloned().unwrap_or_default();
    with_options(pack, |card, bundle, options| {
        let rendered = render_card(card, bundle, options).map_err(message)?;
        let mut reply = Reply::default();
        let results = outputs.iter().map(|output| render_output(&rendered, output, &mut reply)).collect::<Result<Vec<_>, _>>()?;
        Ok(reply.finish(&json!({ "warnings": warnings_json(&rendered.warnings), "outputs": results })))
    })
}

/// Raster planes as unpremultiplied RGBA buffers, each sent once however many lists refer to it.
#[derive(Default)]
struct Rasters {
    sent: HashMap<usize, usize>,
}

impl Rasters {
    fn segment(&mut self, pixmap: &std::sync::Arc<tiny_skia::Pixmap>, reply: &mut Reply) -> Value {
        let key = std::sync::Arc::as_ptr(pixmap) as usize;
        let buffer = *self.sent.entry(key).or_insert_with(|| reply.buffer(unpremultiplied(pixmap)));
        json!({ "kind": "raster", "buffer": buffer, "width": pixmap.width(), "height": pixmap.height() })
    }
}

fn vector(elements: &[SvgElement]) -> Value {
    json!({ "kind": "vector", "elements": elements.iter().map(SvgElement::to_json).collect::<Vec<_>>() })
}

fn render_output(rendered: &RenderedCard, output: &Value, reply: &mut Reply) -> Result<Value, String> {
    let text = |key: &str| output.get(key).and_then(Value::as_str);
    match text("kind") {
        Some("segments") => {
            let mut rasters = Rasters::default();
            let segments: Vec<Value> = rendered
                .segments
                .iter()
                .map(|segment| match segment {
                    RenderSegment::Raster(pixmap) => rasters.segment(pixmap, reply),
                    RenderSegment::Vector(elements) => vector(elements),
                })
                .collect();
            let outlined: Vec<Value> = rendered
                .outlined_segments()
                .map_err(message)?
                .iter()
                .map(|segment| match segment {
                    ExportSegment::Raster(pixmap) => rasters.segment(pixmap, reply),
                    ExportSegment::Vector(elements) => vector(elements),
                })
                .collect();
            let vector_layers: Vec<Value> = rendered.vector_layers.iter().map(SvgElement::to_json).collect();
            Ok(json!({ "kind": "segments", "segments": segments, "outlinedSegments": outlined, "vectorLayers": vector_layers }))
        }
        Some("svg") => {
            let options = SvgExportOptions {
                font_smoothing: match text("fontSmoothing") {
                    None => None,
                    Some("grayscale") => Some(FontSmoothing::Grayscale),
                    Some("subpixel") => Some(FontSmoothing::Subpixel),
                    Some(other) => return Err(format!("Unsupported font smoothing \"{other}\".")),
                },
                text_mode: match text("textMode") {
                    None => None,
                    Some("paths") => Some(TextMode::Paths),
                    Some("text") => Some(TextMode::Text),
                    Some(other) => return Err(format!("Unsupported SVG text mode \"{other}\".")),
                },
                title: text("title").map(str::to_owned),
            };
            let svg = rendered.to_svg(&options).map_err(message)?;
            Ok(json!({ "kind": "svg", "buffer": reply.buffer(svg.into_bytes()) }))
        }
        Some("image") => {
            let options = image_options(output)?;
            if options.format == Some(ImageFormat::Webp) {
                // No pure-Rust lossy WebP encoder: the host encodes these exact pixels.
                validate_image_export_options(&options).map_err(message)?;
                let pixmap = rendered.to_pixmap(options.size).map_err(message)?;
                let (width, height) = (pixmap.width(), pixmap.height());
                let buffer = reply.buffer(unpremultiplied(&pixmap));
                return Ok(json!({ "kind": "pixels", "buffer": buffer, "width": width, "height": height }));
            }
            let mime_type = match options.format {
                Some(ImageFormat::Jpeg) => "image/jpeg",
                _ => "image/png",
            };
            let bytes = rendered.to_image(&options).map_err(message)?;
            Ok(json!({ "kind": "image", "buffer": reply.buffer(bytes), "mimeType": mime_type }))
        }
        other => Err(format!("Unsupported output {other:?}.")),
    }
}

fn image_options(output: &Value) -> Result<ImageExportOptions, String> {
    let format = match output.get("format").and_then(Value::as_str) {
        None => None,
        Some("png") => Some(ImageFormat::Png),
        Some("jpeg") => Some(ImageFormat::Jpeg),
        Some("webp") => Some(ImageFormat::Webp),
        Some(other) => return Err(format!("Unsupported raster format \"{other}\".")),
    };
    let size = match output.get("size").and_then(Value::as_object) {
        None => None,
        Some(size) => {
            let dimension = |key: &str| size.get(key).and_then(Value::as_f64);
            match (dimension("scale"), dimension("width"), dimension("height")) {
                (Some(scale), None, None) => Some(OutputSize::Scale(scale)),
                (None, Some(width), None) => Some(OutputSize::Width(width)),
                (None, None, Some(height)) => Some(OutputSize::Height(height)),
                _ => return Err("Raster size must set exactly one of scale, width, or height.".to_owned()),
            }
        }
    };
    Ok(ImageExportOptions {
        background_color: output.get("backgroundColor").and_then(Value::as_str).map(str::to_owned),
        format,
        quality: output.get("quality").and_then(Value::as_f64),
        size,
    })
}

fn region(region: Option<Region>) -> Value {
    region.map_or(Value::Null, |region| json!({ "x": region.x, "y": region.y, "width": region.width, "height": region.height }))
}

/// The channel's alpha inside `bounds`, row by row. Alpha outside an element's tight bounds is zero
/// by definition, so the host can answer `alphaAt` anywhere from this crop.
fn cropped_alpha(channel: &AlphaChannel, bounds: Option<Region>, width: u32, reply: &mut Reply) -> Value {
    let kind = if channel.kind() == ElementKind::Svg { "svg" } else { "image" };
    let Some(bounds) = bounds else {
        return json!({ "kind": kind, "mimeType": channel.mime_type(), "crop": Value::Null });
    };
    let (x, y, crop_width, crop_height) = (bounds.x as usize, bounds.y as usize, bounds.width as usize, bounds.height as usize);
    let alpha = channel.alpha();
    let mut crop = Vec::with_capacity(crop_width * crop_height);
    for row in y..y + crop_height {
        let start = row * width as usize + x;
        crop.extend_from_slice(&alpha[start..start + crop_width]);
    }
    json!({ "kind": kind, "mimeType": channel.mime_type(), "crop": { "buffer": reply.buffer(crop), "x": x, "y": y, "width": crop_width, "height": crop_height } })
}

fn manifest(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let serial = pack.header.get("serial").and_then(Value::as_u64).ok_or("A manifest needs a serial.")?;
    let (manifest, width, height) = with_options(pack, |card, bundle, options| {
        let manifest = create_render_manifest(card, bundle, options).map_err(message)?;
        Ok((manifest, bundle.template.width.round().max(1.0) as u32, bundle.template.height.round().max(1.0) as u32))
    })?;
    let mut reply = Reply::default();
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
                "alpha": cropped_alpha(&element.alpha, element.bounds, width, &mut reply),
                "absoluteAlpha": cropped_alpha(&element.absolute_alpha, element.absolute_bounds, width, &mut reply),
            })
        })
        .collect();
    session::store_manifest(serial, manifest);
    Ok(reply.finish(&json!({ "width": width, "height": height, "elements": elements })))
}

fn manifest_alpha(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let serial = pack.header.get("serial").and_then(Value::as_u64).ok_or("manifestAlpha needs a serial.")?;
    let index = pack.header.get("element").and_then(Value::as_u64).ok_or("manifestAlpha needs an element.")? as usize;
    let absolute = pack.header.get("absolute").and_then(Value::as_bool).unwrap_or(false);
    let (bytes, mime_type) = session::with_manifest(serial, |manifest| {
        let element = manifest.elements.get(index).ok_or_else(|| format!("Manifest element {index} does not exist."))?;
        let channel = if absolute { &element.absolute_alpha } else { &element.alpha };
        Ok::<_, String>((channel.to_bytes().map_err(message)?, channel.mime_type()))
    })??;
    let mut reply = Reply::default();
    let buffer = reply.buffer(bytes);
    Ok(reply.finish(&json!({ "buffer": buffer, "mimeType": mime_type })))
}

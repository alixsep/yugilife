//! AVIF decoding by the host. A browser's own AV1 decoder runs with SIMD and threads, where rav1d in
//! WebAssembly runs with neither, so the host may decode an AVIF asset's AV1 items itself and
//! return the planes. The core still reads the color metadata from the AV1 sequence headers and
//! converts the planes to RGB itself; AV1 decoding is exact by specification, so the result is the
//! same as decoding here. Anything unexpected is refused, and the render then decodes with rav1d.
//!
//! - `avifItems` `{ file }`: `{ decoded: true }` when a render of these bytes would find them
//!   decoded already, otherwise `{ items: [{ kind, codec, buffer }] }` with each item's AV1 data.
//! - `provideAvif` `{ file, width, height, layout, y, u, v, alpha? }`, each plane
//!   `{ file, stride }` (alpha also `{ width, height }`), for the next render of `file`.

use std::sync::Arc;

use serde_json::{Value, json};
use yugilife_core::raster::av1::{SequenceInfo, sequence_info};
use yugilife_core::raster::decode::{AlphaPlane, ChromaLayout, Decoded, Plane, YuvImage, avif_items};
use yugilife_core::raster::image::RasterImage;

use crate::pack::{Pack, Reply};
use crate::session;

fn avif<'a>(pack: &'a Pack<'a>) -> Result<(&'a str, &'a [u8]), String> {
    let file = pack.str("file").ok_or("An AVIF operation needs a file.")?;
    let bytes = pack.file(file).ok_or_else(|| format!("File \"{file}\" is missing from the pack."))?;
    Ok((file, bytes))
}

pub fn items(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let (file, bytes) = avif(pack)?;
    let mut reply = Reply::default();
    if session::is_decoded(file, bytes) {
        return Ok(reply.finish(&json!({ "decoded": true })));
    }
    let (color, alpha) = avif_items(bytes).ok_or("The file is not an AVIF image.")?;
    let mut items = Vec::new();
    for (kind, data) in [("color", Some(color)), ("alpha", alpha)] {
        let Some(data) = data else { continue };
        let info = sequence_info(&data).ok_or("An AVIF item has no AV1 sequence header.")?;
        if info.bit_depth != 8 {
            return Err("Only 8-bit AVIF is decoded by the host.".to_owned());
        }
        items.push(json!({ "kind": kind, "codec": info.codec(), "buffer": reply.buffer(data) }));
    }
    Ok(reply.finish(&json!({ "items": items })))
}

fn layout(info: &SequenceInfo) -> ChromaLayout {
    match (info.monochrome, info.subsampling_x, info.subsampling_y) {
        (true, _, _) => ChromaLayout::I400,
        (false, true, true) => ChromaLayout::I420,
        (false, true, false) => ChromaLayout::I422,
        _ => ChromaLayout::I444,
    }
}

fn plane(pack: &Pack, description: Option<&Value>) -> Result<Plane, String> {
    let Some(description) = description else {
        return Ok(Plane { data: Vec::new(), stride: 0 });
    };
    let file = description.get("file").and_then(Value::as_str).ok_or("A plane needs a file.")?;
    let data = pack.file(file).ok_or("A plane is missing from the pack.")?.to_vec();
    let stride = description.get("stride").and_then(Value::as_u64).ok_or("A plane needs a stride.")? as usize;
    Ok(Plane { data, stride })
}

pub fn provide(pack: &Pack) -> Result<Vec<Vec<u8>>, String> {
    let (file, bytes) = avif(pack)?;
    let header = &pack.header;
    let (color, alpha_item) = avif_items(bytes).ok_or("The file is not an AVIF image.")?;
    let info = sequence_info(&color).ok_or("The AVIF color item has no AV1 sequence header.")?;
    let expected = match layout(&info) {
        ChromaLayout::I400 => "I400",
        ChromaLayout::I420 => "I420",
        ChromaLayout::I422 => "I422",
        ChromaLayout::I444 => "I444",
    };
    if header.get("layout").and_then(Value::as_str) != Some(expected) || info.bit_depth != 8 {
        return Err(format!("The host decoded a {:?} image as {expected}.", header.get("layout")));
    }
    let dimension = |value: Option<&Value>| value.and_then(Value::as_u64).map(|value| value as u32).ok_or("A plane needs dimensions.");
    let alpha = match (header.get("alpha"), alpha_item) {
        (Some(description), Some(item)) => {
            let alpha_info = sequence_info(&item).ok_or("The AVIF alpha item has no AV1 sequence header.")?;
            Some(AlphaPlane {
                plane: plane(pack, Some(description))?,
                width: dimension(description.get("width"))?,
                height: dimension(description.get("height"))?,
                full_range: alpha_info.full_range,
            })
        }
        (None, None) => None,
        _ => return Err("The host's alpha plane does not match the AVIF alpha item.".to_owned()),
    };
    let image = YuvImage::from_planes(
        dimension(header.get("width"))?,
        dimension(header.get("height"))?,
        layout(&info),
        info.matrix,
        info.full_range,
        plane(pack, header.get("y"))?,
        plane(pack, header.get("u"))?,
        plane(pack, header.get("v"))?,
        alpha,
    )
    .ok_or("The host's planes are smaller than the image.")?;
    session::store_predecoded(file, bytes.to_vec(), Arc::new(Decoded::Raster(RasterImage::from_yuv(image))));
    Ok(Reply::default().finish(&json!({})))
}

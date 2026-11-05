use std::collections::HashMap;
use std::path::Path;

use indexmap::IndexMap;
use serde_json::Value;
use yugilife_core::assets::{AssetSource, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::text::layout::InlineTypography;
use yugilife_core::text::measure::{FontBook, Measurer};

fn load_bundle(directory: &Path) -> TemplateBundle {
    let read = |name: &str| -> Value { serde_json::from_slice(&std::fs::read(directory.join(name)).unwrap()).unwrap() };
    let manifest = read("manifest.json");
    let template = read(manifest["template"].as_str().unwrap());
    let presets = read(manifest["colorPresets"].as_str().unwrap());
    let assets: IndexMap<String, AssetSource> = manifest["assets"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, path)| {
            let path = directory.join(path.as_str().unwrap());
            let bytes = std::fs::read(&path).unwrap();
            let label = path.display().to_string();
            (id.clone(), AssetSource::from_bytes(bytes, Some(media_type_for_path(&label).to_owned()), label))
        })
        .collect();
    TemplateBundle::new(manifest, &template, presets, assets).unwrap()
}

fn main() {
    let mut arguments = std::env::args().skip(1);
    let directory = arguments.next().unwrap();
    let probes = arguments.next().unwrap();
    let bundle = load_bundle(Path::new(&directory));
    let fonts: IndexMap<String, _> = bundle.template.json["fonts"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(family, asset)| (family.clone(), bundle.font_asset(asset.as_str().unwrap()).unwrap().unwrap()))
        .collect();
    let book = FontBook::new(fonts);
    let mut measurer = Measurer::new(&book);
    let mut seen: HashMap<(String, String), f64> = HashMap::new();
    for entry in std::fs::read_dir(&probes).unwrap() {
        let data: Value = serde_json::from_slice(&std::fs::read(entry.unwrap().path()).unwrap()).unwrap();
        for measured in data["measured"].as_array().into_iter().flatten() {
            let font = measured["font"].as_str().unwrap().to_owned();
            let text = measured["text"].as_str().unwrap().to_owned();
            seen.insert((font, text), measured["width"].as_f64().unwrap());
        }
    }
    let mut mismatches = 0;
    let mut by_font: HashMap<String, (usize, usize)> = HashMap::new();
    for ((font, text), expected) in &seen {
        let size_end = font.find("px").unwrap();
        let size_start = font[..size_end].rfind(' ').unwrap() + 1;
        let size: f64 = font[size_start..size_end].parse().unwrap();
        let family = font[size_end + 2..].trim().trim_matches('"').to_owned();
        let typography = InlineTypography {
            fill: String::new(),
            font_family: family,
            font_size: size,
            font_style: None,
            font_weight: None,
            letter_spacing: None,
        };
        let actual = measurer.measure(text, &typography);
        let counter = by_font.entry(font.clone()).or_default();
        counter.0 += 1;
        if (actual - expected).abs() > 1e-9 {
            counter.1 += 1;
            mismatches += 1;
            if mismatches <= 25 {
                println!("{font} {text:?}: expected {expected} actual {actual}");
            }
        }
    }
    let mut fonts: Vec<_> = by_font.into_iter().collect();
    fonts.sort();
    for (font, (total, wrong)) in fonts {
        println!("{font}: {wrong}/{total} mismatched");
    }
    println!("total mismatches {mismatches} of {}", seen.len());
}

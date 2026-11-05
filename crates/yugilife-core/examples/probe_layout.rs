use std::path::Path;

use indexmap::IndexMap;
use serde_json::Value;
use yugilife_core::assets::{AssetSource, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::svg::SvgElement;
use yugilife_core::text::measure::{FontBook, Measurer};
use yugilife_core::text::svg_layout::{TextStyle, layout_text};

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
            let label = path.display().to_string();
            (id.clone(), AssetSource::from_bytes(std::fs::read(&path).unwrap(), Some(media_type_for_path(&label).to_owned()), label))
        })
        .collect();
    TemplateBundle::new(manifest, &template, presets, assets).unwrap()
}

fn main() {
    let mut arguments = std::env::args().skip(1);
    let bundle = load_bundle(Path::new(&arguments.next().unwrap()));
    let probes = arguments.next().unwrap();
    let verbose = arguments.next().is_some();
    let fonts: IndexMap<String, _> = bundle.template.json["fonts"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(family, asset)| (family.clone(), bundle.font_asset(asset.as_str().unwrap()).unwrap().unwrap()))
        .collect();
    let book = FontBook::new(fonts);
    let mut measurer = Measurer::new(&book);
    let (mut texts, mut wrong_texts, mut characters, mut wrong_characters) = (0, 0, 0, 0);
    let mut ulp_histogram: std::collections::BTreeMap<i64, usize> = std::collections::BTreeMap::new();
    let mut entries: Vec<_> = std::fs::read_dir(&probes).unwrap().map(|entry| entry.unwrap().path()).collect();
    entries.sort();
    for path in entries {
        let raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let data = match raw {
            Value::Array(items) => serde_json::json!({ "texts": items.into_iter().map(|item| serde_json::json!({
                "definition": item["definition"], "rendered": { "characters": item["characters"] }, "natural": { "characters": [] }
            })).collect::<Vec<_>>() }),
            other => other,
        };
        for text in data["texts"].as_array().into_iter().flatten() {
            let element = SvgElement::from_json(&text["definition"]);
            let mut text_wrong = false;
            let mut printed = false;
            for (mode, natural) in [("natural", true), ("rendered", false)] {
                let layout = layout_text(&element, &TextStyle::default(), &mut measurer, natural);
                for (index, expected) in text[mode]["characters"].as_array().into_iter().flatten().enumerate() {
                    characters += 1;
                    let Some(position) = expected[0].as_array() else { continue };
                    let (x, y) = (position[0].as_f64().unwrap(), position[1].as_f64().unwrap());
                    let length = expected[1].as_f64().unwrap_or(f64::NAN);
                    let actual = layout.start_position(index).map(|(x, y)| (f64::from(x), f64::from(y)));
                    let actual_length = f64::from(layout.substring_length(index, 1));
                    let matches = actual == Some((x, y)) && (actual_length - length).abs() < 1e-9;
                    if !matches {
                        wrong_characters += 1;
                        if let Some((ax, _)) = actual {
                            let ulps = (x as f32).to_bits() as i64 - (ax as f32).to_bits() as i64;
                            *ulp_histogram.entry(ulps.clamp(-5, 5)).or_insert(0) += 1;
                        }
                        let big = true;
                        if !printed && verbose && big {
                            printed = true;
                            println!(
                                "{} {mode} char {index}: expected ({x}, {y}) len {length} actual {actual:?} len {actual_length}\n  {}",
                                path.display(),
                                serde_json::to_string(&text["definition"]).unwrap().chars().take(400).collect::<String>()
                            );
                        }
                        text_wrong = true;
                    }
                }
            }
            texts += 1;
            if text_wrong {
                wrong_texts += 1;
            }
        }
    }
    println!("ulp differences (expected - actual): {ulp_histogram:?}");
    println!("texts {wrong_texts}/{texts} wrong, characters {wrong_characters}/{characters} wrong");
}

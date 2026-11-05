use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use yugilife_cli::input::{RenderSettings, load_render_request};
use yugilife_core::export::ImageExportOptions;
use yugilife_core::render::{RenderOptions, render_card};

fn main() -> Result<(), String> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [input, directory, selected @ ..] = arguments.as_slice() else {
        return Err("usage: layer_snapshots <card.json> <output-directory> [layer-id...]".to_owned());
    };
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let request = load_render_request(input, Path::new("layer.png"), &RenderSettings::default()).map_err(|error| error.to_string())?;
    let layer_ids: Vec<String> = request.bundle.template.layers.iter().map(|layer| layer.id.clone()).collect();
    for layer_id in layer_ids.iter().filter(|id| selected.is_empty() || selected.contains(id)) {
        let layers: IndexMap<String, bool> = layer_ids.iter().map(|id| (id.clone(), id == layer_id)).collect();
        let options = RenderOptions {
            assets: request.assets.clone(),
            layers,
            presentation_overrides: request.presentation_overrides.as_ref(),
            ..RenderOptions::default()
        };
        let rendered = render_card(&request.card, &request.bundle, &options).map_err(|error| error.message().to_owned())?;
        let png = rendered.to_image(&ImageExportOptions::default()).map_err(|error| error.message().to_owned())?;
        std::fs::write(directory.join(format!("{layer_id}.png")), png).map_err(|error| error.to_string())?;
    }
    Ok(())
}

use std::path::Path;
use std::sync::atomic::AtomicBool;

use serde_json::json;
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::CardData;
use yugilife_core::export::{SvgExportOptions, TextMode};
use yugilife_core::render::{RenderOptions, RenderWarning, RenderedCard, render_card};

use crate::errors::{CliError, CliResult, ErrorCode};
use crate::input::{OutputFormat, RenderRequest, load_render_request};
use crate::templates::absolute;

pub fn render<'a>(request: &'a RenderRequest, cancel: &'a AtomicBool) -> CliResult<RenderedCard<'a>> {
    let options = RenderOptions {
        assets: request.assets.clone(),
        presentation_overrides: request.presentation_overrides.as_ref(),
        cancel: Some(cancel),
        ..RenderOptions::default()
    };
    Ok(render_card(&request.card, &request.bundle, &options)?)
}

pub fn export(rendered: &RenderedCard, request: &RenderRequest, format: OutputFormat, text_mode: Option<TextMode>) -> CliResult<Vec<u8>> {
    Ok(match format {
        OutputFormat::Svg => {
            rendered.to_svg(&SvgExportOptions { font_smoothing: None, text_mode, title: request.title.clone() })?.into_bytes()
        }
        OutputFormat::Raster(_) => rendered.to_image(&request.raster)?,
    })
}

pub fn warnings_json(warnings: &[RenderWarning]) -> String {
    let warnings: Vec<_> = warnings.iter().map(RenderWarning::to_json).collect();
    format!("{}\n", serde_json::to_string_pretty(&warnings).unwrap_or_default())
}

pub fn write_output(output: &Path, display: &str, payload: &[u8]) -> CliResult<()> {
    let failed = || CliError::new(ErrorCode::OutputWriteFailed, format!("Could not write output \"{display}\"."));
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|_| failed())?;
    }
    std::fs::write(output, payload).map_err(|_| failed())
}

pub fn run_render(
    input: &str,
    output: &str,
    settings: &crate::input::RenderSettings,
    cancel: &AtomicBool,
) -> CliResult<Vec<RenderWarning>> {
    let resolved = absolute(Path::new(output));
    let request = load_render_request(input, &resolved, settings)?;
    let rendered = render(&request, cancel)?;
    let payload = export(&rendered, &request, request.format, request.text_mode)?;
    write_output(&resolved, output, &payload)?;
    Ok(rendered.warnings)
}

pub fn doctor(version: &str) -> CliResult<String> {
    let template = json!({
        "cardFields": [{ "defaultValue": "YugiLife CLI", "kind": "text", "label": "Name", "name": "name", "required": true }],
        "dimensions": { "height": 2, "width": 2 },
        "layers": [],
        "schemaVersion": 1
    });
    let manifest = json!({
        "assets": {}, "id": "card/cli-smoke", "kind": "card", "name": "CLI smoke", "template": "template.json", "version": "2026.01.01"
    });
    let unavailable = |message: String| CliError::new(ErrorCode::InternalError, message);
    let bundle =
        TemplateBundle::new(manifest, &template, json!({}), Default::default()).map_err(|error| unavailable(error.message().to_owned()))?;
    let mut card = CardData::default();
    card.insert("name", yugilife_core::card::CardValue::Json(json!("YugiLife CLI")));
    let rendered = render_card(&card, &bundle, &RenderOptions::default()).map_err(|error| unavailable(error.message().to_owned()))?;
    let default_template = crate::templates::resolve_template(None)?;
    Ok([
        format!("YugiLife CLI {version}"),
        format!("YugiLife Core {}", env!("CARGO_PKG_VERSION")),
        String::new(),
        format!("Platform      {} {}", std::env::consts::OS, std::env::consts::ARCH),
        format!("Template      {}@{} (packaged)", default_template.id(), default_template.version()),
        format!("Renderer      ready ({}x{} smoke card)", rendered.width(), rendered.height()),
        String::new(),
    ]
    .join("\n"))
}

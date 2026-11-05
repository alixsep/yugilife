use std::path::{Path, PathBuf};
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::Value;
use yugilife_core::assets::{AssetSource, encode_data_url, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::card::{CardData, CardValue};
use yugilife_core::export::{ImageExportOptions, ImageFormat, OutputSize, TextMode};

use crate::errors::{CliError, CliResult, ErrorCode};
use crate::templates::{absolute, resolve_template};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Svg,
    Raster(ImageFormat),
}

#[derive(Default, Clone)]
pub struct RenderSettings {
    pub background_color: Option<String>,
    pub height: Option<f64>,
    pub quality: Option<f64>,
    pub scale: Option<f64>,
    pub template_reference: Option<String>,
    pub text_mode: Option<TextMode>,
    pub title: Option<String>,
    pub use_default_template: bool,
    pub width: Option<f64>,
}

pub struct RenderRequest {
    pub bundle: Arc<TemplateBundle>,
    pub card: CardData,
    pub assets: IndexMap<String, AssetSource>,
    pub presentation_overrides: Option<Value>,
    pub format: OutputFormat,
    pub raster: ImageExportOptions,
    pub text_mode: Option<TextMode>,
    pub title: Option<String>,
}

fn invalid(message: impl Into<String>) -> CliError {
    CliError::new(ErrorCode::InputInvalid, message)
}

fn has_url_scheme(reference: &str) -> bool {
    let Some((scheme, _)) = reference.split_once(':') else {
        return false;
    };
    let mut characters = scheme.chars();
    let is_scheme = characters.next().is_some_and(|first| first.is_ascii_alphabetic())
        && characters.all(|character| character.is_ascii_alphanumeric() || "+.-".contains(character));
    let is_drive = scheme.len() == 1 && reference.get(2..).is_some_and(|rest| rest.starts_with(['\\', '/']));
    is_scheme && !is_drive
}

fn read_file(directory: &Path, reference: &str, key: &str) -> CliResult<(PathBuf, Vec<u8>)> {
    if reference.is_empty() || reference.contains('\0') {
        return Err(invalid(format!("File reference \"{key}\" must be a non-empty path.")));
    }
    if has_url_scheme(reference) {
        return Err(invalid(format!("File reference \"{key}\" must be a local filesystem path.")));
    }
    let path = if Path::new(reference).is_absolute() { PathBuf::from(reference) } else { directory.join(reference) };
    let bytes = std::fs::read(&path)
        .map_err(|_| CliError::new(ErrorCode::InputReadFailed, format!("Could not read file \"{reference}\" for \"{key}\".")))?;
    if bytes.is_empty() {
        return Err(invalid(format!("File \"{reference}\" for \"{key}\" is empty.")));
    }
    Ok((path, bytes))
}

pub fn output_format(output: &Path) -> CliResult<OutputFormat> {
    let extension = output.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("jpeg" | "jpg") => Ok(OutputFormat::Raster(ImageFormat::Jpeg)),
        Some("png") => Ok(OutputFormat::Raster(ImageFormat::Png)),
        Some("svg") => Ok(OutputFormat::Svg),
        Some("webp") => Ok(OutputFormat::Raster(ImageFormat::Webp)),
        _ => Err(CliError::new(
            ErrorCode::OutputInvalid,
            format!("Output \"{}\" must use a .png, .jpg, .jpeg, .webp, or .svg extension.", output.display()),
        )),
    }
}

fn raster_options(format: OutputFormat, settings: &RenderSettings) -> CliResult<ImageExportOptions> {
    let sizes: Vec<(&str, f64)> = [("height", settings.height), ("scale", settings.scale), ("width", settings.width)]
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| (name, value)))
        .collect();
    let has_raster_options = !sizes.is_empty() || settings.quality.is_some() || settings.background_color.is_some();
    let OutputFormat::Raster(image_format) = format else {
        if has_raster_options {
            return Err(invalid("Raster size, quality, and background options cannot be used with SVG output."));
        }
        return Ok(ImageExportOptions::default());
    };
    if sizes.len() > 1 {
        return Err(invalid("Use only one of --height, --scale, or --width."));
    }
    let size = match sizes.first() {
        None => None,
        Some((name, value)) => {
            if !value.is_finite() || *value <= 0.0 {
                return Err(invalid(format!("--{name} must be finite and greater than zero.")));
            }
            if *name != "scale" && !(value.fract() == 0.0 && *value <= 9_007_199_254_740_991.0) {
                return Err(invalid(format!("--{name} must be a positive whole number of pixels.")));
            }
            Some(match *name {
                "height" => OutputSize::Height(*value),
                "scale" => OutputSize::Scale(*value),
                _ => OutputSize::Width(*value),
            })
        }
    };
    if let Some(quality) = settings.quality {
        if image_format == ImageFormat::Png {
            return Err(invalid("--quality cannot be used with PNG output."));
        }
        if !quality.is_finite() || !(0.0..=1.0).contains(&quality) {
            return Err(invalid("--quality must be from 0 through 100."));
        }
    }
    if let Some(background) = &settings.background_color {
        if image_format != ImageFormat::Jpeg {
            return Err(invalid("--background can be used only with JPEG output."));
        }
        let digits = background.strip_prefix('#').unwrap_or("");
        if !(background.starts_with('#') && matches!(digits.len(), 3 | 6) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())) {
            return Err(invalid("--background must be an opaque #RGB or #RRGGBB color."));
        }
    }
    Ok(ImageExportOptions {
        background_color: settings.background_color.clone(),
        format: Some(image_format),
        quality: settings.quality,
        size,
    })
}

pub fn load_render_request(input: &str, output: &Path, settings: &RenderSettings) -> CliResult<RenderRequest> {
    let input_path = absolute(Path::new(input));
    let contents =
        std::fs::read(&input_path).map_err(|_| CliError::new(ErrorCode::InputReadFailed, format!("Could not read input \"{input}\".")))?;
    let parsed: Value = serde_json::from_slice(&contents)
        .map_err(|_| CliError::new(ErrorCode::InputJsonInvalid, format!("Input \"{input}\" is not valid JSON.")))?;
    let Value::Object(document) = parsed else {
        return Err(invalid(format!("Input \"{input}\" must contain a JSON object.")));
    };
    let Some(Value::Object(card_fields)) = document.get("card") else {
        return Err(invalid(format!("Input \"{input}\" must contain a \"card\" object.")));
    };
    let template_field = match document.get("template") {
        None => None,
        Some(Value::String(template)) => Some(template.clone()),
        Some(_) => return Err(invalid(format!("Input \"{input}\" field \"template\" must be a string."))),
    };
    let files = match document.get("files") {
        None => serde_json::Map::new(),
        Some(Value::Object(files)) => files.clone(),
        Some(_) => return Err(invalid(format!("Input \"{input}\" field \"files\" must be an object."))),
    };
    let presentation_overrides = match document.get("presentationOverrides") {
        None => None,
        Some(Value::Object(overrides)) => Some(Value::Object(overrides.clone())),
        Some(_) => return Err(invalid(format!("Input \"{input}\" field \"presentationOverrides\" must be an object."))),
    };
    let directory = input_path.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let mut loaded = Vec::with_capacity(files.len());
    for (key, reference) in &files {
        let Value::String(reference) = reference else {
            return Err(invalid(format!("File reference \"{key}\" in \"{input}\" must be a string.")));
        };
        let (path, bytes) = read_file(&directory, reference, key)?;
        loaded.push((key.clone(), path, bytes));
    }
    if settings.use_default_template && (template_field.is_some() || settings.template_reference.is_some()) {
        return Err(invalid("--use-default-template cannot be combined with another template selector."));
    }
    if settings.template_reference.is_some() && template_field.is_some() {
        return Err(invalid("--template cannot be combined with a template selector in the input JSON."));
    }
    let reference = if settings.use_default_template { None } else { settings.template_reference.clone().or(template_field) };
    let bundle = resolve_template(reference.as_deref())?;
    let format = output_format(output)?;
    if matches!(format, OutputFormat::Raster(_)) && (settings.text_mode.is_some() || settings.title.is_some()) {
        return Err(invalid("--text-mode and --title can be used only with SVG output."));
    }
    let raster = raster_options(format, settings)?;
    let text_fields: Vec<String> = bundle
        .template
        .card_fields()
        .filter(|field| field.get("kind").and_then(Value::as_str) != Some("image"))
        .filter_map(|field| field.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let mut card = CardData::from_json(card_fields);
    let mut assets = IndexMap::new();
    for (key, path, bytes) in loaded {
        let label = path.display().to_string();
        let media_type = media_type_for_path(&label).to_owned();
        if text_fields.contains(&key) {
            card.insert(key.clone(), CardValue::Json(Value::String(encode_data_url(&media_type, &bytes))));
        }
        let source = AssetSource::from_bytes(bytes, Some(media_type), label);
        if !text_fields.contains(&key) {
            card.insert(key.clone(), CardValue::Asset(source.clone()));
        }
        assets.insert(key, source);
    }
    Ok(RenderRequest {
        bundle,
        card,
        assets,
        presentation_overrides,
        format,
        raster,
        text_mode: settings.text_mode,
        title: settings.title.clone(),
    })
}

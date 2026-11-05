use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use serde_json::{Value, json};
use yugilife_cli::errors::ErrorCode;
use yugilife_cli::input::{OutputFormat, RenderRequest, RenderSettings, load_render_request, output_format};
use yugilife_cli::templates::compare_versions;
use yugilife_core::assets::AssetSource;
use yugilife_core::card::CardValue;
use yugilife_core::export::{ImageFormat, OutputSize};

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn new(label: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
        let path = std::env::temp_dir().join(format!("yugilife-input-test-{}-{label}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("the temporary directory must be created");
        Self { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_input(directory: &TemporaryDirectory, document: Value) -> String {
    let path = directory.join("card.json");
    fs::write(&path, serde_json::to_vec(&document).expect("input JSON must serialize")).expect("input JSON must be written");
    path.to_str().expect("test paths must be UTF-8").to_owned()
}

fn load(input: &str, output: &Path, settings: &RenderSettings) -> RenderRequest {
    load_render_request(input, output, settings).unwrap_or_else(|error| panic!("the request must load: {error}"))
}

fn load_error(input: &str, output: &Path, settings: &RenderSettings) -> (ErrorCode, String) {
    match load_render_request(input, output, settings) {
        Ok(_) => panic!("the request must be rejected"),
        Err(error) => (error.code, error.message),
    }
}

fn media_type(source: &AssetSource) -> Option<&str> {
    match source {
        AssetSource::Encoded(asset) => asset.media_type.as_deref(),
        AssetSource::Url(_) => None,
    }
}

#[test]
fn orders_same_day_template_versions_by_numeric_release_sequence() {
    assert_eq!(compare_versions("2026.08.12", "2026.08.12.1"), Ordering::Less);
    assert_eq!(compare_versions("2026.08.12.2", "2026.08.12.10"), Ordering::Less);
    assert_eq!(compare_versions("2026.08.12", "2026.08.12"), Ordering::Equal);
    assert_eq!(compare_versions("2026.09.01", "2026.08.30.4"), Ordering::Greater);
}

#[test]
fn resolves_image_files_relative_to_the_input_json_including_unicode_paths() {
    let directory = TemporaryDirectory::new("transport");
    fs::write(directory.join("画像 with spaces.png"), [137, 80, 78, 71]).expect("the artwork must be written");
    let input = write_input(
        &directory,
        json!({ "card": { "name": "Transport" }, "files": { "artwork": "./画像 with spaces.png" }, "template": "card/series-10" }),
    );
    let request = load(&input, &directory.join("card.svg"), &RenderSettings::default());

    assert_eq!(request.format, OutputFormat::Svg);
    assert_eq!(request.bundle.id(), "card/series-10");
    assert_eq!(request.bundle.version(), "2026.09.23");
    assert_eq!(request.bundle.assets.get("card.series-10.sticker.00").and_then(media_type), Some("image/webp"));
    let Some(CardValue::Asset(artwork)) = request.card.get("artwork") else {
        panic!("the artwork file must become an asset source");
    };
    assert_eq!(media_type(artwork), Some("image/png"));
    assert!(artwork.label().ends_with("画像 with spaces.png"));
    assert!(request.assets.contains_key("artwork"));
}

#[test]
fn transports_text_field_files_as_data_urls() {
    let directory = TemporaryDirectory::new("text-file");
    fs::write(directory.join("name.txt"), "Named").expect("the text file must be written");
    let input = write_input(&directory, json!({ "card": { "name": "Ignored" }, "files": { "description": "name.txt" } }));
    let request = load(&input, &directory.join("card.svg"), &RenderSettings::default());
    assert_eq!(request.card.json("description"), Some(&json!("data:application/octet-stream;base64,TmFtZWQ=")));
}

#[test]
fn transports_presentation_overrides_for_full_art_and_crop_rendering() {
    let directory = TemporaryDirectory::new("overrides");
    let overrides = json!({ "artworkTransforms": { "artwork": { "mode": "full-art", "scale": 1.5, "x": 0, "y": 0 } } });
    let input = write_input(&directory, json!({ "card": { "name": "Full-art transport" }, "presentationOverrides": overrides }));
    let request = load(&input, &directory.join("card.svg"), &RenderSettings::default());
    assert_eq!(request.presentation_overrides, Some(overrides));
}

#[test]
fn derives_jpeg_and_webp_formats_from_extensions_and_transports_raster_options() {
    let directory = TemporaryDirectory::new("raster");
    let input = write_input(&directory, json!({ "card": { "name": "Raster options" } }));

    let jpeg_settings = RenderSettings {
        background_color: Some("#abcdef".to_owned()),
        quality: Some(0.8),
        width: Some(1200.0),
        ..RenderSettings::default()
    };
    let jpeg = load(&input, &directory.join("card.jpeg"), &jpeg_settings);
    assert_eq!(jpeg.format, OutputFormat::Raster(ImageFormat::Jpeg));
    assert_eq!(jpeg.raster.background_color.as_deref(), Some("#abcdef"));
    assert_eq!(jpeg.raster.quality, Some(0.8));
    assert_eq!(jpeg.raster.size, Some(OutputSize::Width(1200.0)));

    let webp = load(&input, &directory.join("card.webp"), &RenderSettings { scale: Some(2.0), ..RenderSettings::default() });
    assert_eq!(webp.format, OutputFormat::Raster(ImageFormat::Webp));
    assert_eq!(webp.raster.size, Some(OutputSize::Scale(2.0)));
}

#[test]
fn derives_output_formats_case_insensitively() {
    assert_eq!(output_format(Path::new("card.PNG")).ok(), Some(OutputFormat::Raster(ImageFormat::Png)));
    assert_eq!(output_format(Path::new("card.JPG")).ok(), Some(OutputFormat::Raster(ImageFormat::Jpeg)));
    assert_eq!(output_format(Path::new("card.Svg")).ok(), Some(OutputFormat::Svg));
    let error = output_format(Path::new("card")).expect_err("a missing extension must be rejected");
    assert_eq!(error.code, ErrorCode::OutputInvalid);
    assert_eq!(error.message, "Output \"card\" must use a .png, .jpg, .jpeg, .webp, or .svg extension.");
}

#[test]
fn rejects_file_references_that_are_not_readable_local_files() {
    let directory = TemporaryDirectory::new("references");
    let output = directory.join("card.svg");
    let settings = RenderSettings::default();

    let remote =
        write_input(&directory, json!({ "card": { "name": "Remote" }, "files": { "artwork": "https://example.invalid/art.png" } }));
    assert_eq!(
        load_error(&remote, &output, &settings),
        (ErrorCode::InputInvalid, "File reference \"artwork\" must be a local filesystem path.".to_owned())
    );

    let empty_reference = write_input(&directory, json!({ "card": { "name": "Empty" }, "files": { "artwork": "" } }));
    assert_eq!(
        load_error(&empty_reference, &output, &settings),
        (ErrorCode::InputInvalid, "File reference \"artwork\" must be a non-empty path.".to_owned())
    );

    let missing = write_input(&directory, json!({ "card": { "name": "Missing" }, "files": { "artwork": "missing.png" } }));
    assert_eq!(
        load_error(&missing, &output, &settings),
        (ErrorCode::InputReadFailed, "Could not read file \"missing.png\" for \"artwork\".".to_owned())
    );

    fs::write(directory.join("empty.png"), []).expect("the empty file must be written");
    let empty_file = write_input(&directory, json!({ "card": { "name": "Empty file" }, "files": { "artwork": "empty.png" } }));
    assert_eq!(
        load_error(&empty_file, &output, &settings),
        (ErrorCode::InputInvalid, "File \"empty.png\" for \"artwork\" is empty.".to_owned())
    );
}

#[test]
fn rejects_malformed_input_documents() {
    let directory = TemporaryDirectory::new("documents");
    let output = directory.join("card.svg");
    let settings = RenderSettings::default();
    let cases = [
        (json!([]), "must contain a JSON object."),
        (json!({ "card": "text" }), "must contain a \"card\" object."),
        (json!({ "card": {}, "template": 4 }), "field \"template\" must be a string."),
        (json!({ "card": {}, "files": [] }), "field \"files\" must be an object."),
        (json!({ "card": {}, "presentationOverrides": "full-art" }), "field \"presentationOverrides\" must be an object."),
        (json!({ "card": {}, "files": { "artwork": 3 } }), ""),
    ];
    for (document, suffix) in cases {
        let input = write_input(&directory, document);
        let (code, message) = load_error(&input, &output, &settings);
        assert_eq!(code, ErrorCode::InputInvalid, "{message}");
        let expected = if suffix.is_empty() {
            format!("File reference \"artwork\" in \"{input}\" must be a string.")
        } else {
            format!("Input \"{input}\" {suffix}")
        };
        assert_eq!(message, expected);
    }
}

#[test]
fn rejects_conflicting_template_selectors() {
    let directory = TemporaryDirectory::new("selectors");
    let output = directory.join("card.svg");
    let selected = write_input(&directory, json!({ "card": { "name": "Selected" }, "template": "card/series-10" }));

    let explicit = RenderSettings { template_reference: Some("card/series-10".to_owned()), ..RenderSettings::default() };
    assert_eq!(
        load_error(&selected, &output, &explicit),
        (ErrorCode::InputInvalid, "--template cannot be combined with a template selector in the input JSON.".to_owned())
    );

    let default_template = RenderSettings { use_default_template: true, ..RenderSettings::default() };
    assert_eq!(
        load_error(&selected, &output, &default_template),
        (ErrorCode::InputInvalid, "--use-default-template cannot be combined with another template selector.".to_owned())
    );

    let unselected = write_input(&directory, json!({ "card": { "name": "Unselected" } }));
    assert_eq!(load(&unselected, &output, &default_template).bundle.id(), "card/series-10");
    assert_eq!(load(&unselected, &output, &explicit).bundle.id(), "card/series-10");
    let exact = RenderSettings { template_reference: Some("card/series-10@2026.09.23".to_owned()), ..RenderSettings::default() };
    assert_eq!(load(&unselected, &output, &exact).bundle.version(), "2026.09.23");
}

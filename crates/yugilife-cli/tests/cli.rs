use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PACKAGED_LISTING: &str = "card/series-10@2026.09.23\tpackaged\tSeries 10\n";

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn new(label: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("yugilife-cli-test-{}-{label}-{unique}", std::process::id()));
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

struct CliRun {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run_cli(arguments: &[&str], store: &TemporaryDirectory) -> CliRun {
    let output = Command::new(env!("CARGO_BIN_EXE_yugilife-cli"))
        .args(arguments)
        .env("YUGILIFE_TEMPLATE_HOME", &store.path)
        .env_remove("YUGILIFE_TEMPLATE_REGISTRY_URL")
        .output()
        .expect("the CLI binary must start");
    CliRun {
        code: output.status.code().expect("the CLI must exit with a status code"),
        stdout: String::from_utf8(output.stdout).expect("stdout must be UTF-8"),
        stderr: String::from_utf8(output.stderr).expect("stderr must be UTF-8"),
    }
}

fn path_text(path: &Path) -> &str {
    path.to_str().expect("test paths must be UTF-8")
}

fn write_card(directory: &TemporaryDirectory, name: &str, document: Value) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, serde_json::to_vec(&document).expect("card JSON must serialize")).expect("card JSON must be written");
    path
}

fn help_text() -> String {
    let run = run_cli(&["--help"], &TemporaryDirectory::new("help"));
    assert_eq!(run.code, 0);
    run.stdout
}

fn assert_usage_error(run: &CliRun, message: &str) {
    assert_eq!(run.code, 2, "{}", run.stderr);
    assert_eq!(run.stdout, "");
    assert_eq!(run.stderr, format!("yugilife-cli [ARGUMENT_ERROR]: {message}\n\n{}\n", help_text()));
}

fn assert_failure(run: &CliRun, code: i32, error_code: &str, message: &str) {
    assert_eq!(run.code, code, "{}", run.stderr);
    assert_eq!(run.stderr, format!("yugilife-cli [{error_code}]: {message}\n"));
}

fn packaged_template_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates/templates/card/series-10")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("packaged JSON must be readable")).expect("packaged JSON must parse")
}

fn series_9_artifact(asset_url: impl Fn(&Path) -> String) -> Vec<u8> {
    let directory = packaged_template_directory();
    let mut manifest = read_json(&directory.join("manifest.json"));
    let assets: serde_json::Map<String, Value> = manifest["assets"]
        .as_object()
        .expect("the manifest must declare assets")
        .iter()
        .map(|(id, relative)| (id.clone(), json!(asset_url(&directory.join(relative.as_str().expect("asset paths must be strings"))))))
        .collect();
    manifest["id"] = json!("card/series-9");
    manifest["name"] = json!("Series 9");
    manifest["version"] = json!("2026.08.12");
    let artifact = json!({
        "assets": assets,
        "colorPresets": read_json(&directory.join("color-presets.json")),
        "format": "yugilife-template",
        "formatVersion": 1,
        "manifest": manifest,
        "template": read_json(&directory.join("template.json")),
    });
    serde_json::to_vec(&artifact).expect("the artifact must serialize")
}

fn placeholder_asset(_path: &Path) -> String {
    "data:application/octet-stream;base64,AA==".to_owned()
}

fn embedded_asset(path: &Path) -> String {
    let bytes = fs::read(path).expect("packaged assets must be readable");
    let media_type = match path.extension().and_then(|extension| extension.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        _ => "application/octet-stream",
    };
    format!("data:{media_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn write_registry(registry: &TemporaryDirectory, artifact: &[u8], declared_digest: Option<&str>) -> String {
    fs::write(registry.join("series-9.json"), artifact).expect("the artifact must be written");
    let digest: String = Sha256::digest(artifact).iter().map(|byte| format!("{byte:02x}")).collect();
    let catalog = json!({
        "templates": [{
            "id": "card/series-9",
            "sha256": declared_digest.unwrap_or(&digest),
            "size": artifact.len(),
            "url": "series-9.json",
            "version": "2026.08.12",
        }],
    });
    let catalog_path = registry.join("catalog.json");
    fs::write(&catalog_path, serde_json::to_vec(&catalog).expect("the catalog must serialize")).expect("the catalog must be written");
    format!("file://{}", path_text(&catalog_path))
}

fn png_dimensions(path: &Path) -> (u32, u32) {
    let decoded = image::load_from_memory(&fs::read(path).expect("the output must exist")).expect("the output must decode");
    (decoded.width(), decoded.height())
}

#[test]
fn prints_the_version() {
    let store = TemporaryDirectory::new("version");
    for flag in ["--version", "-v"] {
        let run = run_cli(&[flag], &store);
        assert_eq!((run.code, run.stdout.as_str(), run.stderr.as_str()), (0, "0.1.0\n", ""));
    }
}

#[test]
fn prints_help_with_every_command() {
    let help = help_text();
    assert!(help.starts_with("YugiLife CLI 0.1.0\n\nUsage:\n  yugilife-cli doctor\n"), "{help}");
    for usage in [
        "  yugilife-cli render <card.json> --output <card.svg|card.png|card.jpg|card.webp>\n",
        "  yugilife-cli render-batch <card.json>... --output-dir <directory>\n",
        "  yugilife-cli templates list\n",
        "  yugilife-cli templates install <template-id@version>\n",
        "  -v, --version             Show the CLI version\n",
    ] {
        assert!(help.contains(usage), "{usage:?} missing from {help}");
    }
    let short = run_cli(&["-h"], &TemporaryDirectory::new("short-help"));
    assert_eq!(short.stdout, help);
}

#[test]
fn reports_usage_errors_with_a_stable_code() {
    let store = TemporaryDirectory::new("usage");
    assert_usage_error(&run_cli(&["not-a-command"], &store), "Expected a command: doctor, render, render-batch, or templates.");
    assert_usage_error(&run_cli(&[], &store), "Expected a command: doctor, render, render-batch, or templates.");
    assert_usage_error(&run_cli(&["--version", "render"], &store), "--version cannot be combined with a command.");
    assert_usage_error(&run_cli(&["--help", "doctor"], &store), "--help cannot be combined with a command.");
    assert_usage_error(&run_cli(&["doctor", "extra"], &store), "doctor does not accept positional arguments.");
    assert_usage_error(&run_cli(&["templates"], &store), "Expected a templates command: list or install.");
    assert_usage_error(&run_cli(&["templates", "list", "extra"], &store), "templates list does not accept arguments.");
    assert_usage_error(&run_cli(&["templates", "install"], &store), "templates install requires exactly one template ID and version.");
    assert_usage_error(&run_cli(&["render"], &store), "render requires exactly one input JSON path.");
    assert_usage_error(&run_cli(&["render", "card.json"], &store), "render requires --output <path>.");
}

#[test]
fn reports_option_parsing_errors_without_help_text() {
    let store = TemporaryDirectory::new("options");
    let unknown = run_cli(&["--bogus"], &store);
    assert_failure(
        &unknown,
        2,
        "ARGUMENT_ERROR",
        "Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\"",
    );
    let missing = run_cli(&["render", "card.json", "--output"], &store);
    assert_failure(&missing, 2, "ARGUMENT_ERROR", "Option '-o, --output <value>' argument missing");
    let flag_value = run_cli(&["--version=yes"], &store);
    assert_failure(&flag_value, 2, "ARGUMENT_ERROR", "Option '-v, --version' does not take an argument");
}

#[test]
fn lists_the_locally_packaged_default_without_network_access() {
    let run = run_cli(&["templates", "list"], &TemporaryDirectory::new("list"));
    assert_eq!((run.code, run.stdout.as_str(), run.stderr.as_str()), (0, PACKAGED_LISTING, ""));
}

#[test]
fn treats_installing_the_packaged_default_as_an_idempotent_local_operation() {
    let run = run_cli(&["templates", "install", "card/series-10@2026.09.23"], &TemporaryDirectory::new("packaged-install"));
    assert_eq!((run.code, run.stdout.as_str(), run.stderr.as_str()), (0, "card/series-10@2026.09.23 is already available locally.\n", ""));
}

#[test]
fn requires_an_explicit_registry_for_templates_not_packaged_with_the_cli() {
    let run = run_cli(&["templates", "install", "card/series-9@2026.08.12"], &TemporaryDirectory::new("no-registry"));
    assert_failure(
        &run,
        1,
        "TEMPLATE_REGISTRY_UNAVAILABLE",
        "No template registry is configured. Pass --registry <catalog-url> or set YUGILIFE_TEMPLATE_REGISTRY_URL.",
    );
}

#[test]
fn rejects_malformed_template_references() {
    let store = TemporaryDirectory::new("references");
    assert_failure(
        &run_cli(&["templates", "install", "card/series-9"], &store),
        2,
        "ARGUMENT_ERROR",
        "Template reference \"card/series-9\" must use an exact ID and version, for example card/series-10@2026.08.15.",
    );
    assert_failure(
        &run_cli(&["templates", "install", "card/series-9@2026.02.30"], &store),
        2,
        "ARGUMENT_ERROR",
        "Template reference \"card/series-9@2026.02.30\" must use an exact ID and version, for example card/series-10@2026.08.15.",
    );
    assert_failure(
        &run_cli(&["templates", "install", "Card@2026.08.12"], &store),
        2,
        "ARGUMENT_ERROR",
        "Template ID \"Card\" is malformed.",
    );
}

#[test]
fn installs_and_lists_an_exact_verified_template_artifact() {
    let store = TemporaryDirectory::new("install-store");
    let registry_directory = TemporaryDirectory::new("install-registry");
    let registry = write_registry(&registry_directory, &series_9_artifact(placeholder_asset), None);

    let installed = run_cli(&["templates", "install", "card/series-9@2026.08.12", "--registry", &registry], &store);
    assert_eq!((installed.code, installed.stdout.as_str(), installed.stderr.as_str()), (0, "Installed card/series-9@2026.08.12.\n", ""));
    assert!(store.join("card/series-9/2026.08.12.json").is_file());

    let listed = run_cli(&["templates", "list"], &store);
    assert_eq!(listed.code, 0);
    assert_eq!(listed.stdout, format!("{PACKAGED_LISTING}card/series-9@2026.08.12\tinstalled\tSeries 9\n"));

    let repeated = run_cli(&["templates", "install", "card/series-9@2026.08.12"], &store);
    assert_eq!((repeated.code, repeated.stdout.as_str()), (0, "card/series-9@2026.08.12 is already available locally.\n"));
}

#[test]
fn rejects_registry_entries_that_are_missing_or_fail_integrity_checks() {
    let store = TemporaryDirectory::new("integrity-store");
    let registry_directory = TemporaryDirectory::new("integrity-registry");
    let artifact = series_9_artifact(placeholder_asset);
    let tampered = write_registry(&registry_directory, &artifact, Some(&"0".repeat(64)));

    let mismatch = run_cli(&["templates", "install", "card/series-9@2026.08.12", "--registry", &tampered], &store);
    assert_failure(&mismatch, 1, "TEMPLATE_INVALID", "Integrity verification failed for \"card/series-9@2026.08.12\".");
    assert!(!store.join("card/series-9/2026.08.12.json").exists());

    let missing = run_cli(&["templates", "install", "card/series-8@2026.08.12", "--registry", &tampered], &store);
    assert_failure(&missing, 1, "TEMPLATE_NOT_FOUND", "Registry does not contain \"card/series-8@2026.08.12\".");

    let unreadable = format!("file://{}", path_text(&registry_directory.join("absent.json")));
    let unavailable = run_cli(&["templates", "install", "card/series-9@2026.08.12", "--registry", &unreadable], &store);
    assert_failure(&unavailable, 1, "TEMPLATE_REGISTRY_UNAVAILABLE", &format!("Could not read template registry \"{unreadable}\"."));
}

#[test]
fn renders_with_an_installed_template_selected_by_exact_reference() {
    let store = TemporaryDirectory::new("installed-render-store");
    let registry_directory = TemporaryDirectory::new("installed-render-registry");
    let registry = write_registry(&registry_directory, &series_9_artifact(embedded_asset), None);
    assert_eq!(run_cli(&["templates", "install", "card/series-9@2026.08.12", "--registry", &registry], &store).code, 0);

    let work = TemporaryDirectory::new("installed-render");
    let input = write_card(
        &work,
        "card.json",
        json!({ "card": { "cardVariant": "effect", "name": "Installed" }, "template": "card/series-9@2026.08.12" }),
    );
    let output = work.join("card.png");
    let run = run_cli(&["render", path_text(&input), "--output", path_text(&output)], &store);
    assert_eq!((run.code, run.stderr.as_str()), (0, ""));
    assert_eq!(png_dimensions(&output), (813, 1185));

    let conflicting = run_cli(&["render", path_text(&input), "--output", path_text(&output), "--use-default-template"], &store);
    assert_failure(&conflicting, 1, "INPUT_INVALID", "--use-default-template cannot be combined with another template selector.");
}

#[test]
fn reports_templates_that_are_not_installed() {
    let work = TemporaryDirectory::new("not-installed");
    let input = write_card(&work, "card.json", json!({ "card": { "name": "Missing" }, "template": "card/series-7" }));
    let run = run_cli(&["render", path_text(&input), "--output", path_text(&work.join("card.svg"))], &work);
    assert_failure(
        &run,
        1,
        "TEMPLATE_NOT_INSTALLED",
        "Template \"card/series-7\" is not installed. Run yugilife-cli templates install card/series-7@<version>.",
    );
}

#[test]
fn rejects_output_formats_before_rendering() {
    let work = TemporaryDirectory::new("gif");
    let input = write_card(&work, "card.json", json!({ "card": { "name": "Invalid output" } }));
    let output = work.join("card.gif");
    let run = run_cli(&["render", path_text(&input), "--output", path_text(&output)], &work);
    assert_failure(
        &run,
        2,
        "OUTPUT_INVALID",
        &format!("Output \"{}\" must use a .png, .jpg, .jpeg, .webp, or .svg extension.", path_text(&output)),
    );
    assert!(!output.exists());
}

#[test]
fn validates_raster_only_arguments_before_rendering() {
    let work = TemporaryDirectory::new("raster-options");
    let input = write_card(&work, "card.json", json!({ "card": { "name": "Invalid raster options" } }));
    let output = |name: &str| path_text(&work.join(name)).to_owned();
    let (png, svg, webp, jpg) = (output("card.png"), output("card.svg"), output("card.webp"), output("card.jpg"));
    let cases = [
        (vec!["--output", &png, "--quality", "90"], "--quality cannot be used with PNG output."),
        (vec!["--output", &svg, "--width", "1200"], "Raster size, quality, and background options cannot be used with SVG output."),
        (vec!["--output", &webp, "--background", "#fff"], "--background can be used only with JPEG output."),
        (vec!["--output", &webp, "--text-mode", "text"], "--text-mode and --title can be used only with SVG output."),
        (vec!["--output", &jpg, "--width", "1200", "--height", "1700"], "Use only one of --height, --scale, or --width."),
        (vec!["--output", &jpg, "--width", "12.5"], "--width must be a positive whole number of pixels."),
        (vec!["--output", &jpg, "--scale", "0"], "--scale must be finite and greater than zero."),
        (vec!["--output", &jpg, "--background", "red"], "--background must be an opaque #RGB or #RRGGBB color."),
    ];
    for (options, message) in cases {
        let mut arguments = vec!["render", path_text(&input)];
        arguments.extend(options);
        assert_failure(&run_cli(&arguments, &work), 1, "INPUT_INVALID", message);
    }
}

#[test]
fn validates_numeric_and_text_mode_arguments() {
    let work = TemporaryDirectory::new("numeric-options");
    let input = write_card(&work, "card.json", json!({ "card": { "name": "Numbers" } }));
    let png = path_text(&work.join("card.png")).to_owned();
    let jpg = path_text(&work.join("card.jpg")).to_owned();
    let svg = path_text(&work.join("card.svg")).to_owned();
    let input = path_text(&input);
    assert_usage_error(&run_cli(&["render", input, "--output", &jpg, "--quality", "101"], &work), "--quality must be from 0 through 100.");
    assert_usage_error(&run_cli(&["render", input, "--output", &png, "--scale", " "], &work), "--scale requires a number.");
    assert_usage_error(&run_cli(&["render", input, "--output", &png, "--scale", "big"], &work), "--scale requires a finite number.");
    assert_failure(
        &run_cli(&["render", input, "--output", &svg, "--text-mode", "pixels"], &work),
        2,
        "ARGUMENT_ERROR",
        "Unknown SVG text mode \"pixels\". Expected \"paths\" or \"text\".",
    );
}

#[test]
fn reports_unreadable_and_malformed_inputs() {
    let work = TemporaryDirectory::new("inputs");
    let output = path_text(&work.join("card.svg")).to_owned();
    let missing = path_text(&work.join("missing.json")).to_owned();
    assert_failure(
        &run_cli(&["render", &missing, "--output", &output], &work),
        1,
        "INPUT_READ_FAILED",
        &format!("Could not read input \"{missing}\"."),
    );

    let malformed = work.join("malformed.json");
    fs::write(&malformed, "{ not json").expect("the malformed input must be written");
    let malformed = path_text(&malformed);
    assert_failure(
        &run_cli(&["render", malformed, "--output", &output], &work),
        1,
        "INPUT_JSON_INVALID",
        &format!("Input \"{malformed}\" is not valid JSON."),
    );

    let cardless = path_text(&write_card(&work, "cardless.json", json!({ "files": {} }))).to_owned();
    assert_failure(
        &run_cli(&["render", &cardless, "--output", &output], &work),
        1,
        "INPUT_INVALID",
        &format!("Input \"{cardless}\" must contain a \"card\" object."),
    );
}

#[test]
fn reports_card_validation_failures() {
    let work = TemporaryDirectory::new("validation");
    let input = write_card(&work, "card.json", json!({ "card": { "name": "Invalid", "cardVariant": "bogus" } }));
    let run = run_cli(&["render", path_text(&input), "--output", path_text(&work.join("card.svg"))], &work);
    assert_eq!(run.code, 1);
    assert!(
        run.stderr.starts_with("yugilife-cli [RENDER_VALIDATION_FAILED]: Card data does not satisfy this template: \"cardVariant\" must be one of: normal, effect,"),
        "{}",
        run.stderr
    );
}

#[test]
fn renders_a_small_card_to_every_output_format() {
    let work = TemporaryDirectory::new("formats");
    let input = write_card(
        &work,
        "card.json",
        json!({ "card": { "cardVariant": "effect", "name": "Format Dragon", "description": "A <i>clean</i> effect." } }),
    );
    let input = path_text(&input);
    let render = |arguments: &[&str]| {
        let mut all = vec!["render", input];
        all.extend_from_slice(arguments);
        let run = run_cli(&all, &work);
        assert_eq!((run.code, run.stdout.as_str(), run.stderr.as_str()), (0, "", ""), "{arguments:?}");
    };

    let png = work.join("card.png");
    render(&["--output", path_text(&png)]);
    assert!(fs::read(&png).expect("PNG must exist").starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]));
    assert_eq!(png_dimensions(&png), (813, 1185));

    let jpg = work.join("card.jpg");
    render(&["-o", path_text(&jpg), "--width", "400", "--quality", "80", "--background", "#123456"]);
    assert!(fs::read(&jpg).expect("JPEG must exist").starts_with(&[0xff, 0xd8, 0xff]));
    assert_eq!(png_dimensions(&jpg), (400, 583));

    let webp = work.join("card.webp");
    render(&["--output", path_text(&webp), "--scale", "0.5"]);
    let webp_bytes = fs::read(&webp).expect("WebP must exist");
    assert_eq!((&webp_bytes[0..4], &webp_bytes[8..12]), (&b"RIFF"[..], &b"WEBP"[..]));
    assert_eq!(png_dimensions(&webp), (407, 593));

    let paths_svg = work.join("paths.svg");
    render(&["--output", path_text(&paths_svg), "--title", "Format <Dragon>"]);
    let paths = fs::read_to_string(&paths_svg).expect("SVG must exist");
    assert!(
        paths.starts_with(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"813\" height=\"1185\""
        )
    );
    assert!(paths.contains("data-yugilife-text-mode=\"paths\""));
    assert!(paths.contains("<title>Format &lt;Dragon&gt;</title>"));
    assert!(paths.contains("<path ") && !paths.contains("<text"));

    let text_svg = work.join("text.svg");
    render(&["--output", path_text(&text_svg), "--text-mode", "text"]);
    let text = fs::read_to_string(&text_svg).expect("SVG must exist");
    assert!(text.contains("data-yugilife-text-mode=\"text\""));
    assert!(text.contains("Format Dragon"));
}

#[test]
fn prints_rich_text_warnings_to_stderr_while_succeeding() {
    let work = TemporaryDirectory::new("warnings");
    let input = write_card(
        &work,
        "card.json",
        json!({ "card": { "cardVariant": "effect", "name": "Warned", "description": "Effect <b>unclosed" } }),
    );
    let output = work.join("card.svg");
    let run = run_cli(&["render", path_text(&input), "--output", path_text(&output), "--text-mode", "text"], &work);
    assert_eq!(run.code, 0);
    assert_eq!(run.stderr, "yugilife-cli warning [unclosed-tag] description: Rich-text tag <b> is not closed.\n");
    assert!(output.is_file());
}

#[test]
fn reports_doctor_diagnostics() {
    let run = run_cli(&["doctor"], &TemporaryDirectory::new("doctor"));
    assert_eq!(run.code, 0, "{}", run.stderr);
    assert!(run.stdout.starts_with("YugiLife CLI 0.1.0\nYugiLife Core 0.1.0\n\nPlatform      "), "{}", run.stdout);
    assert!(run.stdout.contains("\nTemplate      card/series-10@2026.09.23 (packaged)\n"), "{}", run.stdout);
    assert!(run.stdout.ends_with("\nRenderer      ready (2x2 smoke card)\n"), "{}", run.stdout);
}

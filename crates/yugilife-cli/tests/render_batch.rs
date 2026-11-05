use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{Value, json};

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn new(label: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("yugilife-batch-test-{}-{label}-{unique}", std::process::id()));
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

fn write_card(directory: &TemporaryDirectory, name: &str, card: Value) -> String {
    let path = directory.join(name);
    fs::write(&path, serde_json::to_vec(&json!({ "card": card })).expect("card JSON must serialize")).expect("card JSON must be written");
    path_text(&path).to_owned()
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("the JSON output must exist")).expect("the JSON output must parse")
}

fn help_text(store: &TemporaryDirectory) -> String {
    run_cli(&["--help"], store).stdout
}

fn assert_usage_error(run: &CliRun, message: &str, store: &TemporaryDirectory) {
    assert_eq!(run.code, 2, "{}", run.stderr);
    assert_eq!(run.stderr, format!("yugilife-cli [ARGUMENT_ERROR]: {message}\n\n{}\n", help_text(store)));
}

fn assert_argument_error(run: &CliRun, message: &str) {
    assert_eq!(run.code, 2, "{}", run.stderr);
    assert_eq!(run.stderr, format!("yugilife-cli [ARGUMENT_ERROR]: {message}\n"));
}

#[test]
fn renders_every_requested_format_for_every_card_with_timings() {
    let work = TemporaryDirectory::new("formats");
    let clean = write_card(&work, "clean.json", json!({ "cardVariant": "effect", "name": "Batch Clean" }));
    let warned =
        write_card(&work, "warned.json", json!({ "cardVariant": "trap", "name": "Batch <big>Warned", "description": "Effect <b>open" }));
    let output = work.join("out");
    let timings = work.join("timings.json");
    let run = run_cli(
        &[
            "render-batch",
            &clean,
            &warned,
            "--output-dir",
            path_text(&output),
            "--format",
            "png,svg,text.svg,warnings.json",
            "--jobs",
            "2",
            "--timings",
            path_text(&timings),
        ],
        &work,
    );
    assert_eq!((run.code, run.stdout.as_str(), run.stderr.as_str()), (0, "", ""));

    for stem in ["clean", "warned"] {
        let png = image::load_from_memory(&fs::read(output.join(format!("{stem}.png"))).expect("PNG must exist")).expect("PNG must decode");
        assert_eq!((png.width(), png.height()), (813, 1185));
        let paths = fs::read_to_string(output.join(format!("{stem}.svg"))).expect("SVG must exist");
        assert!(paths.contains("data-yugilife-text-mode=\"paths\"") && paths.contains("<path "));
        let text = fs::read_to_string(output.join(format!("{stem}.text.svg"))).expect("text SVG must exist");
        assert!(text.contains("data-yugilife-text-mode=\"text\"") && text.contains("<text "));
    }
    assert_eq!(fs::read_to_string(output.join("clean.warnings.json")).expect("warnings must exist"), "[]\n");
    assert_eq!(
        read_json(&output.join("warned.warnings.json")),
        json!([
            { "code": "unknown-tag", "layerId": "name", "length": 5, "message": "Unknown rich-text tag <big>.", "offset": 6 },
            { "code": "unclosed-tag", "layerId": "description", "length": 7, "message": "Rich-text tag <b> is not closed.", "offset": 7 },
        ])
    );

    let report = read_json(&timings);
    assert_eq!(report["jobs"], json!(2));
    assert!(report["wallMilliseconds"].as_f64().is_some_and(|milliseconds| milliseconds > 0.0));
    let cards = report["cards"].as_array().expect("the report must list cards");
    let inputs: Vec<&str> = cards.iter().filter_map(|card| card["input"].as_str()).collect();
    assert_eq!(inputs, vec![clean.as_str(), warned.as_str()]);
    for card in cards {
        assert_eq!(card["error"], Value::Null);
        for phase in ["loadMilliseconds", "renderMilliseconds", "exportMilliseconds", "writeMilliseconds"] {
            assert!(card[phase].as_f64().is_some_and(|milliseconds| milliseconds >= 0.0), "{phase}");
        }
    }
}

#[test]
fn defaults_to_png_output() {
    let work = TemporaryDirectory::new("default-format");
    let card = write_card(&work, "card.json", json!({ "cardVariant": "spell", "name": "Default Format" }));
    let output = work.join("out");
    let run = run_cli(&["render-batch", &card, "--output-dir", path_text(&output), "-j", "1"], &work);
    assert_eq!((run.code, run.stderr.as_str()), (0, ""));
    let entries: Vec<String> = fs::read_dir(&output)
        .expect("the output directory must exist")
        .map(|entry| entry.expect("entries must be readable").file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec!["card.png".to_owned()]);
}

#[test]
fn applies_raster_options_to_batch_images() {
    let work = TemporaryDirectory::new("raster-options");
    let card = write_card(&work, "card.json", json!({ "cardVariant": "effect", "name": "Scaled" }));
    let output = work.join("out");
    let run = run_cli(&["render-batch", &card, "--output-dir", path_text(&output), "--format", "jpg,webp", "--width", "300"], &work);
    assert_eq!((run.code, run.stderr.as_str()), (0, ""));
    for name in ["card.jpg", "card.webp"] {
        let decoded = image::load_from_memory(&fs::read(output.join(name)).expect("output must exist")).expect("output must decode");
        assert_eq!((decoded.width(), decoded.height()), (300, 437), "{name}");
    }
}

#[test]
fn reports_failed_cards_after_rendering_the_rest() {
    let work = TemporaryDirectory::new("failures");
    let good = write_card(&work, "good.json", json!({ "cardVariant": "effect", "name": "Good" }));
    let bad_path = work.join("bad.json");
    fs::write(&bad_path, "{ broken").expect("the broken input must be written");
    let bad = path_text(&bad_path).to_owned();
    let output = work.join("out");
    let timings = work.join("timings.json");
    let run = run_cli(&["render-batch", &good, &bad, "--output-dir", path_text(&output), "--timings", path_text(&timings)], &work);

    assert_eq!(run.code, 1);
    assert_eq!(
        run.stderr,
        format!(
            "{bad}: yugilife-cli [INPUT_JSON_INVALID]: Input \"{bad}\" is not valid JSON.\nyugilife-cli [RENDER_FAILED]: 1 of 2 cards failed to render.\n"
        )
    );
    assert!(output.join("good.png").is_file());
    assert!(!output.join("bad.png").exists());
    let report = read_json(&timings);
    assert_eq!(report["cards"][0]["error"], Value::Null);
    assert_eq!(report["cards"][1]["error"], json!(format!("yugilife-cli [INPUT_JSON_INVALID]: Input \"{bad}\" is not valid JSON.")));
}

#[test]
fn validates_batch_arguments_before_rendering() {
    let work = TemporaryDirectory::new("arguments");
    let card = write_card(&work, "card.json", json!({ "cardVariant": "effect", "name": "Arguments" }));
    let output = path_text(&work.join("out")).to_owned();

    assert_usage_error(
        &run_cli(&["render-batch", "--output-dir", &output], &work),
        "render-batch requires at least one input JSON path.",
        &work,
    );
    assert_usage_error(&run_cli(&["render-batch", &card], &work), "render-batch requires --output-dir <directory>.", &work);
    assert_usage_error(
        &run_cli(&["render-batch", &card, "--output-dir", &output, "--jobs", "0"], &work),
        "--jobs must be a positive whole number.",
        &work,
    );
    assert_usage_error(
        &run_cli(&["render-batch", &card, "--output-dir", &output, "--jobs", "1.5"], &work),
        "--jobs must be a positive whole number.",
        &work,
    );
    assert_argument_error(
        &run_cli(&["render-batch", &card, "--output-dir", &output, "--format", "png,gif"], &work),
        "Unknown render-batch format \"gif\". Expected png, jpg, webp, svg, text.svg, or warnings.json.",
    );
    assert_argument_error(
        &run_cli(&["render-batch", &card, "--output-dir", &output, "--format", "warnings.json"], &work),
        "render-batch requires at least one image or SVG format.",
    );
    assert!(!work.join("out").exists());
}

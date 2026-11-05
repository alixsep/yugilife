use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use rayon::prelude::*;
use serde_json::json;
use yugilife_core::export::{ImageFormat, TextMode};

use crate::errors::{CliError, CliResult, ErrorCode};
use crate::input::{OutputFormat, RenderSettings, load_render_request};
use crate::render::{export, render, warnings_json, write_output};

#[derive(Clone, Copy)]
enum BatchFormat {
    Output(OutputFormat, Option<TextMode>),
    Warnings,
}

pub struct BatchSettings<'a> {
    pub directory: &'a str,
    pub format: &'a str,
    pub jobs: Option<usize>,
    pub timings: Option<&'a str>,
}

struct Outcome {
    input: String,
    load: f64,
    render: f64,
    export: f64,
    write: f64,
    error: Option<String>,
}

fn milliseconds(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn parse_format(extension: &str) -> CliResult<BatchFormat> {
    Ok(match extension {
        "png" => BatchFormat::Output(OutputFormat::Raster(ImageFormat::Png), None),
        "jpg" | "jpeg" => BatchFormat::Output(OutputFormat::Raster(ImageFormat::Jpeg), None),
        "webp" => BatchFormat::Output(OutputFormat::Raster(ImageFormat::Webp), None),
        "svg" => BatchFormat::Output(OutputFormat::Svg, None),
        "text.svg" => BatchFormat::Output(OutputFormat::Svg, Some(TextMode::Text)),
        "warnings.json" => BatchFormat::Warnings,
        other => {
            return Err(CliError::new(
                ErrorCode::ArgumentError,
                format!("Unknown render-batch format \"{other}\". Expected png, jpg, webp, svg, text.svg, or warnings.json."),
            ));
        }
    })
}

fn render_one(input: &str, directory: &Path, formats: &[(&str, BatchFormat)], settings: &RenderSettings, cancel: &AtomicBool) -> Outcome {
    let stem = Path::new(input).file_stem().and_then(|stem| stem.to_str()).unwrap_or("card");
    let (first_extension, _) = formats[0];
    let started = Instant::now();
    let mut outcome = Outcome { input: input.to_owned(), load: 0.0, render: 0.0, export: 0.0, write: 0.0, error: None };
    let result = (|| -> CliResult<()> {
        let request = load_render_request(input, &directory.join(format!("{stem}.{first_extension}")), settings)?;
        outcome.load = milliseconds(started);
        let rendering = Instant::now();
        let rendered = render(&request, cancel)?;
        outcome.render = milliseconds(rendering);
        for (extension, format) in formats {
            let exporting = Instant::now();
            let payload = match *format {
                BatchFormat::Output(output_format, text_mode) => {
                    export(&rendered, &request, output_format, text_mode.or(request.text_mode))?
                }
                BatchFormat::Warnings => warnings_json(&rendered.warnings).into_bytes(),
            };
            outcome.export += milliseconds(exporting);
            let writing = Instant::now();
            let output = directory.join(format!("{stem}.{extension}"));
            write_output(&output, &output.display().to_string(), &payload)?;
            outcome.write += milliseconds(writing);
        }
        Ok(())
    })();
    outcome.error = result.err().map(|error| error.to_string());
    outcome
}

fn write_timings(path: &str, wall: f64, jobs: usize, outcomes: &[Outcome]) -> CliResult<()> {
    let cards: Vec<_> = outcomes
        .iter()
        .map(|outcome| {
            json!({
                "input": outcome.input,
                "loadMilliseconds": outcome.load,
                "renderMilliseconds": outcome.render,
                "exportMilliseconds": outcome.export,
                "writeMilliseconds": outcome.write,
                "error": outcome.error,
            })
        })
        .collect();
    let report = json!({ "wallMilliseconds": wall, "jobs": jobs, "cards": cards });
    std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap_or_default())
        .map_err(|_| CliError::new(ErrorCode::OutputWriteFailed, format!("Could not write output \"{path}\".")))
}

pub fn run_batch(inputs: &[String], batch: &BatchSettings, settings: &RenderSettings, cancel: &AtomicBool) -> CliResult<()> {
    let formats = batch
        .format
        .split(',')
        .map(|extension| parse_format(extension).map(|format| (extension, format)))
        .collect::<CliResult<Vec<_>>>()?;
    if !formats.iter().any(|(_, format)| matches!(format, BatchFormat::Output(..))) {
        return Err(CliError::new(ErrorCode::ArgumentError, "render-batch requires at least one image or SVG format."));
    }
    let directory = crate::templates::absolute(Path::new(batch.directory));
    std::fs::create_dir_all(&directory)
        .map_err(|_| CliError::new(ErrorCode::OutputWriteFailed, format!("Could not write output \"{}\".", batch.directory)))?;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(batch.jobs.unwrap_or(0))
        .build()
        .map_err(|error| CliError::new(ErrorCode::InternalError, error.to_string()))?;
    let started = Instant::now();
    let outcomes: Vec<Outcome> =
        pool.install(|| inputs.par_iter().map(|input| render_one(input, &directory, &formats, settings, cancel)).collect());
    let wall = milliseconds(started);
    let failures: Vec<&Outcome> = outcomes.iter().filter(|outcome| outcome.error.is_some()).collect();
    for failure in &failures {
        eprintln!("{}: {}", failure.input, failure.error.as_deref().unwrap_or_default());
    }
    if let Some(path) = batch.timings {
        write_timings(path, wall, pool.current_num_threads(), &outcomes)?;
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(CliError::new(ErrorCode::RenderFailed, format!("{} of {} cards failed to render.", failures.len(), outcomes.len())))
    }
}

use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use signal_hook::consts::{SIGINT, SIGTERM};
use yugilife_cli::arguments::{Arguments, parse_arguments};
use yugilife_cli::errors::{CliError, CliResult, ErrorCode};
use yugilife_cli::input::RenderSettings;
use yugilife_cli::{batch, render, templates};
use yugilife_core::export::TextMode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn help_text() -> String {
    format!(
        "YugiLife CLI {VERSION}

Usage:
  yugilife-cli doctor
  yugilife-cli render <card.json> --output <card.svg|card.png|card.jpg|card.webp>
  yugilife-cli render-batch <card.json>... --output-dir <directory>
  yugilife-cli templates list
  yugilife-cli templates install <template-id@version>

Options:
  -o, --output <path>       Output SVG, PNG, JPEG, or WebP path
      --scale <number>      Raster output scale; defaults to 1
      --width <pixels>      Raster output width; preserves aspect ratio
      --height <pixels>     Raster output height; preserves aspect ratio
      --quality <0-100>     JPEG/WebP quality; defaults to 92
      --background <color>  JPEG matte as #RGB or #RRGGBB; defaults to white
      --text-mode <mode>    SVG text mode: paths (default) or text
      --title <title>       Optional SVG title
      --template <id>       Use an installed template ID or exact ID@version
      --use-default-template
                            Explicitly use the packaged default template
      --registry <url>      Template registry catalog used only by templates install
      --output-dir <path>   render-batch output directory
      --format <formats>    render-batch outputs, comma separated: png (default), jpg,
                            webp, svg, text.svg, warnings.json
  -j, --jobs <count>        render-batch worker threads; defaults to all cores
      --timings <path>      render-batch JSON timing report
  -h, --help                Show this help
  -v, --version             Show the CLI version
"
    )
}

fn usage_error(message: &str) -> CliError {
    CliError::new(ErrorCode::ArgumentError, format!("{message}\n\n{}", help_text()))
}

fn number_option(arguments: &Arguments, name: &str) -> CliResult<Option<f64>> {
    let Some(value) = arguments.text(name) else {
        return Ok(None);
    };
    if yugilife_core::js::trim(value).is_empty() {
        return Err(usage_error(&format!("--{name} requires a number.")));
    }
    let parsed = yugilife_core::js::to_number(value);
    if !parsed.is_finite() {
        return Err(usage_error(&format!("--{name} requires a finite number.")));
    }
    Ok(Some(parsed))
}

fn text_mode(arguments: &Arguments) -> CliResult<Option<TextMode>> {
    match arguments.text("text-mode") {
        None => Ok(None),
        Some("paths") => Ok(Some(TextMode::Paths)),
        Some("text") => Ok(Some(TextMode::Text)),
        Some(other) => {
            Err(CliError::new(ErrorCode::ArgumentError, format!("Unknown SVG text mode \"{other}\". Expected \"paths\" or \"text\".")))
        }
    }
}

fn render_settings(arguments: &Arguments) -> CliResult<RenderSettings> {
    let text_mode = text_mode(arguments)?;
    let height = number_option(arguments, "height")?;
    let quality = match number_option(arguments, "quality")? {
        Some(value) if !(0.0..=100.0).contains(&value) => {
            return Err(usage_error("--quality must be from 0 through 100."));
        }
        quality => quality.map(|value| value / 100.0),
    };
    Ok(RenderSettings {
        background_color: arguments.text("background").map(str::to_owned),
        height,
        quality,
        scale: number_option(arguments, "scale")?,
        template_reference: arguments.text("template").map(str::to_owned),
        text_mode,
        title: arguments.text("title").map(str::to_owned),
        use_default_template: arguments.flag("use-default-template"),
        width: number_option(arguments, "width")?,
    })
}

fn run_templates(arguments: &Arguments, stdout: &mut impl Write) -> CliResult<()> {
    let positionals = &arguments.positionals[1..];
    match positionals.first().map(String::as_str) {
        Some("list") => {
            if positionals.len() > 1 {
                return Err(usage_error("templates list does not accept arguments."));
            }
            for (identity, source) in templates::list_templates() {
                let _ = writeln!(stdout, "{}@{}\t{source}\t{}", identity.id, identity.version, identity.name);
            }
            Ok(())
        }
        Some("install") => {
            if positionals.len() != 2 {
                return Err(usage_error("templates install requires exactly one template ID and version."));
            }
            let reference = &positionals[1];
            let already_installed = templates::install_template(reference, arguments.text("registry"))?;
            let _ = if already_installed {
                writeln!(stdout, "{reference} is already available locally.")
            } else {
                writeln!(stdout, "Installed {reference}.")
            };
            Ok(())
        }
        _ => Err(usage_error("Expected a templates command: list or install.")),
    }
}

fn run_single_render(arguments: &Arguments, cancel: &AtomicBool) -> CliResult<()> {
    if arguments.positionals.len() != 2 {
        return Err(usage_error("render requires exactly one input JSON path."));
    }
    let output =
        arguments.text("output").filter(|output| !output.is_empty()).ok_or_else(|| usage_error("render requires --output <path>."))?;
    let settings = render_settings(arguments)?;
    let threads = std::thread::available_parallelism().map_or(1, |threads| threads.get().min(8) as u32);
    yugilife_core::raster::decode::set_decoder_threads(threads);
    let warnings = render::run_render(&arguments.positionals[1], output, &settings, cancel)?;
    let mut stderr = std::io::stderr().lock();
    for warning in warnings {
        let _ = writeln!(stderr, "yugilife-cli warning [{}] {}: {}", warning.code(), warning.layer_id, warning.message());
    }
    Ok(())
}

fn run_batch_render(arguments: &Arguments, cancel: &AtomicBool) -> CliResult<()> {
    let inputs = &arguments.positionals[1..];
    if inputs.is_empty() {
        return Err(usage_error("render-batch requires at least one input JSON path."));
    }
    let directory = arguments
        .text("output-dir")
        .filter(|directory| !directory.is_empty())
        .ok_or_else(|| usage_error("render-batch requires --output-dir <directory>."))?;
    let settings = render_settings(arguments)?;
    let jobs = match number_option(arguments, "jobs")? {
        Some(jobs) if jobs < 1.0 || jobs.fract() != 0.0 => return Err(usage_error("--jobs must be a positive whole number.")),
        jobs => jobs.map(|jobs| jobs as usize),
    };
    let batch =
        batch::BatchSettings { directory, format: arguments.text("format").unwrap_or("png"), jobs, timings: arguments.text("timings") };
    batch::run_batch(inputs, &batch, &settings, cancel)
}

fn dispatch(arguments: Vec<String>, cancel: &AtomicBool) -> CliResult<()> {
    let arguments = parse_arguments(arguments)?;
    let mut stdout = std::io::stdout().lock();
    if arguments.flag("version") {
        if !arguments.positionals.is_empty() {
            return Err(usage_error("--version cannot be combined with a command."));
        }
        let _ = writeln!(stdout, "{VERSION}");
        return Ok(());
    }
    if arguments.flag("help") {
        if !arguments.positionals.is_empty() {
            return Err(usage_error("--help cannot be combined with a command."));
        }
        let _ = write!(stdout, "{}", help_text());
        return Ok(());
    }
    match arguments.positionals.first().map(String::as_str) {
        Some("doctor") => {
            if arguments.positionals.len() > 1 {
                return Err(usage_error("doctor does not accept positional arguments."));
            }
            let _ = write!(stdout, "{}", render::doctor(VERSION)?);
            Ok(())
        }
        Some("templates") => run_templates(&arguments, &mut stdout),
        Some("render") => run_single_render(&arguments, cancel),
        Some("render-batch") => run_batch_render(&arguments, cancel),
        _ => Err(usage_error("Expected a command: doctor, render, render-batch, or templates.")),
    }
}

fn interrupted_signal(interrupted: &AtomicBool, terminated: &AtomicBool) -> Option<(&'static str, i32)> {
    if interrupted.load(Ordering::Relaxed) {
        Some(("SIGINT", 130))
    } else if terminated.load(Ordering::Relaxed) {
        Some(("SIGTERM", 143))
    } else {
        None
    }
}

fn main() {
    let cancel = Arc::new(AtomicBool::new(false));
    let interrupted = Arc::new(AtomicBool::new(false));
    let terminated = Arc::new(AtomicBool::new(false));
    for (signal, flag) in [(SIGINT, &interrupted), (SIGTERM, &terminated), (SIGINT, &cancel), (SIGTERM, &cancel)] {
        let _ = signal_hook::flag::register(signal, Arc::clone(flag));
    }
    let Err(mut error) = dispatch(std::env::args().skip(1).collect(), &cancel) else {
        std::process::exit(0);
    };
    let signal = interrupted_signal(&interrupted, &terminated);
    if let Some((name, _)) = signal
        && matches!(error.code, ErrorCode::InternalError | ErrorCode::CliInterrupted)
    {
        error.message = format!("Interrupted by {name}.");
    }
    eprintln!("{error}");
    let exit_code = match signal {
        Some((_, code)) if error.code == ErrorCode::CliInterrupted => code,
        _ => error.code.exit_code(),
    };
    std::process::exit(exit_code);
}

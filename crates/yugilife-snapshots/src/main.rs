use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rayon::prelude::*;
use serde_json::{Value, json};

struct Image {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[derive(Default)]
struct PixelMetrics {
    pixels: u64,
    changed: u64,
    over_threshold: u64,
    max_difference: u8,
    absolute_sum: u64,
    squared_sum: u64,
}

impl PixelMetrics {
    fn mean_absolute(&self) -> f64 {
        self.absolute_sum as f64 / (self.pixels * 4).max(1) as f64
    }

    fn psnr(&self) -> f64 {
        let mean_squared = self.squared_sum as f64 / (self.pixels * 4).max(1) as f64;
        if mean_squared == 0.0 { f64::INFINITY } else { 10.0 * (255.0 * 255.0 / mean_squared).log10() }
    }

    fn to_json(&self) -> Value {
        let psnr = self.psnr();
        json!({
            "pixels": self.pixels,
            "changedPixels": self.changed,
            "pixelsOverThreshold": self.over_threshold,
            "overThresholdRatio": self.over_threshold as f64 / self.pixels.max(1) as f64,
            "maxChannelDifference": self.max_difference,
            "meanAbsoluteChannelDifference": self.mean_absolute(),
            "psnr": if psnr.is_finite() { json!(psnr) } else { json!("infinity") },
        })
    }
}

struct Settings {
    original: PathBuf,
    candidate: PathBuf,
    diff: Option<PathBuf>,
    report: Option<PathBuf>,
    threshold: u8,
    max_ratio: f64,
}

fn read_png(path: &Path) -> Result<Image, String> {
    let file = std::fs::File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16 | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().map_err(|error| format!("{}: {error}", path.display()))?;
    let mut buffer = vec![0; reader.output_buffer_size().unwrap_or(0)];
    let frame = reader.next_frame(&mut buffer).map_err(|error| format!("{}: {error}", path.display()))?;
    buffer.truncate(frame.buffer_size());
    let pixels = match frame.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::GrayscaleAlpha => {
            buffer.as_chunks::<2>().0.iter().flat_map(|pixel| [pixel[0], pixel[0], pixel[0], pixel[1]]).collect()
        }
        other => return Err(format!("{}: unsupported color type {other:?}", path.display())),
    };
    Ok(Image { width: frame.width, height: frame.height, pixels })
}

fn rasterize_svg(path: &Path) -> Result<Image, String> {
    let data = std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let tree =
        resvg::usvg::Tree::from_data(&data, &resvg::usvg::Options::default()).map_err(|error| format!("{}: {error}", path.display()))?;
    let size = tree.size().to_int_size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height()).ok_or_else(|| format!("{}: empty SVG", path.display()))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    let pixels = pixmap.pixels().iter().flat_map(|pixel| {
        let color = pixel.demultiply();
        [color.red(), color.green(), color.blue(), color.alpha()]
    });
    Ok(Image { width: size.width(), height: size.height(), pixels: pixels.collect() })
}

fn compare_pixels(original: &Image, candidate: &Image, threshold: u8) -> PixelMetrics {
    let mut metrics = PixelMetrics { pixels: u64::from(original.width) * u64::from(original.height), ..PixelMetrics::default() };
    for (left, right) in original.pixels.as_chunks::<4>().0.iter().zip(candidate.pixels.as_chunks::<4>().0.iter()) {
        let difference = left.iter().zip(right).map(|(left, right)| left.abs_diff(*right)).fold(0, u8::max);
        for (left, right) in left.iter().zip(right) {
            let channel = u64::from(left.abs_diff(*right));
            metrics.absolute_sum += channel;
            metrics.squared_sum += channel * channel;
        }
        metrics.changed += u64::from(difference > 0);
        metrics.over_threshold += u64::from(difference > threshold);
        metrics.max_difference = metrics.max_difference.max(difference);
    }
    metrics
}

fn difference_image(original: &Image, candidate: &Image, threshold: u8) -> Vec<u8> {
    original
        .pixels
        .as_chunks::<4>()
        .0
        .iter()
        .zip(candidate.pixels.as_chunks::<4>().0.iter())
        .flat_map(|(left, right)| {
            let difference = left.iter().zip(right).map(|(left, right)| left.abs_diff(*right)).fold(0, u8::max);
            let luminance = ((u32::from(left[0]) * 3 + u32::from(left[1]) * 6 + u32::from(left[2])) / 10 / 4) as u8;
            if difference > threshold {
                [255, 0, 255, 255]
            } else if difference > 0 {
                [luminance, luminance.saturating_add(difference.saturating_mul(16)), luminance, 255]
            } else {
                [luminance, luminance, luminance, 255]
            }
        })
        .collect()
}

fn write_png(path: &Path, image: &Image) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), image.width, image.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer.write_image_data(&image.pixels).map_err(|error| error.to_string())
}

fn compare_images(original: &Image, candidate: &Image, settings: &Settings, diff_name: &str) -> Result<Value, String> {
    if (original.width, original.height) != (candidate.width, candidate.height) {
        return Ok(json!({
            "dimensionsMatch": false,
            "original": [original.width, original.height],
            "candidate": [candidate.width, candidate.height],
            "passed": false,
        }));
    }
    let metrics = compare_pixels(original, candidate, settings.threshold);
    let passed = (metrics.over_threshold as f64 / metrics.pixels.max(1) as f64) <= settings.max_ratio;
    if let Some(directory) = &settings.diff
        && metrics.over_threshold > 0
    {
        let pixels = difference_image(original, candidate, settings.threshold);
        write_png(&directory.join(diff_name), &Image { width: original.width, height: original.height, pixels })?;
    }
    let mut report = metrics.to_json();
    report["dimensionsMatch"] = json!(true);
    report["passed"] = json!(passed);
    Ok(report)
}

fn tokens(source: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let bytes = source.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        let begins_number =
            byte.is_ascii_digit() || ((byte == b'-' || byte == b'.') && bytes.get(index + 1).is_some_and(u8::is_ascii_digit));
        if begins_number {
            if start < index {
                tokens.push(&source[start..index]);
            }
            let mut end = index + 1;
            while end < bytes.len() && (bytes[end].is_ascii_digit() || bytes[end] == b'.' || bytes[end] == b'e') {
                end += 1;
            }
            tokens.push(&source[index..end]);
            start = end;
            index = end;
        } else {
            index += 1;
        }
    }
    if start < bytes.len() {
        tokens.push(&source[start..]);
    }
    tokens
}

fn without_data_urls(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(position) = rest.find("data:") {
        result.push_str(&rest[..position]);
        let end = rest[position..].find(['"', ')', '\'']).map_or(rest.len(), |offset| position + offset);
        result.push_str("DATA");
        rest = &rest[end..];
    }
    result.push_str(rest);
    result
}

fn compare_structure(original: &str, candidate: &str) -> Value {
    let original = without_data_urls(original);
    let candidate = without_data_urls(candidate);
    let left = tokens(&original);
    let right = tokens(&candidate);
    let mut text_mismatches = 0_u64;
    let mut number_mismatches = 0_u64;
    let mut max_number_difference = 0.0_f64;
    let mut first_mismatch = Value::Null;
    for (index, (left, right)) in left.iter().zip(&right).enumerate() {
        if left == right {
            continue;
        }
        match (left.parse::<f64>(), right.parse::<f64>()) {
            (Ok(left_number), Ok(right_number)) => {
                number_mismatches += 1;
                max_number_difference = max_number_difference.max((left_number - right_number).abs());
            }
            _ => text_mismatches += 1,
        }
        if first_mismatch.is_null() {
            first_mismatch = json!({ "token": index, "original": left, "candidate": right });
        }
    }
    json!({
        "tokenCountMatch": left.len() == right.len(),
        "originalTokens": left.len(),
        "candidateTokens": right.len(),
        "textMismatches": text_mismatches,
        "numberMismatches": number_mismatches,
        "maxNumberDifference": max_number_difference,
        "firstMismatch": first_mismatch,
        "identical": original == candidate,
    })
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))
}

fn compare_card(stem: &str, settings: &Settings) -> Value {
    let original = |extension: &str| settings.original.join(format!("{stem}.{extension}"));
    let candidate = |extension: &str| settings.candidate.join(format!("{stem}.{extension}"));
    let mut report = json!({ "card": stem });
    let raster = read_png(&original("png"))
        .and_then(|left| read_png(&candidate("png")).and_then(|right| compare_images(&left, &right, settings, &format!("{stem}.png"))));
    report["png"] = raster.unwrap_or_else(|error| json!({ "error": error, "passed": false }));
    let vector = rasterize_svg(&original("svg")).and_then(|left| {
        rasterize_svg(&candidate("svg")).and_then(|right| compare_images(&left, &right, settings, &format!("{stem}.svg.png")))
    });
    report["svgRaster"] = vector.unwrap_or_else(|error| json!({ "error": error, "passed": false }));
    for (key, extension) in [("svgStructure", "svg"), ("textSvgStructure", "text.svg")] {
        report[key] = match (read_text(&original(extension)), read_text(&candidate(extension))) {
            (Ok(left), Ok(right)) => compare_structure(&left, &right),
            (Err(error), _) | (_, Err(error)) => json!({ "error": error }),
        };
    }
    let warnings = |path: PathBuf| read_text(&path).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
    report["warningsMatch"] = json!(warnings(original("warnings.json")) == warnings(candidate("warnings.json")));
    report
}

fn stems(directory: &Path) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    let mut stems: Vec<String> = entries
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.strip_suffix(".png").map(str::to_owned))
        .filter(|stem| !stem.contains('.'))
        .collect();
    stems.sort();
    Ok(stems)
}

fn parse_settings() -> Result<(Settings, Vec<String>), String> {
    let mut settings = Settings {
        original: PathBuf::from("snapshots/original"),
        candidate: PathBuf::from("snapshots/rust"),
        diff: Some(PathBuf::from("snapshots/diff")),
        report: Some(PathBuf::from("snapshots/report.json")),
        threshold: 8,
        max_ratio: 0.0001,
    };
    let mut only = Vec::new();
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        let mut value = || arguments.next().ok_or_else(|| format!("{argument} requires a value"));
        match argument.as_str() {
            "--original" => settings.original = PathBuf::from(value()?),
            "--candidate" => settings.candidate = PathBuf::from(value()?),
            "--diff" => settings.diff = Some(PathBuf::from(value()?)),
            "--report" => settings.report = Some(PathBuf::from(value()?)),
            "--threshold" => settings.threshold = value()?.parse().map_err(|_| "--threshold requires 0-255")?,
            "--max-ratio" => settings.max_ratio = value()?.parse().map_err(|_| "--max-ratio requires a number")?,
            "--no-diff" => settings.diff = None,
            _ => only.push(argument),
        }
    }
    Ok((settings, only))
}

fn check(report: &Value, key: &str) -> bool {
    report[key]["passed"].as_bool().unwrap_or(false)
}

fn run() -> Result<bool, String> {
    let (settings, only) = parse_settings()?;
    if let Some(directory) = &settings.diff {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let stems: Vec<String> =
        stems(&settings.original)?.into_iter().filter(|stem| only.is_empty() || only.iter().any(|name| stem.contains(name))).collect();
    let cards: Vec<Value> = stems.par_iter().map(|stem| compare_card(stem, &settings)).collect();
    let failed: Vec<&Value> = cards
        .iter()
        .filter(|card| {
            !check(card, "png")
                || !check(card, "svgRaster")
                || card["warningsMatch"] != json!(true)
                || card["svgStructure"]["identical"] != json!(true)
                || card["textSvgStructure"]["identical"] != json!(true)
        })
        .collect();
    let worst = |key: &str, metric: &str| cards.iter().filter_map(|card| card[key][metric].as_f64()).fold(0.0, f64::max);
    let summary = json!({
        "cards": cards.len(),
        "failed": failed.len(),
        "threshold": settings.threshold,
        "maxRatio": settings.max_ratio,
        "worstPngOverThresholdRatio": worst("png", "overThresholdRatio"),
        "worstPngMeanAbsolute": worst("png", "meanAbsoluteChannelDifference"),
        "worstSvgOverThresholdRatio": worst("svgRaster", "overThresholdRatio"),
        "identicalSvgStructure": cards.iter().filter(|card| card["svgStructure"]["identical"] == json!(true)).count(),
        "identicalTextSvgStructure": cards.iter().filter(|card| card["textSvgStructure"]["identical"] == json!(true)).count(),
        "warningsMatch": cards.iter().filter(|card| card["warningsMatch"] == json!(true)).count(),
        "pixelIdenticalPng": cards.iter().filter(|card| card["png"]["changedPixels"] == json!(0)).count(),
        "pixelIdenticalSvgRaster": cards.iter().filter(|card| card["svgRaster"]["changedPixels"] == json!(0)).count(),
        "changedPngPixels": cards.iter().filter_map(|card| card["png"]["changedPixels"].as_u64()).sum::<u64>(),
        "comparedPngPixels": cards.iter().filter_map(|card| card["png"]["pixels"].as_u64()).sum::<u64>(),
    });
    println!("{}", serde_json::to_string_pretty(&summary).unwrap_or_default());
    for card in &failed {
        println!(
            "FAIL {} png={} svg={} warnings={} svg-structure={} text-svg-structure={} first-difference={}",
            card["card"].as_str().unwrap_or_default(),
            card["png"]["overThresholdRatio"],
            card["svgRaster"]["overThresholdRatio"],
            card["warningsMatch"],
            card["svgStructure"]["identical"],
            card["textSvgStructure"]["identical"],
            card["textSvgStructure"]["firstMismatch"]
        );
    }
    if let Some(path) = &settings.report {
        let report = json!({ "summary": summary, "cards": cards });
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap_or_default()).map_err(|error| error.to_string())?;
    }
    Ok(failed.is_empty())
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("snapshot-diff: {error}");
            ExitCode::from(2)
        }
    }
}

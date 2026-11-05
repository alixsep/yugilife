use std::sync::Arc;

use tiny_skia::{FilterQuality, Pixmap, PixmapPaint, Transform};

use crate::error::{Error, Result};
use crate::raster::canvas::{Surface, unpremultiplied};
use crate::render::{RenderSegment, RenderedCard, check_cancel};
use crate::svg::{SvgElement, escape_xml, escape_xml_into};
use crate::text::outline::Outliner;

const MAXIMUM_RASTER_EDGE: u32 = 16_384;
const MAXIMUM_RASTER_PIXELS: u64 = 64_000_000;
const DEFAULT_LOSSY_QUALITY: f64 = 0.92;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextMode {
    Paths,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontSmoothing {
    Grayscale,
    Subpixel,
}

#[derive(Debug, Clone, Default)]
pub struct SvgExportOptions {
    pub font_smoothing: Option<FontSmoothing>,
    pub text_mode: Option<TextMode>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Webp,
}

impl ImageFormat {
    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::Webp => "WEBP",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutputSize {
    Scale(f64),
    Width(f64),
    Height(f64),
}

#[derive(Debug, Clone, Default)]
pub struct ImageExportOptions {
    pub background_color: Option<String>,
    pub format: Option<ImageFormat>,
    pub quality: Option<f64>,
    pub size: Option<OutputSize>,
}

fn positive_finite(value: f64, name: &str) -> Result<()> {
    if !value.is_finite() || value <= 0.0 {
        return Err(Error::range(format!("{name} must be finite and greater than zero; received {}.", crate::number::js_number(value))));
    }
    Ok(())
}

fn positive_integer(value: f64, name: &str) -> Result<()> {
    if !(value.is_finite() && value.fract() == 0.0 && value > 0.0 && value <= 9_007_199_254_740_991.0) {
        return Err(Error::range(format!("{name} must be a positive integer; received {}.", crate::number::js_number(value))));
    }
    Ok(())
}

pub fn resolve_raster_output_dimensions(width: f64, height: f64, size: Option<OutputSize>) -> Result<(u32, u32)> {
    positive_finite(width, "Template width")?;
    positive_finite(height, "Template height")?;
    let (mut output_width, mut output_height) = (crate::number::js_round(width), crate::number::js_round(height));
    match size {
        None => {}
        Some(OutputSize::Scale(scale)) => {
            positive_finite(scale, "Raster output scale")?;
            output_width = crate::number::js_round(width * scale);
            output_height = crate::number::js_round(height * scale);
        }
        Some(OutputSize::Width(requested)) => {
            positive_integer(requested, "Raster output width")?;
            output_width = requested;
            output_height = crate::number::js_round((height * requested) / width);
        }
        Some(OutputSize::Height(requested)) => {
            positive_integer(requested, "Raster output height")?;
            output_height = requested;
            output_width = crate::number::js_round((width * requested) / height);
        }
    }
    if output_width < 1.0 || output_height < 1.0 {
        return Err(Error::range("Raster output size produces a dimension smaller than one pixel."));
    }
    if output_width > f64::from(MAXIMUM_RASTER_EDGE) || output_height > f64::from(MAXIMUM_RASTER_EDGE) {
        return Err(Error::range(format!("Raster output dimensions cannot exceed {MAXIMUM_RASTER_EDGE} pixels.")));
    }
    if output_width * output_height > MAXIMUM_RASTER_PIXELS as f64 {
        return Err(Error::range(format!("Raster output cannot exceed {MAXIMUM_RASTER_PIXELS} pixels.")));
    }
    Ok((output_width as u32, output_height as u32))
}

struct RasterOptions {
    background: [u8; 3],
    format: ImageFormat,
    quality: f64,
}

fn parse_hex_color(value: &str) -> Option<[u8; 3]> {
    let digits = value.strip_prefix('#')?;
    if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |text: &str| u8::from_str_radix(text, 16).ok();
    match digits.len() {
        3 => {
            let expand = |index: usize| channel(&digits[index..=index].repeat(2));
            Some([expand(0)?, expand(1)?, expand(2)?])
        }
        6 => Some([channel(&digits[0..2])?, channel(&digits[2..4])?, channel(&digits[4..6])?]),
        _ => None,
    }
}

/// Rejects the options `RenderedCard::to_image` would reject, for hosts that encode `to_pixmap`.
pub fn validate_image_export_options(options: &ImageExportOptions) -> Result<()> {
    raster_options(options).map(|_| ())
}

fn raster_options(options: &ImageExportOptions) -> Result<RasterOptions> {
    let format = options.format.unwrap_or(ImageFormat::Png);
    if let Some(quality) = options.quality {
        if format == ImageFormat::Png {
            return Err(Error::range("PNG output does not accept a quality value."));
        }
        if !quality.is_finite() || !(0.0..=1.0).contains(&quality) {
            return Err(Error::range(format!(
                "Raster output quality must be from 0 through 1; received {}.",
                crate::number::js_number(quality)
            )));
        }
    }
    if options.background_color.is_some() && format != ImageFormat::Jpeg {
        return Err(Error::range("A raster background color is supported only for JPEG output."));
    }
    let background_text = options.background_color.as_deref().unwrap_or("#ffffff");
    let background = match parse_hex_color(background_text) {
        Some(color) => color,
        None if format == ImageFormat::Jpeg => {
            return Err(Error::range("JPEG backgroundColor must be an opaque #RGB or #RRGGBB color."));
        }
        None => [255, 255, 255],
    };
    Ok(RasterOptions { background, format, quality: options.quality.unwrap_or(DEFAULT_LOSSY_QUALITY) })
}

pub enum ExportSegment {
    Raster(Arc<Pixmap>),
    Vector(Vec<SvgElement>),
}

impl RenderedCard<'_> {
    pub fn width(&self) -> u32 {
        self.bundle.template.width.round().max(1.0) as u32
    }

    pub fn height(&self) -> u32 {
        self.bundle.template.height.round().max(1.0) as u32
    }

    pub fn outlined_segments(&self) -> Result<Vec<ExportSegment>> {
        let mut outliner = Outliner::new(&self.fonts, &self.bundle.cache.glyph_paths, self.cancel);
        let mut output = Vec::with_capacity(self.segments.len());
        for segment in &self.segments {
            match segment {
                RenderSegment::Raster(pixmap) => output.push(ExportSegment::Raster(pixmap.clone())),
                RenderSegment::Vector(elements) => output.push(ExportSegment::Vector(outliner.outline_elements(elements)?)),
            }
        }
        check_cancel(self.cancel)?;
        Ok(output)
    }

    pub fn outline_elements(&self, elements: &[SvgElement]) -> Result<Vec<SvgElement>> {
        Outliner::new(&self.fonts, &self.bundle.cache.glyph_paths, self.cancel).outline_elements(elements)
    }

    pub fn to_png(&self, scale: Option<f64>) -> Result<Vec<u8>> {
        self.to_image(&ImageExportOptions {
            format: Some(ImageFormat::Png),
            size: scale.map(OutputSize::Scale),
            ..ImageExportOptions::default()
        })
    }

    fn text_segments(&self) -> Vec<ExportSegment> {
        self.segments
            .iter()
            .map(|segment| match segment {
                RenderSegment::Raster(pixmap) => ExportSegment::Raster(pixmap.clone()),
                RenderSegment::Vector(elements) => ExportSegment::Vector(elements.clone()),
            })
            .collect()
    }

    pub fn to_svg(&self, options: &SvgExportOptions) -> Result<String> {
        let text_mode = options.text_mode.unwrap_or(TextMode::Paths);
        let segments = match text_mode {
            TextMode::Text => self.text_segments(),
            TextMode::Paths => self.outlined_segments()?,
        };
        serialize_card_svg(self.width(), self.height(), &segments, text_mode, options)
    }

    pub fn to_image(&self, options: &ImageExportOptions) -> Result<Vec<u8>> {
        let dimensions = resolve_raster_output_dimensions(self.bundle.template.width, self.bundle.template.height, options.size)?;
        let encoding = raster_options(options)?;
        let canvas = self.compose_output(dimensions)?;
        encode(canvas, &encoding)
    }

    /// The complete composition at the requested size, before encoding: what `to_image` encodes. A
    /// host with its own encoder (a browser's WebP encoder, for example) starts from this.
    pub fn to_pixmap(&self, size: Option<OutputSize>) -> Result<Pixmap> {
        let dimensions = resolve_raster_output_dimensions(self.bundle.template.width, self.bundle.template.height, size)?;
        self.compose_output(dimensions)
    }

    fn compose_output(&self, (output_width, output_height): (u32, u32)) -> Result<Pixmap> {
        let segments = self.outlined_segments()?;
        check_cancel(self.cancel)?;
        let (native_width, native_height) = (self.width(), self.height());
        let canvas = if output_width < native_width && output_height < native_height {
            let native = compose(&segments, native_width, native_height, 1.0, 1.0)?;
            let mut target = Pixmap::new(output_width, output_height)
                .ok_or_else(|| Error::range("The browser could not allocate the requested raster output dimensions."))?;
            let paint = PixmapPaint { quality: FilterQuality::Bicubic, ..PixmapPaint::default() };
            let transform = Transform::from_scale(output_width as f32 / native_width as f32, output_height as f32 / native_height as f32);
            target.draw_pixmap(0, 0, native.as_ref(), &paint, transform, None);
            target
        } else {
            let scale_x = f64::from(output_width) / f64::from(native_width);
            let scale_y = f64::from(output_height) / f64::from(native_height);
            compose(&segments, output_width, output_height, scale_x, scale_y)?
        };
        check_cancel(self.cancel)?;
        Ok(canvas)
    }
}

fn compose(segments: &[ExportSegment], width: u32, height: u32, scale_x: f64, scale_y: f64) -> Result<Pixmap> {
    let mut surface = Surface::new(width, height)
        .ok_or_else(|| Error::range("The browser could not allocate the requested raster output dimensions."))?;
    for segment in segments {
        match segment {
            ExportSegment::Raster(pixmap) if scale_x == 1.0 && scale_y == 1.0 => surface.composite_pixmap(pixmap),
            ExportSegment::Raster(pixmap) => {
                surface.draw_pixmap_scaled(pixmap, f64::from(pixmap.width()) * scale_x, f64::from(pixmap.height()) * scale_y);
            }
            ExportSegment::Vector(elements) => render_vector(&mut surface.pixmap, elements, scale_x, scale_y)?,
        }
    }
    Ok(surface.pixmap)
}

pub fn render_vector(pixmap: &mut Pixmap, elements: &[SvgElement], scale_x: f64, scale_y: f64) -> Result<()> {
    if elements.is_empty() {
        return Ok(());
    }
    if elements.iter().all(crate::raster::vector::is_supported) {
        crate::raster::vector::render_elements(pixmap, elements, &crate::raster::vector::Matrix::scale(scale_x as f32, scale_y as f32));
        return Ok(());
    }
    let mut document = String::with_capacity(elements.len() * 256);
    document.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\">");
    for element in elements {
        element.serialize_into(&mut document);
    }
    document.push_str("</svg>");
    let tree = resvg::usvg::Tree::from_str(&document, &resvg::usvg::Options::default())
        .map_err(|error| Error::render(format!("Could not rasterize the rendered SVG for image output: {error}")))?;
    resvg::render(&tree, Transform::from_scale(scale_x as f32, scale_y as f32), &mut pixmap.as_mut());
    Ok(())
}

fn encode(canvas: Pixmap, options: &RasterOptions) -> Result<Vec<u8>> {
    let (width, height) = (canvas.width(), canvas.height());
    match options.format {
        ImageFormat::Png => encode_png(&unpremultiplied(&canvas), width, height),
        ImageFormat::Jpeg => {
            let mut matte = Pixmap::new(width, height).ok_or_else(|| Error::render("Raster image encoding failed."))?;
            let [red, green, blue] = options.background;
            matte.fill(tiny_skia::Color::from_rgba8(red, green, blue, 255));
            matte.draw_pixmap(0, 0, canvas.as_ref(), &PixmapPaint::default(), Transform::identity(), None);
            let rgb: Vec<u8> = matte.data().as_chunks::<4>().0.iter().flat_map(|pixel| [pixel[0], pixel[1], pixel[2]]).collect();
            let mut output = Vec::new();
            let quality = (options.quality * 100.0).round().clamp(1.0, 100.0) as u8;
            let mut encoder = jpeg_encoder::Encoder::new(&mut output, quality);
            encoder.set_sampling_factor(if quality >= 100 {
                jpeg_encoder::SamplingFactor::F_1_1
            } else {
                jpeg_encoder::SamplingFactor::F_2_2
            });
            encoder
                .encode(&rgb, width as u16, height as u16, jpeg_encoder::ColorType::Rgb)
                .map_err(|_| Error::render("The browser could not encode JPEG output."))?;
            Ok(output)
        }
        #[cfg(not(target_family = "wasm"))]
        ImageFormat::Webp => {
            let pixels = unpremultiplied(&canvas);
            let encoded = webp::Encoder::from_rgba(&pixels, width, height).encode((options.quality * 100.0) as f32);
            Ok(encoded.to_vec())
        }
        // There is no pure-Rust lossy WebP encoder. On the web, the host encodes the rendered pixels
        // with the browser's own encoder, as the TypeScript implementation does with `canvas.toBlob`.
        #[cfg(target_family = "wasm")]
        ImageFormat::Webp => Err(Error::render("WebP output is encoded by the host on WebAssembly.")),
    }
}

pub fn encode_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(pixels.len() / 2);
    {
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        encoder.set_filter(png::Filter::Paeth);
        let mut writer = encoder.write_header().map_err(|_| Error::render("Could not encode PNG output."))?;
        writer.write_image_data(pixels).map_err(|_| Error::render("Could not encode PNG output."))?;
    }
    Ok(output)
}

fn flush_run<'a>(run: &mut Vec<&'a Pixmap>, flattened: &mut Vec<FlatSegment<'a>>, width: u32, height: u32) {
    match run.len() {
        0 => {}
        1 => flattened.push(FlatSegment::Raster(std::borrow::Cow::Borrowed(run[0]))),
        _ => {
            if let Some(mut surface) = Surface::new(width, height) {
                for pixmap in run.iter() {
                    surface.composite_pixmap(pixmap);
                }
                flattened.push(FlatSegment::Raster(std::borrow::Cow::Owned(surface.pixmap)));
            }
        }
    }
    run.clear();
}

fn flatten_rasters(segments: &[ExportSegment], width: u32, height: u32) -> Vec<FlatSegment<'_>> {
    let mut flattened: Vec<FlatSegment> = Vec::new();
    let mut run: Vec<&Pixmap> = Vec::new();
    for segment in segments {
        match segment {
            ExportSegment::Raster(pixmap) => run.push(pixmap),
            ExportSegment::Vector(elements) => {
                flush_run(&mut run, &mut flattened, width, height);
                flattened.push(FlatSegment::Vector(elements));
            }
        }
    }
    flush_run(&mut run, &mut flattened, width, height);
    flattened
}

enum FlatSegment<'a> {
    Raster(std::borrow::Cow<'a, Pixmap>),
    Vector(&'a [SvgElement]),
}

pub fn serialize_card_svg(
    width: u32,
    height: u32,
    segments: &[ExportSegment],
    text_mode: TextMode,
    options: &SvgExportOptions,
) -> Result<String> {
    let smoothing = match options.font_smoothing.unwrap_or(FontSmoothing::Grayscale) {
        FontSmoothing::Grayscale => "-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale",
        FontSmoothing::Subpixel => "-webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto",
    };
    if text_mode == TextMode::Paths
        && segments
            .iter()
            .any(|segment| matches!(segment, ExportSegment::Vector(elements) if elements.iter().any(SvgElement::contains_text)))
    {
        return Err(Error::render(
            "SVG text mode \"paths\" cannot serialize residual <text> or <tspan> elements. Use exportCardToSvg so fonts can be loaded and outlined asynchronously.",
        ));
    }
    let mode = if text_mode == TextMode::Paths { "paths" } else { "text" };
    let mut output = String::with_capacity(4 * 1024 * 1024);
    output.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    output.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" data-yugilife-text-mode=\"{mode}\" style=\"{smoothing}\">"
    ));
    if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
        output.push_str("<title>");
        escape_xml_into(title, &mut output);
        output.push_str("</title>");
    }
    for segment in flatten_rasters(segments, width, height) {
        match segment {
            FlatSegment::Vector(elements) => {
                for element in elements {
                    element.serialize_into(&mut output);
                }
            }
            FlatSegment::Raster(pixmap) => {
                let png = encode_png(&unpremultiplied(&pixmap), pixmap.width(), pixmap.height())?;
                let url = crate::assets::encode_data_url("image/png", &png);
                output.push_str(&format!("<image href=\"{}\" x=\"0\" y=\"0\" width=\"{width}\" height=\"{height}\"/>", escape_xml(&url)));
            }
        }
    }
    output.push_str("</svg>");
    Ok(output)
}

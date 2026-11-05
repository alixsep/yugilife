use std::sync::Arc;
use std::sync::OnceLock;

use tiny_skia::{IntSize, Pixmap};

use crate::assets::AssetSource;
use crate::error::{Error, Result};
use crate::raster::image::RasterImage;

pub enum Decoded {
    Raster(RasterImage),
    Vector(Box<resvg::usvg::Tree>),
}

pub type SharedDecoded = Arc<Decoded>;

impl Decoded {
    pub fn width(&self) -> f64 {
        match self {
            Self::Raster(image) => f64::from(image.width()),
            Self::Vector(tree) => f64::from(tree.size().width()),
        }
    }

    pub fn height(&self) -> f64 {
        match self {
            Self::Raster(image) => f64::from(image.height()),
            Self::Vector(tree) => f64::from(tree.size().height()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Avif,
    Bmp,
    Gif,
    Jpeg,
    Png,
    Svg,
    Webp,
}

fn sniff(bytes: &[u8], media_type: Option<&str>) -> Option<Format> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some(Format::Png);
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(Format::Jpeg);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(Format::Webp);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    if bytes.starts_with(b"BM") {
        return Some(Format::Bmp);
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"avif" | b"avis" | b"mif1" | b"msf1") {
        return Some(Format::Avif);
    }
    if media_type.is_some_and(|media| media.eq_ignore_ascii_case("image/svg+xml")) {
        return Some(Format::Svg);
    }
    None
}

pub fn decode_source(source: &AssetSource) -> Result<Decoded> {
    let label = source.label();
    let failure = || Error::render(format!("Could not load image asset \"{label}\"."));
    let resolved = source.read().map_err(|_| failure())?;
    decode_bytes(resolved.bytes(), resolved.media_type()).ok_or_else(failure)
}

pub fn decode_bytes(bytes: &[u8], media_type: Option<&str>) -> Option<Decoded> {
    decode_known(bytes, media_type).ok()
}

fn decode_known(bytes: &[u8], media_type: Option<&str>) -> std::result::Result<Decoded, ()> {
    match sniff(bytes, media_type).ok_or(())? {
        Format::Svg => {
            let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).map_err(|_| ())?;
            Ok(Decoded::Vector(Box::new(tree)))
        }
        Format::Avif => decode_avif(bytes).map(|image| Decoded::Raster(RasterImage::from_yuv(image))),
        Format::Webp => decode_webp(bytes).map(|pixmap| Decoded::Raster(RasterImage::new(pixmap))),
        format => {
            let image_format = match format {
                Format::Bmp => image::ImageFormat::Bmp,
                Format::Gif => image::ImageFormat::Gif,
                Format::Jpeg => image::ImageFormat::Jpeg,
                _ => image::ImageFormat::Png,
            };
            let image = image::load_from_memory_with_format(bytes, image_format).map_err(|_| ())?;
            let rgba = image.to_rgba8();
            let (width, height) = rgba.dimensions();
            premultiplied_pixmap(rgba.into_raw(), width, height).map(|pixmap| Decoded::Raster(RasterImage::new(pixmap)))
        }
    }
}

/// libwebp, as Chromium decodes WebP.
#[cfg(not(target_family = "wasm"))]
fn webp_pixels(bytes: &[u8]) -> std::result::Result<(Vec<u8>, u32, u32), ()> {
    let image = webp::Decoder::new(bytes).decode().ok_or(())?;
    let (width, height) = (image.width(), image.height());
    let pixels = if image.is_alpha() {
        image.to_vec()
    } else {
        image.as_chunks::<3>().0.iter().flat_map(|pixel| [pixel[0], pixel[1], pixel[2], 255]).collect()
    };
    Ok((pixels, width, height))
}

/// The pure-Rust decoder from the `image` crate. Lossless WebP, which every template texture uses,
/// decodes to the same pixels as libwebp by definition; lossy WebP is not guaranteed to.
#[cfg(target_family = "wasm")]
fn webp_pixels(bytes: &[u8]) -> std::result::Result<(Vec<u8>, u32, u32), ()> {
    let rgba = image::load_from_memory_with_format(bytes, image::ImageFormat::WebP).map_err(|_| ())?.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok((rgba.into_raw(), width, height))
}

fn decode_webp(bytes: &[u8]) -> std::result::Result<Pixmap, ()> {
    let (mut pixels, width, height) = webp_pixels(bytes)?;
    for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
        let alpha = u32::from(pixel[3]);
        if alpha != 255 {
            let multiplier = alpha * 32897;
            for channel in &mut pixel[..3] {
                *channel = ((u32::from(*channel) * multiplier) >> 23) as u8;
            }
        }
    }
    Pixmap::from_vec(pixels, IntSize::from_wh(width, height).ok_or(())?).ok_or(())
}

fn premultiplied_pixmap(mut pixels: Vec<u8>, width: u32, height: u32) -> std::result::Result<Pixmap, ()> {
    premultiply_in_place(&mut pixels);
    Pixmap::from_vec(pixels, IntSize::from_wh(width, height).ok_or(())?).ok_or(())
}

pub fn premultiply_in_place(pixels: &mut [u8]) {
    for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
        let alpha = pixel[3];
        if alpha == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = multiply_div_255(*channel, alpha);
        }
    }
}

pub fn unpremultiply_channel(value: u8, alpha: u8) -> u8 {
    static TABLE: OnceLock<Vec<u8>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let step = 1.0_f32 / 255.0;
        (0..=255_u16)
            .flat_map(|alpha| {
                let scale = if alpha == 0 { 0.0 } else { 1.0 / (f32::from(alpha) * step) };
                (0..=255_u16).map(move |value| ((f32::from(value) * step * scale).clamp(0.0, 1.0) * 255.0).round_ties_even() as u8)
            })
            .collect()
    });
    table[usize::from(alpha) * 256 + usize::from(value)]
}

pub fn multiply_div_255(value: u8, alpha: u8) -> u8 {
    let product = u32::from(value) * u32::from(alpha) + 128;
    ((product + (product >> 8)) >> 8) as u8
}

struct YuvConstants {
    y_gain: i32,
    y_bias: i32,
    u_to_b: i32,
    u_to_g: i32,
    v_to_g: i32,
    v_to_r: i32,
}

/// libyuv's constants for a CICP matrix: BT.709, BT.2020, and BT.601 for everything else.
fn yuv_constants(matrix: u8, full_range: bool) -> YuvConstants {
    let (limited, full) = match matrix {
        1 => ((18997, -1160, 128, 14, 34, 115), (16320, 32, 119, 12, 30, 101)),
        9 | 10 => ((19003, -1160, 128, 12, 42, 107), (16320, 32, 120, 11, 37, 94)),
        _ => ((18997, -1160, 128, 25, 52, 102), (16320, 32, 113, 22, 46, 90)),
    };
    let (y_gain, y_bias, u_to_b, u_to_g, v_to_g, v_to_r) = if full_range { full } else { limited };
    YuvConstants { y_gain, y_bias, u_to_b, u_to_g, v_to_g, v_to_r }
}

/// The CICP code of dav1d's matrix, as `yuv_constants` distinguishes them.
fn matrix_code(matrix: dav1d::pixel::MatrixCoefficients) -> u8 {
    use dav1d::pixel::MatrixCoefficients as Matrix;
    match matrix {
        Matrix::BT709 => 1,
        Matrix::BT2020NonConstantLuminance => 9,
        Matrix::BT2020ConstantLuminance => 10,
        _ => 6,
    }
}

fn clamp_pixel(value: i32) -> u8 {
    (value >> 6).clamp(0, 255) as u8
}

fn upsample_linear(source: &[u8], output: &mut [u8]) {
    let width = output.len();
    output[0] = source[0];
    let work = (width - 1) & !1;
    for x in 0..work / 2 {
        let (a, b) = (u32::from(source[x]), u32::from(source[x + 1]));
        output[1 + 2 * x] = ((a * 3 + b + 2) >> 2) as u8;
        output[2 + 2 * x] = ((a + b * 3 + 2) >> 2) as u8;
    }
    output[width - 1] = source[(width - 1) / 2];
}

fn upsample_bilinear(top: &[u8], bottom: &[u8], first: &mut [u8], second: &mut [u8]) {
    let width = first.len();
    let edge = |a: u8, b: u8| ((3 * u32::from(a) + u32::from(b) + 2) >> 2) as u8;
    first[0] = edge(top[0], bottom[0]);
    second[0] = edge(bottom[0], top[0]);
    let work = (width - 1) & !1;
    for x in 0..work / 2 {
        let (s0, s1, t0, t1) = (u32::from(top[x]), u32::from(top[x + 1]), u32::from(bottom[x]), u32::from(bottom[x + 1]));
        first[1 + 2 * x] = ((s0 * 9 + s1 * 3 + t0 * 3 + t1 + 8) >> 4) as u8;
        first[2 + 2 * x] = ((s0 * 3 + s1 * 9 + t0 + t1 * 3 + 8) >> 4) as u8;
        second[1 + 2 * x] = ((s0 * 3 + s1 + t0 * 9 + t1 * 3 + 8) >> 4) as u8;
        second[2 + 2 * x] = ((s0 + s1 * 3 + t0 * 3 + t1 * 9 + 8) >> 4) as u8;
    }
    let last = (width - 1) / 2;
    first[width - 1] = edge(top[last], bottom[last]);
    second[width - 1] = edge(bottom[last], top[last]);
}

fn write_row(output: &mut [u8], y_row: &[u8], u_row: &[u8], v_row: &[u8], constants: &YuvConstants) {
    let count = output.len() / 4;
    let (output, y_row, u_row, v_row) = (&mut output[..count * 4], &y_row[..count], &u_row[..count], &v_row[..count]);
    let (gain, bias) = (constants.y_gain as u32, constants.y_bias);
    let (u_to_b, u_to_g, v_to_g, v_to_r) = (constants.u_to_b, constants.u_to_g, constants.v_to_g, constants.v_to_r);
    for index in 0..count {
        let luma = ((u32::from(y_row[index]) * 0x0101 * gain) >> 16) as i32 + bias;
        let u = i32::from(u_row[index]) - 128;
        let v = i32::from(v_row[index]) - 128;
        output[index * 4] = ((luma + v * v_to_r) >> 6).clamp(0, 255) as u8;
        output[index * 4 + 1] = ((luma - (u * u_to_g + v * v_to_g)) >> 6).clamp(0, 255) as u8;
        output[index * 4 + 2] = ((luma + u * u_to_b) >> 6).clamp(0, 255) as u8;
        output[index * 4 + 3] = 255;
    }
}

static DECODER_THREADS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

pub fn set_decoder_threads(threads: u32) {
    DECODER_THREADS.store(threads, std::sync::atomic::Ordering::Relaxed);
}

fn decode_av1(data: Vec<u8>) -> std::result::Result<dav1d::Picture, ()> {
    let mut settings = dav1d::Settings::new();
    settings.set_n_threads(DECODER_THREADS.load(std::sync::atomic::Ordering::Relaxed));
    settings.set_max_frame_delay(1);
    let mut decoder = dav1d::Decoder::with_settings(&settings).map_err(|_| ())?;
    match decoder.send_data(data, None, None, None) {
        Ok(()) => {}
        Err(error) if error.is_again() => loop {
            match decoder.send_pending_data() {
                Ok(()) => break,
                Err(error) if error.is_again() => continue,
                Err(_) => return Err(()),
            }
        },
        Err(_) => return Err(()),
    }
    for _ in 0..16 {
        match decoder.get_picture() {
            Ok(picture) => return Ok(picture),
            Err(error) if error.is_again() => decoder.flush(),
            Err(_) => return Err(()),
        }
    }
    Err(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChromaLayout {
    I400,
    I420,
    I422,
    I444,
}

/// One 8-bit plane, rows `stride` bytes apart.
pub struct Plane {
    pub data: Vec<u8>,
    pub stride: usize,
}

impl Plane {
    fn row(&self, row: usize, width: usize) -> &[u8] {
        &self.data[row * self.stride..row * self.stride + width]
    }

    fn holds(&self, width: usize, height: usize) -> bool {
        height == 0 || (self.stride >= width && self.data.len() >= (height - 1) * self.stride + width)
    }
}

/// An alpha plane decoded as its own monochrome image.
pub struct AlphaPlane {
    pub plane: Plane,
    pub width: u32,
    pub height: u32,
    pub full_range: bool,
}

/// An 8-bit YUV image, converted to RGBA the way Chromium converts AVIF (libyuv's constants,
/// bilinear chroma upsampling).
pub struct YuvImage {
    width: u32,
    height: u32,
    layout: ChromaLayout,
    y: Plane,
    u: Plane,
    v: Plane,
    alpha: Option<AlphaPlane>,
    constants: YuvConstants,
}

impl YuvImage {
    /// Planes decoded elsewhere (a host's own AV1 decoder, for example). `None` when the planes are
    /// too small for the dimensions and layout.
    #[allow(clippy::too_many_arguments)]
    pub fn from_planes(
        width: u32,
        height: u32,
        layout: ChromaLayout,
        matrix: u8,
        full_range: bool,
        y: Plane,
        u: Plane,
        v: Plane,
        alpha: Option<AlphaPlane>,
    ) -> Option<Self> {
        let (columns, rows) = (width as usize, height as usize);
        let (chroma_columns, chroma_rows) = match layout {
            ChromaLayout::I400 => (0, 0),
            ChromaLayout::I420 => (columns.div_ceil(2), rows.div_ceil(2)),
            ChromaLayout::I422 => (columns.div_ceil(2), rows),
            ChromaLayout::I444 => (columns, rows),
        };
        let fits = y.holds(columns, rows)
            && u.holds(chroma_columns, chroma_rows)
            && v.holds(chroma_columns, chroma_rows)
            && alpha.as_ref().is_none_or(|alpha| alpha.plane.holds(alpha.width as usize, alpha.height as usize));
        fits.then(|| Self { width, height, layout, y, u, v, alpha, constants: yuv_constants(matrix, full_range) })
    }

    fn from_picture(picture: &dav1d::Picture, alpha: Option<(dav1d::Picture, bool)>) -> Option<Self> {
        let plane = |picture: &dav1d::Picture, component| Plane {
            data: picture.plane(component).to_vec(),
            stride: picture.stride(component) as usize,
        };
        let layout = match picture.pixel_layout() {
            dav1d::PixelLayout::I400 => ChromaLayout::I400,
            dav1d::PixelLayout::I420 => ChromaLayout::I420,
            dav1d::PixelLayout::I422 => ChromaLayout::I422,
            dav1d::PixelLayout::I444 => ChromaLayout::I444,
        };
        let (u, v) = if layout == ChromaLayout::I400 {
            (Plane { data: Vec::new(), stride: 0 }, Plane { data: Vec::new(), stride: 0 })
        } else {
            (plane(picture, dav1d::PlanarImageComponent::U), plane(picture, dav1d::PlanarImageComponent::V))
        };
        let alpha = alpha.map(|(alpha, full_range)| AlphaPlane {
            plane: plane(&alpha, dav1d::PlanarImageComponent::Y),
            width: alpha.width(),
            height: alpha.height(),
            full_range,
        });
        Self::from_planes(
            picture.width(),
            picture.height(),
            layout,
            matrix_code(picture.matrix_coefficients()),
            matches!(picture.color_range(), dav1d::pixel::YUVRange::Full),
            plane(picture, dav1d::PlanarImageComponent::Y),
            u,
            v,
            alpha,
        )
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    fn finish_row(&self, row: usize, pixels: &mut [u8]) {
        let Some(alpha) = &self.alpha else {
            return;
        };
        if row < alpha.height as usize {
            let values = alpha.plane.row(row, (alpha.width as usize).min(pixels.len() / 4));
            for (pixel, value) in pixels.as_chunks_mut::<4>().0.iter_mut().zip(values) {
                pixel[3] = if alpha.full_range {
                    *value
                } else {
                    ((f64::from(value.saturating_sub(16)) * 255.0 / 219.0).round()).min(255.0) as u8
                };
            }
        }
        premultiply_in_place(pixels);
    }

    fn for_each_row(&self, mut visit: impl FnMut(usize, &[u8])) {
        let (width, height) = (self.width() as usize, self.height() as usize);
        let constants = &self.constants;
        let y_row = |row: usize| self.y.row(row, width);
        let mut first = vec![0u8; width * 4];
        let mut second = vec![0u8; width * 4];
        let mut emit = |row: usize, pixels: &mut Vec<u8>| {
            self.finish_row(row, pixels);
            visit(row, pixels);
        };
        let layout = self.layout;
        if layout == ChromaLayout::I400 {
            let gain = constants.y_gain as u32;
            for row in 0..height {
                for (pixel, y) in first.as_chunks_mut::<4>().0.iter_mut().zip(y_row(row)) {
                    let gray = clamp_pixel(((u32::from(*y) * 0x0101 * gain) >> 16) as i32 + constants.y_bias);
                    pixel.copy_from_slice(&[gray, gray, gray, 255]);
                }
                emit(row, &mut first);
            }
            return;
        }
        let chroma_width = if layout == ChromaLayout::I444 { width } else { width.div_ceil(2) };
        let u_row = |row: usize| self.u.row(row, chroma_width);
        let v_row = |row: usize| self.v.row(row, chroma_width);
        if layout == ChromaLayout::I444 {
            for row in 0..height {
                write_row(&mut first, y_row(row), u_row(row), v_row(row), constants);
                emit(row, &mut first);
            }
            return;
        }
        let (mut u_first, mut u_second, mut v_first, mut v_second) =
            (vec![0u8; width], vec![0u8; width], vec![0u8; width], vec![0u8; width]);
        if layout == ChromaLayout::I422 {
            for row in 0..height {
                upsample_linear(u_row(row), &mut u_first);
                upsample_linear(v_row(row), &mut v_first);
                write_row(&mut first, y_row(row), &u_first, &v_first, constants);
                emit(row, &mut first);
            }
            return;
        }
        upsample_linear(u_row(0), &mut u_first);
        upsample_linear(v_row(0), &mut v_first);
        write_row(&mut first, y_row(0), &u_first, &v_first, constants);
        emit(0, &mut first);
        let (mut row, mut chroma) = (1, 0);
        while row + 1 < height {
            upsample_bilinear(u_row(chroma), u_row(chroma + 1), &mut u_first, &mut u_second);
            upsample_bilinear(v_row(chroma), v_row(chroma + 1), &mut v_first, &mut v_second);
            write_row(&mut first, y_row(row), &u_first, &v_first, constants);
            write_row(&mut second, y_row(row + 1), &u_second, &v_second, constants);
            emit(row, &mut first);
            emit(row + 1, &mut second);
            row += 2;
            chroma += 1;
        }
        if height % 2 == 0 && height > 1 {
            upsample_linear(u_row(chroma), &mut u_first);
            upsample_linear(v_row(chroma), &mut v_first);
            write_row(&mut first, y_row(row), &u_first, &v_first, constants);
            emit(row, &mut first);
        }
    }

    pub fn to_pixmap(&self) -> Option<Pixmap> {
        let row_bytes = self.width() as usize * 4;
        let mut output = vec![0u8; row_bytes * self.height() as usize];
        self.for_each_row(|row, pixels| output[row * row_bytes..(row + 1) * row_bytes].copy_from_slice(pixels));
        Pixmap::from_vec(output, IntSize::from_wh(self.width(), self.height())?)
    }

    pub fn half_pixmap(&self) -> Option<Pixmap> {
        let (width, height) = (self.width() as usize / 2, self.height() as usize / 2);
        let mut output = vec![0u8; width * height * 4];
        let mut previous = vec![0u8; width * 8];
        self.for_each_row(|row, pixels| {
            if row % 2 == 0 {
                previous.copy_from_slice(&pixels[..width * 8]);
                return;
            }
            let target = &mut output[(row / 2) * width * 4..(row / 2 + 1) * width * 4];
            for ((pixel, top), bottom) in
                target.as_chunks_mut::<4>().0.iter_mut().zip(previous.as_chunks::<8>().0.iter()).zip(pixels.as_chunks::<8>().0.iter())
            {
                for channel in 0..4 {
                    let sum =
                        u16::from(top[channel]) + u16::from(top[channel + 4]) + u16::from(bottom[channel]) + u16::from(bottom[channel + 4]);
                    pixel[channel] = (sum >> 2) as u8;
                }
            }
        });
        Pixmap::from_vec(output, IntSize::from_wh(width as u32, height as u32)?)
    }
}

/// The AV1 data of an AVIF file's primary item and, when there is one, its alpha item.
pub fn avif_items(bytes: &[u8]) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
    let container = avif_parse::read_avif(&mut &bytes[..]).ok()?;
    Some((container.primary_item.to_vec(), container.alpha_item.map(|alpha| alpha.to_vec())))
}

fn decode_avif(bytes: &[u8]) -> std::result::Result<YuvImage, ()> {
    let (color, alpha) = avif_items(bytes).ok_or(())?;
    let picture = decode_av1(color)?;
    if picture.bit_depth() != 8 {
        return Err(());
    }
    let alpha = match alpha {
        Some(alpha) => {
            let alpha_picture = decode_av1(alpha)?;
            let alpha_full = matches!(alpha_picture.color_range(), dav1d::pixel::YUVRange::Full);
            Some((alpha_picture, alpha_full))
        }
        None => None,
    };
    YuvImage::from_picture(&picture, alpha).ok_or(())
}

/// What dav1d reports for each item of an AVIF file: bit depth, chroma layout, CICP matrix and
/// full range. The reference `av1::sequence_info` is checked against.
pub fn avif_picture_info(bytes: &[u8]) -> Option<Vec<(usize, ChromaLayout, u8, bool)>> {
    let (color, alpha) = avif_items(bytes)?;
    [Some(color), alpha]
        .into_iter()
        .flatten()
        .map(|item| {
            let picture = decode_av1(item).ok()?;
            let image = YuvImage::from_picture(&picture, None)?;
            Some((
                picture.bit_depth(),
                image.layout,
                matrix_code(picture.matrix_coefficients()),
                matches!(picture.color_range(), dav1d::pixel::YUVRange::Full),
            ))
        })
        .collect()
}

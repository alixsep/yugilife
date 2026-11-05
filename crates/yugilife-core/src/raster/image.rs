use std::sync::OnceLock;

use tiny_skia::{IntSize, Pixmap};

use crate::model::Region;
use crate::raster::canvas::Bounds;
use crate::raster::decode::YuvImage;

pub struct RasterImage {
    width: u32,
    height: u32,
    base: OnceLock<Pixmap>,
    source: Option<Box<YuvImage>>,
    levels: Vec<OnceLock<Pixmap>>,
}

fn level_slots(width: u32, height: u32) -> Vec<OnceLock<Pixmap>> {
    let larger = width.max(height);
    let count = if larger > 1 { larger.ilog2() as usize } else { 0 };
    (0..count).map(|_| OnceLock::new()).collect()
}

impl RasterImage {
    pub fn new(pixmap: Pixmap) -> Self {
        let (width, height) = (pixmap.width(), pixmap.height());
        Self { width, height, base: OnceLock::from(pixmap), source: None, levels: level_slots(width, height) }
    }

    pub fn from_yuv(source: YuvImage) -> Self {
        let (width, height) = (source.width(), source.height());
        Self { width, height, base: OnceLock::new(), source: Some(Box::new(source)), levels: level_slots(width, height) }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn base(&self) -> Option<&Pixmap> {
        if let Some(base) = self.base.get() {
            return Some(base);
        }
        let converted = self.source.as_ref()?.to_pixmap()?;
        Some(self.base.get_or_init(|| converted))
    }

    fn level(&self, index: usize) -> Option<&Pixmap> {
        if index == 0 || self.levels.is_empty() {
            return self.base();
        }
        let index = index.min(self.levels.len());
        if let Some(level) = self.levels[index - 1].get() {
            return Some(level);
        }
        let direct = index == 1 && self.width.is_multiple_of(2) && self.height.is_multiple_of(2) && self.base.get().is_none();
        let level = match direct.then(|| self.source.as_deref().and_then(YuvImage::half_pixmap)).flatten() {
            Some(level) => level,
            None => downsample(self.level(index - 1)?),
        };
        Some(self.levels[index - 1].get_or_init(|| level))
    }
}

fn expand(pixel: &[u8]) -> [u32; 4] {
    [u32::from(pixel[0]), u32::from(pixel[1]), u32::from(pixel[2]), u32::from(pixel[3])]
}

fn weighted_row(row: &[u8], x: usize, taps: usize) -> [u32; 4] {
    let at = |offset: usize| expand(&row[(x + offset) * 4..(x + offset) * 4 + 4]);
    let mut sum = [0; 4];
    let weights: &[u32] = match taps {
        1 => &[1],
        2 => &[1, 1],
        _ => &[1, 2, 1],
    };
    for (offset, weight) in weights.iter().enumerate() {
        let pixel = at(offset);
        for channel in 0..4 {
            sum[channel] += pixel[channel] * weight;
        }
    }
    sum
}

fn downsample_even(source: &Pixmap) -> Option<Pixmap> {
    let (width, height) = (source.width() as usize / 2, source.height() as usize / 2);
    let stride = source.width() as usize * 4;
    let data = source.data();
    let mut output = vec![0u8; width * height * 4];
    for (y, row) in output.chunks_exact_mut(width * 4).enumerate() {
        let top = &data[2 * y * stride..(2 * y + 1) * stride];
        let bottom = &data[(2 * y + 1) * stride..(2 * y + 2) * stride];
        for ((pixel, top), bottom) in
            row.as_chunks_mut::<4>().0.iter_mut().zip(top.as_chunks::<8>().0.iter()).zip(bottom.as_chunks::<8>().0.iter())
        {
            for channel in 0..4 {
                let sum =
                    u16::from(top[channel]) + u16::from(top[channel + 4]) + u16::from(bottom[channel]) + u16::from(bottom[channel + 4]);
                pixel[channel] = (sum >> 2) as u8;
            }
        }
    }
    IntSize::from_wh(width as u32, height as u32).and_then(|size| Pixmap::from_vec(output, size))
}

fn downsample(source: &Pixmap) -> Pixmap {
    if source.width().is_multiple_of(2)
        && source.height().is_multiple_of(2)
        && let Some(level) = downsample_even(source)
    {
        return level;
    }
    let (source_width, source_height) = (source.width() as usize, source.height() as usize);
    let horizontal_taps = if source_width & 1 == 0 {
        2
    } else if source_width == 1 {
        1
    } else {
        3
    };
    let vertical_taps = if source_height & 1 == 0 {
        2
    } else if source_height == 1 {
        1
    } else {
        3
    };
    let shift = [horizontal_taps, vertical_taps].iter().map(|taps| if *taps == 3 { 2 } else { *taps as u32 - 1 }).sum::<u32>();
    let width = (source_width >> 1).max(1);
    let height = (source_height >> 1).max(1);
    let stride = source_width * 4;
    let data = source.data();
    let vertical_weights: &[u32] = match vertical_taps {
        1 => &[1],
        2 => &[1, 1],
        _ => &[1, 2, 1],
    };
    let mut output = vec![0u8; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0u32; 4];
            for (offset, weight) in vertical_weights.iter().enumerate() {
                let row = &data[(2 * y + offset) * stride..(2 * y + offset + 1) * stride];
                let partial = weighted_row(row, 2 * x, horizontal_taps);
                for channel in 0..4 {
                    sum[channel] += partial[channel] * weight;
                }
            }
            let target = &mut output[(y * width + x) * 4..(y * width + x) * 4 + 4];
            for channel in 0..4 {
                target[channel] = (sum[channel] >> shift) as u8;
            }
        }
    }
    IntSize::from_wh(width as u32, height as u32).and_then(|size| Pixmap::from_vec(output, size)).unwrap_or_else(|| source.clone())
}

const FRACTIONAL_ONE: f64 = 4_294_967_296.0;
const BILINEAR_CHUNK: usize = 127;
const NEAREST_CHUNK: usize = 254;

fn fractional(value: f32) -> i64 {
    (f64::from(value) * FRACTIONAL_ONE) as i64
}

fn round_to_int(value: f32) -> i64 {
    (value + 0.5).floor() as i64
}

fn mip_level(inverse_scale_x: f32, inverse_scale_y: f32) -> usize {
    let width = (inverse_scale_x * inverse_scale_x).sqrt();
    let height = (inverse_scale_y * inverse_scale_y).sqrt();
    let scale = ((1.0 / width) * (1.0 / height)).sqrt();
    if !(scale > 0.0 && scale < 1.0) {
        return 0;
    }
    let level = (-scale.log2() - 0.5).max(0.0);
    if level <= 0.0 { 0 } else { (level + 0.5).floor() as usize }
}

fn nearly_integral(value: f32) -> bool {
    (value - (value + 0.5).floor()).abs() <= 1.0 / 256.0
}

struct Sampler<'a> {
    source: &'a Pixmap,
    scale_x: f32,
    translate_x: f32,
    scale_y: f32,
    translate_y: f32,
    bilinear: bool,
}

impl Sampler<'_> {
    fn bias(&self) -> i64 {
        if self.bilinear { 0x8000 << 16 } else { 1 << 16 }
    }

    fn row(&self, y: i64) -> (usize, usize, u32) {
        let fixed = ((fractional((y as f32 + 0.5) * self.scale_y + self.translate_y) - self.bias()) >> 16) as i32;
        let maximum = self.source.height() as i32 - 1;
        let first = (fixed >> 16).clamp(0, maximum) as usize;
        if !self.bilinear {
            return (first, first, 0);
        }
        let second = ((fixed + 0x10000) >> 16).clamp(0, maximum) as usize;
        (first, second, ((fixed >> 12) & 0xF) as u32)
    }

    fn direct_row(&self, x: i64, y: i64, length: usize) -> Option<&[u8]> {
        if self.bilinear || self.scale_x != 1.0 || self.scale_y != 1.0 {
            return None;
        }
        let first = (fractional((x as f32 + 0.5) * self.scale_x + self.translate_x) - self.bias()) >> 32;
        let (row, _, _) = self.row(y);
        if first < 0 || first as usize + length > self.source.width() as usize {
            return None;
        }
        let stride = self.source.width() as usize * 4;
        let start = row * stride + first as usize * 4;
        Some(&self.source.data()[start..start + length * 4])
    }

    fn shade(&self, x: i64, y: i64, output: &mut [[u8; 4]]) {
        let chunk = if self.bilinear { BILINEAR_CHUNK } else { NEAREST_CHUNK };
        let (row_top, row_bottom, sub_y) = self.row(y);
        let stride = self.source.width() as usize * 4;
        let data = self.source.data();
        let top = &data[row_top * stride..(row_top + 1) * stride];
        let bottom = &data[row_bottom * stride..(row_bottom + 1) * stride];
        let maximum = self.source.width() as i32 - 1;
        let step = fractional(self.scale_x);
        for (index, span) in output.chunks_mut(chunk).enumerate() {
            let start = x + (index * chunk) as i64;
            let mut position = fractional((start as f32 + 0.5) * self.scale_x + self.translate_x) - self.bias();
            for pixel in span {
                let fixed = (position >> 16) as i32;
                let left = (fixed >> 16).clamp(0, maximum) as usize;
                *pixel = if self.bilinear {
                    let right = ((fixed + 0x10000) >> 16).clamp(0, maximum) as usize;
                    filter(top, bottom, left, right, ((fixed >> 12) & 0xF) as u32, sub_y)
                } else {
                    [top[left * 4], top[left * 4 + 1], top[left * 4 + 2], top[left * 4 + 3]]
                };
                position += step;
            }
        }
    }
}

fn filter(top: &[u8], bottom: &[u8], left: usize, right: usize, sub_x: u32, sub_y: u32) -> [u8; 4] {
    let weight_top_left = (16 - sub_x) * (16 - sub_y);
    let weight_top_right = sub_x * (16 - sub_y);
    let weight_bottom_left = (16 - sub_x) * sub_y;
    let weight_bottom_right = sub_x * sub_y;
    let mut result = [0u8; 4];
    for (channel, value) in result.iter_mut().enumerate() {
        let sum = u32::from(top[left * 4 + channel]) * weight_top_left
            + u32::from(top[right * 4 + channel]) * weight_top_right
            + u32::from(bottom[left * 4 + channel]) * weight_bottom_left
            + u32::from(bottom[right * 4 + channel]) * weight_bottom_right;
        *value = (sum >> 8) as u8;
    }
    result
}

#[inline]
pub fn source_over_pixel(destination: &mut [u8], source: [u8; 4]) {
    let alpha = source[3];
    if alpha == 255 {
        destination.copy_from_slice(&source);
    } else if alpha != 0 || source != [0; 4] {
        let scale = 256 - u32::from(alpha);
        for channel in 0..4 {
            destination[channel] = (u32::from(source[channel]) + ((u32::from(destination[channel]) * scale) >> 8)) as u8;
        }
    }
}

pub fn blend_pixel(destination: &mut [u8], source: [u8; 4], coverage: u8) {
    let source_scale = u32::from(coverage) + 1;
    let product = 0xFFFF - u32::from(source[3]) * source_scale;
    let destination_scale = (product + (product >> 8)) >> 8;
    for channel in 0..4 {
        let sum = u32::from(source[channel]) * source_scale + u32::from(destination[channel]) * destination_scale;
        destination[channel] = (sum >> 8) as u8;
    }
}

struct Coverage {
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

impl Coverage {
    fn new(region: &Region) -> Self {
        let dot8 = |value: f32| ((f64::from(value) * 65536.0) as i64 + 0x80) >> 8;
        let left = region.x as f32;
        let top = region.y as f32;
        Self { left: dot8(left), top: dot8(top), right: dot8(left + region.width as f32), bottom: dot8(top + region.height as f32) }
    }

    fn is_integral(&self) -> bool {
        [self.left, self.top, self.right, self.bottom].iter().all(|value| value & 0xFF == 0)
    }

    fn pixel_bounds(&self) -> (i64, i64, i64, i64) {
        (self.left >> 8, self.top >> 8, (self.right + 0xFF) >> 8, (self.bottom + 0xFF) >> 8)
    }

    fn row_alpha(&self, y: i64) -> u32 {
        let top = self.top >> 8;
        if top == (self.bottom - 1) >> 8 {
            return if y == top { (self.bottom - self.top - 1) as u32 } else { 0 };
        }
        let mut first_full = top;
        if self.top & 0xFF != 0 {
            if y == top {
                return 256 - (self.top & 0xFF) as u32;
            }
            first_full += 1;
        }
        let last = self.bottom >> 8;
        if y >= first_full && y < last {
            return 256;
        }
        if y == last && self.bottom & 0xFF != 0 { (self.bottom & 0xFF) as u32 } else { 0 }
    }

    fn alpha(&self, x: i64, y: i64) -> u32 {
        let row = self.row_alpha(y);
        if row == 0 {
            return 0;
        }
        let left = self.left >> 8;
        if left == (self.right - 1) >> 8 {
            let width = if row == 256 { self.right - self.left - 1 } else { (i64::from(row) * (self.right - self.left)) >> 8 };
            return if x == left { width as u32 } else { 0 };
        }
        let scaled = |value: u32| if row == 256 { value } else { (row * value) >> 8 };
        let mut first_full = left;
        if self.left & 0xFF != 0 {
            if x == left {
                return scaled(256 - (self.left & 0xFF) as u32);
            }
            first_full += 1;
        }
        let last = self.right >> 8;
        if x >= first_full && x < last {
            return row;
        }
        if x == last && self.right & 0xFF != 0 { scaled((self.right & 0xFF) as u32) } else { 0 }
    }
}

pub fn draw_image(destination: &mut Pixmap, image: &RasterImage, rect: [f64; 4], clip: Option<&Region>) -> Bounds {
    let left = rect[0] as f32;
    let top = rect[1] as f32;
    let right = left + rect[2] as f32;
    let bottom = top + rect[3] as f32;
    let scale_x = (right - left) / image.width() as f32;
    let scale_y = (bottom - top) / image.height() as f32;
    if !(scale_x > 0.0 && scale_y > 0.0 && scale_x.is_finite() && scale_y.is_finite()) {
        return Bounds::empty();
    }
    let mut inverse_scale_x = 1.0 / scale_x;
    let mut inverse_scale_y = 1.0 / scale_y;
    let mut inverse_translate_x = -left * inverse_scale_x;
    let mut inverse_translate_y = -top * inverse_scale_y;
    let level = mip_level(inverse_scale_x, inverse_scale_y);
    let Some(source) = image.level(level) else {
        return Bounds::empty();
    };
    if level > 0 {
        let level_scale_x = source.width() as f32 / image.width() as f32;
        let level_scale_y = source.height() as f32 / image.height() as f32;
        inverse_scale_x *= level_scale_x;
        inverse_translate_x *= level_scale_x;
        inverse_scale_y *= level_scale_y;
        inverse_translate_y *= level_scale_y;
    }
    let translate_only = inverse_scale_x == 1.0 && inverse_scale_y == 1.0;
    let sampler = Sampler {
        source,
        scale_x: inverse_scale_x,
        translate_x: inverse_translate_x,
        scale_y: inverse_scale_y,
        translate_y: inverse_translate_y,
        bilinear: !(translate_only && nearly_integral(inverse_translate_x) && nearly_integral(inverse_translate_y)),
    };
    let coverage = clip.map(Coverage::new);
    let (mut from_x, mut from_y, mut to_x, mut to_y) =
        (round_to_int(left).max(0), round_to_int(top).max(0), round_to_int(right), round_to_int(bottom));
    to_x = to_x.min(i64::from(destination.width()));
    to_y = to_y.min(i64::from(destination.height()));
    if let Some(coverage) = &coverage {
        let (clip_left, clip_top, clip_right, clip_bottom) = coverage.pixel_bounds();
        from_x = from_x.max(clip_left);
        from_y = from_y.max(clip_top);
        to_x = to_x.min(clip_right);
        to_y = to_y.min(clip_bottom);
    }
    if from_x >= to_x || from_y >= to_y {
        return Bounds::empty();
    }
    let width = destination.width() as usize;
    let span_width = (to_x - from_x) as usize;
    let mut span = vec![[0u8; 4]; span_width];
    let partial = coverage.as_ref().filter(|coverage| !coverage.is_integral());
    let data = destination.data_mut();
    for y in from_y..to_y {
        let row_start = (y as usize * width + from_x as usize) * 4;
        let row = &mut data[row_start..row_start + span_width * 4];
        match partial {
            None if sampler.direct_row(from_x, y, span_width).is_some() => {
                if let Some(source) = sampler.direct_row(from_x, y, span_width) {
                    crate::raster::canvas::source_over(row, source);
                }
            }
            None => {
                sampler.shade(from_x, y, &mut span);
                for (pixel, source) in row.as_chunks_mut::<4>().0.iter_mut().zip(&span) {
                    source_over_pixel(pixel, *source);
                }
            }
            Some(coverage) => blit_covered_row(&sampler, coverage, from_x, y, row, &mut span),
        }
    }
    Bounds { left: from_x as u32, top: from_y as u32, right: to_x as u32, bottom: to_y as u32 }
}

fn blit_covered_row(sampler: &Sampler, coverage: &Coverage, from_x: i64, y: i64, row: &mut [u8], span: &mut [[u8; 4]]) {
    let alphas: Vec<u32> = (0..span.len() as i64).map(|offset| coverage.alpha(from_x + offset, y).min(255)).collect();
    let mut start = 0;
    while start < alphas.len() {
        let alpha = alphas[start];
        let end = alphas[start..].iter().position(|value| *value != alpha).map_or(alphas.len(), |length| start + length);
        if alpha > 0 {
            let run = &mut span[start..end];
            sampler.shade(from_x + start as i64, y, run);
            for (pixel, source) in row[start * 4..end * 4].as_chunks_mut::<4>().0.iter_mut().zip(run.iter()) {
                if alpha == 255 { source_over_pixel(pixel, *source) } else { blend_pixel(pixel, *source, alpha as u8) }
            }
        }
        start = end;
    }
}

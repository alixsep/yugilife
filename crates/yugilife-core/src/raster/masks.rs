use tiny_skia::Pixmap;

use crate::number::js_round;
use crate::raster::canvas::{Bounds, Surface};
use crate::raster::decode::Decoded;

pub fn prepare_mask(image: &Decoded, width: u32, height: u32, luminance: bool, invert: bool) -> Option<Vec<u8>> {
    let mut surface = Surface::new(width, height)?;
    surface.draw_decoded(image, 0.0, 0.0, f64::from(width), f64::from(height), None);
    let pixels = surface.pixmap.data();
    let mut alpha = vec![0u8; (width * height) as usize];
    for (index, pixel) in pixels.as_chunks::<4>().0.iter().enumerate() {
        let source_alpha = pixel[3];
        alpha[index] = if luminance || invert {
            let [red, green, blue] = unpremultiply_rgb(pixel);
            let value = if luminance {
                let mut coverage = 0.2126 * f64::from(red) + 0.7152 * f64::from(green) + 0.0722 * f64::from(blue);
                if invert {
                    coverage = 255.0 - coverage;
                }
                coverage * f64::from(source_alpha) / 255.0
            } else {
                255.0 - f64::from(source_alpha)
            };
            js_round(value).clamp(0.0, 255.0) as u8
        } else {
            source_alpha
        };
    }
    Some(alpha)
}

pub fn unpremultiply_rgb(pixel: &[u8]) -> [u8; 3] {
    let alpha = pixel[3];
    if alpha == 255 {
        return [pixel[0], pixel[1], pixel[2]];
    }
    let channel = |value: u8| crate::raster::decode::unpremultiply_channel(value, alpha);
    [channel(pixel[0]), channel(pixel[1]), channel(pixel[2])]
}

pub fn scope_mask_alpha(mask_alpha: u8, coverage_alpha: u8) -> u8 {
    let attenuation = f64::from(coverage_alpha) * (255.0 - f64::from(mask_alpha)) / 255.0;
    (255.0 - js_round(attenuation)) as u8
}

pub fn scope_mask(mask: &[u8], coverage: &[u8]) -> Vec<u8> {
    mask.iter().zip(coverage).map(|(mask, coverage)| scope_mask_alpha(*mask, *coverage)).collect()
}

pub fn apply_alpha_mask(surface: &mut Surface, mask: &[u8]) {
    let bounds = surface.dirty;
    if bounds.is_empty() {
        return;
    }
    apply_alpha_mask_in(&mut surface.pixmap, mask, bounds);
}

pub fn apply_alpha_mask_in(pixmap: &mut Pixmap, mask: &[u8], bounds: Bounds) {
    let width = pixmap.width() as usize;
    let data = pixmap.data_mut();
    for row in bounds.top as usize..bounds.bottom as usize {
        for column in bounds.left as usize..bounds.right as usize {
            let index = row * width + column;
            let coverage = u32::from(mask[index]);
            if coverage == 255 {
                continue;
            }
            let pixel = &mut data[index * 4..index * 4 + 4];
            if coverage == 0 {
                pixel.fill(0);
                continue;
            }
            if pixel[3] == 0 {
                continue;
            }
            let table = destination_in_table(coverage as u8);
            for channel in pixel.iter_mut() {
                *channel = table[usize::from(*channel)];
            }
        }
    }
}

pub fn alpha_plane(pixmap: &Pixmap) -> Vec<u8> {
    pixmap.data().as_chunks::<4>().0.iter().map(|pixel| pixel[3]).collect()
}

pub fn luminance_to_alpha(pixmap: &mut Pixmap, bounds: Bounds) {
    let width = pixmap.width() as usize;
    let data = pixmap.data_mut();
    for row in bounds.top as usize..bounds.bottom as usize {
        for column in bounds.left as usize..bounds.right as usize {
            let index = (row * width + column) * 4;
            let pixel = &mut data[index..index + 4];
            let [red, green, blue] = unpremultiply_rgb(pixel);
            let luminance = f64::from(red) * 0.2126 + f64::from(green) * 0.7152 + f64::from(blue) * 0.0722;
            let alpha = js_round((luminance * f64::from(pixel[3])) / 255.0).clamp(0.0, 255.0) as u8;
            let premultiplied = |value: u8| crate::raster::decode::multiply_div_255(value, alpha);
            pixel.copy_from_slice(&[premultiplied(red), premultiplied(green), premultiplied(blue), alpha]);
        }
    }
}

pub fn destination_in(value: u8, alpha: u8) -> u8 {
    destination_in_table(alpha)[usize::from(value)]
}

fn destination_in_table(alpha: u8) -> &'static [u8] {
    static TABLE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let step = 1.0_f32 / 255.0;
        (0..=255_u16)
            .flat_map(|alpha| {
                (0..=255_u16).map(move |value| {
                    ((f32::from(value) * step * (f32::from(alpha) * step)).clamp(0.0, 1.0) * 255.0).round_ties_even() as u8
                })
            })
            .collect()
    });
    &table[usize::from(alpha) * 256..usize::from(alpha) * 256 + 256]
}

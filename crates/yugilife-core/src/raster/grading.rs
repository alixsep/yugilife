use serde_json::Value;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum ColorPreset {
    Identity,
    Polynomial { exponents: Vec<[u32; 3]>, coefficients: Vec<[f64; 3]> },
    Histogram { red: Vec<u8>, green: Vec<u8>, blue: Vec<u8> },
}

const CANONICAL_EXPONENTS: [[u32; 3]; 20] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [2, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 2, 0],
    [0, 1, 1],
    [0, 0, 2],
    [3, 0, 0],
    [2, 1, 0],
    [2, 0, 1],
    [1, 2, 0],
    [1, 1, 1],
    [1, 0, 2],
    [0, 3, 0],
    [0, 2, 1],
    [0, 1, 2],
    [0, 0, 3],
];

impl ColorPreset {
    pub fn from_json(value: &Value) -> Result<Self> {
        crate::validation::validate_color_preset(value, "Color preset")?;
        match value.get("method").and_then(Value::as_str) {
            Some("rgb-polynomial") => {
                let triple = |entry: &Value| -> [f64; 3] {
                    let values: Vec<f64> = entry.as_array().into_iter().flatten().filter_map(Value::as_f64).collect();
                    [values[0], values[1], values[2]]
                };
                let exponents = value
                    .get("exponents")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|entry| triple(entry).map(|power| power as u32))
                    .collect();
                let coefficients = value.get("coefficients").and_then(Value::as_array).into_iter().flatten().map(triple).collect();
                Ok(Self::Polynomial { exponents, coefficients })
            }
            Some("skimage-histogram-rgb-lut") => {
                let channel = |name: &str| -> Vec<u8> {
                    value
                        .pointer(&format!("/channels/{name}"))
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .map(|entry| entry.as_f64().unwrap_or(0.0) as u8)
                        .collect()
                };
                Ok(Self::Histogram { red: channel("r"), green: channel("g"), blue: channel("b") })
            }
            _ => Ok(Self::Identity),
        }
    }

    pub fn is_identity(&self) -> bool {
        matches!(self, Self::Identity)
    }
}

fn channel(value: f64) -> u8 {
    let scaled = crate::number::js_round(value * 255.0);
    scaled.clamp(0.0, 255.0) as u8
}

fn is_canonical(exponents: &[[u32; 3]]) -> bool {
    matches!(exponents.len(), 4 | 10 | 20) && exponents.iter().zip(CANONICAL_EXPONENTS.iter()).all(|(left, right)| left == right)
}

pub fn apply_color_preset(pixels: &mut [u8], preset: &ColorPreset) -> Result<()> {
    match preset {
        ColorPreset::Identity => Ok(()),
        ColorPreset::Histogram { red, green, blue } => {
            if red.len() != 256 || green.len() != 256 || blue.len() != 256 {
                return Err(Error::range("Each preset channel must contain 256 entries."));
            }
            for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
                pixel[0] = red[usize::from(pixel[0])];
                pixel[1] = green[usize::from(pixel[1])];
                pixel[2] = blue[usize::from(pixel[2])];
            }
            Ok(())
        }
        ColorPreset::Polynomial { exponents, coefficients } => {
            if is_canonical(exponents) {
                apply_canonical(pixels, coefficients);
            } else {
                apply_generic(pixels, exponents, coefficients);
            }
            Ok(())
        }
    }
}

fn apply_canonical(pixels: &mut [u8], coefficients: &[[f64; 3]]) {
    let terms = coefficients.len();
    let c = |term: usize, channel_index: usize| coefficients[term][channel_index];
    for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
        let red = f64::from(pixel[0]) / 255.0;
        let green = f64::from(pixel[1]) / 255.0;
        let blue = f64::from(pixel[2]) / 255.0;
        let mut basis = [0.0f64; 20];
        basis[0] = 1.0;
        basis[1] = red;
        basis[2] = green;
        basis[3] = blue;
        if terms >= 10 {
            let red_squared = red * red;
            let green_squared = green * green;
            let blue_squared = blue * blue;
            let red_green = red * green;
            let red_blue = red * blue;
            let green_blue = green * blue;
            basis[4] = red_squared;
            basis[5] = red_green;
            basis[6] = red_blue;
            basis[7] = green_squared;
            basis[8] = green_blue;
            basis[9] = blue_squared;
            if terms == 20 {
                basis[10] = red_squared * red;
                basis[11] = red_squared * green;
                basis[12] = red_squared * blue;
                basis[13] = red * green_squared;
                basis[14] = red_green * blue;
                basis[15] = red * blue_squared;
                basis[16] = green_squared * green;
                basis[17] = green_squared * blue;
                basis[18] = green * blue_squared;
                basis[19] = blue_squared * blue;
            }
        }
        for (channel_index, target) in pixel.iter_mut().take(3).enumerate() {
            let mut output = c(0, channel_index);
            for (term, value) in basis.iter().enumerate().take(terms).skip(1) {
                output += value * c(term, channel_index);
            }
            *target = channel(output);
        }
    }
}

fn apply_generic(pixels: &mut [u8], exponents: &[[u32; 3]], coefficients: &[[f64; 3]]) {
    let mut terms = vec![0.0f64; exponents.len()];
    for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
        let channels = [f64::from(pixel[0]) / 255.0, f64::from(pixel[1]) / 255.0, f64::from(pixel[2]) / 255.0];
        for (term, exponent) in exponents.iter().enumerate() {
            terms[term] =
                exponent.iter().zip(channels).fold(1.0, |value, (power, channel_value)| value * channel_value.powf(f64::from(*power)));
        }
        for channel_index in 0..3 {
            let mut value = 0.0;
            for (term, term_value) in terms.iter().enumerate() {
                value += term_value * coefficients[term][channel_index];
            }
            pixel[channel_index] = channel(value);
        }
    }
}

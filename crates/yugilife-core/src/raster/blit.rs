pub type Pixel = [u8; 4];

fn alpha_mul(pixel: Pixel, scale: u32) -> Pixel {
    pixel.map(|channel| ((u32::from(channel) * scale) >> 8) as u8)
}

fn color_over(destination: &mut [u8], color: Pixel) {
    let inverse = 256 - u32::from(color[3]);
    for (channel, value) in destination.iter_mut().zip(color) {
        *channel = (((u32::from(*channel) * inverse) >> 8) + u32::from(value)) as u8;
    }
}

fn color_row(row: &mut [u8], color: Pixel) {
    match color[3] {
        0 => {}
        255 => row.as_chunks_mut::<4>().0.iter_mut().for_each(|pixel| pixel.copy_from_slice(&color)),
        _ => row.as_chunks_mut::<4>().0.iter_mut().for_each(|pixel| color_over(pixel, color)),
    }
}

fn blend(source: Pixel, destination: &mut [u8], coverage: u8) {
    let source_scale = u32::from(coverage) + 1;
    let product = 0xFFFF - u32::from(source[3]) * source_scale;
    let destination_scale = (product + (product >> 8)) >> 8;
    for (channel, value) in destination.iter_mut().zip(source) {
        *channel = ((u32::from(value) * source_scale + u32::from(*channel) * destination_scale) >> 8) as u8;
    }
}

fn interpolate(source: Pixel, destination: &mut [u8], weight: u8) {
    let scale = u32::from(weight) + (u32::from(weight) >> 7);
    for (channel, value) in destination.iter_mut().zip(source) {
        *channel = ((u32::from(value) * scale + (256 - scale) * u32::from(*channel)) >> 8) as u8;
    }
}

fn approximate_scale(value: u8, scale: u8) -> u32 {
    (u32::from(value) * u32::from(scale) + u32::from(value)) >> 8
}

pub fn premultiply_color(red: u8, green: u8, blue: u8, alpha: u8) -> Pixel {
    if alpha == 255 {
        return [red, green, blue, alpha];
    }
    let multiply = |channel: u8| {
        let product = u32::from(channel) * u32::from(alpha) + 128;
        ((product + (product >> 8)) >> 8) as u8
    };
    [multiply(red), multiply(green), multiply(blue), alpha]
}

pub struct ColorBlitter<'a> {
    data: &'a mut [u8],
    width: i32,
    height: i32,
    color: Pixel,
    black: bool,
}

impl<'a> ColorBlitter<'a> {
    pub fn new(data: &'a mut [u8], width: u32, height: u32, color: Pixel) -> Self {
        Self { data, width: width as i32, height: height as i32, color, black: color == [0, 0, 0, 255] }
    }

    pub fn width(&self) -> i32 {
        self.width
    }

    pub fn height(&self) -> i32 {
        self.height
    }

    fn opaque(&self) -> bool {
        self.color[3] == 255
    }

    fn span(&mut self, x: i32, y: i32, length: i32) -> Option<(&mut [u8], i32)> {
        if y < 0 || y >= self.height || length <= 0 {
            return None;
        }
        let start = x.max(0);
        let end = (x + length).min(self.width);
        if start >= end {
            return None;
        }
        let offset = (y as usize * self.width as usize + start as usize) * 4;
        Some((&mut self.data[offset..offset + (end - start) as usize * 4], start - x))
    }

    pub fn blit_h(&mut self, x: i32, y: i32, width: i32) {
        let color = self.color;
        if let Some((row, _)) = self.span(x, y, width) {
            color_row(row, color);
        }
    }

    pub fn blit_rect(&mut self, x: i32, y: i32, width: i32, height: i32) {
        if self.color[3] == 0 {
            return;
        }
        for row in y..y + height {
            self.blit_h(x, row, width);
        }
    }

    pub fn blit_v(&mut self, x: i32, y: i32, height: i32, alpha: u8) {
        if alpha == 0 || self.color[3] == 0 {
            return;
        }
        let color = if alpha == 255 { self.color } else { alpha_mul(self.color, u32::from(alpha) + 1) };
        for row in y..y + height {
            if let Some((pixel, _)) = self.span(x, row, 1) {
                color_over(pixel, color);
            }
        }
    }

    pub fn blit_anti_h(&mut self, x: i32, y: i32, alphas: &[u8]) {
        let (color, opaque, black) = (self.color, self.opaque(), self.black);
        if color[3] == 0 {
            return;
        }
        let Some((row, skipped)) = self.span(x, y, alphas.len() as i32) else {
            return;
        };
        for (pixel, alpha) in row.as_chunks_mut::<4>().0.iter_mut().zip(&alphas[skipped as usize..]) {
            let alpha = *alpha;
            if alpha == 0 {
                continue;
            }
            if black {
                if alpha == 255 {
                    pixel.copy_from_slice(&color);
                } else {
                    color_over(pixel, [0, 0, 0, alpha]);
                }
            } else if opaque && alpha == 255 {
                pixel.copy_from_slice(&color);
            } else {
                color_row(pixel, alpha_mul(color, u32::from(alpha) + 1));
            }
        }
    }

    pub fn blit_anti_h2(&mut self, x: i32, y: i32, first: u8, second: u8) {
        let (color, opaque, black) = (self.color, self.opaque(), self.black);
        for (offset, alpha) in [(0, first), (1, second)] {
            let Some((pixel, _)) = self.span(x + offset, y, 1) else {
                continue;
            };
            if black {
                color_over(pixel, [0, 0, 0, alpha]);
            } else if opaque {
                interpolate(color, pixel, alpha);
            } else {
                blend(color, pixel, alpha);
            }
        }
    }

    pub fn blit_anti_rect(&mut self, x: i32, y: i32, width: i32, height: i32, left_alpha: u8, right_alpha: u8) {
        if left_alpha > 0 {
            self.blit_v(x, y, height, left_alpha);
        }
        let mut x = x + 1;
        if width > 0 {
            self.blit_rect(x, y, width, height);
            x += width;
        }
        if right_alpha > 0 {
            self.blit_v(x, y, height, right_alpha);
        }
    }

    pub fn blit_mask_row(&mut self, x: i32, y: i32, mask: &[u8]) {
        let (color, opaque, black) = (self.color, self.opaque(), self.black);
        let Some((row, skipped)) = self.span(x, y, mask.len() as i32) else {
            return;
        };
        for (pixel, coverage) in row.as_chunks_mut::<4>().0.iter_mut().zip(&mask[skipped as usize..]) {
            let coverage = *coverage;
            let inverse = 255 - coverage;
            if black {
                for channel in pixel.iter_mut() {
                    *channel = approximate_scale(*channel, inverse) as u8;
                }
                pixel[3] = pixel[3].wrapping_add(coverage);
            } else if opaque {
                for channel in 0..4 {
                    pixel[channel] = (approximate_scale(color[channel], coverage) + approximate_scale(pixel[channel], inverse)) as u8;
                }
            } else {
                let left = color.map(|channel| approximate_scale(channel, coverage) as u8);
                let remaining = 255 - left[3];
                for channel in 0..4 {
                    pixel[channel] = (u32::from(left[channel]) + approximate_scale(pixel[channel], remaining)) as u8;
                }
            }
        }
    }
}

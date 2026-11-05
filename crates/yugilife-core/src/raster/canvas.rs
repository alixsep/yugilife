use tiny_skia::{FillRule, FilterQuality, Mask, PathBuilder, Pixmap, PixmapPaint, Rect, Transform};

use crate::model::Region;
use crate::raster::aaa::{self, DevicePath, Point, Verb, fill_path};
use crate::raster::blit::{ColorBlitter, premultiply_color};
use crate::raster::decode::Decoded;
use crate::raster::image::{RasterImage, draw_image, source_over_pixel};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
}

impl Bounds {
    pub fn empty() -> Self {
        Self { left: u32::MAX, top: u32::MAX, right: 0, bottom: 0 }
    }

    pub fn full(width: u32, height: u32) -> Self {
        Self { left: 0, top: 0, right: width, bottom: height }
    }

    pub fn is_empty(&self) -> bool {
        self.left >= self.right || self.top >= self.bottom
    }

    pub fn include(&mut self, other: Bounds) {
        if other.is_empty() {
            return;
        }
        self.left = self.left.min(other.left);
        self.top = self.top.min(other.top);
        self.right = self.right.max(other.right);
        self.bottom = self.bottom.max(other.bottom);
    }

    pub fn from_rect(x: f64, y: f64, width: f64, height: f64, limit_width: u32, limit_height: u32) -> Self {
        let left = x.floor().max(0.0);
        let top = y.floor().max(0.0);
        let right = (x + width).ceil().min(f64::from(limit_width));
        let bottom = (y + height).ceil().min(f64::from(limit_height));
        if right <= left || bottom <= top {
            return Self::empty();
        }
        Self { left: left as u32, top: top as u32, right: right as u32, bottom: bottom as u32 }
    }

    pub fn intersect(&self, other: Bounds) -> Bounds {
        let result = Bounds {
            left: self.left.max(other.left),
            top: self.top.max(other.top),
            right: self.right.min(other.right),
            bottom: self.bottom.min(other.bottom),
        };
        if result.is_empty() { Bounds::empty() } else { result }
    }
}

pub struct Surface {
    pub pixmap: Pixmap,
    pub dirty: Bounds,
}

impl Surface {
    pub fn new(width: u32, height: u32) -> Option<Self> {
        Some(Self { pixmap: Pixmap::new(width, height)?, dirty: Bounds::empty() })
    }

    pub fn width(&self) -> u32 {
        self.pixmap.width()
    }

    pub fn height(&self) -> u32 {
        self.pixmap.height()
    }

    pub fn clear(&mut self) {
        if self.dirty.is_empty() {
            return;
        }
        let width = self.pixmap.width() as usize;
        let data = self.pixmap.data_mut();
        for row in self.dirty.top..self.dirty.bottom {
            let start = (row as usize * width + self.dirty.left as usize) * 4;
            let end = (row as usize * width + self.dirty.right as usize) * 4;
            data[start..end].fill(0);
        }
        self.dirty = Bounds::empty();
    }

    pub fn mark(&mut self, x: f64, y: f64, width: f64, height: f64) {
        let bounds = Bounds::from_rect(x, y, width, height, self.width(), self.height());
        self.dirty.include(bounds);
    }

    pub fn draw_decoded(&mut self, image: &Decoded, x: f64, y: f64, width: f64, height: f64, clip: Option<&Region>) {
        match image {
            Decoded::Raster(source) => self.draw_image(source, x, y, width, height, clip),
            Decoded::Vector(tree)
                if clip.is_none() && crate::raster::vector::render_simple_svg(&mut self.pixmap, tree, [x, y, width, height]) =>
            {
                self.mark(x, y, width, height);
            }
            Decoded::Vector(tree) => {
                let size = tree.size();
                let transform = Transform::from_row(
                    (width / f64::from(size.width())) as f32,
                    0.0,
                    0.0,
                    (height / f64::from(size.height())) as f32,
                    x as f32,
                    y as f32,
                );
                match clip.and_then(|region| clip_mask(region, self.width(), self.height())) {
                    None => resvg::render(tree, transform, &mut self.pixmap.as_mut()),
                    Some(mask) => {
                        let Some(mut layer) = Pixmap::new(self.width(), self.height()) else {
                            return;
                        };
                        resvg::render(tree, transform, &mut layer.as_mut());
                        self.pixmap.draw_pixmap(0, 0, layer.as_ref(), &PixmapPaint::default(), Transform::identity(), Some(&mask));
                    }
                }
                self.mark(x, y, width, height);
            }
        }
    }

    pub fn draw_image(&mut self, image: &RasterImage, x: f64, y: f64, width: f64, height: f64, clip: Option<&Region>) {
        let bounds = draw_image(&mut self.pixmap, image, [x, y, width, height], clip);
        self.dirty.include(bounds);
    }

    pub fn draw_pixmap_scaled(&mut self, source: &Pixmap, width: f64, height: f64) {
        let paint = PixmapPaint { quality: FilterQuality::Bicubic, ..PixmapPaint::default() };
        let transform = Transform::from_scale((width / f64::from(source.width())) as f32, (height / f64::from(source.height())) as f32);
        self.pixmap.draw_pixmap(0, 0, source.as_ref(), &paint, transform, None);
        self.mark(0.0, 0.0, width, height);
    }

    pub fn composite_pixmap(&mut self, source: &Pixmap) {
        source_over(self.pixmap.data_mut(), source.data());
        self.dirty = Bounds::full(self.width(), self.height());
    }

    pub fn composite(&mut self, source: &Surface) {
        if source.dirty.is_empty() {
            return;
        }
        let bounds = source.dirty;
        let width = self.width() as usize;
        let source_data = source.pixmap.data();
        let destination = self.pixmap.data_mut();
        for row in bounds.top..bounds.bottom {
            let start = (row as usize * width + bounds.left as usize) * 4;
            let end = (row as usize * width + bounds.right as usize) * 4;
            source_over(&mut destination[start..end], &source_data[start..end]);
        }
        self.dirty.include(bounds);
    }

    pub fn fill_polygon(&mut self, points: &[(f64, f64)], color: tiny_skia::Color) {
        if points.is_empty() {
            return;
        }
        let device: Vec<Point> = points.iter().map(|(x, y)| Point { x: *x as f32, y: *y as f32 }).collect();
        let mut verbs = vec![Verb::Move];
        verbs.extend(std::iter::repeat_n(Verb::Line, device.len() - 1));
        verbs.push(Verb::Close);
        let bounds = device.iter().fold(
            aaa::Rect { left: f32::INFINITY, top: f32::INFINITY, right: f32::NEG_INFINITY, bottom: f32::NEG_INFINITY },
            |bounds, point| aaa::Rect {
                left: bounds.left.min(point.x),
                top: bounds.top.min(point.y),
                right: bounds.right.max(point.x),
                bottom: bounds.bottom.max(point.y),
            },
        );
        let byte = |value: f32| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        let pixel = premultiply_color(byte(color.red()), byte(color.green()), byte(color.blue()), byte(color.alpha()));
        let path = DevicePath { verbs, points: device, bounds, even_odd: false };
        let (width, height) = (self.width(), self.height());
        fill_path(&mut ColorBlitter::new(self.pixmap.data_mut(), width, height, pixel), &path);
        let bounds = path.bounds;
        self.mark(
            f64::from(bounds.left) - 1.0,
            f64::from(bounds.top) - 1.0,
            f64::from(bounds.right - bounds.left) + 2.0,
            f64::from(bounds.bottom - bounds.top) + 2.0,
        );
    }
}

pub fn source_over(destination: &mut [u8], source: &[u8]) {
    for (destination, source) in destination.as_chunks_mut::<4>().0.iter_mut().zip(source.as_chunks::<4>().0.iter()) {
        match source[3] {
            255 => destination.copy_from_slice(source),
            0 if *source == [0, 0, 0, 0] => {}
            _ => source_over_pixel(destination, [source[0], source[1], source[2], source[3]]),
        }
    }
}

pub fn clip_mask(region: &Region, width: u32, height: u32) -> Option<Mask> {
    let mut mask = Mask::new(width, height)?;
    let rect = Rect::from_xywh(region.x as f32, region.y as f32, region.width as f32, region.height as f32)?;
    let path = PathBuilder::from_rect(rect);
    mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
    Some(mask)
}

pub fn unpremultiplied(pixmap: &Pixmap) -> Vec<u8> {
    let mut pixels = pixmap.data().to_vec();
    for pixel in pixels.as_chunks_mut::<4>().0.iter_mut() {
        let alpha = pixel[3];
        if alpha == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = crate::raster::decode::unpremultiply_channel(*channel, alpha);
        }
    }
    pixels
}

use std::str::FromStr;

use tiny_skia::Pixmap;

use crate::raster::aaa::{DevicePath, Point, Rect, Verb, fill_path};
use crate::raster::blit::{ColorBlitter, Pixel, premultiply_color};
use crate::svg::SvgElement;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix {
    scale_x: f32,
    skew_x: f32,
    skew_y: f32,
    scale_y: f32,
    translate_x: f32,
    translate_y: f32,
}

impl Matrix {
    pub fn scale(scale_x: f32, scale_y: f32) -> Self {
        Self { scale_x, skew_x: 0.0, skew_y: 0.0, scale_y, translate_x: 0.0, translate_y: 0.0 }
    }

    fn is_scale_translate(&self) -> bool {
        self.skew_x == 0.0 && self.skew_y == 0.0
    }

    fn concat(&self, other: &Matrix) -> Matrix {
        if self.is_scale_translate() && other.is_scale_translate() {
            return Matrix {
                scale_x: self.scale_x * other.scale_x,
                skew_x: 0.0,
                skew_y: 0.0,
                scale_y: self.scale_y * other.scale_y,
                translate_x: self.scale_x * other.translate_x + self.translate_x,
                translate_y: self.scale_y * other.translate_y + self.translate_y,
            };
        }
        let combine = |a: f32, b: f32, c: f32, d: f32| (f64::from(a) * f64::from(b) + f64::from(c) * f64::from(d)) as f32;
        Matrix {
            scale_x: combine(self.scale_x, other.scale_x, self.skew_x, other.skew_y),
            skew_x: combine(self.scale_x, other.skew_x, self.skew_x, other.scale_y),
            skew_y: combine(self.skew_y, other.scale_x, self.scale_y, other.skew_y),
            scale_y: combine(self.skew_y, other.skew_x, self.scale_y, other.scale_y),
            translate_x: (f64::from(self.scale_x) * f64::from(other.translate_x)
                + f64::from(self.skew_x) * f64::from(other.translate_y)
                + f64::from(self.translate_x)) as f32,
            translate_y: (f64::from(self.skew_y) * f64::from(other.translate_x)
                + f64::from(self.scale_y) * f64::from(other.translate_y)
                + f64::from(self.translate_y)) as f32,
        }
    }

    fn map(&self, point: Point) -> Point {
        if self.is_scale_translate() {
            return Point { x: point.x * self.scale_x + self.translate_x, y: point.y * self.scale_y + self.translate_y };
        }
        Point {
            x: point.x * self.scale_x + (point.y * self.skew_x + self.translate_x),
            y: point.x * self.skew_y + (point.y * self.scale_y + self.translate_y),
        }
    }

    fn map_rect(&self, rect: Rect) -> Rect {
        let first = self.map(Point { x: rect.left, y: rect.top });
        let second = self.map(Point { x: rect.right, y: rect.bottom });
        Rect { left: first.x.min(second.x), top: first.y.min(second.y), right: first.x.max(second.x), bottom: first.y.max(second.y) }
    }
}

fn attribute(element: &SvgElement, name: &str) -> Option<String> {
    element.attribute(name).map(|value| value.to_js_string())
}

fn number(element: &SvgElement, name: &str) -> f32 {
    attribute(element, name).and_then(|value| value.trim().parse::<f32>().ok()).unwrap_or(0.0)
}

fn element_transform(element: &SvgElement) -> Option<Matrix> {
    let Some(value) = attribute(element, "transform") else {
        return Some(Matrix::scale(1.0, 1.0));
    };
    let transform = svgtypes::Transform::from_str(&value).ok()?;
    Some(Matrix {
        scale_x: transform.a as f32,
        skew_y: transform.b as f32,
        skew_x: transform.c as f32,
        scale_y: transform.d as f32,
        translate_x: transform.e as f32,
        translate_y: transform.f as f32,
    })
}

fn fill_color(element: &SvgElement, opacity: u8) -> Option<Option<Pixel>> {
    let Some(value) = attribute(element, "fill") else {
        return Some(Some(premultiply_color(0, 0, 0, opacity)));
    };
    if value.trim() == "none" {
        return Some(None);
    }
    let color = svgtypes::Color::from_str(value.trim()).ok()?;
    let alpha = ((f32::from(color.alpha) / 255.0 * f32::from(opacity) / 255.0) * 255.0 + 0.5) as u8;
    Some(Some(premultiply_color(color.red, color.green, color.blue, alpha)))
}

fn opacity_alpha(element: &SvgElement) -> Option<u8> {
    let opacity: f32 = attribute(element, "opacity")?.trim().parse().ok()?;
    Some((opacity.clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8)
}

const SUPPORTED: &[(&str, &[&str])] = &[
    ("g", &["transform", "opacity"]),
    ("path", &["d", "fill", "transform", "opacity", "fill-rule"]),
    ("rect", &["x", "y", "width", "height", "fill", "transform", "opacity"]),
];

pub fn is_supported(element: &SvgElement) -> bool {
    let Some((_, allowed)) = SUPPORTED.iter().find(|(tag, _)| *tag == element.tag) else {
        return false;
    };
    element.attributes.iter().all(|(name, _)| allowed.contains(&name.as_str())) && element.children.iter().all(is_supported)
}

fn source_path(data: &str) -> Option<(Vec<Verb>, Vec<Point>)> {
    let mut verbs = Vec::new();
    let mut points = Vec::new();
    let point = |x: f64, y: f64| Point { x: x as f32, y: y as f32 };
    for segment in svgtypes::SimplifyingPathParser::from(data) {
        match segment.ok()? {
            svgtypes::SimplePathSegment::MoveTo { x, y } => {
                verbs.push(Verb::Move);
                points.push(point(x, y));
            }
            svgtypes::SimplePathSegment::LineTo { x, y } => {
                verbs.push(Verb::Line);
                points.push(point(x, y));
            }
            svgtypes::SimplePathSegment::Quadratic { x1, y1, x, y } => {
                verbs.push(Verb::Quad);
                points.extend([point(x1, y1), point(x, y)]);
            }
            svgtypes::SimplePathSegment::CurveTo { x1, y1, x2, y2, x, y } => {
                verbs.push(Verb::Cubic);
                points.extend([point(x1, y1), point(x2, y2), point(x, y)]);
            }
            svgtypes::SimplePathSegment::ClosePath => verbs.push(Verb::Close),
        }
    }
    Some((verbs, points))
}

fn points_bounds(points: &[Point]) -> Rect {
    points.iter().fold(
        Rect { left: f32::INFINITY, top: f32::INFINITY, right: f32::NEG_INFINITY, bottom: f32::NEG_INFINITY },
        |bounds, point| Rect {
            left: bounds.left.min(point.x),
            top: bounds.top.min(point.y),
            right: bounds.right.max(point.x),
            bottom: bounds.bottom.max(point.y),
        },
    )
}

fn device_path(verbs: Vec<Verb>, points: &[Point], matrix: &Matrix, even_odd: bool) -> DevicePath {
    let device: Vec<Point> = points.iter().map(|point| matrix.map(*point)).collect();
    let bounds = if matrix.is_scale_translate() { matrix.map_rect(points_bounds(points)) } else { points_bounds(&device) };
    DevicePath { verbs, points: device, bounds, even_odd }
}

fn fill_rect(blitter: &mut ColorBlitter, rect: Rect) {
    let dot8 = |value: f32| ((f64::from(value) * 65536.0) as i32 + 0x80) >> 8;
    let (left, top, right, bottom) = (dot8(rect.left), dot8(rect.top), dot8(rect.right), dot8(rect.bottom));
    if left >= right || top >= bottom {
        return;
    }
    let mut top_row = top >> 8;
    if top_row == (bottom - 1) >> 8 {
        scanline(blitter, left, top_row, right, (bottom - top - 1) as u32);
        return;
    }
    if top & 0xFF != 0 {
        scanline(blitter, left, top_row, right, (256 - (top & 0xFF)) as u32);
        top_row += 1;
    }
    let bottom_row = bottom >> 8;
    let height = bottom_row - top_row;
    if height > 0 {
        let mut column = left >> 8;
        if column == (right - 1) >> 8 {
            blitter.blit_v(column, top_row, height, (right - left - 1) as u8);
        } else {
            if left & 0xFF != 0 {
                blitter.blit_v(column, top_row, height, (256 - (left & 0xFF)) as u8);
                column += 1;
            }
            let right_column = right >> 8;
            if right_column > column {
                blitter.blit_rect(column, top_row, right_column - column, height);
            }
            if right & 0xFF != 0 {
                blitter.blit_v(right_column, top_row, height, (right & 0xFF) as u8);
            }
        }
    }
    if bottom & 0xFF != 0 {
        scanline(blitter, left, bottom_row, right, (bottom & 0xFF) as u32);
    }
}

fn scanline(blitter: &mut ColorBlitter, left: i32, y: i32, right: i32, alpha: u32) {
    if left >> 8 == (right - 1) >> 8 {
        blitter.blit_v(left >> 8, y, 1, ((alpha * (right - left) as u32) >> 8) as u8);
        return;
    }
    let mut column = left >> 8;
    if left & 0xFF != 0 {
        blitter.blit_v(column, y, 1, ((alpha * (256 - (left & 0xFF)) as u32) >> 8) as u8);
        column += 1;
    }
    let right_column = right >> 8;
    if right_column > column {
        blitter.blit_anti_h(column, y, &vec![alpha.min(255) as u8; (right_column - column) as usize]);
    }
    if right & 0xFF != 0 {
        blitter.blit_v(right_column, y, 1, ((alpha * (right & 0xFF) as u32) >> 8) as u8);
    }
}

fn draw_shape(pixmap: &mut Pixmap, element: &SvgElement, matrix: &Matrix, opacity: u8) {
    let Some(Some(color)) = fill_color(element, opacity) else {
        return;
    };
    let (width, height) = (pixmap.width(), pixmap.height());
    let mut blitter = ColorBlitter::new(pixmap.data_mut(), width, height, color);
    if element.tag == "rect" {
        let (x, y) = (number(element, "x"), number(element, "y"));
        let rect = Rect { left: x, top: y, right: x + number(element, "width"), bottom: y + number(element, "height") };
        if matrix.is_scale_translate() {
            fill_rect(&mut blitter, matrix.map_rect(rect));
            return;
        }
        let corners = [(rect.left, rect.top), (rect.right, rect.top), (rect.right, rect.bottom), (rect.left, rect.bottom)];
        let points: Vec<Point> = corners.iter().map(|(x, y)| Point { x: *x, y: *y }).collect();
        let verbs = vec![Verb::Move, Verb::Line, Verb::Line, Verb::Line, Verb::Close];
        fill_path(&mut blitter, &device_path(verbs, &points, matrix, false));
        return;
    }
    let Some(data) = attribute(element, "d") else {
        return;
    };
    let Some((verbs, points)) = source_path(&data) else {
        return;
    };
    if points.is_empty() {
        return;
    }
    let even_odd = attribute(element, "fill-rule").is_some_and(|rule| rule.trim() == "evenodd");
    fill_path(&mut blitter, &device_path(verbs, &points, matrix, even_odd));
}

fn composite_layer(pixmap: &mut Pixmap, layer: &Pixmap, alpha: u8) {
    for (destination, source) in pixmap.data_mut().as_chunks_mut::<4>().0.iter_mut().zip(layer.data().as_chunks::<4>().0.iter()) {
        if *source == [0, 0, 0, 0] {
            continue;
        }
        let source_scale = u32::from(alpha) + 1;
        let product = 0xFFFF - u32::from(source[3]) * source_scale;
        let destination_scale = (product + (product >> 8)) >> 8;
        for channel in 0..4 {
            destination[channel] =
                ((u32::from(source[channel]) * source_scale + u32::from(destination[channel]) * destination_scale) >> 8) as u8;
        }
    }
}

fn draw_element(pixmap: &mut Pixmap, element: &SvgElement, parent: &Matrix) {
    let Some(transform) = element_transform(element) else {
        return;
    };
    let matrix = parent.concat(&transform);
    let opacity = opacity_alpha(element).filter(|alpha| *alpha < 255);
    if let (Some(alpha), false) = (opacity, element.tag == "g") {
        draw_shape(pixmap, element, &matrix, alpha);
        return;
    }
    if let Some(alpha) = opacity {
        let Some(mut layer) = Pixmap::new(pixmap.width(), pixmap.height()) else {
            return;
        };
        draw_contents(&mut layer, element, &matrix);
        composite_layer(pixmap, &layer, alpha);
        return;
    }
    draw_contents(pixmap, element, &matrix);
}

fn draw_contents(pixmap: &mut Pixmap, element: &SvgElement, matrix: &Matrix) {
    if element.tag == "g" {
        for child in &element.children {
            draw_element(pixmap, child, matrix);
        }
    } else {
        draw_shape(pixmap, element, matrix, 255);
    }
}

pub fn render_elements(pixmap: &mut Pixmap, elements: &[SvgElement], matrix: &Matrix) {
    for element in elements {
        draw_element(pixmap, element, matrix);
    }
}

enum AssetPaint {
    Solid(Pixel),
    Gradient(Gradient),
}

struct Gradient {
    start: (f32, f32),
    end: (f32, f32),
    offsets: Vec<f32>,
    colors: Vec<[f32; 4]>,
}

struct AssetShape {
    rect: Rect,
    paint: AssetPaint,
}

fn usvg_rect(path: &resvg::usvg::Path) -> Option<Rect> {
    let data = path.data();
    let bounds = data.bounds();
    let points = data.points();
    let on_corner = |point: &resvg::tiny_skia::Point| {
        (point.x == bounds.left() || point.x == bounds.right()) && (point.y == bounds.top() || point.y == bounds.bottom())
    };
    if !(4..=5).contains(&points.len()) || !points.iter().all(on_corner) {
        return None;
    }
    let transform = path.abs_transform();
    if transform.kx != 0.0 || transform.ky != 0.0 {
        return None;
    }
    let map = |x: f32, y: f32| (x * transform.sx + transform.tx, y * transform.sy + transform.ty);
    let (left, top) = map(bounds.left(), bounds.top());
    let (right, bottom) = map(bounds.right(), bounds.bottom());
    Some(Rect { left: left.min(right), top: top.min(bottom), right: left.max(right), bottom: top.max(bottom) })
}

fn gradient_paint(gradient: &resvg::usvg::LinearGradient, path: &resvg::usvg::Path, opacity: f32) -> Option<Gradient> {
    if gradient.spread_method() != resvg::usvg::SpreadMethod::Pad {
        return None;
    }
    let transform = path.abs_transform().pre_concat(gradient.transform());
    if transform.kx != 0.0 || transform.ky != 0.0 {
        return None;
    }
    let map = |x: f32, y: f32| (x * transform.sx + transform.tx, y * transform.sy + transform.ty);
    let mut offsets: Vec<f32> = gradient.stops().iter().map(|stop| stop.offset().get()).collect();
    let mut colors: Vec<[f32; 4]> = gradient
        .stops()
        .iter()
        .map(|stop| {
            let color = stop.color();
            let channel = |value: u8| f32::from(value) / 255.0;
            [channel(color.red), channel(color.green), channel(color.blue), stop.opacity().get() * opacity]
        })
        .collect();
    let (first, last) = (*offsets.first()?, *offsets.last()?);
    if first != 0.0 {
        offsets.insert(0, 0.0);
        colors.insert(0, colors[0]);
    }
    if last != 1.0 {
        offsets.push(1.0);
        colors.push(*colors.last()?);
    }
    Some(Gradient { start: map(gradient.x1(), gradient.y1()), end: map(gradient.x2(), gradient.y2()), offsets, colors })
}

fn asset_shapes(tree: &resvg::usvg::Tree) -> Option<Vec<AssetShape>> {
    let root = tree.root();
    if root.opacity().get() != 1.0 || root.clip_path().is_some() || root.mask().is_some() || !root.filters().is_empty() {
        return None;
    }
    let mut shapes = Vec::new();
    for node in root.children() {
        let resvg::usvg::Node::Path(path) = node else {
            return None;
        };
        if !path.is_visible() || path.stroke().is_some() {
            return None;
        }
        let Some(fill) = path.fill() else {
            continue;
        };
        let rect = usvg_rect(path)?;
        let opacity = fill.opacity().get();
        let paint = match fill.paint() {
            resvg::usvg::Paint::Color(color) => {
                let alpha = (opacity.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                AssetPaint::Solid(premultiply_color(color.red, color.green, color.blue, alpha))
            }
            resvg::usvg::Paint::LinearGradient(gradient) => AssetPaint::Gradient(gradient_paint(gradient, path, opacity)?),
            _ => return None,
        };
        shapes.push(AssetShape { rect, paint });
    }
    Some(shapes)
}

fn dither(x: u32, y: u32) -> f32 {
    let y = y ^ x;
    let value = ((y & 1) << 5) | ((x & 1) << 4) | ((y & 2) << 2) | ((x & 2) << 1) | ((y & 4) >> 1) | ((x & 4) >> 2);
    (value as f32).mul_add(2.0 / 128.0, -63.0 / 128.0)
}

fn gradient_color(gradient: &Gradient, t: f32) -> [f32; 4] {
    let (offsets, colors) = (&gradient.offsets, &gradient.colors);
    if offsets.len() == 2 {
        let t = t.clamp(0.0, 1.0);
        return std::array::from_fn(|channel| t.mul_add(colors[1][channel] - colors[0][channel], colors[0][channel]));
    }
    let interval = offsets[1..offsets.len() - 1].iter().filter(|offset| t >= **offset).count();
    if t < offsets[1] {
        return colors[0];
    }
    if interval + 1 >= offsets.len() - 1 && t >= offsets[offsets.len() - 1] {
        return colors[colors.len() - 1];
    }
    let (left, right) = (offsets[interval], offsets[interval + 1]);
    let (from, to) = (colors[interval], colors[interval + 1]);
    std::array::from_fn(|channel| {
        let scale = (to[channel] - from[channel]) / (right - left);
        let bias = from[channel] - scale * left;
        t.mul_add(scale, bias)
    })
}

fn fill_gradient_rect(pixmap: &mut Pixmap, rect: Rect, gradient: &Gradient) -> bool {
    if [rect.left, rect.top, rect.right, rect.bottom].iter().any(|value| value.fract() != 0.0) {
        return false;
    }
    let (dx, dy) = (gradient.end.0 - gradient.start.0, gradient.end.1 - gradient.start.1);
    let length = dx * dx + dy * dy;
    if length == 0.0 {
        return false;
    }
    let (m0, m2) = (dx / length, dy / length);
    let m4 = -(gradient.start.0 * dx + gradient.start.1 * dy) / length;
    let width = pixmap.width() as i32;
    let (left, top) = ((rect.left as i32).max(0), (rect.top as i32).max(0));
    let (right, bottom) = ((rect.right as i32).min(width), (rect.bottom as i32).min(pixmap.height() as i32));
    let data = pixmap.data_mut();
    for y in top..bottom {
        for x in left..right {
            let t = (x as f32 + 0.5).mul_add(m0, (y as f32 + 0.5).mul_add(m2, m4));
            let color = gradient_color(gradient, t);
            let alpha = color[3].clamp(0.0, 1.0);
            let offset = dither(x as u32, y as u32);
            let mut pixel = [0u8; 4];
            for channel in 0..3 {
                let value = offset.mul_add(1.0 / 255.0, color[channel] * alpha);
                pixel[channel] = (value.clamp(0.0, 1.0) * 255.0).round_ties_even() as u8;
            }
            pixel[3] = (alpha * 255.0).round_ties_even() as u8;
            let index = ((y * width + x) * 4) as usize;
            crate::raster::image::source_over_pixel(&mut data[index..index + 4], pixel);
        }
    }
    true
}

pub fn render_simple_svg(pixmap: &mut Pixmap, tree: &resvg::usvg::Tree, rect: [f64; 4]) -> bool {
    let size = tree.size();
    if rect != [0.0, 0.0, f64::from(size.width()), f64::from(size.height())] {
        return false;
    }
    let Some(shapes) = asset_shapes(tree) else {
        return false;
    };
    let Some(mut layer) = Pixmap::new(pixmap.width(), pixmap.height()) else {
        return false;
    };
    for shape in &shapes {
        match &shape.paint {
            AssetPaint::Solid(color) => {
                let (width, height) = (layer.width(), layer.height());
                fill_rect(&mut ColorBlitter::new(layer.data_mut(), width, height, *color), shape.rect);
            }
            AssetPaint::Gradient(gradient) => {
                if !fill_gradient_rect(&mut layer, shape.rect, gradient) {
                    return false;
                }
            }
        }
    }
    crate::raster::canvas::source_over(pixmap.data_mut(), layer.data());
    true
}

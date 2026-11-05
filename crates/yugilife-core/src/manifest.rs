use std::sync::Arc;

use base64::Engine;

use crate::error::Result;
use crate::export::encode_png;
use crate::model::Region;
use crate::number::js_round;
use crate::svg::SvgElement;

#[derive(Debug, Clone)]
pub enum CaptureContent {
    Image(Arc<Vec<u8>>),
    Svg(Vec<SvgElement>),
}

#[derive(Debug, Clone)]
pub struct Capture {
    pub layer_id: String,
    pub order: usize,
    pub source_fields: Vec<String>,
    pub content: CaptureContent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementKind {
    Image,
    Svg,
}

#[derive(Debug, Clone)]
pub struct AlphaChannel {
    alpha: Arc<Vec<u8>>,
    kind: ElementKind,
    width: u32,
    height: u32,
    outlined: Arc<Vec<SvgElement>>,
    visibility: Option<Arc<Vec<u8>>>,
}

impl AlphaChannel {
    pub fn alpha_at(&self, x: f64, y: f64) -> u8 {
        let (pixel_x, pixel_y) = (x.floor(), y.floor());
        if !(pixel_x >= 0.0 && pixel_y >= 0.0 && pixel_x < f64::from(self.width) && pixel_y < f64::from(self.height)) {
            return 0;
        }
        self.alpha[pixel_y as usize * self.width as usize + pixel_x as usize]
    }

    pub fn kind(&self) -> ElementKind {
        self.kind
    }

    pub fn mime_type(&self) -> &'static str {
        match self.kind {
            ElementKind::Svg => "image/svg+xml",
            ElementKind::Image => "image/png",
        }
    }

    pub fn alpha(&self) -> &[u8] {
        &self.alpha
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        match self.kind {
            ElementKind::Image => white_alpha_png(&self.alpha, self.width, self.height),
            ElementKind::Svg => Ok(self.vector_svg()?.into_bytes()),
        }
    }

    fn vector_svg(&self) -> Result<String> {
        let (width, height) = (self.width, self.height);
        let mut source = String::new();
        for element in self.outlined.iter() {
            element.serialize_into(&mut source);
        }
        let visibility = match &self.visibility {
            Some(visible) => Some(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(white_alpha_png(visible, width, height)?)
            )),
            None => None,
        };
        let mut output = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        output.push_str(&format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\">"
        ));
        output.push_str("<defs><mask id=\"source\" mask-type=\"alpha\" style=\"mask-type:alpha\">");
        output.push_str(&source);
        output.push_str("</mask>");
        if let Some(url) = &visibility {
            output.push_str("<mask id=\"visible\" mask-type=\"alpha\" style=\"mask-type:alpha\">");
            output.push_str(&format!("<image href=\"{url}\" x=\"0\" y=\"0\" width=\"{width}\" height=\"{height}\"/>"));
            output.push_str("</mask>");
        }
        output.push_str("</defs>");
        output.push_str(if visibility.is_some() { "<g mask=\"url(#visible)\">" } else { "<g>" });
        output.push_str(&format!("<rect width=\"{width}\" height=\"{height}\" fill=\"#fff\" mask=\"url(#source)\"/>"));
        output.push_str("</g></svg>");
        Ok(output)
    }
}

fn white_alpha_png(alpha: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let pixels: Vec<u8> = alpha.iter().flat_map(|alpha| if *alpha == 0 { [0, 0, 0, 0] } else { [255, 255, 255, *alpha] }).collect();
    encode_png(&pixels, width, height)
}

#[derive(Debug, Clone)]
pub struct ManifestEntry {
    pub absolute_alpha: AlphaChannel,
    pub absolute_bounds: Option<Region>,
    pub alpha: AlphaChannel,
    pub bounds: Option<Region>,
    pub layer_id: String,
    pub order: usize,
    pub source_fields: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RenderManifest {
    pub elements: Vec<ManifestEntry>,
}

fn alpha_bounds(alpha: &[u8], width: u32, height: u32) -> Option<Region> {
    let (mut minimum_x, mut minimum_y, mut maximum_x, mut maximum_y) = (width as i64, height as i64, -1_i64, -1_i64);
    for y in 0..height as i64 {
        let row = &alpha[(y * width as i64) as usize..((y + 1) * width as i64) as usize];
        let Some(first) = row.iter().position(|value| *value != 0) else {
            continue;
        };
        let last = row.iter().rposition(|value| *value != 0).unwrap_or(first);
        minimum_x = minimum_x.min(first as i64);
        maximum_x = maximum_x.max(last as i64);
        minimum_y = minimum_y.min(y);
        maximum_y = maximum_y.max(y);
    }
    (maximum_x >= minimum_x && maximum_y >= minimum_y).then(|| Region {
        x: minimum_x as f64,
        y: minimum_y as f64,
        width: (maximum_x - minimum_x + 1) as f64,
        height: (maximum_y - minimum_y + 1) as f64,
    })
}

pub struct PreparedCoverage {
    pub capture: Capture,
    pub alpha: Arc<Vec<u8>>,
    pub outlined: Arc<Vec<SvgElement>>,
}

pub fn build_manifest(prepared: Vec<PreparedCoverage>, width: u32, height: u32) -> RenderManifest {
    let pixel_count = width as usize * height as usize;
    let mut occlusion = vec![0u8; pixel_count];
    let mut entries = Vec::with_capacity(prepared.len());
    for element in prepared.into_iter().rev() {
        let mut visible = vec![0u8; pixel_count];
        let mut unoccluded = vec![0u8; pixel_count];
        for pixel in 0..pixel_count {
            let source = f64::from(element.alpha[pixel]);
            let above = f64::from(occlusion[pixel]);
            let remaining = 255.0 - above;
            unoccluded[pixel] = remaining as u8;
            visible[pixel] = js_round(source * remaining / 255.0) as u8;
            occlusion[pixel] = js_round(source + above * (255.0 - source) / 255.0) as u8;
        }
        let kind = match element.capture.content {
            CaptureContent::Image(_) => ElementKind::Image,
            CaptureContent::Svg(_) => ElementKind::Svg,
        };
        let channel = |alpha: Arc<Vec<u8>>, visibility: Option<Arc<Vec<u8>>>| AlphaChannel {
            alpha,
            kind,
            width,
            height,
            outlined: element.outlined.clone(),
            visibility,
        };
        entries.push(ManifestEntry {
            absolute_bounds: alpha_bounds(&element.alpha, width, height),
            bounds: alpha_bounds(&visible, width, height),
            absolute_alpha: channel(element.alpha.clone(), None),
            alpha: channel(Arc::new(visible), Some(Arc::new(unoccluded))),
            layer_id: element.capture.layer_id,
            order: element.capture.order,
            source_fields: element.capture.source_fields,
        });
    }
    entries.reverse();
    RenderManifest { elements: entries }
}

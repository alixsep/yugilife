use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::Value;
use tiny_skia::Pixmap;

use crate::assets::{AssetIdentity, AssetSource};
use crate::bundle::{MaskKey, TemplateBundle, TextureKey};
use crate::card::{CardData, CardValue};
use crate::error::{Error, Result};
use crate::manifest::{Capture, CaptureContent, PreparedCoverage, RenderManifest, build_manifest};
use crate::model::{ArtworkLayer, CardTemplate, Layer, LayerBody, RasterLayer, Region, is_layer_visible, walk_layers};
use crate::presentation::{ArtworkTransform, ResolvedCardPresentation, ResolvedLayerMask, resolve_card_presentation};
use crate::raster::canvas::Surface;
use crate::raster::decode::{Decoded, SharedDecoded, decode_source};
use crate::raster::grading::apply_color_preset;
use crate::raster::image::RasterImage;
use crate::raster::masks::{alpha_plane, apply_alpha_mask, destination_in, luminance_to_alpha, prepare_mask, scope_mask};
use crate::rich_text::RichTextWarning;
use crate::semantics::derive_card_semantics;
use crate::source_fields::SourceFieldResolver;
use crate::svg::SvgElement;
use crate::text::fonts::SharedFont;
use crate::text::layout::{TextLayoutRequest, create_text_element};
use crate::text::measure::{FontBook, Measurer};
use crate::text::outline::{MissingGlyph, missing_glyphs};
use crate::validation::{Record, merge_text_typography, validate_card_data, validate_rendered_svg_element};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererOutput {
    Container,
    Raster,
    Vector,
}

pub struct LayerTarget<'a> {
    pub surface: &'a mut Surface,
    pub vectors: &'a mut Vec<SvgElement>,
    pub card: &'a CardData,
    pub presentation: &'a ResolvedCardPresentation,
}

pub trait LayerRenderer: Send + Sync {
    fn output(&self) -> RendererOutput;
    fn render(&self, target: &mut LayerTarget, layer: &Layer) -> Result<bool>;
}

#[derive(Default)]
pub struct RenderOptions<'a> {
    pub assets: IndexMap<String, AssetSource>,
    pub layers: IndexMap<String, bool>,
    pub preset_overrides: IndexMap<String, String>,
    pub presentation_overrides: Option<&'a Value>,
    pub layer_renderers: IndexMap<String, Arc<dyn LayerRenderer>>,
    pub cancel: Option<&'a AtomicBool>,
    /// Keeps decoded card assets from one render to the next.
    pub decoded_assets: Option<&'a DecodedAssetCache>,
}

/// Decoded card assets kept across renders, for hosts such as an editor that re-render a card many
/// times while its artwork stays the same: the host passes the same `AssetSource` values each time
/// and decoding happens once. Each entry holds its source, so the identity it is keyed by cannot be
/// reused by another asset. After every render the cache keeps only the entries that render used.
#[derive(Default)]
pub struct DecodedAssetCache {
    entries: Mutex<HashMap<AssetIdentity, (AssetSource, SharedDecoded)>>,
}

impl DecodedAssetCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.lock().map_or(0, |entries| entries.len())
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }

    pub fn contains(&self, source: &AssetSource) -> bool {
        self.entries.lock().is_ok_and(|entries| entries.contains_key(&source.identity()))
    }

    /// Supplies a source's decoded form, so a render that uses the source does not decode it.
    pub fn provide(&self, source: &AssetSource, decoded: SharedDecoded) {
        self.insert(source.identity(), source, decoded);
    }

    fn get(&self, identity: &AssetIdentity) -> Option<SharedDecoded> {
        self.entries.lock().ok()?.get(identity).map(|(_, decoded)| decoded.clone())
    }

    fn insert(&self, identity: AssetIdentity, source: &AssetSource, decoded: SharedDecoded) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(identity, (source.clone(), decoded));
        }
    }

    fn retain_used(&self, used: &HashMap<AssetIdentity, SharedDecoded>) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|identity, _| used.contains_key(identity));
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RenderWarning {
    pub kind: RenderWarningKind,
    pub layer_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RenderWarningKind {
    RichText(RichTextWarning),
    MissingGlyph(MissingGlyph),
}

impl RenderWarning {
    pub fn code(&self) -> &'static str {
        match &self.kind {
            RenderWarningKind::RichText(warning) => warning.code.as_str(),
            RenderWarningKind::MissingGlyph(_) => "missing-glyph",
        }
    }

    pub fn message(&self) -> String {
        match &self.kind {
            RenderWarningKind::RichText(warning) => warning.message.clone(),
            RenderWarningKind::MissingGlyph(missing) => format!(
                "Font \"{}\" has no glyph for {} (U+{:04X}), so it is drawn as the font's missing-glyph placeholder.",
                missing.font_family,
                serde_json::to_string(&missing.character.to_string()).unwrap_or_default(),
                missing.character as u32
            ),
        }
    }

    /// The warning as the CLI, the WebAssembly module and the JavaScript package report it.
    pub fn to_json(&self) -> Value {
        match &self.kind {
            RenderWarningKind::RichText(warning) => serde_json::json!({
                "code": self.code(),
                "layerId": self.layer_id,
                "length": warning.length,
                "message": warning.message,
                "offset": warning.offset,
            }),
            RenderWarningKind::MissingGlyph(missing) => serde_json::json!({
                "character": missing.character.to_string(),
                "code": self.code(),
                "fontFamily": missing.font_family,
                "layerId": self.layer_id,
                "message": self.message(),
            }),
        }
    }
}

#[derive(Clone)]
pub enum RenderSegment {
    Raster(Arc<Pixmap>),
    Vector(Vec<SvgElement>),
}

pub struct RenderedCard<'a> {
    pub bundle: &'a TemplateBundle,
    pub segments: Vec<RenderSegment>,
    pub vector_layers: Vec<SvgElement>,
    pub warnings: Vec<RenderWarning>,
    pub presentation: ResolvedCardPresentation,
    pub fonts: FontBook,
    pub cancel: Option<&'a AtomicBool>,
}

#[derive(Clone, Copy)]
enum BuiltIn {
    Image,
    RepeatedImage,
    Artwork,
    ColorTexture,
    ColorTextureBevel,
    Bevel,
    Text,
    Svg,
    Group,
}

enum Renderer {
    BuiltIn(BuiltIn),
    Custom(Arc<dyn LayerRenderer>),
}

impl Renderer {
    fn output(&self) -> RendererOutput {
        match self {
            Self::BuiltIn(BuiltIn::Text | BuiltIn::Svg) => RendererOutput::Vector,
            Self::BuiltIn(BuiltIn::Group) => RendererOutput::Container,
            Self::BuiltIn(_) => RendererOutput::Raster,
            Self::Custom(renderer) => renderer.output(),
        }
    }
}

fn find_renderer(options: &RenderOptions, key: &str) -> Option<Renderer> {
    if let Some(custom) = options.layer_renderers.get(key) {
        return Some(Renderer::Custom(custom.clone()));
    }
    let built_in = match key {
        "image" => BuiltIn::Image,
        "repeated-image" => BuiltIn::RepeatedImage,
        "artwork" => BuiltIn::Artwork,
        "color-texture" => BuiltIn::ColorTexture,
        "color-texture-bevel" => BuiltIn::ColorTextureBevel,
        "bevel" => BuiltIn::Bevel,
        "text" => BuiltIn::Text,
        "svg" => BuiltIn::Svg,
        "group" => BuiltIn::Group,
        _ => return None,
    };
    Some(Renderer::BuiltIn(built_in))
}

pub fn check_cancel(cancel: Option<&AtomicBool>) -> Result<()> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) { Err(Error::Aborted) } else { Ok(()) }
}

struct AssetResolver<'a> {
    bundle: &'a TemplateBundle,
    overrides: &'a IndexMap<String, AssetSource>,
    decoded: HashMap<AssetIdentity, SharedDecoded>,
    shared: Option<&'a DecodedAssetCache>,
}

impl<'a> AssetResolver<'a> {
    fn has(&self, id: &str) -> bool {
        self.overrides.contains_key(id) || self.bundle.assets.contains_key(id)
    }

    fn source(&self, id: &str) -> Result<&'a AssetSource> {
        self.overrides
            .get(id)
            .or_else(|| self.bundle.assets.get(id))
            .ok_or_else(|| Error::render(format!("Unresolved semantic asset ID \"{id}\". Supply it through RenderOptions.assets.")))
    }

    fn is_bundle_asset(&self, id: &str) -> bool {
        !self.overrides.contains_key(id) && self.bundle.assets.contains_key(id)
    }

    fn image(&mut self, id: &str) -> Result<SharedDecoded> {
        if self.is_bundle_asset(id)
            && let Some(decoded) = self.bundle.decoded_asset(id)
        {
            return decoded;
        }
        let source = self.source(id)?;
        self.decode(source)
    }

    fn decode(&mut self, source: &AssetSource) -> Result<SharedDecoded> {
        let identity = source.identity();
        if let Some(decoded) = self.decoded.get(&identity) {
            return Ok(decoded.clone());
        }
        let decoded = match self.shared.and_then(|shared| shared.get(&identity)) {
            Some(decoded) => decoded,
            None => {
                let decoded = Arc::new(decode_source(source)?);
                if let Some(shared) = self.shared {
                    shared.insert(identity.clone(), source, decoded.clone());
                }
                decoded
            }
        };
        self.decoded.insert(identity, decoded.clone());
        Ok(decoded)
    }

    fn font(&self, id: &str) -> Result<SharedFont> {
        if self.is_bundle_asset(id)
            && let Some(font) = self.bundle.font_asset(id)
        {
            return font;
        }
        crate::text::fonts::load_font(self.source(id)?, id)
    }
}

fn text_typography_font_ids(layer: &Layer) -> Vec<String> {
    let LayerBody::Text(text) = &layer.body else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    let mut add = |typography: &Record| {
        if let Some(id) = typography.get("fontAssetId").and_then(Value::as_str) {
            ids.push(id.to_owned());
        }
    };
    add(&text.typography);
    for style in &text.semantic_styles {
        if let Ok(merged) = merge_text_typography(&text.typography, &[style.typography.as_ref()]) {
            add(&merged);
        }
    }
    ids
}

fn is_raster_only(layer: &Layer, options: &RenderOptions) -> bool {
    let Some(renderer) = find_renderer(options, layer.renderer_key()) else {
        return false;
    };
    match layer.children() {
        Some(children) => !children.is_empty() && children.iter().all(|child| is_raster_only(child, options)),
        None => renderer.output() == RendererOutput::Raster,
    }
}

fn assert_layer_tree(
    template: &CardTemplate,
    options: &RenderOptions,
    assets: &AssetResolver,
    presentation: &ResolvedCardPresentation,
) -> Result<()> {
    let mut layers_by_id: HashMap<&str, &Layer> = HashMap::new();
    let mut layer_order: HashMap<&str, usize> = HashMap::new();
    let mut failure: Option<Error> = None;
    walk_layers(&template.layers, &mut |layer, _| {
        if failure.is_some() {
            return;
        }
        layers_by_id.insert(&layer.id, layer);
        let next = layer_order.len();
        layer_order.insert(&layer.id, next);
        let key = layer.renderer_key();
        let Some(renderer) = find_renderer(options, key) else {
            failure = Some(Error::render(format!(
                "Unknown layer kind or renderer \"{key}\" on layer \"{}\". Register a renderer through RenderOptions.layerRenderers.",
                layer.id
            )));
            return;
        };
        let output = renderer.output();
        let is_group = layer.kind == "group";
        if output == RendererOutput::Container && !is_group {
            failure =
                Some(Error::render(format!("Renderer \"{key}\" uses the \"container\" output plane, which is reserved for group layers.")));
            return;
        }
        if is_group && output != RendererOutput::Container {
            failure = Some(Error::render(format!("Group layer \"{}\" must use a renderer with \"container\" output.", layer.id)));
            return;
        }
        if matches!(layer.kind.as_str(), "image" | "repeated-image" | "raster")
            && let Some(asset_id) = layer.json.get("assetId").and_then(Value::as_str)
            && !assets.has(asset_id)
        {
            failure = Some(Error::render(format!("Layer \"{}\" has unresolved semantic asset ID \"{asset_id}\".", layer.id)));
            return;
        }
        if let Some(selected) = presentation.asset_selections.get(&layer.id)
            && !assets.has(selected)
        {
            failure = Some(Error::render(format!("Layer \"{}\" has unresolved selected semantic asset ID \"{selected}\".", layer.id)));
            return;
        }
        for font in text_typography_font_ids(layer) {
            if !assets.has(&font) {
                failure = Some(Error::render(format!("Layer \"{}\" has unresolved font asset ID \"{font}\".", layer.id)));
                return;
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    for mask in &template.masks {
        if !assets.has(&mask.asset_id) {
            return Err(Error::render(format!("Canvas mask \"{}\" has unresolved asset ID \"{}\".", mask.id, mask.asset_id)));
        }
    }
    for (layer_id, mask) in &presentation.layer_masks {
        let Some(layer) = layers_by_id.get(layer_id.as_str()) else {
            return Err(Error::render(format!("Canvas mask \"{}\" references unknown layer \"{layer_id}\".", mask.id)));
        };
        let raster_output =
            find_renderer(options, layer.renderer_key()).is_some_and(|renderer| renderer.output() == RendererOutput::Raster);
        let valid = raster_output || (layer.kind == "group" && is_raster_only(layer, options));
        if !valid && layer.kind == "group" {
            return Err(Error::render(format!("Canvas mask \"{}\" can only target a raster-only group \"{layer_id}\".", mask.id)));
        }
        if !valid {
            return Err(Error::render(format!("Canvas mask \"{}\" can only target raster-output layer \"{layer_id}\".", mask.id)));
        }
        let Some(coverage_id) = &mask.coverage_layer_id else {
            continue;
        };
        let Some(coverage) = layers_by_id.get(coverage_id.as_str()) else {
            return Err(Error::render(format!("Canvas mask \"{}\" references unknown coverage layer \"{coverage_id}\".", mask.id)));
        };
        if find_renderer(options, coverage.renderer_key()).map(|renderer| renderer.output()) != Some(RendererOutput::Raster) {
            return Err(Error::render(format!("Canvas mask \"{}\" coverage layer \"{coverage_id}\" must use raster output.", mask.id)));
        }
        let coverage_order = layer_order.get(coverage_id.as_str()).copied().unwrap_or(usize::MAX);
        let target_order = layer_order.get(layer_id.as_str()).copied();
        if target_order.is_none_or(|target| coverage_order >= target) {
            return Err(Error::render(format!(
                "Canvas mask \"{}\" coverage layer \"{coverage_id}\" must render before target layer \"{layer_id}\".",
                mask.id
            )));
        }
    }
    Ok(())
}

fn presentation_fonts(presentation: &ResolvedCardPresentation, assets: &AssetResolver) -> Result<FontBook> {
    let mut families: IndexMap<String, String> = IndexMap::new();
    for text in presentation.text.values() {
        let Some(asset_id) = &text.typography.font_asset_id else {
            continue;
        };
        let family = &text.typography.font_family;
        if let Some(existing) = families.get(family)
            && existing != asset_id
        {
            return Err(Error::render(format!("Font family \"{family}\" maps to both \"{existing}\" and \"{asset_id}\".")));
        }
        families.insert(family.clone(), asset_id.clone());
    }
    let mut fonts = IndexMap::new();
    for (family, asset_id) in families {
        fonts.insert(family, assets.font(&asset_id)?);
    }
    Ok(FontBook::new(fonts))
}

pub fn render_card<'a>(card: &CardData, bundle: &'a TemplateBundle, options: &RenderOptions<'a>) -> Result<RenderedCard<'a>> {
    render_with_capture(card, bundle, options, false).map(|(rendered, _)| rendered)
}

pub fn create_render_manifest(card: &CardData, bundle: &TemplateBundle, options: &RenderOptions) -> Result<RenderManifest> {
    let (rendered, captures) = render_with_capture(card, bundle, options, true)?;
    let (width, height) = (rendered.width(), rendered.height());
    let mut prepared = Vec::with_capacity(captures.len());
    for capture in captures {
        check_cancel(options.cancel)?;
        let (alpha, outlined) = match &capture.content {
            CaptureContent::Image(alpha) => (alpha.clone(), Arc::new(Vec::new())),
            CaptureContent::Svg(elements) => {
                let outlined = rendered.outline_elements(elements)?;
                let mut pixmap = Pixmap::new(width, height)
                    .ok_or_else(|| Error::render("A 2D canvas context is required to prepare render coverage."))?;
                crate::export::render_vector(&mut pixmap, &outlined, 1.0, 1.0)?;
                (Arc::new(alpha_plane(&pixmap)), Arc::new(outlined))
            }
        };
        prepared.push(PreparedCoverage { capture, alpha, outlined });
    }
    Ok(build_manifest(prepared, width, height))
}

pub fn export_card_to_svg(
    card: &CardData,
    bundle: &TemplateBundle,
    options: &RenderOptions,
    export: &crate::export::SvgExportOptions,
) -> Result<String> {
    render_card(card, bundle, options)?.to_svg(export)
}

pub fn export_card_to_image(
    card: &CardData,
    bundle: &TemplateBundle,
    options: &RenderOptions,
    export: &crate::export::ImageExportOptions,
) -> Result<Vec<u8>> {
    render_card(card, bundle, options)?.to_image(export)
}

pub fn export_card_to_png(card: &CardData, bundle: &TemplateBundle, options: &RenderOptions, scale: Option<f64>) -> Result<Vec<u8>> {
    render_card(card, bundle, options)?.to_png(scale)
}

fn render_with_capture<'a>(
    card: &CardData,
    bundle: &'a TemplateBundle,
    options: &RenderOptions<'a>,
    capture: bool,
) -> Result<(RenderedCard<'a>, Vec<Capture>)> {
    check_cancel(options.cancel)?;
    let template = &bundle.template;
    validate_card_data(card, &template.json)?;
    let semantics = derive_card_semantics(card, template)?;
    let presentation = resolve_card_presentation(template, semantics, options.presentation_overrides)?;
    let mut assets = AssetResolver { bundle, overrides: &options.assets, decoded: HashMap::new(), shared: options.decoded_assets };
    assert_layer_tree(template, options, &assets, &presentation)?;
    let fonts = presentation_fonts(&presentation, &assets)?;
    check_cancel(options.cancel)?;
    let width = template.width.round().max(1.0) as u32;
    let height = template.height.round().max(1.0) as u32;
    let mut visibility = presentation.layer_visibility.clone();
    for (id, visible) in &options.layers {
        visibility.insert(id.clone(), *visible);
    }
    let mut preset_overrides = presentation.presets.clone();
    for (key, value) in &options.preset_overrides {
        preset_overrides.insert(key.clone(), value.clone());
    }
    let coverage_ids: HashSet<String> = presentation.layer_masks.values().filter_map(|mask| mask.coverage_layer_id.clone()).collect();
    let (segments, vector_layers, warnings, captures) = {
        let mut measurer = Measurer::new(&fonts);
        let mut state = RenderState {
            card,
            bundle,
            options,
            presentation: &presentation,
            assets: &mut assets,
            measurer: &mut measurer,
            visibility,
            preset_overrides,
            coverage_ids,
            coverage: HashMap::new(),
            width,
            height,
            root: Surface::new(width, height).ok_or_else(|| Error::render("A 2D canvas context is required to render a card."))?,
            isolated: Vec::new(),
            spare: Vec::new(),
            raster_dirty: false,
            segments: Vec::new(),
            vector_layers: Vec::new(),
            warnings: Vec::new(),
            captures: capture.then(Vec::new),
            source_fields: capture.then(|| SourceFieldResolver::new(template, &presentation)),
        };
        for layer in &template.layers {
            state.render_layer(layer)?;
        }
        state.flush_raster(false);
        check_cancel(options.cancel)?;
        for (index, element) in state.vector_layers.iter().enumerate() {
            validate_rendered_svg_element(element, &format!("Rendered vector layer {index}"))?;
        }
        (state.segments, state.vector_layers, state.warnings, state.captures.unwrap_or_default())
    };
    check_cancel(options.cancel)?;
    if let Some(shared) = options.decoded_assets {
        shared.retain_used(&assets.decoded);
    }
    Ok((RenderedCard { bundle, segments, vector_layers, warnings, presentation, fonts, cancel: options.cancel }, captures))
}

struct RenderState<'r, 'a> {
    card: &'r CardData,
    bundle: &'a TemplateBundle,
    options: &'r RenderOptions<'a>,
    presentation: &'r ResolvedCardPresentation,
    assets: &'r mut AssetResolver<'a>,
    measurer: &'r mut Measurer<'r>,
    visibility: IndexMap<String, bool>,
    preset_overrides: IndexMap<String, String>,
    coverage_ids: HashSet<String>,
    coverage: HashMap<String, Arc<Vec<u8>>>,
    width: u32,
    height: u32,
    root: Surface,
    isolated: Vec<Surface>,
    spare: Vec<Surface>,
    raster_dirty: bool,
    segments: Vec<RenderSegment>,
    vector_layers: Vec<SvgElement>,
    warnings: Vec<RenderWarning>,
    captures: Option<Vec<Capture>>,
    source_fields: Option<SourceFieldResolver<'r>>,
}

fn js_value_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::Number(number)) => number.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(text)) => crate::js::to_number(text),
        Some(Value::Array(entries)) => match entries.as_slice() {
            [] => 0.0,
            [single] => js_value_number(Some(single)),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

impl<'r, 'a> RenderState<'r, 'a> {
    fn target(&mut self) -> &mut Surface {
        match self.isolated.last_mut() {
            Some(surface) => surface,
            None => &mut self.root,
        }
    }

    fn new_surface(&mut self) -> Result<Surface> {
        if let Some(surface) = self.spare.pop() {
            return Ok(surface);
        }
        Surface::new(self.width, self.height).ok_or_else(|| Error::render("A 2D canvas context is required to compose a card layer."))
    }

    fn release_surface(&mut self, mut surface: Surface) {
        surface.clear();
        self.spare.push(surface);
    }

    fn flush_raster(&mut self, prepare_next: bool) {
        if !self.raster_dirty {
            return;
        }
        let (width, height) = if prepare_next { (self.width, self.height) } else { (1, 1) };
        let pixmap = match Surface::new(width, height) {
            Some(next) => std::mem::replace(&mut self.root, next).pixmap,
            None => self.root.pixmap.clone(),
        };
        self.segments.push(RenderSegment::Raster(Arc::new(pixmap)));
        self.raster_dirty = false;
    }

    fn append_vectors(&mut self, elements: Vec<SvgElement>) {
        if elements.is_empty() {
            return;
        }
        self.flush_raster(true);
        if let Some(RenderSegment::Vector(existing)) = self.segments.last_mut() {
            existing.extend(elements);
        } else {
            self.segments.push(RenderSegment::Vector(elements));
        }
    }

    fn resolve_layer<'l>(&self, layer: &'l Layer) -> std::borrow::Cow<'l, Layer> {
        let region = self.presentation.layer_regions.get(&layer.id).filter(|_| layer.has_region_key());
        let options_patch =
            self.presentation.layer_options.get(&layer.id).filter(|_| matches!(layer.body, LayerBody::Raster(_) | LayerBody::Canvas));
        if region.is_none() && options_patch.is_none() {
            return std::borrow::Cow::Borrowed(layer);
        }
        let mut resolved = layer.clone();
        if let Some(region) = region {
            resolved.region = Some(*region);
        }
        if let Some(patch) = options_patch {
            let mut options = resolved.options.clone().unwrap_or_default();
            for (key, value) in patch {
                options.insert(key.clone(), value.clone());
            }
            resolved.options = Some(options);
        }
        std::borrow::Cow::Owned(resolved)
    }

    fn render_layer(&mut self, layer: &Layer) -> Result<()> {
        check_cancel(self.options.cancel)?;
        let resolved = self.resolve_layer(layer);
        if !is_layer_visible(&resolved, &self.visibility) {
            return Ok(());
        }
        let renderer = find_renderer(self.options, resolved.renderer_key())
            .ok_or_else(|| Error::render(format!("Unknown renderer for layer \"{}\".", resolved.id)))?;
        let output = renderer.output();
        let mask = self.presentation.layer_masks.get(&resolved.id).cloned();
        let masked_group = mask.is_some() && resolved.kind == "group" && output == RendererOutput::Container;
        if let Some(mask) = &mask
            && output != RendererOutput::Raster
            && !masked_group
        {
            return Err(Error::render(format!("Canvas mask \"{}\" can only target raster-output layer \"{}\".", mask.id, resolved.id)));
        }
        let coverage_needed = output == RendererOutput::Raster && (self.captures.is_some() || self.coverage_ids.contains(&resolved.id));
        let isolate = mask.is_some();
        if isolate {
            let surface = self.new_surface()?;
            self.isolated.push(surface);
        }
        let vector_start = self.vector_layers.len();
        let capture_start = self.captures.as_ref().map_or(0, Vec::len);
        let result = self.run_renderer(&renderer, &resolved);
        let isolated = if isolate { self.isolated.pop() } else { None };
        let rendered = result?;
        let emitted: Vec<SvgElement> = self.vector_layers[vector_start..].to_vec();
        match output {
            RendererOutput::Raster => {
                if !emitted.is_empty() {
                    return Err(Error::render(format!(
                        "Raster renderer for layer \"{}\" emitted vector output. Split mixed output into separate ordered layers.",
                        layer.id
                    )));
                }
                if !rendered {
                    if let Some(surface) = isolated {
                        self.release_surface(surface);
                    }
                    return check_cancel(self.options.cancel);
                }
                let coverage = if coverage_needed { Some(self.render_coverage(&renderer, &resolved)?) } else { None };
                let plane = match &mask {
                    Some(mask) => self.mask_plane(mask)?,
                    None => None,
                };
                if let Some(mut surface) = isolated {
                    if let Some(plane) = &plane {
                        apply_alpha_mask(&mut surface, plane);
                    }
                    self.target().composite(&surface);
                    self.release_surface(surface);
                }
                if let Some(mut coverage) = coverage {
                    if let Some(plane) = &plane {
                        apply_alpha_mask(&mut coverage, plane);
                    }
                    let alpha = Arc::new(alpha_plane(&coverage.pixmap));
                    self.release_surface(coverage);
                    if self.coverage_ids.contains(&resolved.id) {
                        self.coverage.insert(resolved.id.clone(), alpha.clone());
                    }
                    self.record_capture(layer, CaptureContent::Image(alpha));
                }
                self.raster_dirty = true;
            }
            RendererOutput::Container => {
                if mask.is_some() && !emitted.is_empty() {
                    return Err(Error::render(format!(
                        "Masked container layer \"{}\" emitted vector output. Split mixed output into separate ordered layers.",
                        layer.id
                    )));
                }
                if let (Some(mask), Some(mut surface)) = (&mask, isolated) {
                    let plane = self.mask_plane(mask)?;
                    if let Some(plane) = &plane {
                        apply_alpha_mask(&mut surface, plane);
                    }
                    self.target().composite(&surface);
                    self.release_surface(surface);
                    if let (Some(plane), Some(captures)) = (&plane, self.captures.as_mut()) {
                        for capture in &mut captures[capture_start..] {
                            if let CaptureContent::Image(alpha) = &mut capture.content {
                                *alpha =
                                    Arc::new(alpha.iter().zip(plane.iter()).map(|(alpha, mask)| destination_in(*alpha, *mask)).collect());
                            }
                        }
                    }
                    self.raster_dirty = true;
                }
            }
            RendererOutput::Vector => {
                if !emitted.is_empty() {
                    self.vector_layers.truncate(vector_start);
                    self.vector_layers.extend(emitted.iter().cloned());
                    self.append_vectors(emitted.clone());
                    self.record_capture(layer, CaptureContent::Svg(emitted));
                }
            }
        }
        check_cancel(self.options.cancel)
    }

    fn mask_plane(&mut self, mask: &ResolvedLayerMask) -> Result<Option<Arc<Vec<u8>>>> {
        let prepared = self.prepared_mask(mask)?;
        Ok(match &mask.coverage_layer_id {
            None => Some(prepared),
            Some(coverage_id) => self.coverage.get(coverage_id).map(|coverage| Arc::new(scope_mask(&prepared, coverage))),
        })
    }

    fn render_coverage(&mut self, renderer: &Renderer, layer: &Layer) -> Result<Surface> {
        let surface = self.new_surface()?;
        self.isolated.push(surface);
        let result = self.run_renderer(renderer, layer);
        let surface =
            self.isolated.pop().ok_or_else(|| Error::render(format!("Raster layer \"{}\" lost its alpha coverage canvas.", layer.id)))?;
        result?;
        Ok(surface)
    }

    fn record_capture(&mut self, layer: &Layer, content: CaptureContent) {
        let source_fields = self.source_fields.as_ref().map(|resolver| resolver.fields(layer)).unwrap_or_default();
        if let Some(captures) = self.captures.as_mut() {
            let order = captures.len();
            captures.push(Capture { layer_id: layer.id.clone(), order, source_fields, content });
        }
    }

    fn prepared_mask(&mut self, mask: &ResolvedLayerMask) -> Result<Arc<Vec<u8>>> {
        let bundle_asset = self.assets.is_bundle_asset(&mask.asset_id);
        let key = MaskKey { asset_id: mask.asset_id.clone(), luminance: mask.luminance, invert: mask.invert };
        if bundle_asset && let Some(cached) = self.bundle.cache.masks.lock().ok().and_then(|masks| masks.get(&key).cloned()) {
            return Ok(cached);
        }
        let image = self.assets.image(&mask.asset_id)?;
        let prepared = Arc::new(
            prepare_mask(&image, self.width, self.height, mask.luminance, mask.invert)
                .ok_or_else(|| Error::render("A 2D canvas context is required to prepare a canvas mask."))?,
        );
        if bundle_asset && let Ok(mut masks) = self.bundle.cache.masks.lock() {
            masks.insert(key, prepared.clone());
        }
        Ok(prepared)
    }

    fn run_renderer(&mut self, renderer: &Renderer, layer: &Layer) -> Result<bool> {
        match renderer {
            Renderer::Custom(custom) => {
                let card = self.card;
                let presentation = self.presentation;
                let mut vectors = Vec::new();
                let target_surface: &mut Surface = match self.isolated.last_mut() {
                    Some(surface) => surface,
                    None => &mut self.root,
                };
                let rendered =
                    custom.render(&mut LayerTarget { surface: target_surface, vectors: &mut vectors, card, presentation }, layer)?;
                self.vector_layers.extend(vectors);
                Ok(rendered)
            }
            Renderer::BuiltIn(kind) => match kind {
                BuiltIn::Image => self.render_image(layer),
                BuiltIn::RepeatedImage => self.render_repeated_image(layer),
                BuiltIn::Artwork => self.render_artwork(layer),
                BuiltIn::ColorTexture => self.render_color_texture(layer).map(|()| true),
                BuiltIn::ColorTextureBevel => {
                    self.render_color_texture(layer)?;
                    self.render_bevel(layer)?;
                    Ok(true)
                }
                BuiltIn::Bevel => self.render_bevel(layer).map(|()| true),
                BuiltIn::Text => self.render_text(layer).map(|()| true),
                BuiltIn::Svg => {
                    if let LayerBody::Svg(element) = &layer.body {
                        self.vector_layers.push(element.clone());
                    }
                    Ok(true)
                }
                BuiltIn::Group => {
                    if let Some(children) = layer.children() {
                        for child in children {
                            self.render_layer(child)?;
                        }
                    }
                    Ok(true)
                }
            },
        }
    }

    fn selected_asset(&self, layer: &Layer) -> Option<String> {
        self.presentation.asset_selections.get(&layer.id).cloned().or_else(|| layer.asset_id().map(str::to_owned))
    }

    fn render_image(&mut self, layer: &Layer) -> Result<bool> {
        let asset = self.selected_asset(layer).unwrap_or_default();
        let image = self.assets.image(&asset)?;
        let region = layer.region.unwrap_or(Region { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
        self.target().draw_decoded(&image, region.x, region.y, region.width, region.height, None);
        Ok(true)
    }

    fn render_repeated_image(&mut self, layer: &Layer) -> Result<bool> {
        let LayerBody::RepeatedImage { field, offset, .. } = &layer.body else {
            return Ok(false);
        };
        let count = match self.card.get(field) {
            None => return Ok(false),
            Some(CardValue::Json(Value::String(text))) if text.is_empty() => return Ok(false),
            Some(CardValue::Json(Value::Number(number))) if number.as_f64().is_some_and(|value| value.fract() == 0.0 && value >= 0.0) => {
                number.as_f64().unwrap_or(0.0)
            }
            Some(_) => {
                return Err(Error::render(format!(
                    "Repeated-image layer \"{}\" requires card field \"{field}\" to contain a non-negative integer.",
                    layer.id
                )));
            }
        };
        if count == 0.0 {
            return Ok(false);
        }
        let asset = self.selected_asset(layer).unwrap_or_default();
        let image = self.assets.image(&asset)?;
        let region = layer.region.unwrap_or(Region { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
        for index in 0..count as usize {
            let step = index as f64;
            self.target().draw_decoded(&image, region.x + offset.x * step, region.y + offset.y * step, region.width, region.height, None);
        }
        Ok(true)
    }

    fn card_asset(&mut self, layer_id: &str, field: &str, mask: bool) -> Result<Option<SharedDecoded>> {
        let value = match self.card.get(field) {
            None => return Ok(None),
            Some(CardValue::Json(Value::String(text))) if text.is_empty() => return Ok(None),
            Some(value) => value,
        };
        let source = match value {
            CardValue::Asset(source) => source.clone(),
            CardValue::Json(Value::String(url)) => AssetSource::Url(url.clone()),
            CardValue::Json(Value::Object(map)) if map.contains_key("width") && map.contains_key("height") => {
                return Err(Error::render("Could not load image asset \"[object Object]\"."));
            }
            _ => {
                let noun = if mask { "mask field" } else { "card field" };
                return Err(Error::render(format!("Artwork layer \"{layer_id}\" requires {noun} \"{field}\" to contain an AssetSource.")));
            }
        };
        self.assets.decode(&source).map(Some)
    }

    fn render_artwork(&mut self, layer: &Layer) -> Result<bool> {
        let LayerBody::Artwork(artwork) = &layer.body else {
            return Ok(false);
        };
        let ArtworkLayer { field, fit_width, mask_field, mask_alpha, placement_region, transform_id, transform_mode } = artwork;
        let transform = self
            .presentation
            .artwork_transforms
            .get(transform_id.as_deref().unwrap_or(&layer.id))
            .cloned()
            .unwrap_or(ArtworkTransform::IDENTITY);
        if transform_mode.is_some() && transform.mode != *transform_mode {
            return Ok(false);
        }
        let Some(image) = self.card_asset(&layer.id, field, false)? else {
            return Ok(false);
        };
        let region = layer.region.unwrap_or(Region { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
        let placement = placement_region.unwrap_or(region);
        let base_height = if *fit_width { (placement.width * image.height()) / image.width() } else { placement.height };
        let width = placement.width * transform.scale;
        let height = base_height * transform.scale;
        let x = placement.x - (width - placement.width) / 2.0 + transform.x * placement.width;
        let y = placement.y - (height - base_height) / 2.0 + transform.y * placement.height;
        let clip = Some(&region);
        let Some(mask_field) = mask_field else {
            self.target().draw_decoded(&image, x, y, width, height, clip);
            return Ok(true);
        };
        let Some(mask_image) = self.card_asset(&layer.id, mask_field, true)? else {
            return Ok(false);
        };
        let mut masked = self.new_surface()?;
        masked.draw_decoded(&image, x, y, width, height, clip);
        let mut mask_surface = self.new_surface()?;
        mask_surface.draw_decoded(&mask_image, x, y, width, height, clip);
        if !mask_alpha {
            let bounds = mask_surface.dirty;
            luminance_to_alpha(&mut mask_surface.pixmap, bounds);
        }
        let alpha = alpha_plane(&mask_surface.pixmap);
        apply_alpha_mask(&mut masked, &alpha);
        self.target().composite(&masked);
        self.release_surface(masked);
        self.release_surface(mask_surface);
        Ok(true)
    }

    fn render_color_texture(&mut self, layer: &Layer) -> Result<()> {
        let LayerBody::Raster(RasterLayer { preset_target, default_preset, source_region, .. }) = &layer.body else {
            return Ok(());
        };
        let asset_id =
            self.selected_asset(layer).ok_or_else(|| Error::render(format!("Color-texture layer \"{}\" requires assetId.", layer.id)))?;
        let preset_name = self
            .preset_overrides
            .get(&layer.id)
            .or_else(|| preset_target.as_ref().and_then(|target| self.preset_overrides.get(target)))
            .cloned()
            .or_else(|| default_preset.clone());
        let preset = match &preset_name {
            Some(name) => Some(
                self.bundle
                    .color_preset(name)?
                    .ok_or_else(|| Error::render(format!("Layer \"{}\" requested unknown color preset \"{name}\".", layer.id)))?,
            ),
            None => None,
        };
        let region = layer.region.unwrap_or(Region { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
        let image = self.assets.image(&asset_id)?;
        if preset.is_none() && source_region.is_none() {
            self.target().draw_decoded(&image, region.x, region.y, region.width, region.height, None);
            return Ok(());
        }
        let key = TextureKey {
            asset_id: asset_id.clone(),
            preset: preset_name.clone().unwrap_or_default(),
            region: source_region.map(|source| [source.x.to_bits(), source.y.to_bits(), source.width.to_bits(), source.height.to_bits()]),
        };
        let cacheable = self.assets.is_bundle_asset(&asset_id);
        let cached = if cacheable { self.bundle.cache.textures.lock().ok().and_then(|textures| textures.get(&key).cloned()) } else { None };
        let texture = match cached {
            Some(texture) => texture,
            None => {
                let texture = Arc::new(RasterImage::new(graded_texture(&image, *source_region, preset.as_ref(), &layer.id)?));
                if cacheable && let Ok(mut textures) = self.bundle.cache.textures.lock() {
                    textures.insert(key, texture.clone());
                }
                texture
            }
        };
        self.target().draw_image(&texture, region.x, region.y, region.width, region.height, None);
        Ok(())
    }

    fn render_bevel(&mut self, layer: &Layer) -> Result<()> {
        let options = layer.options.clone().unwrap_or_default();
        let Some(Value::Object(thickness)) = options.get("thickness") else {
            return Err(Error::render(format!("Bevel layer \"{}\" is missing options.thickness.", layer.id)));
        };
        let edges = ["top", "right", "bottom", "left"].map(|edge| js_value_number(thickness.get(edge)));
        if !edges.iter().all(|value| value.is_finite()) {
            return Err(Error::render(format!("Bevel layer \"{}\" has malformed thickness values.", layer.id)));
        }
        let [top, right_edge, bottom_edge, left_edge] = edges;
        let color = |key: &str| -> Result<String> {
            match options.get(key) {
                Some(Value::String(text)) => Ok(text.clone()),
                _ => Err(Error::render(format!("Bevel layer \"{}\" option \"{key}\" must be a color string.", layer.id))),
            }
        };
        let opacity = |key: &str| -> Result<f64> {
            match options.get(key) {
                None => Ok(1.0),
                Some(Value::Number(number)) => Ok(number.as_f64().unwrap_or(1.0)),
                Some(_) => Err(Error::render(format!("Bevel layer \"{}\" option \"{key}\" must be a finite number.", layer.id))),
            }
        };
        let region = layer.region.unwrap_or(Region { x: 0.0, y: 0.0, width: 0.0, height: 0.0 });
        let (x, y) = (region.x, region.y);
        let right = x + region.width;
        let bottom = y + region.height;
        let inner_left = x + left_edge;
        let inner_top = y + top;
        let inner_right = right - right_edge;
        let inner_bottom = bottom - bottom_edge;
        let sides = [
            (vec![(x, y), (right, y), (inner_right, inner_top), (inner_left, inner_top)], "highlightColor", "highlightOpacity"),
            (vec![(x, y), (inner_left, inner_top), (inner_left, inner_bottom), (x, bottom)], "highlightColor", "highlightOpacity"),
            (vec![(x, bottom), (right, bottom), (inner_right, inner_bottom), (inner_left, inner_bottom)], "shadowColor", "shadowOpacity"),
            (vec![(right, y), (right, bottom), (inner_right, inner_bottom), (inner_right, inner_top)], "shadowColor", "shadowOpacity"),
        ];
        let mut fill = tiny_skia::Color::BLACK;
        let mut global_alpha = 1.0;
        for (points, color_key, opacity_key) in sides {
            if let Some(parsed) = parse_css_color(&color(color_key)?) {
                fill = parsed;
            }
            let requested = opacity(opacity_key)?;
            if (0.0..=1.0).contains(&requested) {
                global_alpha = requested;
            }
            let mut paint_color = fill;
            paint_color.apply_opacity(global_alpha as f32);
            self.target().fill_polygon(&points, paint_color);
        }
        Ok(())
    }

    fn render_text(&mut self, layer: &Layer) -> Result<()> {
        let LayerBody::Text(text) = &layer.body else {
            return Ok(());
        };
        let resolved = self
            .presentation
            .text
            .get(&layer.id)
            .ok_or_else(|| Error::render(format!("Text layer \"{}\" has no resolved presentation.", layer.id)))?;
        let request = TextLayoutRequest {
            card: self.card,
            layer_id: &layer.id,
            layer: text,
            position: resolved.position,
            typography: &resolved.typography,
            fit_profile_id: resolved.fit_profile_id.as_deref(),
            semantic_value: resolved.value.as_ref(),
        };
        let mut warnings = Vec::new();
        let element = create_text_element(&request, self.measurer, &mut warnings)?;
        let warnings = warnings.into_iter().map(RenderWarningKind::RichText);
        let missing = missing_glyphs(self.measurer.book(), &element).into_iter().map(RenderWarningKind::MissingGlyph);
        self.warnings.extend(warnings.chain(missing).map(|kind| RenderWarning { kind, layer_id: layer.id.clone() }));
        self.vector_layers.push(element);
        Ok(())
    }
}

pub fn parse_css_color(value: &str) -> Option<tiny_skia::Color> {
    let color: svgtypes::Color = value.trim().parse().ok()?;
    Some(tiny_skia::Color::from_rgba8(color.red, color.green, color.blue, color.alpha))
}

pub(crate) fn texture_surface(image: &Decoded, source_region: Option<Region>, layer_id: &str) -> Result<Surface> {
    let region = source_region.unwrap_or(Region { x: 0.0, y: 0.0, width: image.width(), height: image.height() });
    let width = region.width.round().max(1.0) as u32;
    let height = region.height.round().max(1.0) as u32;
    let mut surface =
        Surface::new(width, height).ok_or_else(|| Error::render(format!("Layer \"{layer_id}\" could not prepare its texture.")))?;
    let (source_width, source_height) = (image.width(), image.height());
    let scale_x = f64::from(width) / region.width;
    let scale_y = f64::from(height) / region.height;
    surface.draw_decoded(image, -region.x * scale_x, -region.y * scale_y, source_width * scale_x, source_height * scale_y, None);
    Ok(surface)
}

fn graded_texture(
    image: &Decoded,
    source_region: Option<Region>,
    preset: Option<&crate::raster::grading::ColorPreset>,
    layer_id: &str,
) -> Result<Pixmap> {
    let mut surface = texture_surface(image, source_region, layer_id)?;
    if let Some(preset) = preset {
        let mut pixels = crate::raster::canvas::unpremultiplied(&surface.pixmap);
        apply_color_preset(&mut pixels, preset)?;
        crate::raster::decode::premultiply_in_place(&mut pixels);
        surface.pixmap.data_mut().copy_from_slice(&pixels);
    }
    Ok(surface.pixmap)
}

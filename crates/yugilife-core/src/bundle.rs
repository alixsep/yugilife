use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use indexmap::IndexMap;
use serde_json::Value;

use crate::assets::AssetSource;
use crate::error::{Error, Result};
use crate::model::CardTemplate;
use crate::raster::decode::{SharedDecoded, decode_source};
use crate::raster::grading::ColorPreset;
use crate::text::fonts::{SharedFont, load_font};
use crate::validation::{validate_card_template, validate_template_manifest};

type Cell<T> = OnceLock<std::result::Result<T, Error>>;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TextureKey {
    pub asset_id: String,
    pub preset: String,
    pub region: Option<[u64; 4]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MaskKey {
    pub asset_id: String,
    pub luminance: bool,
    pub invert: bool,
}

#[derive(Default)]
pub struct BundleCache {
    images: HashMap<String, Cell<SharedDecoded>>,
    fonts: HashMap<String, Cell<SharedFont>>,
    pub textures: Mutex<HashMap<TextureKey, Arc<crate::raster::image::RasterImage>>>,
    pub masks: Mutex<HashMap<MaskKey, Arc<Vec<u8>>>>,
    pub glyph_paths: crate::text::outline::GlyphPathCache,
}

pub struct TemplateBundle {
    pub manifest: Value,
    pub template: CardTemplate,
    pub color_presets_json: Value,
    pub color_presets: IndexMap<String, Value>,
    pub assets: IndexMap<String, AssetSource>,
    pub cache: BundleCache,
}

impl TemplateBundle {
    pub fn new(manifest: Value, template: &Value, color_presets: Value, assets: IndexMap<String, AssetSource>) -> Result<Self> {
        validate_template_manifest(&manifest)?;
        let template = CardTemplate::from_normalized(validate_card_template(template)?);
        let presets: IndexMap<String, Value> = color_presets
            .as_object()
            .map(|presets| presets.iter().map(|(name, preset)| (name.clone(), preset.clone())).collect())
            .unwrap_or_default();
        let cache = BundleCache {
            images: assets.keys().map(|id| (id.clone(), OnceLock::new())).collect(),
            fonts: assets.keys().map(|id| (id.clone(), OnceLock::new())).collect(),
            ..BundleCache::default()
        };
        Ok(Self { manifest, template, color_presets_json: color_presets, color_presets: presets, assets, cache })
    }

    pub fn id(&self) -> &str {
        self.manifest.get("id").and_then(Value::as_str).unwrap_or_default()
    }

    pub fn version(&self) -> &str {
        self.manifest.get("version").and_then(Value::as_str).unwrap_or_default()
    }

    pub fn color_preset(&self, name: &str) -> Result<Option<ColorPreset>> {
        self.color_presets.get(name).map(ColorPreset::from_json).transpose()
    }

    pub fn decoded_asset(&self, asset_id: &str) -> Option<Result<SharedDecoded>> {
        let source = self.assets.get(asset_id)?;
        let cell = self.cache.images.get(asset_id)?;
        Some(cell.get_or_init(|| decode_source(source).map(Arc::new)).clone())
    }

    pub fn font_asset(&self, asset_id: &str) -> Option<Result<SharedFont>> {
        let source = self.assets.get(asset_id)?;
        let cell = self.cache.fonts.get(asset_id)?;
        Some(cell.get_or_init(|| load_font(source, asset_id)).clone())
    }
}

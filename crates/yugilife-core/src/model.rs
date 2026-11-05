use indexmap::IndexMap;
use serde_json::Value;

use crate::svg::SvgElement;
use crate::validation::Record;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Region {
    pub fn from_json(value: Option<&Value>) -> Option<Self> {
        let value = value?;
        Some(Self {
            x: value.get("x")?.as_f64()?,
            y: value.get("y")?.as_f64()?,
            width: value.get("width")?.as_f64()?,
            height: value.get("height")?.as_f64()?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Primitive {
    Bool(bool),
    Number(f64),
    String(String),
}

impl Primitive {
    pub fn from_json(value: &Value) -> Option<Self> {
        match value {
            Value::Bool(flag) => Some(Self::Bool(*flag)),
            Value::Number(number) => number.as_f64().map(Self::Number),
            Value::String(text) => Some(Self::String(text.clone())),
            _ => None,
        }
    }

    pub fn to_js_string(&self) -> String {
        match self {
            Self::Bool(flag) => flag.to_string(),
            Self::Number(number) => crate::number::js_number(*number),
            Self::String(text) => text.clone(),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Self::Bool(flag) => Value::Bool(*flag),
            Self::Number(number) => crate::validation::number_value(*number),
            Self::String(text) => Value::String(text.clone()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SemanticValue {
    Primitive(Primitive),
    List(Vec<Primitive>),
}

impl SemanticValue {
    pub fn from_json(value: &Value) -> Option<Self> {
        match value {
            Value::Array(entries) => entries.iter().map(Primitive::from_json).collect::<Option<Vec<_>>>().map(Self::List),
            other => Primitive::from_json(other).map(Self::Primitive),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Self::Primitive(primitive) => primitive.to_json(),
            Self::List(entries) => Value::Array(entries.iter().map(Primitive::to_json).collect()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    Equals { path: String, equals: Primitive },
    In { path: String, values: Vec<Primitive> },
    All(Vec<Condition>),
    Any(Vec<Condition>),
}

impl Condition {
    pub fn from_json(value: &Value) -> Option<Self> {
        if let Some(children) = value.get("all").and_then(Value::as_array) {
            return children.iter().map(Self::from_json).collect::<Option<Vec<_>>>().map(Self::All);
        }
        if let Some(children) = value.get("any").and_then(Value::as_array) {
            return children.iter().map(Self::from_json).collect::<Option<Vec<_>>>().map(Self::Any);
        }
        let path = value.get("path")?.as_str()?.to_owned();
        if let Some(values) = value.get("in").and_then(Value::as_array) {
            let values = values.iter().map(Primitive::from_json).collect::<Option<Vec<_>>>()?;
            return Some(Self::In { path, values });
        }
        Some(Self::Equals { path, equals: Primitive::from_json(value.get("equals")?)? })
    }

    pub fn paths(&self, output: &mut Vec<String>) {
        match self {
            Self::Equals { path, .. } | Self::In { path, .. } => output.push(path.clone()),
            Self::All(children) | Self::Any(children) => children.iter().for_each(|child| child.paths(output)),
        }
    }
}

pub type TransformGate = IndexMap<String, Option<String>>;

pub fn transform_gate(value: Option<&Value>) -> Option<TransformGate> {
    value.and_then(Value::as_object).map(|gate| gate.iter().map(|(key, mode)| (key.clone(), mode.as_str().map(str::to_owned))).collect())
}

#[derive(Debug, Clone, PartialEq)]
pub enum SourceValue {
    Field(String),
    Value(SemanticValue),
}

#[derive(Debug, Clone, PartialEq)]
pub enum SourceReference {
    Field(String),
    Path(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum SemanticTransform {
    UniqueList,
    Includes(String),
    Lookup(IndexMap<String, Primitive>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum SemanticFallback {
    ListLength { minimum: Option<f64>, source: SourceReference },
    Value(Primitive),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticBinding {
    pub path: String,
    pub source: SourceValue,
    pub transform: Option<SemanticTransform>,
    pub fallback: Option<SemanticFallback>,
    pub fallback_values: Vec<Primitive>,
    pub when: Option<Condition>,
}

impl SemanticBinding {
    fn from_json(value: &Value) -> Option<Self> {
        let source = value.get("source")?;
        let source = match source.get("field").and_then(Value::as_str) {
            Some(field) => SourceValue::Field(field.to_owned()),
            None => SourceValue::Value(SemanticValue::from_json(source.get("value")?)?),
        };
        let transform = match value.get("transform") {
            None => None,
            Some(transform) => Some(match transform.get("kind")?.as_str()? {
                "unique-list" => SemanticTransform::UniqueList,
                "includes" => SemanticTransform::Includes(transform.get("value")?.as_str()?.to_owned()),
                _ => SemanticTransform::Lookup(
                    transform
                        .get("values")?
                        .as_object()?
                        .iter()
                        .filter_map(|(key, value)| Some((key.clone(), Primitive::from_json(value)?)))
                        .collect(),
                ),
            }),
        };
        let fallback = match value.get("fallback") {
            None => None,
            Some(fallback) => Some(match fallback.get("kind")?.as_str()? {
                "value" => SemanticFallback::Value(Primitive::from_json(fallback.get("value")?)?),
                _ => {
                    let source = fallback.get("source")?;
                    let source = match source.get("field").and_then(Value::as_str) {
                        Some(field) => SourceReference::Field(field.to_owned()),
                        None => SourceReference::Path(source.get("path")?.as_str()?.to_owned()),
                    };
                    SemanticFallback::ListLength { minimum: fallback.get("minimum").and_then(Value::as_f64), source }
                }
            }),
        };
        Some(Self {
            path: value.get("path")?.as_str()?.to_owned(),
            source,
            transform,
            fallback,
            fallback_values: value
                .get("fallbackValues")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Primitive::from_json).collect())
                .unwrap_or_default(),
            when: value.get("when").and_then(Condition::from_json),
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CanvasMask {
    pub id: String,
    pub asset_id: String,
    pub coverage_layer_id: Option<String>,
    pub luminance: bool,
    pub invert: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PresentationRule {
    pub id: String,
    pub layer_visibility: IndexMap<String, bool>,
    pub layer_regions: IndexMap<String, Region>,
    pub layer_options: IndexMap<String, Record>,
    pub asset_selections: IndexMap<String, String>,
    pub mask_selections: IndexMap<String, String>,
    pub presets: IndexMap<String, String>,
    pub text_values: IndexMap<String, String>,
    pub text_positions: IndexMap<String, Position>,
    pub when: Option<Condition>,
    pub when_transforms: Option<TransformGate>,
}

fn string_map(value: Option<&Value>) -> IndexMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|map| map.iter().filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned()))).collect())
        .unwrap_or_default()
}

impl PresentationRule {
    fn from_json(value: &Value) -> Self {
        let object = |key: &str| value.get(key).and_then(Value::as_object);
        Self {
            id: value.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
            layer_visibility: object("layerVisibility")
                .map(|map| map.iter().filter_map(|(key, value)| Some((key.clone(), value.as_bool()?))).collect())
                .unwrap_or_default(),
            layer_regions: object("layerRegions")
                .map(|map| map.iter().filter_map(|(key, value)| Some((key.clone(), Region::from_json(Some(value))?))).collect())
                .unwrap_or_default(),
            layer_options: object("layerOptions")
                .map(|map| map.iter().filter_map(|(key, value)| Some((key.clone(), value.as_object()?.clone()))).collect())
                .unwrap_or_default(),
            asset_selections: string_map(value.get("assetSelections")),
            mask_selections: string_map(value.get("maskSelections")),
            presets: string_map(value.get("presets")),
            text_values: string_map(value.get("textValues")),
            text_positions: object("textPositions")
                .map(|map| {
                    map.iter()
                        .filter_map(|(key, value)| {
                            Some((key.clone(), Position { x: value.get("x")?.as_f64()?, y: value.get("y")?.as_f64()? }))
                        })
                        .collect()
                })
                .unwrap_or_default(),
            when: value.get("when").and_then(Condition::from_json),
            when_transforms: transform_gate(value.get("whenTransforms")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextFormat {
    Plain,
    Lines,
    Pair,
    TypeList,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticTextStyle {
    pub id: String,
    pub label: String,
    pub typography: Option<Record>,
    pub when: Option<Condition>,
    pub when_transforms: Option<TransformGate>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextLayer {
    pub fallback_field: Option<String>,
    pub field: Option<String>,
    pub format: Option<TextFormat>,
    pub pair_index: Option<usize>,
    pub position: Position,
    pub prefix: Option<String>,
    pub separator: Option<String>,
    pub suffix: Option<String>,
    pub semantic_path: Option<String>,
    pub semantic_styles: Vec<SemanticTextStyle>,
    pub typography: Record,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArtworkLayer {
    pub field: String,
    pub fit_width: bool,
    pub mask_field: Option<String>,
    pub mask_alpha: bool,
    pub placement_region: Option<Region>,
    pub transform_id: Option<String>,
    pub transform_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RasterLayer {
    pub asset_id: Option<String>,
    pub default_preset: Option<String>,
    pub preset_target: Option<String>,
    pub source_region: Option<Region>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LayerBody {
    Image { asset_id: String },
    RepeatedImage { asset_id: String, field: String, offset: Position },
    Artwork(ArtworkLayer),
    Raster(RasterLayer),
    Canvas,
    Text(Box<TextLayer>),
    Svg(SvgElement),
    Group(Vec<Layer>),
    Custom,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Layer {
    pub id: String,
    pub kind: String,
    pub default_visible: Option<bool>,
    pub editor_visible: Option<bool>,
    pub group: Option<String>,
    pub label: Option<String>,
    pub region: Option<Region>,
    pub renderer: Option<String>,
    pub options: Option<Record>,
    pub body: LayerBody,
    pub json: Record,
}

impl Layer {
    pub fn from_json(value: &Value) -> Self {
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
        let kind = text("kind").unwrap_or_default();
        let body = match kind.as_str() {
            "image" => LayerBody::Image { asset_id: text("assetId").unwrap_or_default() },
            "repeated-image" => LayerBody::RepeatedImage {
                asset_id: text("assetId").unwrap_or_default(),
                field: text("field").unwrap_or_default(),
                offset: Position {
                    x: value.pointer("/offset/x").and_then(Value::as_f64).unwrap_or(0.0),
                    y: value.pointer("/offset/y").and_then(Value::as_f64).unwrap_or(0.0),
                },
            },
            "artwork" => LayerBody::Artwork(ArtworkLayer {
                field: text("field").unwrap_or_default(),
                fit_width: text("fit").as_deref() == Some("width"),
                mask_field: text("maskField"),
                mask_alpha: text("maskChannel").as_deref() == Some("alpha"),
                placement_region: Region::from_json(value.get("placementRegion")),
                transform_id: text("transformId"),
                transform_mode: text("transformMode"),
            }),
            "raster" => LayerBody::Raster(RasterLayer {
                asset_id: text("assetId"),
                default_preset: text("defaultPreset"),
                preset_target: text("presetTarget"),
                source_region: Region::from_json(value.get("sourceRegion")),
            }),
            "canvas" => LayerBody::Canvas,
            "text" => LayerBody::Text(Box::new(TextLayer {
                fallback_field: text("fallbackField"),
                field: text("field"),
                format: text("format").map(|format| match format.as_str() {
                    "lines" => TextFormat::Lines,
                    "pair" => TextFormat::Pair,
                    "type-list" => TextFormat::TypeList,
                    _ => TextFormat::Plain,
                }),
                pair_index: value.get("pairIndex").and_then(Value::as_f64).map(|index| index as usize),
                position: Position {
                    x: value.pointer("/position/x").and_then(Value::as_f64).unwrap_or(0.0),
                    y: value.pointer("/position/y").and_then(Value::as_f64).unwrap_or(0.0),
                },
                prefix: text("prefix"),
                separator: text("separator"),
                suffix: text("suffix"),
                semantic_path: text("semanticPath"),
                semantic_styles: value
                    .get("semanticStyles")
                    .and_then(Value::as_array)
                    .map(|styles| {
                        styles
                            .iter()
                            .map(|style| SemanticTextStyle {
                                id: style.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
                                label: style.get("label").and_then(Value::as_str).unwrap_or_default().to_owned(),
                                typography: style.get("typography").and_then(Value::as_object).cloned(),
                                when: style.get("when").and_then(Condition::from_json),
                                when_transforms: transform_gate(style.get("whenTransforms")),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                typography: value.get("typography").and_then(Value::as_object).cloned().unwrap_or_default(),
            })),
            "svg" => LayerBody::Svg(value.get("element").map(SvgElement::from_json).unwrap_or_default()),
            "group" => LayerBody::Group(
                value
                    .get("layers")
                    .and_then(Value::as_array)
                    .map(|layers| layers.iter().map(Self::from_json).collect())
                    .unwrap_or_default(),
            ),
            _ => LayerBody::Custom,
        };
        Self {
            id: text("id").unwrap_or_default(),
            kind,
            default_visible: value.get("defaultVisible").and_then(Value::as_bool),
            editor_visible: value.get("editorVisible").and_then(Value::as_bool),
            group: text("group"),
            label: text("label"),
            region: Region::from_json(value.get("region")),
            renderer: text("renderer"),
            options: value.get("options").and_then(Value::as_object).cloned(),
            body,
            json: value.as_object().cloned().unwrap_or_default(),
        }
    }

    pub fn has_region_key(&self) -> bool {
        self.json.contains_key("region")
    }

    pub fn renderer_key(&self) -> &str {
        match (&self.body, &self.renderer) {
            (LayerBody::Raster(_) | LayerBody::Canvas, Some(renderer)) => renderer,
            _ => &self.kind,
        }
    }

    pub fn children(&self) -> Option<&[Layer]> {
        match &self.body {
            LayerBody::Group(children) => Some(children),
            _ => None,
        }
    }

    pub fn asset_id(&self) -> Option<&str> {
        match &self.body {
            LayerBody::Image { asset_id } | LayerBody::RepeatedImage { asset_id, .. } => Some(asset_id),
            LayerBody::Raster(raster) => raster.asset_id.as_deref(),
            _ => None,
        }
    }

    pub fn preset_target(&self) -> Option<&str> {
        match &self.body {
            LayerBody::Raster(raster) => raster.preset_target.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CardTemplate {
    pub json: Record,
    pub width: f64,
    pub height: f64,
    pub layers: Vec<Layer>,
    pub masks: Vec<CanvasMask>,
    pub rules: Vec<PresentationRule>,
    pub bindings: Vec<SemanticBinding>,
}

impl CardTemplate {
    pub fn from_normalized(json: Record) -> Self {
        let array = |key: &str| json.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
        let masks = array("masks")
            .iter()
            .map(|mask| CanvasMask {
                id: mask.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
                asset_id: mask.get("assetId").and_then(Value::as_str).unwrap_or_default().to_owned(),
                coverage_layer_id: mask.get("coverageLayerId").and_then(Value::as_str).map(str::to_owned),
                luminance: mask.get("channel").and_then(Value::as_str) != Some("alpha"),
                invert: mask.get("invert").and_then(Value::as_bool).unwrap_or(false),
            })
            .collect();
        let bindings = json
            .get("semanticBindings")
            .and_then(|bindings| bindings.get("bindings"))
            .and_then(Value::as_array)
            .map(|bindings| bindings.iter().filter_map(SemanticBinding::from_json).collect())
            .unwrap_or_default();
        Self {
            width: json.get("dimensions").and_then(|dimensions| dimensions.get("width")).and_then(Value::as_f64).unwrap_or(0.0),
            height: json.get("dimensions").and_then(|dimensions| dimensions.get("height")).and_then(Value::as_f64).unwrap_or(0.0),
            layers: array("layers").iter().map(Layer::from_json).collect(),
            masks,
            rules: array("presentationRules").iter().map(PresentationRule::from_json).collect(),
            bindings,
            json,
        }
    }

    pub fn card_fields(&self) -> impl Iterator<Item = &Record> {
        self.json.get("cardFields").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object)
    }
}

pub fn walk_layers<'a>(layers: &'a [Layer], visitor: &mut impl FnMut(&'a Layer, &[&'a Layer])) {
    fn visit<'a>(layers: &'a [Layer], ancestors: &mut Vec<&'a Layer>, visitor: &mut impl FnMut(&'a Layer, &[&'a Layer])) {
        for layer in layers {
            visitor(layer, ancestors);
            if let Some(children) = layer.children() {
                ancestors.push(layer);
                visit(children, ancestors, visitor);
                ancestors.pop();
            }
        }
    }
    visit(layers, &mut Vec::new(), visitor);
}

pub fn flatten_layers(layers: &[Layer]) -> Vec<&Layer> {
    let mut flattened = Vec::new();
    walk_layers(layers, &mut |layer, _| flattened.push(layer));
    flattened
}

pub fn flatten_drawable_layers(layers: &[Layer]) -> Vec<&Layer> {
    flatten_layers(layers).into_iter().filter(|layer| layer.children().is_none()).collect()
}

pub fn is_layer_visible(layer: &Layer, visibility: &IndexMap<String, bool>) -> bool {
    visibility.get(&layer.id).copied().or(layer.default_visible).unwrap_or(true)
}

pub fn default_layer_visibility(template: &CardTemplate) -> IndexMap<String, bool> {
    flatten_drawable_layers(&template.layers).into_iter().map(|layer| (layer.id.clone(), layer.default_visible.unwrap_or(true))).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerGroupEntry {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerGroup {
    pub label: String,
    pub layers: Vec<LayerGroupEntry>,
}

pub fn collect_layer_groups(template: &CardTemplate, fallback_label: &str) -> Vec<LayerGroup> {
    let mut groups: IndexMap<String, Vec<LayerGroupEntry>> = IndexMap::new();
    for layer in flatten_drawable_layers(&template.layers) {
        if !layer.editor_visible.unwrap_or(true) {
            continue;
        }
        let label = layer.group.clone().unwrap_or_else(|| fallback_label.to_owned());
        groups
            .entry(label)
            .or_default()
            .push(LayerGroupEntry { id: layer.id.clone(), label: layer.label.clone().unwrap_or_else(|| layer.id.clone()) });
    }
    groups.into_iter().map(|(label, layers)| LayerGroup { label, layers }).collect()
}

pub fn default_preset_for_target(template: &CardTemplate, target: &str) -> Option<String> {
    flatten_drawable_layers(&template.layers).into_iter().find_map(|layer| match &layer.body {
        LayerBody::Raster(raster) if raster.preset_target.as_deref() == Some(target) => raster.default_preset.clone(),
        _ => None,
    })
}

pub fn collect_preset_targets(template: &CardTemplate) -> Vec<String> {
    let mut targets: Vec<String> = Vec::new();
    for layer in flatten_drawable_layers(&template.layers) {
        if let Some(target) = layer.preset_target()
            && !targets.iter().any(|existing| existing == target)
        {
            targets.push(target.to_owned());
        }
    }
    targets
}

impl Region {
    pub fn to_json(&self) -> Value {
        use crate::validation::number_value;
        serde_json::json!({ "height": number_value(self.height), "width": number_value(self.width), "x": number_value(self.x), "y": number_value(self.y) })
    }
}

impl Position {
    pub fn to_json(&self) -> Value {
        use crate::validation::number_value;
        serde_json::json!({ "x": number_value(self.x), "y": number_value(self.y) })
    }
}

impl LayerGroup {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "label": self.label,
            "layers": self.layers.iter().map(|entry| serde_json::json!({ "id": entry.id, "label": entry.label })).collect::<Vec<_>>(),
        })
    }
}

/// Each layer's position in the tree, as child indices from the top, in `walk_layers` order. Hosts
/// that hold the layers as objects use these to return their own objects.
pub fn layer_paths(layers: &[Layer], drawable_only: bool) -> Vec<Vec<usize>> {
    fn visit(layers: &[Layer], prefix: &mut Vec<usize>, drawable_only: bool, output: &mut Vec<Vec<usize>>) {
        for (index, layer) in layers.iter().enumerate() {
            prefix.push(index);
            let children = layer.children();
            if !(drawable_only && children.is_some()) {
                output.push(prefix.clone());
            }
            if let Some(children) = children {
                visit(children, prefix, drawable_only, output);
            }
            prefix.pop();
        }
    }
    let mut output = Vec::new();
    visit(layers, &mut Vec::new(), drawable_only, &mut output);
    output
}

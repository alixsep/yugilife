use serde_json::Value;

use crate::number::js_number;
use crate::validation::Record;

#[derive(Debug, Clone, PartialEq)]
pub enum FontWeight {
    Number(f64),
    Keyword(String),
}

impl FontWeight {
    pub fn to_js_string(&self) -> String {
        match self {
            Self::Number(value) => js_number(*value),
            Self::Keyword(keyword) => keyword.clone(),
        }
    }

    pub fn numeric(&self) -> f64 {
        match self {
            Self::Number(value) => *value,
            Self::Keyword(keyword) => match keyword.as_str() {
                "bold" | "bolder" => 700.0,
                "lighter" => 100.0,
                _ => 400.0,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextStroke {
    pub color: String,
    pub width: f64,
    pub outer: bool,
    pub linejoin: Option<String>,
    pub opacity: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FitProfile {
    pub font_size: f64,
    pub id: String,
    pub line_height: Option<f64>,
    pub max_auto_compression_x: Option<f64>,
    pub max_lines: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextAnchor {
    Start,
    Middle,
    End,
}

impl TextAnchor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Middle => "middle",
            Self::End => "end",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextTypography {
    pub auto_scale_x_quantifier: Option<f64>,
    pub fill: String,
    pub stroke: Option<TextStroke>,
    pub fit_scale_x: bool,
    pub fit_blocks_preferred_max_lines: Option<usize>,
    pub fit_profiles: Option<Vec<FitProfile>>,
    pub font_asset_id: Option<String>,
    pub font_family: String,
    pub font_size: f64,
    pub font_style: Option<String>,
    pub font_weight: Option<FontWeight>,
    pub letter_spacing: Option<f64>,
    pub line_height: Option<f64>,
    pub max_auto_compression_x: Option<f64>,
    pub max_height: Option<f64>,
    pub max_width: Option<f64>,
    pub min_font_size: Option<f64>,
    pub text_anchor: Option<TextAnchor>,
    pub justify: bool,
    pub top_anchor: bool,
    pub wrap_word: bool,
}

impl TextTypography {
    pub fn from_record(record: &Record) -> Self {
        let number = |key: &str| record.get(key).and_then(Value::as_f64);
        let text = |key: &str| record.get(key).and_then(Value::as_str).map(str::to_owned);
        let stroke = record.get("stroke").and_then(Value::as_object).map(|stroke| TextStroke {
            color: stroke.get("color").and_then(Value::as_str).unwrap_or_default().to_owned(),
            width: stroke.get("width").and_then(Value::as_f64).unwrap_or(0.0),
            outer: stroke.get("align").and_then(Value::as_str) != Some("center"),
            linejoin: stroke.get("linejoin").and_then(Value::as_str).map(str::to_owned),
            opacity: stroke.get("opacity").and_then(Value::as_f64),
        });
        let fit_profiles = record.get("fitProfiles").and_then(Value::as_array).map(|profiles| {
            profiles
                .iter()
                .map(|profile| FitProfile {
                    font_size: profile.get("fontSize").and_then(Value::as_f64).unwrap_or(0.0),
                    id: profile.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
                    line_height: profile.get("lineHeight").and_then(Value::as_f64),
                    max_auto_compression_x: profile.get("maxAutoCompressionX").and_then(Value::as_f64),
                    max_lines: profile.get("maxLines").and_then(Value::as_f64),
                })
                .collect()
        });
        Self {
            auto_scale_x_quantifier: number("autoScaleXQuantifier"),
            fill: text("fill").unwrap_or_default(),
            stroke,
            fit_scale_x: text("fit").as_deref() == Some("scale-x"),
            fit_blocks_preferred_max_lines: record
                .get("fitBlocks")
                .and_then(|blocks| blocks.pointer("/leading/preferredMaxLines"))
                .and_then(Value::as_f64)
                .map(|lines| lines as usize),
            fit_profiles,
            font_asset_id: text("fontAssetId"),
            font_family: text("fontFamily").unwrap_or_default(),
            font_size: number("fontSize").unwrap_or(0.0),
            font_style: text("fontStyle"),
            font_weight: record.get("fontWeight").and_then(|weight| match weight {
                Value::Number(number) => number.as_f64().map(FontWeight::Number),
                Value::String(keyword) => Some(FontWeight::Keyword(keyword.clone())),
                _ => None,
            }),
            letter_spacing: number("letterSpacing"),
            line_height: number("lineHeight"),
            max_auto_compression_x: number("maxAutoCompressionX"),
            max_height: number("maxHeight"),
            max_width: number("maxWidth"),
            min_font_size: number("minFontSize"),
            text_anchor: match text("textAnchor").as_deref() {
                Some("start") => Some(TextAnchor::Start),
                Some("middle") => Some(TextAnchor::Middle),
                Some("end") => Some(TextAnchor::End),
                _ => None,
            },
            justify: text("textAlign").as_deref() == Some("justify"),
            top_anchor: text("verticalAnchor").as_deref() == Some("top"),
            wrap_word: text("wrap").as_deref() == Some("word"),
        }
    }

    pub fn has_fit_blocks(&self) -> bool {
        self.fit_blocks_preferred_max_lines.is_some()
    }
}

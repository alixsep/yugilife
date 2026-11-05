use std::sync::Arc;

use base64::Engine;

use crate::error::{Error, Result};

#[derive(Debug)]
pub struct EncodedAsset {
    pub bytes: Vec<u8>,
    pub media_type: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone)]
pub enum AssetSource {
    Url(String),
    Encoded(Arc<EncodedAsset>),
}

impl AssetSource {
    pub fn from_bytes(bytes: Vec<u8>, media_type: Option<String>, name: impl Into<String>) -> Self {
        Self::Encoded(Arc::new(EncodedAsset { bytes, media_type, name: name.into() }))
    }

    pub fn identity(&self) -> AssetIdentity {
        match self {
            Self::Url(url) => AssetIdentity::Url(url.clone()),
            Self::Encoded(asset) => AssetIdentity::Pointer(Arc::as_ptr(asset) as usize),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Url(url) => url.clone(),
            Self::Encoded(asset) => asset.name.clone(),
        }
    }

    pub fn read(&self) -> Result<Resolved<'_>> {
        match self {
            Self::Encoded(asset) => Ok(Resolved::Borrowed(&asset.bytes, asset.media_type.as_deref())),
            Self::Url(url) => {
                let (media_type, bytes) =
                    decode_data_url(url).ok_or_else(|| Error::render(format!("Could not load image asset \"{url}\".")))?;
                Ok(Resolved::Owned(bytes, media_type))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum AssetIdentity {
    Url(String),
    Pointer(usize),
}

pub enum Resolved<'a> {
    Borrowed(&'a [u8], Option<&'a str>),
    Owned(Vec<u8>, Option<String>),
}

impl Resolved<'_> {
    pub fn bytes(&self) -> &[u8] {
        match self {
            Self::Borrowed(bytes, _) => bytes,
            Self::Owned(bytes, _) => bytes,
        }
    }

    pub fn media_type(&self) -> Option<&str> {
        match self {
            Self::Borrowed(_, media_type) => *media_type,
            Self::Owned(_, media_type) => media_type.as_deref(),
        }
    }
}

pub fn decode_data_url(url: &str) -> Option<(Option<String>, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (header, payload) = rest.split_once(',')?;
    let is_base64 = header.ends_with(";base64");
    let media_type = header.split(';').next().filter(|value| !value.is_empty()).map(str::to_owned);
    let bytes = if is_base64 { base64::engine::general_purpose::STANDARD.decode(payload.trim()).ok()? } else { percent_decode(payload) };
    Some((media_type, bytes))
}

fn percent_decode(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(decoded) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            output.push(decoded);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    output
}

pub fn media_type_for_path(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let extension = lower.rsplit_once('.').map_or("", |(_, extension)| extension);
    match extension {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "jpe" | "jpeg" | "jpg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "otf" => "font/otf",
        "ttf" => "font/ttf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "webp" => "image/webp",
        "png" => "image/png",
        _ => "application/octet-stream",
    }
}

pub fn encode_data_url(media_type: &str, bytes: &[u8]) -> String {
    format!("data:{media_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[derive(Debug, Clone, Default)]
pub struct MapAssetResolver {
    assets: indexmap::IndexMap<String, AssetSource>,
}

impl MapAssetResolver {
    pub fn new(defaults: &indexmap::IndexMap<String, AssetSource>, overrides: &indexmap::IndexMap<String, AssetSource>) -> Self {
        let mut assets = defaults.clone();
        for (id, source) in overrides {
            assets.insert(id.clone(), source.clone());
        }
        Self { assets }
    }

    pub fn has(&self, id: &str) -> bool {
        self.assets.contains_key(id)
    }

    pub fn resolve(&self, id: &str) -> Result<&AssetSource> {
        self.assets
            .get(id)
            .ok_or_else(|| Error::render(format!("Unresolved semantic asset ID \"{id}\". Supply it through RenderOptions.assets.")))
    }
}

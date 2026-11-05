use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use indexmap::IndexMap;
use serde_json::Value;
use sha2::{Digest, Sha256};
use yugilife_core::assets::{AssetSource, decode_data_url, media_type_for_path};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::validation::{compare_template_versions, template_version_is_valid, validate_card_template, validate_template_manifest};

use crate::errors::{CliError, CliResult, ErrorCode};

mod packaged {
    include!(concat!(env!("OUT_DIR"), "/packaged.rs"));
}

const MAXIMUM_ARTIFACT_BYTES: u64 = 128 * 1024 * 1024;

pub struct TemplateIdentity {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub version: String,
}

fn packaged_file(path: &str) -> Option<&'static [u8]> {
    packaged::PACKAGED_FILES.iter().find(|(name, _)| *name == path).map(|(_, bytes)| *bytes)
}

fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn packaged_ids() -> Vec<String> {
    packaged_file("catalog.json")
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        .and_then(|catalog| catalog.get("bundledTemplates").and_then(Value::as_array).cloned())
        .map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}

pub fn default_template_id() -> String {
    packaged_file("catalog.json")
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        .and_then(|catalog| catalog.pointer("/defaults/card").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "card/series-10".to_owned())
}

fn packaged_manifest(id: &str) -> Option<(String, Value)> {
    let directory = format!("templates/{id}");
    let manifest = serde_json::from_slice(packaged_file(&format!("{directory}/manifest.json"))?).ok()?;
    Some((directory, manifest))
}

pub fn packaged_identities() -> Vec<TemplateIdentity> {
    packaged_ids().iter().filter_map(|id| packaged_manifest(id)).map(|(_, manifest)| identity_of(&manifest)).collect()
}

fn identity_of(manifest: &Value) -> TemplateIdentity {
    let text = |key: &str| manifest.get(key).and_then(Value::as_str).unwrap_or_default().to_owned();
    TemplateIdentity { id: text("id"), kind: text("kind"), name: text("name"), version: text("version") }
}

fn load_packaged(id: &str) -> CliResult<TemplateBundle> {
    let (directory, manifest) = packaged_manifest(id).ok_or_else(|| {
        CliError::new(ErrorCode::TemplateNotInstalled, format!("Official template \"{id}\" is not installed with this package."))
    })?;
    let read_json = |relative: &str| -> CliResult<Value> {
        let path = normalize(&format!("{directory}/{relative}"));
        packaged_file(&path)
            .and_then(|bytes| serde_json::from_slice(bytes).ok())
            .ok_or_else(|| CliError::new(ErrorCode::TemplateInvalid, format!("Packaged template file \"{path}\" is missing.")))
    };
    let template = read_json(manifest.get("template").and_then(Value::as_str).unwrap_or("template.json"))?;
    let presets = match manifest.get("colorPresets").and_then(Value::as_str) {
        Some(path) => read_json(path)?,
        None => Value::Object(serde_json::Map::new()),
    };
    let mut assets = IndexMap::new();
    for (asset_id, relative) in manifest.get("assets").and_then(Value::as_object).into_iter().flatten() {
        let path = normalize(&format!("{directory}/{}", relative.as_str().unwrap_or_default()));
        let bytes = packaged_file(&path)
            .ok_or_else(|| CliError::new(ErrorCode::TemplateInvalid, format!("Packaged template asset \"{asset_id}\" is missing.")))?;
        assets.insert(asset_id.clone(), AssetSource::from_bytes(bytes.to_vec(), Some(media_type_for_path(&path).to_owned()), path));
    }
    TemplateBundle::new(manifest, &template, presets, assets).map_err(|error| CliError::new(ErrorCode::TemplateInvalid, error.message()))
}

pub fn store_root() -> PathBuf {
    if let Some(configured) = std::env::var_os("YUGILIFE_TEMPLATE_HOME").filter(|value| !value.is_empty()) {
        return absolute(Path::new(&configured));
    }
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(|value| absolute(Path::new(&value)))
        .unwrap_or_else(|| home_directory().join(".local").join("share"));
    data_home.join("yugilife").join("templates")
}

fn home_directory() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

pub fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map(|directory| directory.join(path)).unwrap_or_else(|_| path.to_path_buf())
    }
}

fn artifact_path(id: &str, version: &str) -> PathBuf {
    let mut path = store_root();
    for part in id.split('/') {
        path.push(percent_encode(part));
    }
    path.join(format!("{version}.json"))
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn validate_artifact(value: &Value) -> Result<TemplateBundle, String> {
    let Value::Object(artifact) = value else {
        return Err("Template artifact must contain an object.".to_owned());
    };
    if artifact.get("format").and_then(Value::as_str) != Some("yugilife-template")
        || artifact.get("formatVersion").and_then(Value::as_f64) != Some(1.0)
    {
        return Err("Template artifact has an unsupported format.".to_owned());
    }
    let Some(Value::Object(asset_values)) = artifact.get("assets") else {
        return Err("Template artifact assets must be an object.".to_owned());
    };
    let mut assets = IndexMap::new();
    for (asset_id, source) in asset_values {
        let Some(url) = source.as_str().filter(|url| url.starts_with("data:") && !asset_id.is_empty()) else {
            return Err(format!("Template artifact asset \"{asset_id}\" must be a data URL."));
        };
        let (media_type, bytes) =
            decode_data_url(url).ok_or_else(|| format!("Template artifact asset \"{asset_id}\" must be a data URL."))?;
        assets.insert(asset_id.clone(), AssetSource::from_bytes(bytes, media_type, asset_id.clone()));
    }
    let manifest = artifact.get("manifest").cloned().unwrap_or(Value::Null);
    validate_template_manifest(&manifest).map_err(|error| error.message().to_owned())?;
    let template = artifact.get("template").cloned().unwrap_or(Value::Null);
    validate_card_template(&template).map_err(|error| error.message().to_owned())?;
    for asset_id in manifest.get("assets").and_then(Value::as_object).into_iter().flatten().map(|(id, _)| id) {
        if !assets.contains_key(asset_id) {
            return Err(format!("Template artifact is missing declared asset \"{asset_id}\"."));
        }
    }
    let presets = artifact.get("colorPresets").cloned().unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    TemplateBundle::new(manifest, &template, presets, assets).map_err(|error| error.message().to_owned())
}

fn read_stored(id: &str, version: &str) -> CliResult<Option<TemplateBundle>> {
    let path = artifact_path(id, version);
    let contents = match std::fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(CliError::new(ErrorCode::TemplateInvalid, format!("Installed template \"{id}@{version}\" is invalid.")));
        }
    };
    let invalid = || CliError::new(ErrorCode::TemplateInvalid, format!("Installed template \"{id}@{version}\" is invalid."));
    let value: Value = serde_json::from_slice(&contents).map_err(|_| invalid())?;
    let bundle = validate_artifact(&value).map_err(|_| invalid())?;
    if bundle.id() != id || bundle.version() != version {
        return Err(invalid());
    }
    Ok(Some(bundle))
}

pub fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    compare_template_versions(left, right).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
}

fn newest_stored_version(id: &str) -> Option<String> {
    let directory = artifact_path(id, "2000.01.01").parent()?.to_path_buf();
    let mut versions: Vec<String> = std::fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().and_then(|name| name.strip_suffix(".json")).map(str::to_owned))
        .filter(|version| template_version_is_valid(version))
        .collect();
    versions.sort_by(|left, right| compare_versions(right, left));
    versions.into_iter().next()
}

fn parse_exact_reference(reference: &str) -> CliResult<(String, String)> {
    let malformed = || {
        CliError::new(
            ErrorCode::ArgumentError,
            format!("Template reference \"{reference}\" must use an exact ID and version, for example card/series-10@2026.08.15."),
        )
    };
    let (id, version) = reference.split_once('@').ok_or_else(malformed)?;
    if id.is_empty() || version.contains('@') || id.chars().any(char::is_whitespace) || version.chars().any(char::is_whitespace) {
        return Err(malformed());
    }
    if !template_version_is_valid(version) {
        return Err(malformed());
    }
    let valid_part = |part: &str| {
        let mut characters = part.chars();
        characters.next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
            && characters.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
    };
    let parts: Vec<&str> = id.split('/').collect();
    if parts.len() < 2 || !parts.iter().all(|part| valid_part(part)) {
        return Err(CliError::new(ErrorCode::ArgumentError, format!("Template ID \"{id}\" is malformed.")));
    }
    Ok((id.to_owned(), version.to_owned()))
}

fn bundles() -> &'static Mutex<HashMap<String, Arc<TemplateBundle>>> {
    static BUNDLES: OnceLock<Mutex<HashMap<String, Arc<TemplateBundle>>>> = OnceLock::new();
    BUNDLES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached(key: &str) -> Option<Arc<TemplateBundle>> {
    bundles().lock().ok().and_then(|bundles| bundles.get(key).cloned())
}

fn cached_bundle(key: String, load: impl FnOnce() -> CliResult<TemplateBundle>) -> CliResult<Arc<TemplateBundle>> {
    let mut bundles = bundles().lock().map_err(|_| CliError::new(ErrorCode::InternalError, "Template cache is unavailable."))?;
    if let Some(bundle) = bundles.get(&key) {
        return Ok(bundle.clone());
    }
    let bundle = Arc::new(load()?);
    bundles.insert(key, bundle.clone());
    Ok(bundle)
}

pub fn resolve_template(reference: Option<&str>) -> CliResult<Arc<TemplateBundle>> {
    let exact = match reference.filter(|reference| reference.contains('@')) {
        Some(reference) => Some(parse_exact_reference(reference)?),
        None => None,
    };
    let default_id = default_template_id();
    let requested_id = exact.as_ref().map(|(id, _)| id.clone()).or_else(|| reference.map(str::to_owned)).unwrap_or(default_id.clone());
    if let Some(identity) = packaged_identities().into_iter().find(|identity| identity.id == requested_id)
        && exact.as_ref().is_none_or(|(_, version)| *version == identity.version)
    {
        return cached_bundle(format!("packaged:{}", identity.id), || load_packaged(&identity.id));
    }
    let candidate = match (&exact, reference) {
        (Some((id, version)), _) => Some((id.clone(), Some(version.clone()))),
        (None, Some(reference)) => Some((reference.to_owned(), newest_stored_version(reference))),
        (None, None) => None,
    };
    if let Some((id, Some(version))) = candidate {
        let key = format!("stored:{id}@{version}");
        if let Some(bundle) = cached(&key) {
            return Ok(bundle);
        }
        if let Some(bundle) = read_stored(&id, &version)? {
            return cached_bundle(key, || Ok(bundle));
        }
    }
    let requested = reference.map_or(default_id, str::to_owned);
    let hint = if requested.contains('@') { requested.clone() } else { format!("{requested}@<version>") };
    Err(CliError::new(
        ErrorCode::TemplateNotInstalled,
        format!("Template \"{requested}\" is not installed. Run yugilife-cli templates install {hint}."),
    ))
}

pub fn list_templates() -> Vec<(TemplateIdentity, &'static str)> {
    let mut templates: Vec<(TemplateIdentity, &'static str)> =
        packaged_identities().into_iter().map(|identity| (identity, "packaged")).collect();
    let mut pending = vec![store_root()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|extension| extension == "json") {
                let Some(bundle) = std::fs::read(&path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                    .and_then(|value| validate_artifact(&value).ok())
                else {
                    continue;
                };
                templates.push((identity_of(&bundle.manifest), "installed"));
            }
        }
    }
    templates.sort_by(|(left, _), (right, _)| left.id.cmp(&right.id).then_with(|| compare_versions(&left.version, &right.version)));
    templates
}

fn fetch(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    if let Some(path) = url.strip_prefix("file://") {
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > limit {
            return Err("Downloaded template exceeds its declared or permitted size.".to_owned());
        }
        return Ok(bytes);
    }
    let response = ureq::get(url).call().map_err(|error| error.to_string())?;
    let mut body = response.into_body();
    body.with_config().limit(limit.saturating_add(1)).read_to_vec().map_err(|error| error.to_string())
}

fn resolve_url(base: &str, relative: &str) -> String {
    if relative.contains("://") {
        return relative.to_owned();
    }
    if relative.starts_with('/')
        && let Some((scheme, rest)) = base.split_once("://")
    {
        let host = rest.split('/').next().unwrap_or_default();
        return if scheme == "file" { format!("file://{relative}") } else { format!("{scheme}://{host}{relative}") };
    }
    match base.rfind('/') {
        Some(index) => format!("{}/{relative}", &base[..index]),
        None => relative.to_owned(),
    }
}

pub fn install_template(reference: &str, registry: Option<&str>) -> CliResult<bool> {
    let (id, version) = parse_exact_reference(reference)?;
    if packaged_identities().iter().any(|identity| identity.id == id && identity.version == version) {
        return Ok(true);
    }
    if read_stored(&id, &version)?.is_some() {
        return Ok(true);
    }
    let registry = registry
        .map(str::to_owned)
        .or_else(|| std::env::var("YUGILIFE_TEMPLATE_REGISTRY_URL").ok().filter(|value| !value.is_empty()))
        .ok_or_else(|| {
            CliError::new(
                ErrorCode::TemplateRegistryUnavailable,
                "No template registry is configured. Pass --registry <catalog-url> or set YUGILIFE_TEMPLATE_REGISTRY_URL.",
            )
        })?;
    let unavailable = || CliError::new(ErrorCode::TemplateRegistryUnavailable, format!("Could not read template registry \"{registry}\"."));
    let catalog_bytes = fetch(&registry, MAXIMUM_ARTIFACT_BYTES).map_err(|_| unavailable())?;
    let catalog: Value = serde_json::from_slice(&catalog_bytes).map_err(|_| unavailable())?;
    let entry = catalog
        .get("templates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|entry| {
            entry.get("id").and_then(Value::as_str) == Some(id.as_str())
                && entry.get("version").and_then(Value::as_str) == Some(version.as_str())
                && entry.get("url").is_some_and(Value::is_string)
                && entry
                    .get("sha256")
                    .and_then(Value::as_str)
                    .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
                && entry
                    .get("size")
                    .and_then(Value::as_f64)
                    .is_some_and(|size| size > 0.0 && size.fract() == 0.0 && size <= MAXIMUM_ARTIFACT_BYTES as f64)
        })
        .ok_or_else(|| CliError::new(ErrorCode::TemplateNotFound, format!("Registry does not contain \"{reference}\".")))?;
    let size = entry.get("size").and_then(Value::as_f64).unwrap_or(0.0) as u64;
    let url = resolve_url(&registry, entry.get("url").and_then(Value::as_str).unwrap_or_default());
    let bytes = fetch(&url, size).map_err(|error| CliError::new(ErrorCode::InternalError, error))?;
    if bytes.len() as u64 != size {
        return Err(CliError::new(
            ErrorCode::InternalError,
            if bytes.len() as u64 > size {
                "Downloaded template exceeds its declared or permitted size.".to_owned()
            } else {
                format!("Downloaded {} bytes; registry declared {size}.", bytes.len())
            },
        ));
    }
    let digest: String = Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect();
    if Some(digest.as_str()) != entry.get("sha256").and_then(Value::as_str) {
        return Err(CliError::new(ErrorCode::TemplateInvalid, format!("Integrity verification failed for \"{reference}\".")));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| CliError::new(ErrorCode::TemplateInvalid, format!("Downloaded artifact for \"{reference}\" is invalid.")))?;
    let bundle = validate_artifact(&value)
        .map_err(|_| CliError::new(ErrorCode::TemplateInvalid, format!("Downloaded artifact for \"{reference}\" is invalid.")))?;
    if bundle.id() != id || bundle.version() != version {
        return Err(CliError::new(ErrorCode::TemplateInvalid, format!("Downloaded artifact identity does not match \"{reference}\".")));
    }
    let destination = artifact_path(&id, &version);
    let write_failed = |error: std::io::Error| CliError::new(ErrorCode::InternalError, error.to_string());
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(write_failed)?;
    }
    let temporary = destination.with_extension(format!("json.{}.tmp", std::process::id()));
    let result = std::fs::write(&temporary, &bytes).and_then(|()| std::fs::rename(&temporary, &destination));
    let _ = std::fs::remove_file(&temporary);
    result.map_err(write_failed)?;
    Ok(false)
}

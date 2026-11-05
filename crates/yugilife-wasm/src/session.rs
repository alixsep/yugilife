//! State kept between calls. The module runs on one thread (a Web Worker), so it is thread-local.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use yugilife_core::assets::{AssetSource, Resolved};
use yugilife_core::bundle::TemplateBundle;
use yugilife_core::manifest::RenderManifest;
use yugilife_core::model::{CardTemplate, Layer};
use yugilife_core::raster::decode::SharedDecoded;
use yugilife_core::render::DecodedAssetCache;

/// Data a host registered once and refers to by key in later calls: card templates and layer
/// arrays, which the synchronous operations receive far more often than they change.
pub enum Registered {
    Template(Arc<CardTemplate>),
    Layers(Arc<Vec<Layer>>),
}

thread_local! {
    static REGISTERED: RefCell<HashMap<String, Registered>> = RefCell::new(HashMap::new());
    static TEMPLATES: RefCell<HashMap<String, Arc<TemplateBundle>>> = RefCell::new(HashMap::new());
    /// The previous render's card assets by host reference. Passing the same source again while its
    /// bytes are unchanged lets `DECODED` skip decoding, as when an editor re-renders after a text edit.
    static SOURCES: RefCell<HashMap<String, AssetSource>> = RefCell::new(HashMap::new());
    static DECODED: DecodedAssetCache = DecodedAssetCache::new();
    /// Assets a host decoded itself, by reference, with the bytes they were decoded from; a render
    /// that receives the same bytes uses them instead of decoding.
    static PREDECODED: RefCell<HashMap<String, (Vec<u8>, SharedDecoded)>> = RefCell::new(HashMap::new());
    /// The most recent manifest, whose alpha channels the host encodes on demand.
    static MANIFEST: RefCell<Option<(u64, RenderManifest)>> = const { RefCell::new(None) };
}

pub fn store_template(id: &str, bundle: TemplateBundle) {
    TEMPLATES.with(|templates| templates.borrow_mut().insert(id.to_owned(), Arc::new(bundle)));
}

pub fn drop_template(id: &str) {
    TEMPLATES.with(|templates| templates.borrow_mut().remove(id));
}

pub fn template(id: &str) -> Result<Arc<TemplateBundle>, String> {
    TEMPLATES.with(|templates| templates.borrow().get(id).cloned()).ok_or_else(|| format!("Template \"{id}\" is not loaded."))
}

fn same_bytes(source: &AssetSource, bytes: &[u8]) -> bool {
    match source.read() {
        Ok(Resolved::Borrowed(existing, _)) => existing == bytes,
        Ok(Resolved::Owned(existing, _)) => existing == bytes,
        Err(_) => false,
    }
}

/// Collects the card assets of one call, reusing the previous call's sources where they match.
#[derive(Default)]
pub struct Sources {
    used: HashMap<String, AssetSource>,
}

impl Sources {
    pub fn source(&mut self, reference: &str, bytes: &[u8], media_type: Option<&str>) -> AssetSource {
        let previous = SOURCES.with(|sources| sources.borrow().get(reference).filter(|source| same_bytes(source, bytes)).cloned());
        let source =
            previous.unwrap_or_else(|| AssetSource::from_bytes(bytes.to_vec(), media_type.map(str::to_owned), reference.to_owned()));
        self.used.insert(reference.to_owned(), source.clone());
        source
    }

    /// Keeps this call's sources for the next call and releases the rest.
    pub fn commit(self) {
        SOURCES.with(|sources| *sources.borrow_mut() = self.used);
    }
}

pub fn with_decoded<T>(run: impl FnOnce(&DecodedAssetCache) -> T) -> T {
    DECODED.with(run)
}

pub fn store_manifest(serial: u64, manifest: RenderManifest) {
    MANIFEST.with(|slot| *slot.borrow_mut() = Some((serial, manifest)));
}

pub fn with_manifest<T>(serial: u64, run: impl FnOnce(&RenderManifest) -> T) -> Result<T, String> {
    MANIFEST.with(|slot| match &*slot.borrow() {
        Some((current, manifest)) if *current == serial => Ok(run(manifest)),
        _ => Err("This render manifest is no longer available; create it again.".to_owned()),
    })
}

pub fn register(key: &str, value: Registered) {
    REGISTERED.with(|registered| registered.borrow_mut().insert(key.to_owned(), value));
}

pub fn release(key: &str) {
    REGISTERED.with(|registered| registered.borrow_mut().remove(key));
}

pub fn registered_template(key: &str) -> Result<Arc<CardTemplate>, String> {
    REGISTERED.with(|registered| match registered.borrow().get(key) {
        Some(Registered::Template(template)) => Ok(template.clone()),
        _ => Err(format!("No card template is registered as \"{key}\".")),
    })
}

pub fn registered_layers(key: &str) -> Result<Arc<Vec<Layer>>, String> {
    REGISTERED.with(|registered| match registered.borrow().get(key) {
        Some(Registered::Layers(layers)) => Ok(layers.clone()),
        _ => Err(format!("No layer array is registered as \"{key}\".")),
    })
}

pub fn store_predecoded(reference: &str, bytes: Vec<u8>, decoded: SharedDecoded) {
    PREDECODED.with(|predecoded| predecoded.borrow_mut().insert(reference.to_owned(), (bytes, decoded)));
}

/// The host-decoded form of `reference`, when it was decoded from exactly `bytes`.
pub fn take_predecoded(reference: &str, bytes: &[u8]) -> Option<SharedDecoded> {
    PREDECODED.with(|predecoded| {
        let mut predecoded = predecoded.borrow_mut();
        let matches = predecoded.get(reference).is_some_and(|(stored, _)| stored == bytes);
        if matches { predecoded.remove(reference).map(|(_, decoded)| decoded) } else { None }
    })
}

/// Whether a render of `reference` with these bytes would find it decoded already.
pub fn is_decoded(reference: &str, bytes: &[u8]) -> bool {
    let predecoded = PREDECODED.with(|predecoded| predecoded.borrow().get(reference).is_some_and(|(stored, _)| stored == bytes));
    predecoded
        || SOURCES.with(|sources| {
            sources
                .borrow()
                .get(reference)
                .filter(|source| same_bytes(source, bytes))
                .is_some_and(|source| DECODED.with(|decoded| decoded.contains(source)))
        })
}

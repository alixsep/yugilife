// Links the dav1d C API that rav1d implements, which the dav1d crate calls on WebAssembly.
#[cfg(target_family = "wasm")]
extern crate rav1d as _;

pub mod assets;
pub mod bundle;
pub mod card;
pub mod error;
pub mod export;
pub mod js;
pub mod manifest;
pub mod model;
pub mod number;
pub mod presentation;
pub mod raster;
pub mod render;
pub mod rich_text;
pub mod semantics;
pub mod source_fields;
pub mod svg;
pub mod text;
pub mod validation;

pub use error::{Error, Result};

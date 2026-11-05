//! WebAssembly entry points for yugilife-core.
//!
//! The host passes packs (see `pack`) and reads the outputs back through `ffi`. `app` serves the
//! JavaScript `yugilife-core-wasm` package; `harness` serves the reference tooling that compares
//! this build with the native CLI. The logic is safe Rust that can run natively; only `ffi` touches
//! raw memory.

pub mod app;
mod avif;
pub mod ffi;
pub mod harness;
pub mod pack;
mod session;
pub mod sync;

pub use harness::{load_bundle, render};

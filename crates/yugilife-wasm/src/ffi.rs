//! The raw WebAssembly ABI. The host allocates input with `yl_alloc`, calls an entry point with a
//! pointer and length, and reads the outputs (or, on failure, one UTF-8 error message) back with
//! `yl_output_count`, `yl_output_ptr` and `yl_output_len` before the next call replaces them.
#![allow(unsafe_code)]

use std::cell::RefCell;

thread_local! {
    static OUTPUTS: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
}

/// # Safety
/// `pointer` must address at least `length` initialized bytes obtained from `yl_alloc`.
unsafe fn input<'a>(pointer: *const u8, length: usize) -> &'a [u8] {
    if length == 0 {
        return &[];
    }
    // SAFETY: guaranteed by the caller.
    unsafe { std::slice::from_raw_parts(pointer, length) }
}

fn finish(result: Result<Vec<Vec<u8>>, String>) -> i32 {
    let (status, outputs) = match result {
        Ok(outputs) => (0, outputs),
        Err(message) => (1, vec![message.into_bytes()]),
    };
    OUTPUTS.with(|slot| *slot.borrow_mut() = outputs);
    status
}

#[unsafe(no_mangle)]
pub extern "C" fn yl_alloc(length: usize) -> *mut u8 {
    let mut buffer = std::mem::ManuallyDrop::new(Vec::<u8>::with_capacity(length));
    buffer.as_mut_ptr()
}

/// # Safety
/// `pointer` and `length` must come from one `yl_alloc` call, and the buffer must not be used after.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yl_free(pointer: *mut u8, length: usize) {
    // SAFETY: guaranteed by the caller; `yl_alloc` created a buffer with exactly this capacity.
    drop(unsafe { Vec::from_raw_parts(pointer, 0, length) });
}

/// # Safety
/// `pointer` must address `length` initialized bytes obtained from `yl_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yl_load_bundle(pointer: *const u8, length: usize) -> i32 {
    // SAFETY: guaranteed by the caller.
    finish(crate::load_bundle(unsafe { input(pointer, length) }).map(|()| Vec::new()))
}

/// # Safety
/// `pointer` must address `length` initialized bytes obtained from `yl_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yl_call(pointer: *const u8, length: usize) -> i32 {
    // SAFETY: guaranteed by the caller.
    finish(crate::app::call(unsafe { input(pointer, length) }))
}

/// # Safety
/// `pointer` must address `length` initialized bytes obtained from `yl_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yl_render(pointer: *const u8, length: usize) -> i32 {
    // SAFETY: guaranteed by the caller.
    finish(crate::render(unsafe { input(pointer, length) }))
}

#[unsafe(no_mangle)]
pub extern "C" fn yl_output_count() -> usize {
    OUTPUTS.with(|slot| slot.borrow().len())
}

#[unsafe(no_mangle)]
pub extern "C" fn yl_output_ptr(index: usize) -> *const u8 {
    OUTPUTS.with(|slot| slot.borrow().get(index).map_or(std::ptr::null(), |output| output.as_ptr()))
}

#[unsafe(no_mangle)]
pub extern "C" fn yl_output_len(index: usize) -> usize {
    OUTPUTS.with(|slot| slot.borrow().get(index).map_or(0, Vec::len))
}

//! Utility functions for WASM bindings to reduce boilerplate.

use conduit_core::{FileOperation, ReplaceLinesResponse};
use js_sys::{Array, Object};
use wasm_bindgen::prelude::*;

#[macro_export]
macro_rules! js_err {
    ($msg:expr) => {
        JsValue::from_str($msg)
    };
    ($fmt:expr, $($arg:tt)*) => {
        JsValue::from_str(&format!($fmt, $($arg)*))
    };
}

/// Extract a string field from a JavaScript object.
pub fn get_string_field(obj: &Object, field: &str) -> Result<String, JsValue> {
    js_sys::Reflect::get(obj, &JsValue::from_str(field))?
        .as_string()
        .ok_or_else(|| js_err!("Missing or invalid '{}' field", field))
}

/// Extract a usize field from a JavaScript object.
pub fn get_usize_field(obj: &Object, field: &str) -> Result<usize, JsValue> {
    let value = js_sys::Reflect::get(obj, &JsValue::from_str(field))?
        .as_f64()
        .ok_or_else(|| js_err!("Missing or invalid '{}' field", field))?;
    if value < 0.0 {
        return Err(js_err!("Field '{}' must be non-negative", field));
    }
    Ok(value as usize)
}

/// Parse an array of file operations from JavaScript.
pub fn parse_file_operations(array: &Array) -> Result<Vec<FileOperation>, JsValue> {
    use crate::globals::create_path_key;

    let mut operations = Vec::new();

    for i in 0..array.length() {
        let op = array.get(i);
        if let Some(obj) = op.dyn_ref::<Object>() {
            let src = get_string_field(obj, "src")?;
            let dst = get_string_field(obj, "dst")?;

            let src_key = create_path_key(&src)
                .map_err(|e| js_err!("Invalid source path '{}': {}", src, e))?;
            let dst_key = create_path_key(&dst)
                .map_err(|e| js_err!("Invalid destination path '{}': {}", dst, e))?;

            operations.push(FileOperation {
                src: src_key,
                dst: dst_key,
            });
        } else {
            return Err(js_err!(
                "Each operation must be an object with 'src' and 'dst' fields"
            ));
        }
    }

    Ok(operations)
}

/// Build a standard response for line operations.
pub fn build_line_operation_response(response: &ReplaceLinesResponse) -> Result<JsValue, JsValue> {
    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response.path.as_str()))?
        .set(
            "linesReplaced",
            JsValue::from(response.lines_replaced as u32),
        )?
        .set("linesAdded", JsValue::from(response.lines_added as i32))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .set(
            "originalLines",
            JsValue::from(response.original_lines as u32),
        )?
        .build();
    Ok(obj)
}

/// Helper for building JavaScript objects.
pub struct JsObjectBuilder {
    obj: Object,
}

impl JsObjectBuilder {
    pub fn new() -> Self {
        Self { obj: Object::new() }
    }

    pub fn set(self, key: &str, value: JsValue) -> Result<Self, JsValue> {
        js_sys::Reflect::set(&self.obj, &JsValue::from_str(key), &value)
            .map_err(|e| js_err!("Failed to set property '{}': {:?}", key, e))?;
        Ok(self)
    }

    pub fn build(self) -> JsValue {
        self.obj.into()
    }
}

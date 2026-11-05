use serde_json::Value;

/// One call's input: a little-endian `u32` header length, a JSON header, then a byte payload whose
/// files the header's `files` entries address as `[offset, length]`.
pub struct Pack<'a> {
    pub header: Value,
    payload: &'a [u8],
}

impl<'a> Pack<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, String> {
        let length = bytes.get(..4).ok_or("Pack is truncated.")?;
        let length = u32::from_le_bytes([length[0], length[1], length[2], length[3]]) as usize;
        let header = bytes.get(4..4 + length).ok_or("Pack header is truncated.")?;
        let header = serde_json::from_slice(header).map_err(|error| format!("Pack header is not JSON: {error}"))?;
        Ok(Self { header, payload: &bytes[4 + length..] })
    }

    pub fn file(&self, name: &str) -> Option<&'a [u8]> {
        let range = self.header.get("files")?.get(name)?.as_array()?;
        let offset = range.first()?.as_u64()? as usize;
        let length = range.get(1)?.as_u64()? as usize;
        self.payload.get(offset..offset.checked_add(length)?)
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.header.get(key).and_then(Value::as_str)
    }
}

/// One call's output: a JSON response followed by binary buffers that the response refers to by
/// index (`{"buffer": n}` refers to buffer `n`, counting from 0 after the JSON).
#[derive(Default)]
pub struct Reply {
    buffers: Vec<Vec<u8>>,
}

impl Reply {
    pub fn buffer(&mut self, bytes: Vec<u8>) -> usize {
        self.buffers.push(bytes);
        self.buffers.len() - 1
    }

    pub fn finish(self, response: &Value) -> Vec<Vec<u8>> {
        let mut outputs = Vec::with_capacity(self.buffers.len() + 1);
        outputs.push(response.to_string().into_bytes());
        outputs.extend(self.buffers);
        outputs
    }
}

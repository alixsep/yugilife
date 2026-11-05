use serde_json::Value;

use crate::number::js_number;

#[derive(Debug, Clone, PartialEq)]
pub enum AttributeValue {
    Number(f64),
    Text(String),
}

impl AttributeValue {
    pub fn to_js_string(&self) -> String {
        match self {
            Self::Number(value) => js_number(*value),
            Self::Text(value) => value.clone(),
        }
    }

    fn from_json(value: &Value) -> Self {
        match value {
            Value::Number(number) => Self::Number(number.as_f64().unwrap_or(0.0)),
            Value::String(text) => Self::Text(text.clone()),
            other => Self::Text(other.to_string()),
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Self::Number(value) => serde_json::Number::from_f64(*value).map_or(Value::Null, Value::Number),
            Self::Text(value) => Value::String(value.clone()),
        }
    }
}

impl From<f64> for AttributeValue {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}

impl From<&str> for AttributeValue {
    fn from(value: &str) -> Self {
        Self::Text(value.to_owned())
    }
}

impl From<String> for AttributeValue {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SvgElement {
    pub tag: String,
    pub attributes: Vec<(String, AttributeValue)>,
    pub children: Vec<SvgElement>,
    pub text: Option<String>,
}

impl SvgElement {
    pub fn new(tag: &str) -> Self {
        Self { tag: tag.to_owned(), ..Self::default() }
    }

    pub fn attribute(&self, name: &str) -> Option<&AttributeValue> {
        self.attributes.iter().find(|(key, _)| key == name).map(|(_, value)| value)
    }

    pub fn set(&mut self, name: &str, value: impl Into<AttributeValue>) {
        let value = value.into();
        match self.attributes.iter_mut().find(|(key, _)| key == name) {
            Some(entry) => entry.1 = value,
            None => self.attributes.push((name.to_owned(), value)),
        }
    }

    pub fn from_json(value: &Value) -> Self {
        let attributes = value
            .get("attributes")
            .and_then(Value::as_object)
            .map(|map| map.iter().map(|(key, value)| (key.clone(), AttributeValue::from_json(value))).collect())
            .unwrap_or_default();
        let children = value
            .get("children")
            .and_then(Value::as_array)
            .map(|children| children.iter().map(Self::from_json).collect())
            .unwrap_or_default();
        Self {
            tag: value.get("tag").and_then(Value::as_str).unwrap_or_default().to_owned(),
            attributes,
            children,
            text: value.get("text").and_then(Value::as_str).map(str::to_owned),
        }
    }

    pub fn to_json(&self) -> Value {
        let mut object = serde_json::Map::new();
        if !self.attributes.is_empty() {
            object.insert(
                "attributes".to_owned(),
                Value::Object(self.attributes.iter().map(|(key, value)| (key.clone(), value.to_json())).collect()),
            );
        }
        if !self.children.is_empty() {
            object.insert("children".to_owned(), Value::Array(self.children.iter().map(Self::to_json).collect()));
        }
        object.insert("tag".to_owned(), Value::String(self.tag.clone()));
        if let Some(text) = &self.text {
            object.insert("text".to_owned(), Value::String(text.clone()));
        }
        Value::Object(object)
    }

    pub fn contains_text(&self) -> bool {
        self.tag == "text" || self.tag == "tspan" || self.children.iter().any(Self::contains_text)
    }

    pub fn serialize_into(&self, output: &mut String) {
        output.push('<');
        output.push_str(&self.tag);
        for (name, value) in &self.attributes {
            output.push(' ');
            output.push_str(name);
            output.push_str("=\"");
            escape_xml_into(&value.to_js_string(), output);
            output.push('"');
        }
        output.push('>');
        if let Some(text) = &self.text {
            escape_xml_into(text, output);
        }
        for child in &self.children {
            child.serialize_into(output);
        }
        output.push_str("</");
        output.push_str(&self.tag);
        output.push('>');
    }

    pub fn serialize(&self) -> String {
        let mut output = String::new();
        self.serialize_into(&mut output);
        output
    }
}

pub fn escape_xml_into(value: &str, output: &mut String) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&apos;"),
            other => output.push(other),
        }
    }
}

pub fn escape_xml(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    escape_xml_into(value, &mut output);
    output
}

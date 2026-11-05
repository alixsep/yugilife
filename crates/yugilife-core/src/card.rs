use indexmap::IndexMap;
use serde_json::Value;

use crate::assets::AssetSource;

#[derive(Debug, Clone)]
pub enum CardValue {
    Json(Value),
    Asset(AssetSource),
}

impl CardValue {
    pub fn json(&self) -> Option<&Value> {
        match self {
            Self::Json(value) => Some(value),
            Self::Asset(_) => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CardData {
    fields: IndexMap<String, CardValue>,
}

impl CardData {
    pub fn from_json(fields: &serde_json::Map<String, Value>) -> Self {
        Self { fields: fields.iter().map(|(name, value)| (name.clone(), CardValue::Json(value.clone()))).collect() }
    }

    pub fn get(&self, name: &str) -> Option<&CardValue> {
        self.fields.get(name)
    }

    pub fn json(&self, name: &str) -> Option<&Value> {
        self.fields.get(name).and_then(CardValue::json)
    }

    pub fn insert(&mut self, name: impl Into<String>, value: CardValue) {
        self.fields.insert(name.into(), value);
    }

    pub fn fields(&self) -> impl Iterator<Item = (&String, &CardValue)> {
        self.fields.iter()
    }
}

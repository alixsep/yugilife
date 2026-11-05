use std::collections::HashMap;

use indexmap::IndexSet;
use serde_json::Value;

use crate::model::{CardTemplate, Condition, Layer, LayerBody, PresentationRule, SemanticFallback, SourceReference, SourceValue};
use crate::presentation::{ResolvedCardPresentation, matches_presentation_gate};

fn condition_paths(condition: Option<&Condition>) -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(condition) = condition {
        condition.paths(&mut paths);
    }
    paths
}

fn semantic_field_dependencies(template: &CardTemplate) -> HashMap<String, IndexSet<String>> {
    let mut dependencies: HashMap<String, IndexSet<String>> = HashMap::new();
    for binding in &template.bindings {
        let mut fields = IndexSet::new();
        if let SourceValue::Field(field) = &binding.source {
            fields.insert(field.clone());
        }
        for path in condition_paths(binding.when.as_ref()) {
            if let Some(known) = dependencies.get(&path) {
                fields.extend(known.iter().cloned());
            }
        }
        if let Some(SemanticFallback::ListLength { source, .. }) = &binding.fallback {
            match source {
                SourceReference::Field(field) => {
                    fields.insert(field.clone());
                }
                SourceReference::Path(path) => {
                    if let Some(known) = dependencies.get(path) {
                        fields.extend(known.iter().cloned());
                    }
                }
            }
        }
        dependencies.insert(binding.path.clone(), fields);
    }
    dependencies
}

fn rule_affects_layer(rule: &PresentationRule, layer: &Layer) -> bool {
    let id = &layer.id;
    rule.layer_visibility.contains_key(id)
        || rule.layer_regions.contains_key(id)
        || rule.layer_options.contains_key(id)
        || rule.asset_selections.contains_key(id)
        || rule.mask_selections.contains_key(id)
        || rule.text_values.contains_key(id)
        || rule.text_positions.contains_key(id)
        || layer.json.get("presetTarget").and_then(Value::as_str).is_some_and(|target| rule.presets.contains_key(target))
}

pub struct SourceFieldResolver<'a> {
    template: &'a CardTemplate,
    presentation: &'a ResolvedCardPresentation,
    dependencies: HashMap<String, IndexSet<String>>,
}

impl<'a> SourceFieldResolver<'a> {
    pub fn new(template: &'a CardTemplate, presentation: &'a ResolvedCardPresentation) -> Self {
        Self { template, presentation, dependencies: semantic_field_dependencies(template) }
    }

    pub fn fields(&self, layer: &Layer) -> Vec<String> {
        let mut fields = IndexSet::new();
        let add_path = |fields: &mut IndexSet<String>, path: &str| {
            if let Some(known) = self.dependencies.get(path) {
                fields.extend(known.iter().cloned());
            }
        };
        for key in ["field", "maskField", "fallbackField"] {
            if let Some(field) = layer.json.get(key).and_then(Value::as_str) {
                fields.insert(field.to_owned());
            }
        }
        if let Some(path) = layer.json.get("semanticPath").and_then(Value::as_str) {
            add_path(&mut fields, path);
        }
        let active = |when: Option<&Condition>, transforms| {
            matches_presentation_gate(&self.presentation.semantics, &self.presentation.artwork_transforms, when, transforms)
        };
        if let LayerBody::Text(text) = &layer.body {
            for style in text.semantic_styles.iter().filter(|style| active(style.when.as_ref(), style.when_transforms.as_ref())) {
                for path in condition_paths(style.when.as_ref()) {
                    add_path(&mut fields, &path);
                }
            }
        }
        for rule in self
            .template
            .rules
            .iter()
            .filter(|rule| rule_affects_layer(rule, layer) && active(rule.when.as_ref(), rule.when_transforms.as_ref()))
        {
            for path in condition_paths(rule.when.as_ref()) {
                add_path(&mut fields, &path);
            }
        }
        fields.into_iter().collect()
    }
}

pub fn layer_source_fields(template: &CardTemplate, layer: &Layer, presentation: &ResolvedCardPresentation) -> Vec<String> {
    SourceFieldResolver::new(template, presentation).fields(layer)
}

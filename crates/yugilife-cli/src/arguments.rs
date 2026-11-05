use std::collections::{HashMap, VecDeque};

use crate::errors::{CliError, CliResult, ErrorCode};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Boolean,
    Text,
}

struct OptionSpec {
    name: &'static str,
    short: Option<char>,
    kind: Kind,
}

const OPTIONS: &[OptionSpec] = &[
    OptionSpec { name: "background", short: None, kind: Kind::Text },
    OptionSpec { name: "help", short: Some('h'), kind: Kind::Boolean },
    OptionSpec { name: "height", short: None, kind: Kind::Text },
    OptionSpec { name: "output", short: Some('o'), kind: Kind::Text },
    OptionSpec { name: "output-dir", short: None, kind: Kind::Text },
    OptionSpec { name: "format", short: None, kind: Kind::Text },
    OptionSpec { name: "jobs", short: Some('j'), kind: Kind::Text },
    OptionSpec { name: "quality", short: None, kind: Kind::Text },
    OptionSpec { name: "registry", short: None, kind: Kind::Text },
    OptionSpec { name: "scale", short: None, kind: Kind::Text },
    OptionSpec { name: "template", short: None, kind: Kind::Text },
    OptionSpec { name: "text-mode", short: None, kind: Kind::Text },
    OptionSpec { name: "timings", short: None, kind: Kind::Text },
    OptionSpec { name: "title", short: None, kind: Kind::Text },
    OptionSpec { name: "use-default-template", short: None, kind: Kind::Boolean },
    OptionSpec { name: "version", short: Some('v'), kind: Kind::Boolean },
    OptionSpec { name: "width", short: None, kind: Kind::Text },
];

#[derive(Default)]
pub struct Arguments {
    pub positionals: Vec<String>,
    values: HashMap<&'static str, Option<String>>,
}

impl Arguments {
    pub fn text(&self, name: &str) -> Option<&str> {
        self.values.get(name).and_then(|value| value.as_deref())
    }

    pub fn flag(&self, name: &str) -> bool {
        self.values.contains_key(name)
    }
}

fn argument_error(message: String) -> CliError {
    CliError::new(ErrorCode::ArgumentError, message)
}

fn spec_by_name(name: &str) -> Option<&'static OptionSpec> {
    OPTIONS.iter().find(|spec| spec.name == name)
}

fn spec_by_short(short: char) -> Option<&'static OptionSpec> {
    OPTIONS.iter().find(|spec| spec.short == Some(short))
}

fn short_and_long(spec: &OptionSpec) -> String {
    match spec.short {
        Some(short) => format!("-{short}, --{}", spec.name),
        None => format!("--{}", spec.name),
    }
}

fn unknown(raw: &str) -> CliError {
    argument_error(format!(
        "Unknown option '{raw}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{raw}\""
    ))
}

struct Token {
    raw_name: String,
    name: String,
    value: Option<String>,
    inline_value: bool,
}

fn check_token(token: &Token) -> CliResult<&'static OptionSpec> {
    let spec = spec_by_name(&token.name).ok_or_else(|| unknown(&token.raw_name))?;
    if spec.kind == Kind::Text
        && let Some(value) = &token.value
        && !token.inline_value
        && value.len() > 1
        && value.starts_with('-')
    {
        let example = if token.raw_name.starts_with("--") {
            format!("'{}=-XYZ'", token.raw_name)
        } else {
            format!("'--{}=-XYZ' or '{}-XYZ'", token.name, token.raw_name)
        };
        return Err(argument_error(format!(
            "Option '{raw}' argument is ambiguous.\nDid you forget to specify the option argument for '{raw}'?\nTo specify an option argument starting with a dash use {example}.",
            raw = token.raw_name
        )));
    }
    match spec.kind {
        Kind::Text if token.value.is_none() => Err(argument_error(format!("Option '{} <value>' argument missing", short_and_long(spec)))),
        Kind::Boolean if token.value.is_some() => {
            Err(argument_error(format!("Option '{}' does not take an argument", short_and_long(spec))))
        }
        _ => Ok(spec),
    }
}

pub fn parse_arguments(arguments: Vec<String>) -> CliResult<Arguments> {
    let mut remaining: VecDeque<String> = arguments.into();
    let mut parsed = Arguments::default();
    while let Some(argument) = remaining.pop_front() {
        if argument == "--" {
            parsed.positionals.extend(remaining.drain(..));
            break;
        }
        let token = if let Some(long) = argument.strip_prefix("--") {
            match long.split_once('=') {
                Some((name, value)) => {
                    Token { raw_name: format!("--{name}"), name: name.to_owned(), value: Some(value.to_owned()), inline_value: true }
                }
                None => {
                    let value = if spec_by_name(long).is_some_and(|spec| spec.kind == Kind::Text) { remaining.pop_front() } else { None };
                    Token { raw_name: argument.clone(), name: long.to_owned(), value, inline_value: false }
                }
            }
        } else if argument.len() > 1 && argument.starts_with('-') {
            let characters: Vec<char> = argument.chars().skip(1).collect();
            let first = characters[0];
            let first_spec = spec_by_short(first);
            if characters.len() > 1 {
                if first_spec.is_some_and(|spec| spec.kind == Kind::Text) {
                    let spec = first_spec.map_or("", |spec| spec.name);
                    Token {
                        raw_name: format!("-{first}"),
                        name: spec.to_owned(),
                        value: Some(characters[1..].iter().collect()),
                        inline_value: true,
                    }
                } else {
                    let mut expanded = Vec::new();
                    for (index, short) in characters.iter().enumerate() {
                        let is_text = spec_by_short(*short).is_some_and(|spec| spec.kind == Kind::Text);
                        if !is_text || index == characters.len() - 1 {
                            expanded.push(format!("-{short}"));
                        } else {
                            expanded.push(format!("-{}", characters[index..].iter().collect::<String>()));
                            break;
                        }
                    }
                    for item in expanded.into_iter().rev() {
                        remaining.push_front(item);
                    }
                    continue;
                }
            } else {
                let name = first_spec.map_or_else(|| first.to_string(), |spec| spec.name.to_owned());
                let value = if first_spec.is_some_and(|spec| spec.kind == Kind::Text) { remaining.pop_front() } else { None };
                Token { raw_name: argument.clone(), name, value, inline_value: false }
            }
        } else {
            parsed.positionals.push(argument);
            continue;
        };
        let spec = check_token(&token)?;
        parsed.values.insert(spec.name, token.value);
    }
    Ok(parsed)
}

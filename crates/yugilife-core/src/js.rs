pub fn is_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

pub fn trim(value: &str) -> &str {
    value.trim_matches(is_whitespace)
}

pub fn has_visible(value: &str) -> bool {
    value.chars().any(|character| !is_whitespace(character))
}

pub fn split_lines(value: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                lines.push(&value[start..index]);
                index += if bytes.get(index + 1) == Some(&b'\n') { 2 } else { 1 };
                start = index;
            }
            b'\n' => {
                lines.push(&value[start..index]);
                index += 1;
                start = index;
            }
            _ => index += 1,
        }
    }
    lines.push(&value[start..]);
    lines
}

pub fn to_number(value: &str) -> f64 {
    let text = trim(value);
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|character| character.is_digit(radix)) {
                return f64::NAN;
            }
            return digits
                .chars()
                .fold(0.0, |total, character| total * f64::from(radix) + f64::from(character.to_digit(radix).unwrap_or(0)));
        }
    }
    if decimal_prefix_length(text) == Some(text.len()) { text.parse().unwrap_or(f64::NAN) } else { f64::NAN }
}

pub fn parse_float(value: &str) -> f64 {
    let text = value.trim_start_matches(is_whitespace);
    for (prefix, result) in [("Infinity", f64::INFINITY), ("+Infinity", f64::INFINITY), ("-Infinity", f64::NEG_INFINITY)] {
        if text.starts_with(prefix) {
            return result;
        }
    }
    match decimal_prefix_length(text) {
        Some(length) => text[..length].parse().unwrap_or(f64::NAN),
        None => f64::NAN,
    }
}

fn decimal_prefix_length(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut index = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        index += 1;
    }
    let integer_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    let integer_digits = index - integer_start;
    let mut fraction_digits = 0;
    if bytes.get(index) == Some(&b'.') {
        let fraction_start = index + 1;
        let mut cursor = fraction_start;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        fraction_digits = cursor - fraction_start;
        if integer_digits > 0 || fraction_digits > 0 {
            index = cursor;
        }
    }
    if integer_digits == 0 && fraction_digits == 0 {
        return None;
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        let mut cursor = index + 1;
        if matches!(bytes.get(cursor), Some(b'+' | b'-')) {
            cursor += 1;
        }
        let exponent_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor > exponent_start {
            index = cursor;
        }
    }
    Some(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_strings_like_number() {
        assert_eq!(to_number(" 0.75 "), 0.75);
        assert_eq!(to_number(""), 0.0);
        assert_eq!(to_number("0x10"), 16.0);
        assert!(to_number("1px").is_nan());
        assert!(to_number("inf").is_nan());
        assert_eq!(to_number(".5"), 0.5);
        assert_eq!(to_number("5."), 5.0);
        assert!(to_number(".").is_nan());
        assert_eq!(to_number("1e3"), 1000.0);
    }

    #[test]
    fn parses_prefixes_like_parse_float() {
        assert_eq!(parse_float("1.35abc"), 1.35);
        assert_eq!(parse_float("0x10"), 0.0);
        assert_eq!(parse_float("  -2e1x"), -20.0);
        assert!(parse_float("abc").is_nan());
        assert_eq!(parse_float("1e"), 1.0);
    }

    #[test]
    fn splits_authored_lines() {
        assert_eq!(split_lines("a\r\nb\rc\nd"), vec!["a", "b", "c", "d"]);
        assert_eq!(split_lines(""), vec![""]);
    }
}

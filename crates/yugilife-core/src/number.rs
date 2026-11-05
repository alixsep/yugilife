pub fn js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let point = exponent + 1;
    let count = digits.len() as i32;
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let exponent_sign = if point > 0 { "+" } else { "-" };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() { String::new() } else { format!(".{rest}") };
        format!("{first}{fraction}e{exponent_sign}{}", (point - 1).abs())
    };
    format!("{sign}{body}")
}

pub fn to_fixed(value: f64, digits: usize) -> String {
    if !value.is_finite() || value.abs() >= 1e21 {
        return js_number(value);
    }
    let magnitude = value.abs();
    let mut rounded = format!("{magnitude:.digits$}");
    if is_exact_tie(magnitude, digits) {
        rounded = round_tie_up(&format!("{magnitude:.1100}"), digits);
    }
    if value < 0.0 { format!("-{rounded}") } else { rounded }
}

fn is_exact_tie(magnitude: f64, digits: usize) -> bool {
    let probe = format!("{magnitude:.40}");
    let Some((_, fraction)) = probe.split_once('.') else {
        return false;
    };
    let tail = &fraction[digits.min(fraction.len())..];
    if !tail.starts_with('5') || !tail[1..].bytes().all(|byte| byte == b'0') {
        return false;
    }
    let exact = format!("{magnitude:.1100}");
    let (_, exact_fraction) = exact.split_once('.').unwrap_or(("", ""));
    let exact_tail = &exact_fraction[digits..];
    exact_tail.starts_with('5') && exact_tail[1..].bytes().all(|byte| byte == b'0')
}

fn round_tie_up(exact: &str, digits: usize) -> String {
    let (whole, fraction) = exact.split_once('.').unwrap_or((exact, ""));
    let mut kept: Vec<u8> = whole.bytes().chain(fraction.bytes().take(digits)).collect();
    let mut index = kept.len();
    loop {
        if index == 0 {
            kept.insert(0, b'1');
            break;
        }
        index -= 1;
        if kept[index] == b'9' {
            kept[index] = b'0';
        } else {
            kept[index] += 1;
            break;
        }
    }
    let whole_length = kept.len() - digits;
    let text = String::from_utf8(kept).unwrap_or_default();
    if digits == 0 { text } else { format!("{}.{}", &text[..whole_length], &text[whole_length..]) }
}

pub fn stable_layout_number(value: f64) -> f64 {
    to_fixed(value, 12).parse().unwrap_or(value)
}

pub fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 { floor + 1.0 } else { floor }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_numbers_like_javascript() {
        assert_eq!(js_number(136.388_888_888_888_89), "136.38888888888889");
        assert_eq!(js_number(1.0), "1");
        assert_eq!(js_number(-0.5), "-0.5");
        assert_eq!(js_number(0.000_001), "0.000001");
        assert_eq!(js_number(0.000_000_1), "1e-7");
        assert_eq!(js_number(1e21), "1e+21");
        assert_eq!(js_number(123_456_789_012_345_680_000.0), "123456789012345680000");
        assert_eq!(js_number(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn fixes_decimals_like_javascript() {
        assert_eq!(to_fixed(0.25, 1), "0.3");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(-0.000_000_000_000_1, 12), "-0.000000000000");
        assert_eq!(to_fixed(0.000_122_070_312_5, 12), "0.000122070313");
        assert_eq!(stable_layout_number(0.1 + 0.2), 0.3);
    }

    #[test]
    fn rounds_like_math_round() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
    }
}

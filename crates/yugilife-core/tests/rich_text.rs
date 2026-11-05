use yugilife_core::rich_text::{
    LengthUnit, RichTextLength, RichTextNode, TagName, WarningCode, grapheme_count, has_leading_authored_line_fit_split,
    has_leading_authored_line_fit_split_source, parse_rich_text, parse_rich_text_length, parse_rich_text_scale, plain_text_from_rich_text,
    rich_text_line_lengths,
};

fn warning_codes(source: &str) -> Vec<&'static str> {
    parse_rich_text(source).warnings.iter().map(|warning| warning.code.as_str()).collect()
}

fn first_warning_code(source: &str) -> Option<WarningCode> {
    parse_rich_text(source).warnings.first().map(|warning| warning.code)
}

fn element_tag(node: &RichTextNode) -> Option<TagName> {
    match node {
        RichTextNode::Element(element) => Some(element.tag),
        RichTextNode::Text(_) => None,
    }
}

#[test]
fn parses_supported_tags_nesting_exact_spaces_and_escaped_markup() {
    let parsed = parse_rich_text(r##"<b><color value="#ff0000">FIRE</color></b> ATK<space width="1px"/>/ \<i\>literal\</i>"##);

    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    assert_eq!(parsed.document.children.len(), 4);
    let RichTextNode::Element(bold) = &parsed.document.children[0] else {
        panic!("the first node must be an element");
    };
    assert_eq!(bold.tag, TagName::B);
    let RichTextNode::Element(color) = &bold.children[0] else {
        panic!("the bold element must contain a color element");
    };
    assert_eq!(color.tag, TagName::Color);
    assert_eq!(color.attribute("value"), Some("#ff0000"));
    assert_eq!(plain_text_from_rich_text(&parsed.document), "FIRE ATK / <i>literal</i>");
}

#[test]
fn accepts_signed_tracking_and_em_or_px_lengths() {
    assert_eq!(parse_rich_text_length("29.5px", false), Some(RichTextLength { unit: LengthUnit::Px, value: 29.5 }));
    assert_eq!(parse_rich_text_length("0.5em", false), Some(RichTextLength { unit: LengthUnit::Em, value: 0.5 }));
    assert_eq!(parse_rich_text_scale("0.75"), Some(0.75));
    assert_eq!(parse_rich_text_scale("1.25"), Some(1.25));
    for valid in [
        r#"<tracking value="-0.5px">Tight</tracking>"#,
        r#"<scale x="2">Stretched</scale>"#,
        r#"<scale y="0.8">Shorter</scale>"#,
        r#"<scale x="0.8" y="1.2">Both</scale>"#,
        r#"<shift x="1px">Right</shift>"#,
        r#"<shift y="-1px">Up</shift>"#,
    ] {
        assert!(parse_rich_text(valid).warnings.is_empty(), "{valid}");
    }
    for invalid in
        ["<scale>Missing axes</scale>", r#"<scale x="0">Invisible</scale>"#, "<shift>Missing axes</shift>", r#"<space width="-1px"/>"#]
    {
        assert_eq!(first_warning_code(invalid), Some(WarningCode::InvalidValue), "{invalid}");
    }
}

#[test]
fn accepts_the_complete_documented_formatting_vocabulary() {
    let parsed = parse_rich_text(
        r##"<i><size value="18px"><tracking value="-0.5px"><shift x="2px"><ruby text="カオス・ナンバーズ"><color value="#ffffff">CX</color></ruby></shift></tracking></size></i> <sup>st</sup><sub>2</sub> <nowrap align="justify">one two</nowrap> <nocompress><scale x="1.25"><align value="center">three</align></scale></nocompress>"##,
    );

    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    assert_eq!(plain_text_from_rich_text(&parsed.document), "CX st2 one two three");
}

#[test]
fn counts_visible_rich_text_graphemes_per_rendered_line() {
    assert_eq!(grapheme_count("👨‍👩‍👧‍👦"), 1);
    assert_eq!(rich_text_line_lengths("<color value=\"#ff0000\">AB</color><sup>st</sup>\nC<space width=\"1px\"/>D"), vec![4, 3]);
}

#[test]
fn detects_a_visible_leading_authored_line_independently_of_markup() {
    assert!(has_leading_authored_line_fit_split_source("Materials\nEffect text"));
    assert!(has_leading_authored_line_fit_split(&parse_rich_text("<b>Materials</b>\r\n<i>Effect text</i>").document));
    assert!(!has_leading_authored_line_fit_split_source("Materials without an authored newline"));
    assert!(!has_leading_authored_line_fit_split_source("   \nEffect text"));
    assert!(!has_leading_authored_line_fit_split_source("Materials\n \n"));
}

#[test]
fn keeps_unknown_tags_literal_while_leaving_unclosed_known_formatting_open() {
    let parsed = parse_rich_text("<big>Literal</big><b>Unclosed");

    assert_eq!(plain_text_from_rich_text(&parsed.document), "<big>Literal</big>Unclosed");
    let Some(RichTextNode::Element(last)) = parsed.document.children.last() else {
        panic!("the unclosed tag must remain an element");
    };
    assert_eq!(last.tag, TagName::B);
    assert_eq!(last.children, vec![RichTextNode::Text("Unclosed".to_owned())]);
    assert_eq!(warning_codes("<big>Literal</big><b>Unclosed"), vec!["unknown-tag", "unknown-tag", "unclosed-tag"]);
}

#[test]
fn reports_mismatched_closing_tags_without_changing_the_open_scope() {
    let parsed = parse_rich_text("<b>Bold</i> still bold</b>");

    assert_eq!(warning_codes("<b>Bold</i> still bold</b>"), vec!["mismatched-closing-tag"]);
    assert_eq!(parsed.document.children.first().and_then(element_tag), Some(TagName::B));
}

#[test]
fn reports_warning_offsets_and_lengths_in_utf16_code_units() {
    let parsed = parse_rich_text("😀<big>x</big>");
    let spans: Vec<(usize, usize)> = parsed.warnings.iter().map(|warning| (warning.offset, warning.length)).collect();
    assert_eq!(spans, vec![(2, 5), (8, 6)]);

    let unclosed = parse_rich_text("é<b>😀😀");
    assert_eq!(unclosed.warnings.len(), 1);
    assert_eq!((unclosed.warnings[0].offset, unclosed.warnings[0].length), (1, 7));
    assert_eq!(unclosed.warnings[0].message, "Rich-text tag <b> is not closed.");
}

#[test]
fn reports_malformed_tags_with_their_messages() {
    let missing_bracket = parse_rich_text("ab<b");
    assert_eq!(missing_bracket.warnings[0].code, WarningCode::MalformedTag);
    assert_eq!(missing_bracket.warnings[0].message, "Rich-text tag is missing its closing angle bracket.");
    assert_eq!((missing_bracket.warnings[0].offset, missing_bracket.warnings[0].length), (2, 2));
    assert_eq!(plain_text_from_rich_text(&missing_bracket.document), "ab<b");

    let unknown = parse_rich_text("<big>");
    assert_eq!(unknown.warnings[0].message, "Unknown rich-text tag <big>.");

    let color = parse_rich_text("<color value=\"red\">x</color>");
    assert_eq!(color.warnings[0].message, "Rich-text color must be a hexadecimal value such as \"#ff0000\".");
}

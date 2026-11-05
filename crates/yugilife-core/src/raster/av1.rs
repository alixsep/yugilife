//! The AV1 sequence header fields a host needs to decode an AVIF item itself and hand back the
//! planes: profile, level and tier for the codec string, and the bit depth, chroma layout, matrix
//! and range that decide how the planes convert to RGB. Parsed as the AV1 specification's
//! `sequence_header_obu()` (section 5.5), the same values dav1d reads.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SequenceInfo {
    pub profile: u8,
    pub level: u8,
    pub tier: u8,
    pub bit_depth: u8,
    pub monochrome: bool,
    pub subsampling_x: bool,
    pub subsampling_y: bool,
    /// CICP matrix coefficients (`matrix_coefficients`, 2 when unspecified).
    pub matrix: u8,
    pub full_range: bool,
}

impl SequenceInfo {
    /// The WebCodecs codec string, `av01.P.LLT.DD`.
    pub fn codec(&self) -> String {
        format!("av01.{}.{:02}{}.{:02}", self.profile, self.level, if self.tier == 0 { 'M' } else { 'H' }, self.bit_depth)
    }
}

struct Bits<'a> {
    data: &'a [u8],
    position: usize,
}

impl Bits<'_> {
    fn bit(&mut self) -> Option<u32> {
        let byte = *self.data.get(self.position / 8)?;
        let bit = (byte >> (7 - self.position % 8)) & 1;
        self.position += 1;
        Some(u32::from(bit))
    }

    fn read(&mut self, count: u32) -> Option<u32> {
        let mut value = 0u32;
        for _ in 0..count {
            value = (value << 1) | self.bit()?;
        }
        Some(value)
    }

    fn flag(&mut self) -> Option<bool> {
        self.bit().map(|bit| bit == 1)
    }

    fn uvlc(&mut self) -> Option<u32> {
        let mut zeros = 0;
        while !self.flag()? {
            zeros += 1;
            if zeros >= 32 {
                return Some(u32::MAX);
            }
        }
        Some(self.read(zeros)?.saturating_add((1u32 << zeros) - 1))
    }
}

fn leb128(data: &[u8], position: &mut usize) -> Option<usize> {
    let mut value = 0usize;
    for index in 0..8 {
        let byte = *data.get(*position)?;
        *position += 1;
        value |= usize::from(byte & 0x7f) << (index * 7);
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

/// The payload of the first sequence header OBU in a stream of OBUs (an AVIF item's data).
fn sequence_header_payload(obus: &[u8]) -> Option<&[u8]> {
    let mut position = 0;
    while position < obus.len() {
        let header = obus[position];
        let kind = (header >> 3) & 0x0f;
        let has_extension = header & 0x04 != 0;
        let has_size = header & 0x02 != 0;
        position += 1 + usize::from(has_extension);
        let size = if has_size { leb128(obus, &mut position)? } else { obus.len().checked_sub(position)? };
        let payload = obus.get(position..position.checked_add(size)?)?;
        if kind == 1 {
            return Some(payload);
        }
        position += size;
    }
    None
}

pub fn sequence_info(obus: &[u8]) -> Option<SequenceInfo> {
    let mut bits = Bits { data: sequence_header_payload(obus)?, position: 0 };
    let profile = bits.read(3)? as u8;
    let _still_picture = bits.flag()?;
    let reduced_still_picture_header = bits.flag()?;
    let (level, tier);
    if reduced_still_picture_header {
        level = bits.read(5)? as u8;
        tier = 0;
    } else {
        let timing_info_present = bits.flag()?;
        let mut decoder_model_info_present = false;
        let mut buffer_delay_length = 0;
        if timing_info_present {
            bits.read(32)?;
            bits.read(32)?;
            if bits.flag()? {
                bits.uvlc()?;
            }
            decoder_model_info_present = bits.flag()?;
            if decoder_model_info_present {
                buffer_delay_length = bits.read(5)? + 1;
                bits.read(32)?;
                bits.read(5)?;
                bits.read(5)?;
            }
        }
        let initial_display_delay_present = bits.flag()?;
        let operating_points = bits.read(5)? + 1;
        let mut first = None;
        for _ in 0..operating_points {
            bits.read(12)?;
            let level_index = bits.read(5)? as u8;
            let tier_flag = if level_index > 7 { bits.read(1)? as u8 } else { 0 };
            if decoder_model_info_present && bits.flag()? {
                bits.read(buffer_delay_length)?;
                bits.read(buffer_delay_length)?;
                bits.read(1)?;
            }
            if initial_display_delay_present && bits.flag()? {
                bits.read(4)?;
            }
            first.get_or_insert((level_index, tier_flag));
        }
        (level, tier) = first?;
    }
    let width_bits = bits.read(4)? + 1;
    let height_bits = bits.read(4)? + 1;
    bits.read(width_bits)?;
    bits.read(height_bits)?;
    if !reduced_still_picture_header && bits.flag()? {
        bits.read(4)?;
        bits.read(3)?;
    }
    bits.read(3)?; // use_128x128_superblock, enable_filter_intra, enable_intra_edge_filter
    if !reduced_still_picture_header {
        bits.read(4)?; // interintra compound, masked compound, warped motion, dual filter
        let enable_order_hint = bits.flag()?;
        if enable_order_hint {
            bits.read(2)?; // jnt_comp, ref_frame_mvs
        }
        let screen_content_tools = if bits.flag()? { 2 } else { bits.read(1)? };
        if screen_content_tools > 0 && !bits.flag()? {
            bits.read(1)?;
        }
        if enable_order_hint {
            bits.read(3)?;
        }
    }
    bits.read(3)?; // enable_superres, enable_cdef, enable_restoration

    // color_config()
    let high_bitdepth = bits.flag()?;
    let bit_depth = if profile == 2 && high_bitdepth {
        if bits.flag()? { 12 } else { 10 }
    } else if high_bitdepth {
        10
    } else {
        8
    };
    let monochrome = if profile == 1 { false } else { bits.flag()? };
    let (primaries, transfer, matrix) = if bits.flag()? { (bits.read(8)?, bits.read(8)?, bits.read(8)?) } else { (2, 2, 2) };
    let (full_range, subsampling_x, subsampling_y);
    if monochrome {
        full_range = bits.flag()?;
        (subsampling_x, subsampling_y) = (true, true);
    } else if primaries == 1 && transfer == 13 && matrix == 0 {
        full_range = true;
        (subsampling_x, subsampling_y) = (false, false);
    } else {
        full_range = bits.flag()?;
        (subsampling_x, subsampling_y) = match profile {
            0 => (true, true),
            1 => (false, false),
            _ if bit_depth == 12 => {
                let x = bits.flag()?;
                (x, x && bits.flag()?)
            }
            _ => (true, false),
        };
    }
    Some(SequenceInfo { profile, level, tier, bit_depth, monochrome, subsampling_x, subsampling_y, matrix: matrix as u8, full_range })
}

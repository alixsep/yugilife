use crate::raster::blit::ColorBlitter;

const FIXED_ONE: i32 = 1 << 16;
const MAX_S32: i32 = i32::MAX;
const MIN_S32: i32 = -i32::MAX;
const NONE: usize = usize::MAX;
const ACCURACY: i32 = 2;
const MAX_COEFFICIENT_SHIFT: i32 = 6;
const INVERSE_TABLE_SIZE: i32 = 1024;
const MASK_MAX_WIDTH: i32 = 32;
const MASK_MAX_STORAGE: i64 = 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Verb {
    Move,
    Line,
    Quad,
    Cubic,
    Close,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

pub struct DevicePath {
    pub verbs: Vec<Verb>,
    pub points: Vec<Point>,
    pub bounds: Rect,
    pub even_odd: bool,
}

fn fixed_mul(a: i32, b: i32) -> i32 {
    ((i64::from(a) * i64::from(b)) >> 16) as i32
}

fn saturating_add(a: i32, b: i32) -> i32 {
    (i64::from(a) + i64::from(b)).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn fixed_ceil_to_int(value: i32) -> i32 {
    value.wrapping_add(FIXED_ONE - 1) >> 16
}

fn fixed_floor_to_int(value: i32) -> i32 {
    value >> 16
}

fn fixed_round_to_int(value: i32) -> i32 {
    value.wrapping_add(FIXED_ONE >> 1) >> 16
}

fn fixed_ceil_to_fixed(value: i32) -> i32 {
    (value.wrapping_add(FIXED_ONE - 1) as u32 & 0xFFFF_0000) as i32
}

fn fixed_floor_to_fixed(value: i32) -> i32 {
    (value as u32 & 0xFFFF_0000) as i32
}

fn fixed_round_to_fixed(value: i32) -> i32 {
    (value.wrapping_add(FIXED_ONE >> 1) as u32 & 0xFFFF_0000) as i32
}

fn fdot6_to_fixed(value: i32) -> i32 {
    value.wrapping_shl(10)
}

fn fixed_to_fdot6(value: i32) -> i32 {
    value >> 10
}

fn fdot6_round(value: i32) -> i32 {
    (value + 32) >> 6
}

fn fdot6_div(a: i32, b: i32) -> i32 {
    if i16::try_from(a).is_ok() {
        a.wrapping_shl(16) / b
    } else {
        ((i64::from(a) << 16) / i64::from(b)).clamp(i64::from(MIN_S32), i64::from(MAX_S32)) as i32
    }
}

fn quick_inverse(value: i32) -> i32 {
    match value {
        0 => 0,
        value if value > 0 => (1 << 22) / value,
        value => -((1 << 22) / -value),
    }
}

fn quick_div(a: i32, b: i32) -> i32 {
    let (absolute_a, absolute_b) = (a.wrapping_abs(), b.wrapping_abs());
    if (8..INVERSE_TABLE_SIZE).contains(&absolute_b) && absolute_a < 4096 {
        return (a * quick_inverse(b)) >> 6;
    }
    fdot6_div(a, b)
}

fn snap_y(value: i32) -> i32 {
    ((value as u32).wrapping_add((FIXED_ONE >> (ACCURACY + 1)) as u32) >> (16 - ACCURACY) << (16 - ACCURACY)) as i32
}

fn inverse_slope(dx: i32, dy: i32, slope: i32, absolute_slope: i32) -> i32 {
    if dx == 0 || slope == 0 {
        MAX_S32
    } else if absolute_slope < INVERSE_TABLE_SIZE {
        quick_inverse(absolute_slope)
    } else {
        quick_div(dy, dx).wrapping_abs()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum EdgeKind {
    Line,
    Quad,
    Cubic,
}

#[derive(Debug, Clone, Copy)]
struct Edge {
    next: usize,
    previous: usize,
    x: i32,
    dx: i32,
    upper_x: i32,
    y: i32,
    upper_y: i32,
    lower_y: i32,
    dy: i32,
    kind: EdgeKind,
    curve_count: i32,
    curve_shift: i32,
    cubic_shift: i32,
    winding: i32,
    qx: i32,
    qy: i32,
    qdx: i32,
    qdy: i32,
    qddx: i32,
    qddy: i32,
    qdddx: i32,
    qdddy: i32,
    last_x: i32,
    last_y: i32,
    snapped_x: i32,
    snapped_y: i32,
}

impl Edge {
    fn sentinel(x: i32, y: i32) -> Self {
        Self {
            next: NONE,
            previous: NONE,
            x,
            dx: 0,
            upper_x: x,
            y: 0,
            upper_y: y,
            lower_y: y,
            dy: MAX_S32,
            kind: EdgeKind::Line,
            curve_count: 0,
            curve_shift: 0,
            cubic_shift: 0,
            winding: 1,
            qx: 0,
            qy: 0,
            qdx: 0,
            qdy: 0,
            qddx: 0,
            qddy: 0,
            qdddx: 0,
            qdddy: 0,
            last_x: 0,
            last_y: 0,
            snapped_x: 0,
            snapped_y: 0,
        }
    }

    fn go_y(&mut self, y: i32) {
        if y == self.y.wrapping_add(FIXED_ONE) {
            self.x = self.x.wrapping_add(self.dx);
            self.y = y;
        } else if y != self.y {
            self.x = self.upper_x.wrapping_add(fixed_mul(self.dx, y.wrapping_sub(self.upper_y)));
            self.y = y;
        }
    }

    fn go_y_shift(&mut self, y: i32, shift: i32) {
        self.y = y;
        self.x = self.x.wrapping_add(self.dx >> shift);
    }

    fn set_line(&mut self, from: Point, to: Point) -> bool {
        let fixed = |value: f32| fdot6_to_fixed(((value * 4.0) * 64.0) as i32) >> ACCURACY;
        let (mut x0, mut y0, mut x1, mut y1) = (fixed(from.x), snap_y(fixed(from.y)), fixed(to.x), snap_y(fixed(to.y)));
        let mut winding = 1;
        if y0 > y1 {
            std::mem::swap(&mut x0, &mut x1);
            std::mem::swap(&mut y0, &mut y1);
            winding = -1;
        }
        let dy = fixed_to_fdot6(y1 - y0);
        if dy == 0 {
            return false;
        }
        let dx = fixed_to_fdot6(x1 - x0);
        let slope = quick_div(dx, dy);
        self.x = x0;
        self.dx = slope;
        self.upper_x = x0;
        self.y = y0;
        self.upper_y = y0;
        self.lower_y = y1;
        self.dy = inverse_slope(dx, dy, slope, slope.wrapping_abs());
        self.kind = EdgeKind::Line;
        self.curve_count = 0;
        self.winding = winding;
        self.curve_shift = 0;
        true
    }

    fn update_line(&mut self, mut x0: i32, mut y0: i32, mut x1: i32, mut y1: i32, slope: i32) -> bool {
        if y0 > y1 {
            std::mem::swap(&mut x0, &mut x1);
            std::mem::swap(&mut y0, &mut y1);
            self.winding = -self.winding;
        }
        let dx = fixed_to_fdot6(x1.wrapping_sub(x0));
        let dy = fixed_to_fdot6(y1.wrapping_sub(y0));
        if dy == 0 {
            return false;
        }
        let absolute_slope = fixed_to_fdot6(slope).wrapping_abs();
        self.x = x0;
        self.dx = slope;
        self.upper_x = x0;
        self.y = y0;
        self.upper_y = y0;
        self.lower_y = y1;
        self.dy = inverse_slope(dx, dy, slope, absolute_slope);
        true
    }

    fn update(&mut self) -> bool {
        if self.curve_count < 0 {
            self.update_cubic()
        } else if self.curve_count > 0 {
            self.update_quadratic()
        } else {
            false
        }
    }

    fn set_quadratic(&mut self, points: &[Point]) -> bool {
        let scale = (1 << (ACCURACY + 6)) as f32;
        let convert = |value: f32| (value * scale) as i32;
        let (mut x0, mut y0) = (convert(points[0].x), convert(points[0].y));
        let (x1, y1) = (convert(points[1].x), convert(points[1].y));
        let (mut x2, mut y2) = (convert(points[2].x), convert(points[2].y));
        let mut winding = 1;
        if y0 > y2 {
            std::mem::swap(&mut x0, &mut x2);
            std::mem::swap(&mut y0, &mut y2);
            winding = -1;
        }
        if fdot6_round(y0) == fdot6_round(y2) {
            return false;
        }
        let mut shift = {
            let dx = (x1.wrapping_shl(1) - x0 - x2) >> 2;
            let dy = (y1.wrapping_shl(1) - y0 - y2) >> 2;
            difference_to_shift(dx, dy, ACCURACY)
        };
        if shift == 0 {
            shift = 1;
        } else if shift > MAX_COEFFICIENT_SHIFT {
            shift = MAX_COEFFICIENT_SHIFT;
        }
        self.winding = winding;
        self.kind = EdgeKind::Quad;
        self.curve_count = 1 << shift;
        self.curve_shift = shift - 1;
        let half = |value: i32| value.wrapping_shl(9);
        let a = half(x0 - x1 - x1 + x2);
        let b = fdot6_to_fixed(x1 - x0);
        self.qx = fdot6_to_fixed(x0);
        self.qdx = b + (a >> shift);
        self.qddx = a >> (shift - 1);
        let a = half(y0 - y1 - y1 + y2);
        let b = fdot6_to_fixed(y1 - y0);
        self.qy = fdot6_to_fixed(y0);
        self.qdy = b + (a >> shift);
        self.qddy = a >> (shift - 1);
        self.last_x = fdot6_to_fixed(x2);
        self.last_y = fdot6_to_fixed(y2);
        for value in
            [&mut self.qx, &mut self.qy, &mut self.qdx, &mut self.qdy, &mut self.qddx, &mut self.qddy, &mut self.last_x, &mut self.last_y]
        {
            *value >>= ACCURACY;
        }
        self.qy = snap_y(self.qy);
        self.last_y = snap_y(self.last_y);
        self.snapped_x = self.qx;
        self.snapped_y = self.qy;
        self.update_quadratic()
    }

    fn update_quadratic(&mut self) -> bool {
        let mut success = false;
        let mut count = self.curve_count;
        let mut old_x = self.qx;
        let mut old_y = self.qy;
        let mut dx = self.qdx;
        let mut dy = self.qdy;
        let shift = self.curve_shift;
        let (mut new_x, mut new_y, mut new_snapped_x, mut new_snapped_y);
        loop {
            let slope;
            count -= 1;
            if count > 0 {
                new_x = old_x.wrapping_add(dx >> shift);
                new_y = old_y.wrapping_add(dy >> shift);
                if (dy >> shift).wrapping_abs() >= FIXED_ONE * 2 && (i64::from(dy.wrapping_abs()) << 6) > i64::from(dx.wrapping_abs()) {
                    let difference_y = fixed_to_fdot6(new_y.wrapping_sub(self.snapped_y));
                    slope = if difference_y != 0 {
                        quick_div(fixed_to_fdot6(new_x.wrapping_sub(self.snapped_x)), difference_y)
                    } else {
                        MAX_S32
                    };
                    new_snapped_y = self.last_y.min(fixed_round_to_fixed(new_y));
                    new_snapped_x = new_x.wrapping_sub(fixed_mul(slope, new_y.wrapping_sub(new_snapped_y)));
                } else {
                    new_snapped_y = self.last_y.min(snap_y(new_y));
                    new_snapped_x = new_x;
                    let difference_y = fixed_to_fdot6(new_snapped_y.wrapping_sub(self.snapped_y));
                    slope = if difference_y != 0 {
                        quick_div(fixed_to_fdot6(new_x.wrapping_sub(self.snapped_x)), difference_y)
                    } else {
                        MAX_S32
                    };
                }
                dx = dx.wrapping_add(self.qddx);
                dy = dy.wrapping_add(self.qddy);
            } else {
                new_x = self.last_x;
                new_y = self.last_y;
                new_snapped_y = new_y;
                new_snapped_x = new_x;
                let difference_y = fixed_to_fdot6(new_y.wrapping_sub(self.snapped_y));
                slope =
                    if difference_y != 0 { quick_div(fixed_to_fdot6(new_x.wrapping_sub(self.snapped_x)), difference_y) } else { MAX_S32 };
            }
            if slope < MAX_S32 {
                success = self.update_line(self.snapped_x, self.snapped_y, new_snapped_x, new_snapped_y, slope);
            }
            old_x = new_x;
            old_y = new_y;
            if !(count > 0 && !success) {
                break;
            }
        }
        self.qx = new_x;
        self.qy = new_y;
        self.qdx = dx;
        self.qdy = dy;
        self.snapped_x = new_snapped_x;
        self.snapped_y = new_snapped_y;
        self.curve_count = count;
        success
    }

    fn set_cubic(&mut self, points: &[Point]) -> bool {
        let scale = (1 << (ACCURACY + 6)) as f32;
        let convert = |value: f32| (value * scale) as i32;
        let (mut x0, mut y0) = (convert(points[0].x), convert(points[0].y));
        let (mut x1, mut y1) = (convert(points[1].x), convert(points[1].y));
        let (mut x2, mut y2) = (convert(points[2].x), convert(points[2].y));
        let (mut x3, mut y3) = (convert(points[3].x), convert(points[3].y));
        let mut winding = 1;
        if y0 > y3 {
            std::mem::swap(&mut x0, &mut x3);
            std::mem::swap(&mut x1, &mut x2);
            std::mem::swap(&mut y0, &mut y3);
            std::mem::swap(&mut y1, &mut y2);
            winding = -1;
        }
        if fdot6_round(y0) == fdot6_round(y3) {
            return false;
        }
        let mut shift = {
            let dx = cubic_delta_from_line(x0, x1, x2, x3);
            let dy = cubic_delta_from_line(y0, y1, y2, y3);
            difference_to_shift(dx, dy, 2) + 1
        };
        if shift > MAX_COEFFICIENT_SHIFT {
            shift = MAX_COEFFICIENT_SHIFT;
        }
        let mut up_shift = 6;
        let mut down_shift = shift + up_shift - 10;
        if down_shift < 0 {
            down_shift = 0;
            up_shift = 10 - shift;
        }
        self.winding = winding;
        self.kind = EdgeKind::Cubic;
        self.curve_count = (-1_i32).wrapping_shl(shift as u32);
        self.curve_shift = shift;
        self.cubic_shift = down_shift;
        let up = |value: i32| value.wrapping_shl(up_shift as u32);
        let b = up(3 * (x1 - x0));
        let c = up(3 * (x0 - x1 - x1 + x2));
        let d = up(x3 + 3 * (x1 - x2) - x0);
        self.qx = fdot6_to_fixed(x0);
        self.qdx = b + (c >> shift) + (d >> (2 * shift));
        self.qddx = 2 * c + ((3 * d) >> (shift - 1));
        self.qdddx = (3 * d) >> (shift - 1);
        let b = up(3 * (y1 - y0));
        let c = up(3 * (y0 - y1 - y1 + y2));
        let d = up(y3 + 3 * (y1 - y2) - y0);
        self.qy = fdot6_to_fixed(y0);
        self.qdy = b + (c >> shift) + (d >> (2 * shift));
        self.qddy = 2 * c + ((3 * d) >> (shift - 1));
        self.qdddy = (3 * d) >> (shift - 1);
        self.last_x = fdot6_to_fixed(x3);
        self.last_y = fdot6_to_fixed(y3);
        for value in [
            &mut self.qx,
            &mut self.qy,
            &mut self.qdx,
            &mut self.qdy,
            &mut self.qddx,
            &mut self.qddy,
            &mut self.qdddx,
            &mut self.qdddy,
            &mut self.last_x,
            &mut self.last_y,
        ] {
            *value >>= ACCURACY;
        }
        self.qy = snap_y(self.qy);
        self.snapped_y = self.qy;
        self.last_y = snap_y(self.last_y);
        self.update_cubic()
    }

    fn update_cubic(&mut self) -> bool {
        let mut success;
        let mut count = self.curve_count;
        let mut old_x = self.qx;
        let mut old_y = self.qy;
        let (mut new_x, mut new_y);
        let second_shift = self.curve_shift;
        let first_shift = self.cubic_shift;
        loop {
            count += 1;
            if count < 0 {
                new_x = old_x.wrapping_add(self.qdx >> first_shift);
                self.qdx = self.qdx.wrapping_add(self.qddx >> second_shift);
                self.qddx = self.qddx.wrapping_add(self.qdddx);
                new_y = old_y.wrapping_add(self.qdy >> first_shift);
                self.qdy = self.qdy.wrapping_add(self.qddy >> second_shift);
                self.qddy = self.qddy.wrapping_add(self.qdddy);
            } else {
                new_x = self.last_x;
                new_y = self.last_y;
            }
            if new_y < old_y {
                new_y = old_y;
            }
            let mut new_snapped_y = snap_y(new_y);
            if self.last_y < new_snapped_y {
                new_snapped_y = self.last_y;
                count = 0;
            }
            let slope = if fixed_to_fdot6(new_snapped_y.wrapping_sub(self.snapped_y)) == 0 {
                MAX_S32
            } else {
                fdot6_div(fixed_to_fdot6(new_x.wrapping_sub(old_x)), fixed_to_fdot6(new_snapped_y.wrapping_sub(self.snapped_y)))
            };
            success = self.update_line(old_x, self.snapped_y, new_x, new_snapped_y, slope);
            old_x = new_x;
            old_y = new_y;
            self.snapped_y = new_snapped_y;
            if !(count < 0 && !success) {
                break;
            }
        }
        self.qx = new_x;
        self.qy = new_y;
        self.curve_count = count;
        success
    }

    fn keep_continuous(&mut self) {
        if self.curve_count < 0 {
            self.qx = self.x;
        } else {
            self.snapped_x = self.x;
        }
        self.snapped_y = self.y;
    }
}

fn cheap_distance(dx: i32, dy: i32) -> i32 {
    let (dx, dy) = (dx.wrapping_abs(), dy.wrapping_abs());
    if dx > dy { dx + (dy >> 1) } else { dy + (dx >> 1) }
}

fn difference_to_shift(dx: i32, dy: i32, shift: i32) -> i32 {
    let distance = (cheap_distance(dx, dy) + (1 << (2 + shift))) >> (3 + shift);
    (32 - (distance as u32).leading_zeros() as i32) >> 1
}

fn cubic_delta_from_line(a: i32, b: i32, c: i32, d: i32) -> i32 {
    let one_third = ((a * 8 - b * 15 + 6 * c + d) * 19) >> 9;
    let two_third = ((a + 6 * b - c * 15 + d * 8) * 19) >> 9;
    one_third.wrapping_abs().max(two_third.wrapping_abs())
}

fn valid_unit_divide(numerator: f32, denominator: f32) -> Option<f32> {
    let (numerator, denominator) = if numerator < 0.0 { (-numerator, -denominator) } else { (numerator, denominator) };
    if denominator == 0.0 || numerator == 0.0 || numerator >= denominator {
        return None;
    }
    let ratio = numerator / denominator;
    if ratio.is_nan() || ratio == 0.0 { None } else { Some(ratio) }
}

fn is_not_monotonic(a: f32, b: f32, c: f32) -> bool {
    let ab = a - b;
    let bc = if ab < 0.0 { -(b - c) } else { b - c };
    ab == 0.0 || bc < 0.0
}

fn mix(a: Point, b: Point, t: f32) -> Point {
    Point { x: (b.x - a.x) * t + a.x, y: (b.y - a.y) * t + a.y }
}

fn chop_quad_at_y_extrema(source: &[Point]) -> Vec<[Point; 3]> {
    let (a, mut b, c) = (source[0].y, source[1].y, source[2].y);
    if is_not_monotonic(a, b, c) {
        if let Some(t) = valid_unit_divide(a - b, a - b - b + c) {
            let first = mix(source[0], source[1], t);
            let second = mix(source[1], source[2], t);
            let middle = mix(first, second, t);
            let flat = middle.y;
            return vec![[source[0], Point { x: first.x, y: flat }, middle], [middle, Point { x: second.x, y: flat }, source[2]]];
        }
        b = if (a - b).abs() < (b - c).abs() { a } else { c };
    }
    vec![[Point { x: source[0].x, y: a }, Point { x: source[1].x, y: b }, Point { x: source[2].x, y: c }]]
}

fn find_unit_quad_roots(a: f32, b: f32, c: f32) -> Vec<f32> {
    if a == 0.0 {
        return valid_unit_divide(-c, b).into_iter().collect();
    }
    let discriminant = f64::from(b) * f64::from(b) - 4.0 * f64::from(a) * f64::from(c);
    if discriminant < 0.0 {
        return Vec::new();
    }
    let root = discriminant.sqrt() as f32;
    if !root.is_finite() {
        return Vec::new();
    }
    let q = if b < 0.0 { -(b - root) / 2.0 } else { -(b + root) / 2.0 };
    let mut roots: Vec<f32> = valid_unit_divide(q, a).into_iter().chain(valid_unit_divide(c, q)).collect();
    if roots.len() == 2 {
        if roots[0] > roots[1] {
            roots.swap(0, 1);
        } else if roots[0] == roots[1] {
            roots.pop();
        }
    }
    roots
}

fn chop_cubic_at(source: [Point; 4], t: f32) -> [Point; 7] {
    if t == 1.0 {
        return [source[0], source[1], source[2], source[3], source[3], source[3], source[3]];
    }
    let ab = mix(source[0], source[1], t);
    let bc = mix(source[1], source[2], t);
    let cd = mix(source[2], source[3], t);
    let abc = mix(ab, bc, t);
    let bcd = mix(bc, cd, t);
    [source[0], ab, abc, mix(abc, bcd, t), bcd, cd, source[3]]
}

fn chop_cubic_twice(source: [Point; 4], first: f32, second: f32) -> [Point; 10] {
    if second == 1.0 {
        let chopped = chop_cubic_at(source, first);
        return [chopped[0], chopped[1], chopped[2], chopped[3], chopped[4], chopped[5], chopped[6], source[3], source[3], source[3]];
    }
    let pairs = |t: f32| {
        let ab = mix(source[0], source[1], t);
        let bc = mix(source[1], source[2], t);
        let cd = mix(source[2], source[3], t);
        let abc = mix(ab, bc, t);
        let bcd = mix(bc, cd, t);
        (ab, cd, abc, bcd, mix(abc, bcd, t))
    };
    let (ab0, _, abc0, bcd0, abcd0) = pairs(first);
    let (_, cd1, abc1, bcd1, abcd1) = pairs(second);
    [source[0], ab0, abc0, abcd0, mix(abc0, bcd0, second), mix(abc1, bcd1, first), abcd1, bcd1, cd1, source[3]]
}

fn chop_cubic_at_y_extrema(source: [Point; 4]) -> Vec<[Point; 4]> {
    let (a, b, c, d) = (source[0].y, source[1].y, source[2].y, source[3].y);
    let roots = find_unit_quad_roots(d - a + 3.0 * (b - c), 2.0 * (a - b - b + c), b - a);
    let mut points: Vec<Point> = match roots.as_slice() {
        [] => source.to_vec(),
        [t] => chop_cubic_at(source, *t).to_vec(),
        [first, second, ..] => chop_cubic_twice(source, *first, *second).to_vec(),
    };
    if !roots.is_empty() {
        let flat = points[3].y;
        points[2].y = flat;
        points[4].y = flat;
        if roots.len() == 2 {
            let flat = points[6].y;
            points[5].y = flat;
            points[7].y = flat;
        }
    }
    points.windows(4).step_by(3).map(|window| [window[0], window[1], window[2], window[3]]).collect()
}

#[derive(PartialEq)]
enum Combine {
    None,
    Partial,
    Total,
}

fn combine_vertical(edge: &Edge, last: &mut Edge) -> Combine {
    let close = |a: i32, b: i32| a.wrapping_sub(b).wrapping_abs() < 0x100;
    if last.kind != EdgeKind::Line || last.dx != 0 || edge.x != last.x {
        return Combine::None;
    }
    if edge.winding == last.winding {
        if edge.lower_y == last.upper_y {
            last.upper_y = edge.upper_y;
            last.y = last.upper_y;
            return Combine::Partial;
        }
        if close(edge.upper_y, last.lower_y) {
            last.lower_y = edge.lower_y;
            return Combine::Partial;
        }
        return Combine::None;
    }
    if close(edge.upper_y, last.upper_y) {
        if close(edge.lower_y, last.lower_y) {
            return Combine::Total;
        }
        if edge.lower_y < last.lower_y {
            last.upper_y = edge.lower_y;
            last.y = last.upper_y;
            return Combine::Partial;
        }
        last.upper_y = last.lower_y;
        last.y = last.upper_y;
        last.lower_y = edge.lower_y;
        last.winding = edge.winding;
        return Combine::Partial;
    }
    if close(edge.lower_y, last.lower_y) {
        if edge.upper_y > last.upper_y {
            last.lower_y = edge.upper_y;
            return Combine::Partial;
        }
        last.lower_y = last.upper_y;
        last.upper_y = edge.upper_y;
        last.y = last.upper_y;
        last.winding = edge.winding;
        return Combine::Partial;
    }
    Combine::None
}

fn add_line(edges: &mut Vec<Edge>, from: Point, to: Point) {
    let mut edge = Edge::sentinel(0, 0);
    if !edge.set_line(from, to) {
        return;
    }
    let vertical = edge.dx == 0 && edge.kind == EdgeKind::Line;
    let combine = match edges.last_mut() {
        Some(last) if vertical => combine_vertical(&edge, last),
        _ => Combine::None,
    };
    match combine {
        Combine::Total => {
            edges.pop();
        }
        Combine::Partial => {}
        Combine::None => edges.push(edge),
    }
}

fn for_each_segment(path: &DevicePath, mut visit: impl FnMut(Verb, &[Point])) {
    let points = &path.points;
    let mut index = 0;
    let mut move_index = 0;
    let mut needs_close = false;
    let close = |index: usize, move_index: usize, visit: &mut dyn FnMut(Verb, &[Point])| {
        visit(Verb::Line, &[points[index - 1], points[move_index]]);
    };
    for verb in &path.verbs {
        match verb {
            Verb::Move => {
                if needs_close {
                    close(index, move_index, &mut visit);
                    needs_close = false;
                }
                move_index = index;
                index += 1;
            }
            Verb::Close => {
                if needs_close {
                    close(index, move_index, &mut visit);
                    needs_close = false;
                }
            }
            Verb::Line | Verb::Quad | Verb::Cubic => {
                let count = match verb {
                    Verb::Line => 1,
                    Verb::Quad => 2,
                    _ => 3,
                };
                visit(*verb, &points[index - 1..index + count]);
                index += count;
                needs_close = true;
            }
        }
    }
    if needs_close {
        close(index, move_index, &mut visit);
    }
}

fn build_edges(path: &DevicePath) -> Vec<Edge> {
    let mut edges = Vec::new();
    for_each_segment(path, |verb, points| match verb {
        Verb::Line => add_line(&mut edges, points[0], points[1]),
        Verb::Quad => {
            for quad in chop_quad_at_y_extrema(points) {
                let mut edge = Edge::sentinel(0, 0);
                if edge.set_quadratic(&quad) {
                    edges.push(edge);
                }
            }
        }
        Verb::Cubic => {
            for cubic in chop_cubic_at_y_extrema([points[0], points[1], points[2], points[3]]) {
                let mut edge = Edge::sentinel(0, 0);
                if edge.set_cubic(&cubic) {
                    edges.push(edge);
                }
            }
        }
        _ => {}
    });
    edges
}

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Unknown,
    Left,
    Right,
    Straight,
    Backwards,
    Invalid,
}

struct Convexicator {
    first_point: Point,
    first_vector: Point,
    last_point: Point,
    last_vector: Point,
    expected: Direction,
    first_direction_known: bool,
    reversals: i32,
}

impl Convexicator {
    fn set_move(&mut self, point: Point) {
        self.first_point = point;
        self.last_point = point;
        self.expected = Direction::Invalid;
    }

    fn add_point(&mut self, point: Point) -> bool {
        if self.last_point == point {
            return true;
        }
        let vector = Point { x: point.x - self.last_point.x, y: point.y - self.last_point.y };
        if self.first_point == self.last_point && self.expected == Direction::Invalid && self.last_vector == (Point { x: 0.0, y: 0.0 }) {
            self.last_vector = vector;
            self.first_vector = vector;
        } else if !self.add_vector(vector) {
            return false;
        }
        self.last_point = point;
        true
    }

    fn direction(&self, vector: Point) -> Direction {
        let cross = self.last_vector.x * vector.y - self.last_vector.y * vector.x;
        if !cross.is_finite() {
            return Direction::Unknown;
        }
        if cross == 0.0 {
            let dot = self.last_vector.x * vector.x + self.last_vector.y * vector.y;
            return if dot < 0.0 { Direction::Backwards } else { Direction::Straight };
        }
        if cross > 0.0 { Direction::Right } else { Direction::Left }
    }

    fn add_vector(&mut self, vector: Point) -> bool {
        match self.direction(vector) {
            direction @ (Direction::Left | Direction::Right) => {
                if self.expected == Direction::Invalid {
                    self.expected = direction;
                    self.first_direction_known = true;
                } else if direction != self.expected {
                    self.first_direction_known = false;
                    return false;
                }
                self.last_vector = vector;
                true
            }
            Direction::Straight => true,
            Direction::Backwards => {
                self.last_vector = vector;
                self.reversals += 1;
                self.reversals < 3
            }
            Direction::Unknown | Direction::Invalid => false,
        }
    }

    fn close(&mut self) -> bool {
        let first_vector = self.first_vector;
        self.add_point(self.first_point) && self.add_vector(first_vector)
    }
}

fn concave_by_sign(points: &[Point]) -> bool {
    if points.len() <= 3 {
        return false;
    }
    let mut current = points[0];
    let first = points[0];
    let (mut x_changes, mut y_changes) = (0, 0);
    let (mut last_x, mut last_y) = (2, 2);
    let mut check = |next: Point, current: &mut Point| -> bool {
        let vector = Point { x: next.x - current.x, y: next.y - current.y };
        if vector.x != 0.0 || vector.y != 0.0 {
            if !vector.x.is_finite() || !vector.y.is_finite() {
                return true;
            }
            let (sign_x, sign_y) = (i32::from(vector.x < 0.0), i32::from(vector.y < 0.0));
            x_changes += i32::from(sign_x != last_x);
            y_changes += i32::from(sign_y != last_y);
            if x_changes > 3 || y_changes > 3 {
                return true;
            }
            last_x = sign_x;
            last_y = sign_y;
        }
        *current = next;
        false
    };
    for point in &points[1..] {
        if check(*point, &mut current) {
            return true;
        }
    }
    check(first, &mut current)
}

pub fn is_convex(path: &DevicePath) -> bool {
    let mut verb_count = path.verbs.len();
    let mut point_count = path.points.len();
    while verb_count > 0 && path.verbs[verb_count - 1] == Verb::Move {
        verb_count -= 1;
        point_count -= 1;
    }
    if verb_count == 0 {
        return true;
    }
    let points = &path.points[..point_count];
    if concave_by_sign(points) {
        return false;
    }
    let zero = Point { x: 0.0, y: 0.0 };
    let mut state = Convexicator {
        first_point: zero,
        first_vector: zero,
        last_point: zero,
        last_vector: zero,
        expected: Direction::Invalid,
        first_direction_known: false,
        reversals: 0,
    };
    let mut contours = 0;
    let mut needs_close = false;
    let mut index = 0;
    for verb in &path.verbs[..verb_count] {
        let count = match verb {
            Verb::Move => 1,
            Verb::Line => 1,
            Verb::Quad => 2,
            Verb::Cubic => 3,
            Verb::Close => 0,
        };
        let added = &points[index..index + count];
        index += count;
        if contours == 0 {
            if *verb == Verb::Move {
                state.set_move(added[0]);
                continue;
            }
            contours = 1;
            needs_close = true;
        }
        if contours == 1 {
            if matches!(verb, Verb::Close | Verb::Move) {
                if !state.close() {
                    return false;
                }
                needs_close = false;
                contours = 2;
            } else {
                for point in added {
                    if !state.add_point(*point) {
                        return false;
                    }
                }
            }
        } else if *verb != Verb::Move {
            return false;
        }
    }
    if needs_close && !state.close() {
        return false;
    }
    !(!state.first_direction_known && state.reversals >= 3)
}

fn trivial_rect(path: &DevicePath) -> Option<Option<Rect>> {
    let points = &path.points;
    if points.len() != 4 || path.verbs != [Verb::Move, Verb::Line, Verb::Line, Verb::Line, Verb::Close] {
        return None;
    }
    let vector = |a: Point, b: Point| Point { x: b.x - a.x, y: b.y - a.y };
    let (v0, v1, v2, v3) =
        (vector(points[0], points[1]), vector(points[1], points[2]), vector(points[2], points[3]), vector(points[3], points[0]));
    let orthogonal = |a: Point, b: Point| ((a.x == 0.0) ^ (b.x == 0.0)) & ((a.y == 0.0) ^ (b.y == 0.0));
    if !(((v0.x == 0.0) ^ (v0.y == 0.0)) & orthogonal(v0, v1) & orthogonal(v1, v2) & orthogonal(v2, v3)) {
        return Some(None);
    }
    Some(Some(sorted_rect(points[0], points[2])))
}

fn sorted_rect(a: Point, b: Point) -> Rect {
    Rect { left: a.x.min(b.x), top: a.y.min(b.y), right: a.x.max(b.x), bottom: a.y.max(b.y) }
}

fn rect_direction(dx: f32, dy: f32) -> i32 {
    i32::from(dx != 0.0) | (i32::from(dx > 0.0 || dy > 0.0) << 1)
}

pub fn path_rect(path: &DevicePath) -> Option<Rect> {
    if path.verbs.iter().any(|verb| matches!(verb, Verb::Quad | Verb::Cubic)) || path.points.len() < 4 || path.verbs.len() < 4 {
        return None;
    }
    if !path.verbs.contains(&Verb::Line) {
        return None;
    }
    if let Some(rect) = trivial_rect(path)
        && rect.is_some()
    {
        return rect;
    }
    let points = &path.points;
    let mut corners = 0;
    let mut line_start = Point { x: 0.0, y: 0.0 };
    let mut first: Option<usize> = None;
    let mut last: Option<usize> = None;
    let mut first_corner = line_start;
    let mut third_corner = line_start;
    let mut directions = [-1_i32; 5];
    let mut closed_or_moved = false;
    let mut auto_close = false;
    let mut index = 0;
    for verb in &path.verbs {
        match verb {
            Verb::Close | Verb::Line => {
                if *verb == Verb::Close {
                    auto_close = true;
                } else {
                    last = Some(index);
                }
                let line_end = if *verb == Verb::Close {
                    points[first?]
                } else {
                    index += 1;
                    points[index - 1]
                };
                let delta = Point { x: line_end.x - line_start.x, y: line_end.y - line_start.y };
                if delta.x != 0.0 && delta.y != 0.0 {
                    return None;
                }
                if !delta.x.is_finite() || !delta.y.is_finite() {
                    return None;
                }
                if line_start == line_end {
                    continue;
                }
                let next = rect_direction(delta.x, delta.y);
                if corners == 0 {
                    directions[0] = next;
                    corners = 1;
                    closed_or_moved = false;
                    line_start = line_end;
                    continue;
                }
                if closed_or_moved {
                    return None;
                }
                if auto_close && next == directions[0] {
                    continue;
                }
                closed_or_moved = auto_close;
                if directions[corners - 1] == next {
                    if corners == 3 && *verb == Verb::Line {
                        third_corner = line_end;
                    }
                    line_start = line_end;
                    continue;
                }
                directions[corners] = next;
                corners += 1;
                match corners {
                    2 => first_corner = line_start,
                    3 => {
                        if (directions[0] ^ directions[2]) != 2 {
                            return None;
                        }
                        third_corner = line_end;
                    }
                    4 => {
                        if (directions[1] ^ directions[3]) != 2 {
                            return None;
                        }
                    }
                    _ => return None,
                }
                line_start = line_end;
            }
            Verb::Move => {
                if corners == 0 {
                    first = Some(index);
                } else {
                    let (first_point, last_point) = (points[first?], points[last?]);
                    if first_point.x != last_point.x && first_point.y != last_point.y {
                        return None;
                    }
                }
                line_start = points[index];
                index += 1;
                closed_or_moved = true;
            }
            Verb::Quad | Verb::Cubic => return None,
        }
    }
    if !(3..=4).contains(&corners) {
        return None;
    }
    let (first_point, last_point) = (points[first?], points[last?]);
    if first_point.x != last_point.x && first_point.y != last_point.y {
        return None;
    }
    Some(sorted_rect(first_corner, third_corner))
}

fn edge_less(edges: &[Edge], a: usize, b: usize) -> bool {
    let (a, b) = (&edges[a], &edges[b]);
    if a.upper_y != b.upper_y {
        return a.upper_y < b.upper_y;
    }
    if a.x != b.x {
        return a.x < b.x;
    }
    a.dx < b.dx
}

fn insertion_sort(order: &mut [usize], less: &impl Fn(usize, usize) -> bool) {
    for next in 1..order.len() {
        if !less(order[next], order[next - 1]) {
            continue;
        }
        let insert = order[next];
        let mut hole = next;
        loop {
            order[hole] = order[hole - 1];
            hole -= 1;
            if !(hole > 0 && less(insert, order[hole - 1])) {
                break;
            }
        }
        order[hole] = insert;
    }
}

fn sift_down(order: &mut [usize], mut root: usize, bottom: usize, less: &impl Fn(usize, usize) -> bool) {
    let value = order[root - 1];
    let mut child = root << 1;
    while child <= bottom {
        if child < bottom && less(order[child - 1], order[child]) {
            child += 1;
        }
        if less(value, order[child - 1]) {
            order[root - 1] = order[child - 1];
            root = child;
            child = root << 1;
        } else {
            break;
        }
    }
    order[root - 1] = value;
}

fn sift_up(order: &mut [usize], mut root: usize, bottom: usize, less: &impl Fn(usize, usize) -> bool) {
    let value = order[root - 1];
    let start = root;
    let mut child = root << 1;
    while child <= bottom {
        if child < bottom && less(order[child - 1], order[child]) {
            child += 1;
        }
        order[root - 1] = order[child - 1];
        root = child;
        child = root << 1;
    }
    let mut parent = root >> 1;
    while parent >= start {
        if less(order[parent - 1], value) {
            order[root - 1] = order[parent - 1];
            root = parent;
            parent = root >> 1;
        } else {
            break;
        }
    }
    order[root - 1] = value;
}

fn heap_sort(order: &mut [usize], less: &impl Fn(usize, usize) -> bool) {
    let count = order.len();
    for index in (1..=count >> 1).rev() {
        sift_down(order, index, count, less);
    }
    for index in (1..count).rev() {
        order.swap(0, index);
        sift_up(order, 1, index, less);
    }
}

fn partition(order: &mut [usize], pivot: usize, less: &impl Fn(usize, usize) -> bool) -> usize {
    let right = order.len() - 1;
    let pivot_value = order[pivot];
    order.swap(pivot, right);
    let mut new_pivot = 0;
    for left in 0..right {
        if less(order[left], pivot_value) {
            order.swap(left, new_pivot);
            new_pivot += 1;
        }
    }
    order.swap(new_pivot, right);
    new_pivot
}

fn intro_sort(mut depth: i32, mut order: &mut [usize], less: &impl Fn(usize, usize) -> bool) {
    loop {
        if order.len() <= 32 {
            insertion_sort(order, less);
            return;
        }
        if depth == 0 {
            heap_sort(order, less);
            return;
        }
        depth -= 1;
        let middle = (order.len() - 1) >> 1;
        let pivot = partition(order, middle, less);
        let (left, right) = order.split_at_mut(pivot);
        intro_sort(depth, left, less);
        order = &mut right[1..];
    }
}

fn sort_edges(edges: &[Edge]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..edges.len()).collect();
    if order.len() > 1 {
        let depth = 2 * (32 - ((order.len() - 1) as u32 - 1).leading_zeros() as i32);
        intro_sort(depth, &mut order, &|a, b| edge_less(edges, a, b));
    }
    order
}

fn catch_overflow(value: u32) -> u8 {
    (value - (value >> 8)) as u8
}

fn add_alpha(alpha: &mut u8, delta: u8) {
    *alpha = catch_overflow(u32::from(*alpha) + u32::from(delta));
}

fn safely_add_alpha(alpha: &mut u8, delta: u8) {
    *alpha = (u32::from(*alpha) + u32::from(delta)).min(255) as u8;
}

fn snap_alpha(alpha: u8) -> u8 {
    if alpha > 247 {
        255
    } else if alpha < 8 {
        0
    } else {
        alpha
    }
}

struct MaskAccumulator {
    mask: Vec<u8>,
    left: i32,
    top: i32,
    width: i32,
    clip: [i32; 4],
}

struct RunAccumulator {
    alphas: Vec<u8>,
    left: i32,
    top: i32,
    current_y: i32,
    safe: bool,
}

enum Accumulator {
    Mask(MaskAccumulator),
    Runs(RunAccumulator),
}

struct Additive<'a, 'b> {
    real: &'a mut ColorBlitter<'b>,
    accumulator: Accumulator,
}

impl Additive<'_, '_> {
    fn is_mask(&self) -> bool {
        matches!(self.accumulator, Accumulator::Mask(_))
    }

    fn row(&self, y: i32) -> isize {
        match &self.accumulator {
            Accumulator::Mask(mask) => 1 + ((y - mask.top) * mask.width - mask.left) as isize,
            Accumulator::Runs(_) => 0,
        }
    }

    fn mask_at(&mut self, row: isize, x: i32) -> Option<&mut u8> {
        match &mut self.accumulator {
            Accumulator::Mask(mask) => {
                let index = row + x as isize;
                usize::try_from(index).ok().and_then(|index| mask.mask.get_mut(index))
            }
            Accumulator::Runs(_) => None,
        }
    }

    fn flush(&mut self) {
        let Accumulator::Runs(runs) = &mut self.accumulator else {
            return;
        };
        if runs.current_y >= runs.top {
            runs.alphas.iter_mut().for_each(|alpha| *alpha = snap_alpha(*alpha));
            if runs.alphas.iter().any(|alpha| *alpha != 0) {
                self.real.blit_anti_h(runs.left, runs.current_y, &runs.alphas);
                runs.alphas.fill(0);
            }
            runs.current_y = runs.top - 1;
        }
    }

    fn check_y(&mut self, y: i32) {
        let current = match &self.accumulator {
            Accumulator::Runs(runs) => runs.current_y,
            Accumulator::Mask(_) => return,
        };
        if y != current {
            self.flush();
            if let Accumulator::Runs(runs) = &mut self.accumulator {
                runs.current_y = y;
            }
        }
    }

    fn flush_if_y_changed(&mut self, y: i32, next_y: i32) {
        if !self.is_mask() && fixed_floor_to_int(y) != fixed_floor_to_int(next_y) {
            self.flush();
        }
    }

    fn anti_h_one(&mut self, x: i32, y: i32, alpha: u8) {
        if self.is_mask() {
            let row = self.row(y);
            if let Some(value) = self.mask_at(row, x) {
                add_alpha(value, alpha);
            }
            return;
        }
        self.check_y(y);
        if let Accumulator::Runs(runs) = &mut self.accumulator {
            let x = x - runs.left;
            if x >= 0 && x < runs.alphas.len() as i32 {
                let value = &mut runs.alphas[x as usize];
                if runs.safe { safely_add_alpha(value, alpha) } else { add_alpha(value, alpha) }
            }
        }
    }

    fn anti_h_width(&mut self, x: i32, y: i32, width: i32, alpha: u8) {
        if self.is_mask() {
            let row = self.row(y);
            for offset in 0..width {
                if let Some(value) = self.mask_at(row, x + offset) {
                    add_alpha(value, alpha);
                }
            }
            return;
        }
        self.check_y(y);
        if let Accumulator::Runs(runs) = &mut self.accumulator {
            let x = x - runs.left;
            if x >= 0 && x + width <= runs.alphas.len() as i32 {
                for value in &mut runs.alphas[x as usize..(x + width) as usize] {
                    if runs.safe { safely_add_alpha(value, alpha) } else { add_alpha(value, alpha) }
                }
            }
        }
    }

    fn anti_h_array(&mut self, x: i32, y: i32, alphas: &[u8]) {
        self.check_y(y);
        if let Accumulator::Runs(runs) = &mut self.accumulator {
            let mut x = x - runs.left;
            let mut alphas = alphas;
            if x < 0 {
                alphas = &alphas[(-x as usize).min(alphas.len())..];
                x = 0;
            }
            let length = (alphas.len() as i32).min(runs.alphas.len() as i32 - x).max(0) as usize;
            for (value, alpha) in runs.alphas[x as usize..x as usize + length].iter_mut().zip(alphas) {
                if runs.safe { safely_add_alpha(value, *alpha) } else { add_alpha(value, *alpha) }
            }
        }
    }

    fn real_blit_v(&mut self, x: i32, y: i32, height: i32, alpha: u8) {
        if self.is_mask() {
            if alpha == 0 {
                return;
            }
            for offset in 0..height {
                let row = self.row(y + offset);
                if let Some(value) = self.mask_at(row, x) {
                    *value = alpha;
                }
            }
            return;
        }
        self.real.blit_v(x, y, height, alpha);
    }

    fn real_blit_anti_rect(&mut self, x: i32, y: i32, width: i32, height: i32, left_alpha: u8, right_alpha: u8) {
        if self.is_mask() {
            self.real_blit_v(x, y, height, left_alpha);
            self.real_blit_v(x + 1 + width, y, height, right_alpha);
            for offset in 0..height {
                let row = self.row(y + offset);
                for column in 0..width {
                    if let Some(value) = self.mask_at(row, x + 1 + column) {
                        *value = 0xFF;
                    }
                }
            }
            return;
        }
        self.real.blit_anti_rect(x, y, width, height, left_alpha, right_alpha);
    }

    fn real_blit_h(&mut self, x: i32, y: i32, width: i32) {
        if !self.is_mask() {
            self.real.blit_h(x, y, width);
        }
    }

    fn real_blit_anti_h(&mut self, x: i32, y: i32, alphas: &[u8]) {
        if !self.is_mask() {
            self.real.blit_anti_h(x, y, alphas);
        }
    }

    fn real_blit_anti_h2(&mut self, x: i32, y: i32, first: u8, second: u8) {
        if !self.is_mask() {
            self.real.blit_anti_h2(x, y, first, second);
        }
    }

    fn finish(mut self) {
        match &self.accumulator {
            Accumulator::Runs(_) => self.flush(),
            Accumulator::Mask(mask) => {
                let [left, top, right, bottom] = mask.clip;
                for y in top..bottom {
                    let start = (1 + (y - mask.top) * mask.width + (left - mask.left)) as usize;
                    let row = &mask.mask[start..start + (right - left) as usize];
                    self.real.blit_mask_row(left, y, row);
                }
            }
        }
    }
}

fn trapezoid_to_alpha(first: i32, second: i32) -> u8 {
    ((first.wrapping_add(second) / 2) >> 8) as u8
}

fn partial_triangle_to_alpha(a: i32, b: i32) -> u8 {
    let area = (a >> 11).wrapping_mul(a >> 11).wrapping_mul(b >> 11);
    ((area >> 8) & 0xFF) as u8
}

fn partial_alpha_height(alpha: u8, partial_height: i32) -> u8 {
    fixed_round_to_int(i32::from(alpha).wrapping_mul(partial_height)) as u8
}

fn partial_alpha(alpha: u8, full_alpha: u8) -> u8 {
    ((u32::from(alpha) * u32::from(full_alpha)) >> 8) as u8
}

fn fixed_to_alpha(value: i32) -> u8 {
    partial_alpha_height(0xFF, value)
}

fn approximate_intersection(mut l1: i32, mut r1: i32, mut l2: i32, mut r2: i32) -> i32 {
    if l1 > r1 {
        std::mem::swap(&mut l1, &mut r1);
    }
    if l2 > r2 {
        std::mem::swap(&mut l2, &mut r2);
    }
    (l1.max(l2).wrapping_add(r1.min(r2))) / 2
}

fn alpha_above_line(alphas: &mut [u8], l: i32, r: i32, dy: i32, full_alpha: u8) {
    let count = fixed_ceil_to_int(r);
    if count == 0 {
        return;
    }
    if count == 1 {
        alphas[0] = partial_alpha(((count << 17) - l - r).wrapping_shr(9) as u8, full_alpha);
        return;
    }
    let first = FIXED_ONE - l;
    let last = r - ((count - 1) << 16);
    let first_height = fixed_mul(first, dy);
    alphas[0] = (fixed_mul(first, first_height) >> 9) as u8;
    let mut alpha16 = saturating_add(first_height, dy >> 1);
    for alpha in alphas.iter_mut().take(count as usize - 1).skip(1) {
        *alpha = (alpha16 >> 8) as u8;
        alpha16 = saturating_add(alpha16, dy);
    }
    alphas[count as usize - 1] = full_alpha.wrapping_sub(partial_triangle_to_alpha(last, dy));
}

fn alpha_below_line(alphas: &mut [u8], l: i32, r: i32, dy: i32, full_alpha: u8) {
    let count = fixed_ceil_to_int(r);
    if count == 0 {
        return;
    }
    if count == 1 {
        alphas[0] = partial_alpha(trapezoid_to_alpha(l, r), full_alpha);
        return;
    }
    let first = FIXED_ONE - l;
    let last = r - ((count - 1) << 16);
    let last_height = fixed_mul(last, dy);
    alphas[count as usize - 1] = (fixed_mul(last, last_height) >> 9) as u8;
    let mut alpha16 = saturating_add(last_height, dy >> 1);
    for index in (1..count as usize - 1).rev() {
        alphas[index] = ((alpha16 >> 8) & 0xFF) as u8;
        alpha16 = saturating_add(alpha16, dy);
    }
    alphas[0] = full_alpha.wrapping_sub(partial_triangle_to_alpha(first, dy));
}

struct Row {
    y: i32,
    full_alpha: u8,
    mask: Option<isize>,
    no_real: bool,
}

fn blit_single_alpha(blitter: &mut Additive, row: &Row, x: i32, alpha: u8) {
    let direct = row.full_alpha == 0xFF && !row.no_real;
    if let Some(mask) = row.mask {
        if let Some(value) = blitter.mask_at(mask, x) {
            if direct { *value = alpha } else { safely_add_alpha(value, partial_alpha(alpha, row.full_alpha)) }
        }
    } else if direct {
        blitter.real_blit_v(x, row.y, 1, alpha);
    } else {
        blitter.anti_h_one(x, row.y, partial_alpha(alpha, row.full_alpha));
    }
}

fn blit_two_alphas(blitter: &mut Additive, row: &Row, x: i32, first: u8, second: u8) {
    if let Some(mask) = row.mask {
        if let Some(value) = blitter.mask_at(mask, x) {
            safely_add_alpha(value, first);
        }
        if let Some(value) = blitter.mask_at(mask, x + 1) {
            safely_add_alpha(value, second);
        }
    } else if row.full_alpha == 0xFF && !row.no_real {
        blitter.real_blit_anti_h2(x, row.y, first, second);
    } else {
        blitter.anti_h_one(x, row.y, first);
        blitter.anti_h_one(x + 1, row.y, second);
    }
}

fn blit_full_alpha(blitter: &mut Additive, row: &Row, x: i32, length: i32) {
    if let Some(mask) = row.mask {
        for offset in 0..length {
            if let Some(value) = blitter.mask_at(mask, x + offset) {
                safely_add_alpha(value, row.full_alpha);
            }
        }
    } else if row.full_alpha == 0xFF && !row.no_real {
        blitter.real_blit_h(x, row.y, length);
    } else {
        blitter.anti_h_width(x, row.y, length, row.full_alpha);
    }
}

#[allow(clippy::too_many_arguments)]
fn blit_aaa_trapezoid_row(blitter: &mut Additive, row: &Row, ul: i32, ur: i32, ll: i32, lr: i32, left_dy: i32, right_dy: i32) {
    let left = fixed_floor_to_int(ul);
    let length = fixed_ceil_to_int(lr) - left;
    let full_alpha = row.full_alpha;
    if length == 1 {
        blit_single_alpha(blitter, row, left, trapezoid_to_alpha(ur.wrapping_sub(ul), lr.wrapping_sub(ll)));
        return;
    }
    if length <= 0 {
        return;
    }
    let size = length as usize;
    let mut alphas = vec![full_alpha; size];
    let mut temporary = vec![0u8; size + 2];
    let upper_left = fixed_floor_to_int(ul);
    let lower_left = fixed_ceil_to_int(ll);
    if upper_left + 2 == lower_left {
        let first = (upper_left << 16) + FIXED_ONE - ul;
        let second = ll - ul - first;
        let a1 = full_alpha.wrapping_sub(partial_triangle_to_alpha(first, left_dy));
        let a2 = partial_triangle_to_alpha(second, left_dy);
        alphas[0] = alphas[0].saturating_sub(a1);
        alphas[1] = alphas[1].saturating_sub(a2);
    } else {
        let offset = (upper_left - left) as usize;
        alpha_below_line(&mut temporary[offset..], ul - (upper_left << 16), ll - (upper_left << 16), left_dy, full_alpha);
        for index in upper_left..lower_left {
            let index = (index - left) as usize;
            if index < size {
                alphas[index] = alphas[index].saturating_sub(temporary[index]);
            }
        }
    }
    let upper_right = fixed_floor_to_int(ur);
    let lower_right = fixed_ceil_to_int(lr);
    if upper_right + 2 == lower_right {
        let first = (upper_right << 16) + FIXED_ONE - ur;
        let second = lr - ur - first;
        let a1 = partial_triangle_to_alpha(first, right_dy);
        let a2 = full_alpha.wrapping_sub(partial_triangle_to_alpha(second, right_dy));
        alphas[size - 2] = alphas[size - 2].saturating_sub(a1);
        alphas[size - 1] = alphas[size - 1].saturating_sub(a2);
    } else {
        temporary.fill(0);
        let offset = (upper_right - left) as usize;
        if offset < temporary.len() {
            alpha_above_line(&mut temporary[offset..], ur - (upper_right << 16), lr - (upper_right << 16), right_dy, full_alpha);
        }
        for index in upper_right..lower_right {
            let index = (index - left) as usize;
            if index < size {
                alphas[index] = alphas[index].saturating_sub(temporary[index]);
            }
        }
    }
    if let Some(mask) = row.mask {
        for (offset, alpha) in alphas.iter().enumerate() {
            if let Some(value) = blitter.mask_at(mask, left + offset as i32) {
                safely_add_alpha(value, *alpha);
            }
        }
    } else if full_alpha == 0xFF && !row.no_real {
        blitter.real_blit_anti_h(left, row.y, &alphas);
    } else {
        blitter.anti_h_array(left, row.y, &alphas);
    }
}

#[allow(clippy::too_many_arguments)]
fn blit_trapezoid_row(blitter: &mut Additive, row: &Row, mut ul: i32, mut ur: i32, mut ll: i32, mut lr: i32, left_dy: i32, right_dy: i32) {
    if ul > ur {
        return;
    }
    if ll > lr {
        ll = approximate_intersection(ul, ll, ur, lr);
        lr = ll;
    }
    if ul == ur && ll == lr {
        return;
    }
    if ul > ll {
        std::mem::swap(&mut ul, &mut ll);
    }
    if ur > lr {
        std::mem::swap(&mut ur, &mut lr);
    }
    let join_left = fixed_ceil_to_fixed(ll);
    let join_right = fixed_floor_to_fixed(ur);
    if join_left > join_right {
        blit_aaa_trapezoid_row(blitter, row, ul, ur, ll, lr, left_dy, right_dy);
        return;
    }
    if ul < join_left {
        let length = fixed_ceil_to_int(join_left - ul);
        if length == 1 {
            blit_single_alpha(blitter, row, ul >> 16, trapezoid_to_alpha(join_left - ul, join_left - ll));
        } else if length == 2 {
            let first = join_left - FIXED_ONE - ul;
            let second = ll - ul - first;
            let a1 = partial_triangle_to_alpha(first, left_dy);
            let a2 = row.full_alpha.wrapping_sub(partial_triangle_to_alpha(second, left_dy));
            blit_two_alphas(blitter, row, ul >> 16, a1, a2);
        } else {
            blit_aaa_trapezoid_row(blitter, row, ul, join_left, ll, join_left, left_dy, MAX_S32);
        }
    }
    if join_left < join_right {
        blit_full_alpha(blitter, row, fixed_floor_to_int(join_left), fixed_floor_to_int(join_right - join_left));
    }
    if lr > join_right {
        let length = fixed_ceil_to_int(lr - join_right);
        if length == 1 {
            blit_single_alpha(blitter, row, join_right >> 16, trapezoid_to_alpha(ur - join_right, lr - join_right));
        } else if length == 2 {
            let first = join_right + FIXED_ONE - ur;
            let second = lr - ur - first;
            let a1 = row.full_alpha.wrapping_sub(partial_triangle_to_alpha(first, right_dy));
            let a2 = partial_triangle_to_alpha(second, right_dy);
            blit_two_alphas(blitter, row, join_right >> 16, a1, a2);
        } else {
            blit_aaa_trapezoid_row(blitter, row, join_right, ur, join_right, lr, MAX_S32, right_dy);
        }
    }
}

fn smooth_edge(edges: &[Edge], this: usize, next: usize) -> bool {
    let edge = &edges[this];
    if edge.curve_count < 0 {
        let shift = edge.curve_shift;
        return (edge.qdx.wrapping_abs() >> 1) >= (edge.qddx.wrapping_abs() >> shift)
            && (edge.qdy.wrapping_abs() >> 1) >= (edge.qddy.wrapping_abs() >> shift)
            && (edge.qdy.wrapping_sub(edge.qddy >> shift) >> edge.cubic_shift) >= FIXED_ONE;
    }
    if edge.curve_count > 0 {
        return (edge.qdx.wrapping_abs() >> 1) >= edge.qddx.wrapping_abs()
            && (edge.qdy.wrapping_abs() >> 1) >= edge.qddy.wrapping_abs()
            && (edge.qdy.wrapping_sub(edge.qddy) >> edge.curve_shift) >= FIXED_ONE;
    }
    let next = &edges[next];
    let difference = (i64::from(next.dx) - i64::from(edge.dx)).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    difference.wrapping_abs() <= FIXED_ONE && next.lower_y.wrapping_sub(next.upper_y) >= FIXED_ONE
}

fn smooth_pair(edges: &[Edge], left: usize, right: usize, current: usize, stop_y: i32) -> bool {
    if edges[current].upper_y >= stop_y.wrapping_shl(16) {
        return false;
    }
    if edges[left].lower_y.wrapping_add(FIXED_ONE) < edges[right].lower_y {
        return smooth_edge(edges, left, current);
    }
    if edges[left].lower_y > edges[right].lower_y.wrapping_add(FIXED_ONE) {
        return smooth_edge(edges, right, current);
    }
    let mut current = current;
    let mut next = edges[current].next;
    if edges[next].upper_y >= stop_y << 16 {
        return false;
    }
    if edges[next].upper_x < edges[current].upper_x {
        std::mem::swap(&mut current, &mut next);
    }
    smooth_edge(edges, left, current) && smooth_edge(edges, right, next)
}

struct Walk {
    start_y: i32,
    stop_y: i32,
    left_bound: i32,
    right_bound: i32,
}

fn advance_edge(edges: &mut [Edge], edge: &mut usize, current: &mut usize, y: i32, stop_y: i32) -> bool {
    while edges[*edge].lower_y <= y {
        if !edges[*edge].update() {
            if fixed_floor_to_int(edges[*current].upper_y) >= stop_y {
                return false;
            }
            *edge = *current;
            *current = edges[*current].next;
        }
    }
    true
}

fn blit_convex_rect(blitter: &mut Additive, y: i32, bottom: i32, left: i32, right: i32) {
    let full_left = fixed_ceil_to_int(left);
    let full_right = fixed_floor_to_int(right);
    let partial_left = (full_left << 16) - left;
    let partial_right = right - (full_right << 16);
    let full_top = fixed_ceil_to_int(y);
    let full_bottom = fixed_floor_to_int(bottom);
    let mut partial_top = (full_top << 16) - y;
    let mut partial_bottom = bottom - (full_bottom << 16);
    if full_top > full_bottom {
        partial_top -= FIXED_ONE - partial_bottom;
        partial_bottom = 0;
    }
    if full_right >= full_left {
        if partial_top > 0 {
            if partial_left > 0 {
                blitter.anti_h_one(full_left - 1, full_top - 1, fixed_to_alpha(fixed_mul(partial_top, partial_left)));
            }
            blitter.anti_h_width(full_left, full_top - 1, full_right - full_left, fixed_to_alpha(partial_top));
            if partial_right > 0 {
                blitter.anti_h_one(full_right, full_top - 1, fixed_to_alpha(fixed_mul(partial_top, partial_right)));
            }
            blitter.flush_if_y_changed(y, y + partial_top);
        }
        if full_bottom > full_top && (full_right > full_left || fixed_to_alpha(partial_left) > 0 || fixed_to_alpha(partial_right) > 0) {
            blitter.real_blit_anti_rect(
                full_left - 1,
                full_top,
                full_right - full_left,
                full_bottom - full_top,
                fixed_to_alpha(partial_left),
                fixed_to_alpha(partial_right),
            );
        }
        if partial_bottom > 0 {
            if partial_left > 0 {
                blitter.anti_h_one(full_left - 1, full_bottom, fixed_to_alpha(fixed_mul(partial_bottom, partial_left)));
            }
            blitter.anti_h_width(full_left, full_bottom, full_right - full_left, fixed_to_alpha(partial_bottom));
            if partial_right > 0 {
                blitter.anti_h_one(full_right, full_bottom, fixed_to_alpha(fixed_mul(partial_bottom, partial_right)));
            }
        }
        return;
    }
    let width = right - left;
    if width <= 0 {
        return;
    }
    if partial_top > 0 {
        blitter.anti_h_width(full_left - 1, full_top - 1, 1, fixed_to_alpha(fixed_mul(partial_top, width)));
        blitter.flush_if_y_changed(y, y + partial_top);
    }
    if full_bottom > full_top {
        blitter.real_blit_v(full_left - 1, full_top, full_bottom - full_top, fixed_to_alpha(width));
    }
    if partial_bottom > 0 {
        blitter.anti_h_width(full_left - 1, full_bottom, 1, fixed_to_alpha(fixed_mul(partial_bottom, width)));
    }
}

const SNAP_DIGIT: i32 = FIXED_ONE >> 4;
const SNAP_HALF: i32 = SNAP_DIGIT >> 1;
const SNAP_MASK: i32 = -SNAP_DIGIT;

fn walk_convex(edges: &mut [Edge], head: usize, blitter: &mut Additive, walk: &Walk) {
    let mut left_edge = edges[head].next;
    let mut right_edge = edges[left_edge].next;
    let mut current = edges[right_edge].next;
    let mut y = edges[left_edge].upper_y.max(edges[right_edge].upper_y);
    let stop_y = walk.stop_y;
    let mask = blitter.is_mask();
    loop {
        if !advance_edge(edges, &mut left_edge, &mut current, y, stop_y) || !advance_edge(edges, &mut right_edge, &mut current, y, stop_y) {
            return;
        }
        if fixed_floor_to_int(y) >= stop_y {
            return;
        }
        edges[left_edge].go_y(y);
        edges[right_edge].go_y(y);
        if edges[left_edge].x > edges[right_edge].x
            || (edges[left_edge].x == edges[right_edge].x && edges[left_edge].dx > edges[right_edge].dx)
        {
            std::mem::swap(&mut left_edge, &mut right_edge);
        }
        let mut bottom = edges[left_edge].lower_y.min(edges[right_edge].lower_y);
        if smooth_pair(edges, left_edge, right_edge, current, stop_y) {
            bottom = fixed_ceil_to_fixed(bottom);
        }
        bottom = bottom.min(stop_y << 16);
        let mut left = walk.left_bound.max(edges[left_edge].x);
        let left_dx = edges[left_edge].dx;
        let mut right = walk.right_bound.min(edges[right_edge].x);
        let right_dx = edges[right_edge].dx;
        let (left_dy, right_dy) = (edges[left_edge].dy, edges[right_edge].dy);
        if left_dx | right_dx == 0 {
            blit_convex_rect(blitter, y, bottom, left, right);
            y = bottom;
        } else {
            left += SNAP_HALF;
            right += SNAP_HALF;
            let mut count = fixed_ceil_to_int(bottom) - fixed_floor_to_int(y);
            let mut mask_row = mask.then(|| blitter.row(y >> 16));
            if count > 1 {
                if fixed_floor_to_fixed(y) != y {
                    count -= 1;
                    let next_y = fixed_ceil_to_fixed(y + 1);
                    let dy = next_y - y;
                    let next_left = left + fixed_mul(left_dx, dy);
                    let next_right = right + fixed_mul(right_dx, dy);
                    let row = Row { y: y >> 16, full_alpha: partial_alpha_height(0xFF, dy), mask: mask_row, no_real: false };
                    blit_trapezoid_row(
                        blitter,
                        &row,
                        left & SNAP_MASK,
                        right & SNAP_MASK,
                        next_left & SNAP_MASK,
                        next_right & SNAP_MASK,
                        left_dy,
                        right_dy,
                    );
                    blitter.flush_if_y_changed(y, next_y);
                    left = next_left;
                    right = next_right;
                    y = next_y;
                }
                while count > 1 {
                    count -= 1;
                    if mask {
                        mask_row = Some(blitter.row(y >> 16));
                    }
                    let (next_y, next_left, next_right) = (y + FIXED_ONE, left + left_dx, right + right_dx);
                    let row = Row { y: y >> 16, full_alpha: 0xFF, mask: mask_row, no_real: false };
                    blit_trapezoid_row(
                        blitter,
                        &row,
                        left & SNAP_MASK,
                        right & SNAP_MASK,
                        next_left & SNAP_MASK,
                        next_right & SNAP_MASK,
                        left_dy,
                        right_dy,
                    );
                    blitter.flush_if_y_changed(y, next_y);
                    left = next_left;
                    right = next_right;
                    y = next_y;
                }
            }
            if mask {
                mask_row = Some(blitter.row(y >> 16));
            }
            let dy = bottom - y;
            let next_left = (left + fixed_mul(left_dx, dy)).max(walk.left_bound + SNAP_HALF);
            let next_right = (right + fixed_mul(right_dx, dy)).min(walk.right_bound + SNAP_HALF);
            let row = Row { y: y >> 16, full_alpha: partial_alpha_height(0xFF, dy), mask: mask_row, no_real: false };
            blit_trapezoid_row(
                blitter,
                &row,
                left & SNAP_MASK,
                right & SNAP_MASK,
                next_left & SNAP_MASK,
                next_right & SNAP_MASK,
                left_dy,
                right_dy,
            );
            blitter.flush_if_y_changed(y, bottom);
            left = next_left - SNAP_HALF;
            right = next_right - SNAP_HALF;
            y = bottom;
        }
        edges[left_edge].x = left;
        edges[right_edge].x = right;
        edges[left_edge].y = y;
        edges[right_edge].y = y;
    }
}

fn update_next_next_y(y: i32, next_y: i32, next_next_y: &mut i32) {
    if y > next_y && y < *next_next_y {
        *next_next_y = y;
    }
}

fn check_intersection(edges: &[Edge], edge: usize, next_y: i32, next_next_y: &mut i32) {
    let previous = edges[edge].previous;
    if edges[previous].previous != NONE && edges[previous].x.wrapping_add(edges[previous].dx) > edges[edge].x.wrapping_add(edges[edge].dx) {
        *next_next_y = next_y + (FIXED_ONE >> ACCURACY);
    }
}

fn check_intersection_forward(edges: &[Edge], edge: usize, next_y: i32, next_next_y: &mut i32) {
    let next = edges[edge].next;
    if edges[next].next != NONE && edges[edge].x.wrapping_add(edges[edge].dx) > edges[next].x.wrapping_add(edges[next].dx) {
        *next_next_y = next_y + (FIXED_ONE >> ACCURACY);
    }
}

fn remove_edge(edges: &mut [Edge], edge: usize) {
    let (previous, next) = (edges[edge].previous, edges[edge].next);
    edges[previous].next = next;
    edges[next].previous = previous;
}

fn insert_edge_after(edges: &mut [Edge], edge: usize, after: usize) {
    let next = edges[after].next;
    edges[edge].previous = after;
    edges[edge].next = next;
    edges[next].previous = edge;
    edges[after].next = edge;
}

fn backward_insert_start(edges: &[Edge], mut previous: usize, x: i32) -> usize {
    while edges[previous].previous != NONE && edges[previous].x > x {
        previous = edges[previous].previous;
    }
    previous
}

fn backward_insert_edge_based_on_x(edges: &mut [Edge], edge: usize) {
    let previous = backward_insert_start(edges, edges[edge].previous, edges[edge].x);
    if edges[previous].next != edge {
        remove_edge(edges, edge);
        insert_edge_after(edges, edge, previous);
    }
}

fn insert_new_edges(edges: &mut [Edge], mut new_edge: usize, y: i32, next_next_y: &mut i32) {
    if edges[new_edge].upper_y > y {
        update_next_next_y(edges[new_edge].upper_y, y, next_next_y);
        return;
    }
    let previous = edges[new_edge].previous;
    if edges[previous].x <= edges[new_edge].x {
        while edges[new_edge].upper_y <= y {
            check_intersection(edges, new_edge, y, next_next_y);
            update_next_next_y(edges[new_edge].lower_y, y, next_next_y);
            new_edge = edges[new_edge].next;
        }
        update_next_next_y(edges[new_edge].upper_y, y, next_next_y);
        return;
    }
    let mut start = backward_insert_start(edges, previous, edges[new_edge].x);
    loop {
        let next = edges[new_edge].next;
        let mut already_placed = false;
        loop {
            if edges[start].next == new_edge {
                already_placed = true;
                break;
            }
            let after = edges[start].next;
            if edges[after].x >= edges[new_edge].x {
                break;
            }
            start = after;
        }
        if !already_placed {
            remove_edge(edges, new_edge);
            insert_edge_after(edges, new_edge, start);
        }
        check_intersection(edges, new_edge, y, next_next_y);
        check_intersection_forward(edges, new_edge, y, next_next_y);
        update_next_next_y(edges[new_edge].lower_y, y, next_next_y);
        start = new_edge;
        new_edge = next;
        if edges[new_edge].upper_y > y {
            break;
        }
    }
    update_next_next_y(edges[new_edge].upper_y, y, next_next_y);
}

fn edges_too_close(edges: &[Edge], previous: usize, next: usize, lower_y: i32) -> bool {
    next != NONE
        && previous != NONE
        && edges[next].upper_y < lower_y
        && edges[previous].x.wrapping_add(FIXED_ONE) >= edges[next].x.wrapping_sub(edges[next].dx.wrapping_abs())
}

fn advance_curve(edge: &mut Edge, next_y: i32) {
    while edge.lower_y <= next_y {
        if edge.curve_count == 0 {
            break;
        }
        edge.keep_continuous();
        let updated = if edge.curve_count < 0 { edge.update_cubic() } else { edge.update_quadratic() };
        if !updated {
            break;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn walk_edges(edges: &mut [Edge], head: usize, tail: usize, even_odd: bool, blitter: &mut Additive, walk: &Walk, skip_intersect: bool) {
    let (left_clip, right_clip) = (walk.left_bound, walk.right_bound);
    edges[head].x = left_clip;
    edges[head].upper_x = left_clip;
    edges[tail].x = right_clip;
    edges[tail].upper_x = right_clip;
    let mut y = edges[edges[head].next].upper_y.max(walk.start_y << 16);
    let mut next_next_y = MAX_S32;
    let mut edge = edges[head].next;
    while edges[edge].upper_y <= y {
        edges[edge].go_y(y);
        update_next_next_y(edges[edge].lower_y, y, &mut next_next_y);
        edge = edges[edge].next;
    }
    update_next_next_y(edges[edge].upper_y, y, &mut next_next_y);
    let winding_mask = if even_odd { 1 } else { -1 };
    let mask = blitter.is_mask();
    loop {
        let mut winding = 0;
        let mut in_interval = false;
        let mut previous_x = edges[head].x;
        let mut next_y = next_next_y.min(fixed_ceil_to_fixed(y + 1));
        let mut current = edges[head].next;
        let mut left_edge = head;
        let mut left = left_clip;
        let mut left_dy = 0;
        let mut previous_right = fixed_floor_to_int(left_clip);
        next_next_y = MAX_S32;
        let mut y_shift = 0;
        if (next_y - y) & (FIXED_ONE >> 2) != 0 {
            y_shift = 2;
            next_y = y + (FIXED_ONE >> 2);
        } else if (next_y - y) & (FIXED_ONE >> 1) != 0 {
            y_shift = 1;
        }
        let full_alpha = fixed_to_alpha(next_y - y);
        let mask_row = mask.then(|| blitter.row(fixed_floor_to_int(y)));
        while edges[current].upper_y <= y {
            winding += edges[current].winding;
            let previous_in_interval = in_interval;
            in_interval = winding & winding_mask != 0;
            let is_left = in_interval && !previous_in_interval;
            let is_right = !in_interval && previous_in_interval;
            if is_right {
                let mut right = edges[current].x;
                edges[current].go_y_shift(next_y, y_shift);
                let next_left = left_clip.max(edges[left_edge].x);
                right = right_clip.min(right);
                let next_right = right_clip.min(edges[current].x);
                let too_close = previous_right > fixed_floor_to_int(left)
                    || previous_right > fixed_floor_to_int(edges[left_edge].x)
                    || edges_too_close(edges, current, edges[current].next, next_y);
                let row = Row { y: y >> 16, full_alpha, mask: mask_row, no_real: full_alpha == 0xFF && too_close };
                blit_trapezoid_row(blitter, &row, left, right, next_left, next_right, left_dy, edges[current].dy);
                previous_right = fixed_ceil_to_int(right.max(edges[current].x));
            } else {
                if is_left {
                    left = edges[current].x.max(left_clip);
                    left_dy = edges[current].dy;
                    left_edge = current;
                }
                edges[current].go_y_shift(next_y, y_shift);
            }
            let next = edges[current].next;
            advance_curve(&mut edges[current], next_y);
            if edges[current].lower_y <= next_y {
                remove_edge(edges, current);
            } else {
                update_next_next_y(edges[current].lower_y, next_y, &mut next_next_y);
                let new_x = edges[current].x;
                if new_x < previous_x {
                    backward_insert_edge_based_on_x(edges, current);
                } else {
                    previous_x = new_x;
                }
                if !skip_intersect {
                    check_intersection(edges, current, next_y, &mut next_next_y);
                }
            }
            current = next;
        }
        if in_interval {
            let too_close = edges_too_close(edges, edges[left_edge].previous, left_edge, next_y);
            let row = Row { y: y >> 16, full_alpha, mask: mask_row, no_real: full_alpha == 0xFF && too_close };
            blit_trapezoid_row(blitter, &row, left, right_clip, left_clip.max(edges[left_edge].x), right_clip, left_dy, 0);
        }
        y = next_y;
        if y >= walk.stop_y << 16 {
            break;
        }
        insert_new_edges(edges, current, y, &mut next_next_y);
    }
}

fn scalar_to_alpha(value: f32) -> u8 {
    snap_alpha((value * 255.0) as u8)
}

fn round_out(rect: Rect) -> [i32; 4] {
    [rect.left.floor() as i32, rect.top.floor() as i32, rect.right.ceil() as i32, rect.bottom.ceil() as i32]
}

fn blit_fat_rect(blitter: &mut ColorBlitter, rect: Rect) {
    let [left, top, right, bottom] = round_out(rect);
    let (width, height) = (right - left, bottom - top);
    if height == 0 {
        return;
    }
    let partial_left = (left + 1) as f32 - rect.left;
    let partial_right = rect.right - (right - 1) as f32;
    let mut partial_top = (top + 1) as f32 - rect.top;
    let partial_bottom = rect.bottom - (bottom - 1) as f32;
    if height == 1 {
        partial_top = rect.bottom - rect.top;
    }
    let row = |partial: f32| {
        let mut alphas = vec![scalar_to_alpha(partial); width as usize];
        alphas[0] = scalar_to_alpha(partial_left * partial);
        alphas[width as usize - 1] = scalar_to_alpha(partial_right * partial);
        alphas
    };
    blitter.blit_anti_h(left, top, &row(partial_top));
    if height > 2 {
        blitter.blit_anti_rect(left, top + 1, width - 2, height - 2, scalar_to_alpha(partial_left), scalar_to_alpha(partial_right));
    }
    if height > 1 {
        blitter.blit_anti_h(left, bottom - 1, &row(partial_bottom));
    }
}

fn try_fat_rect(blitter: &mut ColorBlitter, path: &DevicePath, clip: [i32; 4]) -> bool {
    let Some(rect) = path_rect(path) else {
        return false;
    };
    let rect = Rect {
        left: rect.left.max(clip[0] as f32),
        top: rect.top.max(clip[1] as f32),
        right: rect.right.min(clip[2] as f32),
        bottom: rect.bottom.min(clip[3] as f32),
    };
    if !(rect.left < rect.right && rect.top < rect.bottom) {
        return true;
    }
    let bounds = round_out(rect);
    if bounds[2] - bounds[0] < 3 {
        return false;
    }
    blit_fat_rect(blitter, rect);
    true
}

fn link_edges(mut edges: Vec<Edge>) -> (Vec<Edge>, usize, usize) {
    let order = sort_edges(&edges);
    let head = edges.len();
    let tail = head + 1;
    edges.push(Edge::sentinel(MIN_S32, MIN_S32));
    edges.push(Edge::sentinel(MAX_S32, MAX_S32));
    let mut previous = head;
    for index in order {
        edges[previous].next = index;
        edges[index].previous = previous;
        previous = index;
    }
    edges[previous].next = tail;
    edges[tail].previous = previous;
    (edges, head, tail)
}

pub fn fill_path(blitter: &mut ColorBlitter, path: &DevicePath) {
    let bounds = path.bounds;
    if ![bounds.left, bounds.top, bounds.right, bounds.bottom].iter().all(|value| value.is_finite()) {
        return;
    }
    let bounds = round_out(bounds);
    let clip = [0, 0, blitter.width(), blitter.height()];
    let section = [bounds[0].max(clip[0]), bounds[1].max(clip[1]), bounds[2].min(clip[2]), bounds[3].min(clip[3])];
    if bounds[2] <= bounds[0] || bounds[3] <= bounds[1] || section[2] <= section[0] || section[3] <= section[1] {
        return;
    }
    let contained = section == bounds;
    let convex = is_convex(path);
    let (width, height) = (bounds[2] - bounds[0], bounds[3] - bounds[1]);
    let use_mask = width <= MASK_MAX_WIDTH && i64::from((width + 3) & !3) * i64::from(height) <= MASK_MAX_STORAGE;
    if use_mask && try_fat_rect(blitter, path, clip) {
        return;
    }
    let accumulator = if use_mask {
        Accumulator::Mask(MaskAccumulator {
            mask: vec![0; (width * height + 2) as usize],
            left: bounds[0],
            top: bounds[1],
            width,
            clip: section,
        })
    } else {
        Accumulator::Runs(RunAccumulator {
            alphas: vec![0; (section[2] - section[0]) as usize],
            left: section[0],
            top: section[1],
            current_y: section[1] - 1,
            safe: !convex,
        })
    };
    let mut additive = Additive { real: blitter, accumulator };
    let edges = build_edges(path);
    if !edges.is_empty() {
        let count = edges.len();
        let (mut edges, head, tail) = link_edges(edges);
        let mut walk = Walk { start_y: bounds[1], stop_y: bounds[3], left_bound: clip[0] << 16, right_bound: clip[2] << 16 };
        if !contained {
            walk.start_y = walk.start_y.max(clip[1]);
            walk.stop_y = walk.stop_y.min(clip[3]);
        }
        if use_mask {
            walk.left_bound = walk.left_bound.max(bounds[0] << 16);
            walk.right_bound = walk.right_bound.min(bounds[2] << 16);
        }
        if convex && count >= 2 {
            walk_convex(&mut edges, head, &mut additive, &walk);
        } else {
            let skip_intersect = path.points.len() > ((walk.stop_y - walk.start_y) * 2).max(0) as usize;
            walk_edges(&mut edges, head, tail, path.even_odd, &mut additive, &walk, skip_intersect);
        }
    }
    additive.finish();
}

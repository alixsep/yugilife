#include <stdint.h>

/*
 * WASM-only Quick Selection core.
 *
 * This is a direct typed-array port of the JavaScript implementation in the
 * workspace. The queue and graph keep the same LIFO/insertion order as the
 * original arrays; that order is observable in ties, so it is intentionally
 * not replaced with a different priority-queue or graph algorithm.
 */

#define WASM_PAGE_SIZE 65536u
/* The linker owns static data and stack placement. A hard-coded 64KiB heap can
 * overlap its stack when a compiler/linker changes layout. */
extern unsigned char __heap_base;
#define HEAP_START ((uint32_t)(uintptr_t)&__heap_base)
#define UNASSIGNED 65535u
#define HISTOGRAM_STRIDE 4400u
#define MAX_SUBDIVISIONS 10u
#define NO_NEIGHBOR 0xffffffffu

static uint32_t heap_pointer = HEAP_START;

typedef struct {
  uint32_t x;
  uint32_t y;
  uint32_t region;
} Seed;

typedef struct {
  uint32_t packed;
  uint32_t region;
  uint32_t next;
} QueueNode;

typedef struct {
  uint32_t region_count;
  uint32_t capacity;
  uint32_t *heads;
  uint32_t *tails;
  uint32_t *lengths;
  uint32_t *neighbor;
  uint32_t *weight;
  uint32_t *previous;
  uint32_t *next;
  uint32_t free_head;
} Graph;

typedef struct {
  uint32_t width;
  uint32_t height;
  uint32_t size;
  uint32_t max_regions;
  const uint8_t *rgba;

  uint16_t *hardware_labels;
  uint16_t *hardware_labels_base;
  uint32_t *hardware_stats;
  uint32_t *hardware_stats_base;
  uint32_t hardware_count;
  uint32_t hardware_count_base;
  double hardware_spatial;

  uint16_t *unified_labels;
  uint32_t unified_count;
  uint32_t *base_histogram;
  uint32_t *work_histogram;
  Graph base_graph;
  Graph work_graph;

  uint8_t *region_state_scratch;
  uint8_t *mixed_scratch;
  uint32_t *union_roots;
  uint8_t *union_ranks;
  uint16_t *component_ids;
  uint16_t *remapped_ids;

  Seed *seed_scratch;
  Seed *split_seeds;
  QueueNode *queue_nodes;
  uint32_t queue_capacity;
  uint32_t queue_used;
  uint32_t queue_free_head;
  uint32_t *bucket_heads;
  uint32_t bucket_count;

  /* Reusable scratch owned by the app-only mask-effects entry point. */
  uint8_t *mask_alpha;
  uint32_t mask_capacity;

  uint32_t split_seed_count;
  int initialized;
  int failed;
} QuickState;

static QuickState quick;

static uint32_t align4(uint32_t value) {
  return (value + 3u) & ~3u;
}

static uint32_t checked_product(uint64_t count, uint64_t item_size) {
  const uint64_t bytes = count * item_size;
  if (item_size != 0u && bytes / item_size != count) return 0u;
  if (bytes == 0u || bytes > 0xffffffffu) return 0u;
  return (uint32_t)bytes;
}

__attribute__((export_name("reset_heap")))
void reset_heap(void) {
  heap_pointer = HEAP_START;
  quick.initialized = 0;
  quick.failed = 0;
  quick.mask_alpha = 0;
  quick.mask_capacity = 0;
  quick.hardware_labels_base = 0;
  quick.hardware_stats_base = 0;
  quick.hardware_count_base = 0;
  quick.queue_used = 0;
  quick.queue_free_head = 0;
}

__attribute__((export_name("alloc")))
uint32_t alloc(uint32_t bytes) {
  if (bytes == 0u) return 0u;
  const uint32_t pointer = align4(heap_pointer);
  const uint32_t end = pointer + bytes;
  if (end < pointer) return 0u;

  const uint32_t current_pages = __builtin_wasm_memory_size(0);
  const uint32_t required_pages = (end + WASM_PAGE_SIZE - 1u) / WASM_PAGE_SIZE;
  if (required_pages > current_pages) {
    const uint32_t extra_pages = required_pages - current_pages;
    if (__builtin_wasm_memory_grow(0, extra_pages) == (uint32_t)-1) return 0u;
  }
  heap_pointer = end;
  return pointer;
}

static void *quick_alloc(uint64_t count, uint64_t item_size) {
  const uint32_t bytes = checked_product(count, item_size);
  if (bytes == 0u) return 0;
  const uint32_t pointer = alloc(bytes);
  if (pointer == 0u) return 0;
  return (void *)(uintptr_t)pointer;
}

static uint32_t next_mask_capacity(uint32_t required, uint32_t current) {
  uint32_t capacity = current == 0u ? required : current;
  while (capacity < required) {
    if (capacity > 0x7fffffffu) {
      capacity = required;
      break;
    }
    capacity *= 2u;
  }
  return capacity;
}

static int ensure_mask_alpha_capacity(uint32_t required) {
  if (required <= quick.mask_capacity && quick.mask_alpha) return 1;
  const uint32_t capacity = next_mask_capacity(required, quick.mask_capacity);
  uint8_t *alpha = (uint8_t *)quick_alloc(capacity, sizeof(uint8_t));
  if (!alpha) return 0;
  quick.mask_alpha = alpha;
  quick.mask_capacity = capacity;
  return 1;
}

static double q_sqrt(double value) {
  return __builtin_sqrt(value);
}

static void graph_reset(Graph *graph) {
  graph->free_head = graph->capacity > 1u ? 1u : 0u;
  for (uint32_t region = 0u; region < graph->region_count; region++) {
    graph->heads[region] = 0u;
    graph->tails[region] = 0u;
    graph->lengths[region] = 0u;
  }
  if (graph->capacity > 1u) {
    for (uint32_t node = 1u; node + 1u < graph->capacity; node++) graph->next[node] = node + 1u;
    graph->next[graph->capacity - 1u] = 0u;
  }
}

static int graph_init(Graph *graph, uint32_t region_count, uint32_t capacity) {
  graph->region_count = region_count;
  graph->capacity = capacity;
  graph->heads = (uint32_t *)quick_alloc(region_count, sizeof(uint32_t));
  graph->tails = (uint32_t *)quick_alloc(region_count, sizeof(uint32_t));
  graph->lengths = (uint32_t *)quick_alloc(region_count, sizeof(uint32_t));
  graph->neighbor = (uint32_t *)quick_alloc(capacity, sizeof(uint32_t));
  graph->weight = (uint32_t *)quick_alloc(capacity, sizeof(uint32_t));
  graph->previous = (uint32_t *)quick_alloc(capacity, sizeof(uint32_t));
  graph->next = (uint32_t *)quick_alloc(capacity, sizeof(uint32_t));
  if (!graph->heads || !graph->tails || !graph->lengths || !graph->neighbor ||
      !graph->weight || !graph->previous || !graph->next) return 0;
  graph_reset(graph);
  return 1;
}

static uint32_t graph_pair_index(const Graph *graph, uint32_t region, uint32_t value) {
  uint32_t node = graph->heads[region];
  while (node != 0u) {
    if (graph->neighbor[node] == value) return node;
    node = graph->next[node];
  }
  return 0u;
}

static uint32_t graph_add(Graph *graph, uint32_t region, uint32_t value, uint32_t weight) {
  const uint32_t node = graph->free_head;
  if (node == 0u) {
    quick.failed = 4;
    return 0u;
  }
  graph->free_head = graph->next[node];
  graph->neighbor[node] = value;
  graph->weight[node] = weight;
  graph->previous[node] = graph->tails[region];
  graph->next[node] = 0u;
  if (graph->tails[region] != 0u) graph->next[graph->tails[region]] = node;
  else graph->heads[region] = node;
  graph->tails[region] = node;
  graph->lengths[region] += 2u;
  return node;
}

/* JS removePair swaps the final pair into the removed pair's position. */
static void graph_remove_node(Graph *graph, uint32_t region, uint32_t node) {
  if (node == 0u) return;
  const uint32_t tail = graph->tails[region];
  if (tail == 0u) return;
  if (node != tail) {
    graph->neighbor[node] = graph->neighbor[tail];
    graph->weight[node] = graph->weight[tail];
  }
  const uint32_t previous_tail = graph->previous[tail];
  if (previous_tail != 0u) graph->next[previous_tail] = 0u;
  else graph->heads[region] = 0u;
  graph->tails[region] = previous_tail;
  graph->lengths[region] -= 2u;
  graph->next[tail] = graph->free_head;
  graph->free_head = tail;
}

static void graph_remove_pair(Graph *graph, uint32_t region, uint32_t value) {
  graph_remove_node(graph, region, graph_pair_index(graph, region, value));
}

static void graph_clear_region(Graph *graph, uint32_t region) {
  uint32_t node = graph->heads[region];
  while (node != 0u) {
    const uint32_t next = graph->next[node];
    graph->next[node] = graph->free_head;
    graph->free_head = node;
    node = next;
  }
  graph->heads[region] = 0u;
  graph->tails[region] = 0u;
  graph->lengths[region] = 0u;
}

static void graph_copy(const Graph *source, Graph *target) {
  graph_reset(target);
  for (uint32_t region = 0u; region < source->region_count; region++) {
    uint32_t node = source->heads[region];
    while (node != 0u) {
      graph_add(target, region, source->neighbor[node], source->weight[node]);
      node = source->next[node];
    }
  }
}

static void union_reset(uint32_t count) {
  for (uint32_t i = 0u; i < count; i++) {
    quick.union_roots[i] = i;
    quick.union_ranks[i] = 0u;
  }
}

static uint32_t union_find(uint32_t value) {
  uint32_t root = value;
  while (quick.union_roots[root] != root) root = quick.union_roots[root];
  while (quick.union_roots[value] != value) {
    const uint32_t next = quick.union_roots[value];
    quick.union_roots[value] = root;
    value = next;
  }
  return root;
}

static void union_link(uint32_t x, uint32_t y) {
  const uint32_t xr = union_find(x), yr = union_find(y);
  if (xr == yr) return;
  const uint8_t xd = quick.union_ranks[xr], yd = quick.union_ranks[yr];
  if (xd < yd) quick.union_roots[xr] = yr;
  else if (yd < xd) quick.union_roots[yr] = xr;
  else {
    quick.union_roots[yr] = xr;
    quick.union_ranks[xr]++;
  }
}

static uint32_t pixel_difference(uint32_t a, uint32_t b) {
  const int red = (int)quick.rgba[a] - (int)quick.rgba[b];
  const int green = (int)quick.rgba[a + 1u] - (int)quick.rgba[b + 1u];
  const int blue = (int)quick.rgba[a + 2u] - (int)quick.rgba[b + 2u];
  return (uint32_t)(red * red + green * green + blue * blue);
}

static double gradient(uint32_t x, uint32_t y) {
  /* Typed-array out-of-bounds reads become undefined/NaN in the JS port. */
  if (x == 0u || y == 0u || x + 1u >= quick.width || y + 1u >= quick.height) return 1.0e30;
  const uint32_t index = (y * quick.width + x) * 4u;
  const uint32_t row = quick.width * 4u;
  return (double)pixel_difference(index - 4u, index) +
         (double)pixel_difference(index, index + 4u) +
         (double)pixel_difference(index - row, index) +
         (double)pixel_difference(index, index + row);
}

static uint32_t make_seed_grid(uint32_t step, uint32_t coarse_width, uint32_t coarse_height) {
  uint32_t seed_count = 0u;
  const uint32_t quarter_step = step >> 2u;
  for (uint32_t row = 0u; row < coarse_height; row++) {
    for (uint32_t col = 0u; col < coarse_width; col++) {
      uint32_t x = ((2u * col + 1u) * step) / 2u;
      uint32_t y = ((2u * row + 1u) * step) / 2u;
      double best = 1.0e9;
      const uint32_t min_x = x > quarter_step ? x - quarter_step : 0u;
      const uint32_t max_x = x + quarter_step + 1u < quick.width ? x + quarter_step + 1u : quick.width;
      const uint32_t min_y = y > quarter_step ? y - quarter_step : 0u;
      const uint32_t max_y = y + quarter_step + 1u < quick.height ? y + quarter_step + 1u : quick.height;
      for (uint32_t yy = min_y; yy < max_y; yy++) {
        for (uint32_t xx = min_x; xx < max_x; xx++) {
          const double value = gradient(xx, yy);
          if (value < best) {
            x = xx;
            y = yy;
            best = value;
          }
        }
      }
      quick.seed_scratch[seed_count].x = x;
      quick.seed_scratch[seed_count].y = y;
      quick.seed_scratch[seed_count].region = seed_count;
      seed_count++;
    }
  }
  return seed_count;
}

static int queue_enqueue(uint32_t packed, uint32_t region, int32_t cost,
                         uint32_t *pending, uint32_t *minimum) {
  uint32_t normalized = cost < 0 ? 0u : (uint32_t)cost;
  if (normalized >= quick.bucket_count) {
    quick.failed = 2;
    return 0;
  }
  uint32_t node;
  /* Reuse popped nodes; queue_used is only the high-water allocation cursor. */
  if (quick.queue_free_head != 0u) {
    node = quick.queue_free_head - 1u;
    quick.queue_free_head = quick.queue_nodes[node].next;
  } else {
    if (quick.queue_used >= quick.queue_capacity) {
      quick.failed = 3;
      return 0;
    }
    node = quick.queue_used++;
  }
  quick.queue_nodes[node].packed = packed;
  quick.queue_nodes[node].region = region;
  quick.queue_nodes[node].next = quick.bucket_heads[normalized];
  quick.bucket_heads[normalized] = node + 1u;
  (*pending)++;
  if (normalized < *minimum) *minimum = normalized;
  return 1;
}

static int32_t distance_to_region(uint32_t x, uint32_t y, uint32_t region_base) {
  const uint32_t index = (y * quick.width + x) * 4u;
  const double count = (double)quick.hardware_stats[region_base + 5u];
  const double inverse = 1.0 / count;
  const double red = (double)quick.rgba[index] * count - (double)quick.hardware_stats[region_base];
  const double green = (double)quick.rgba[index + 1u] * count - (double)quick.hardware_stats[region_base + 1u];
  const double blue = (double)quick.rgba[index + 2u] * count - (double)quick.hardware_stats[region_base + 2u];
  const double dx = (double)x * count - (double)quick.hardware_stats[region_base + 3u];
  const double dy = (double)y * count - (double)quick.hardware_stats[region_base + 4u];
  const double value = (q_sqrt(red * red + green * green + blue * blue) +
                        quick.hardware_spatial * q_sqrt(dx * dx + dy * dy)) * inverse + .5;
  return (int32_t)value;
}

static int priority_grow(Seed *seeds, uint32_t seed_count) {
  for (uint32_t i = 0u; i < quick.bucket_count; i++) quick.bucket_heads[i] = 0u;
  quick.queue_used = 0u;
  quick.queue_free_head = 0u;
  uint32_t pending = 0u, minimum = 0u;
  for (uint32_t i = 0u; i < seed_count; i++) {
    const uint32_t packed = (seeds[i].y << 16u) | seeds[i].x;
    if (!queue_enqueue(packed, seeds[i].region, 0, &pending, &minimum)) return 0;
  }
  while (pending != 0u) {
    pending--;
    while (minimum < quick.bucket_count && quick.bucket_heads[minimum] == 0u) minimum++;
    if (minimum >= quick.bucket_count) {
      quick.failed = 7;
      return 0;
    }
    const uint32_t node = quick.bucket_heads[minimum] - 1u;
    quick.bucket_heads[minimum] = quick.queue_nodes[node].next;
    const uint32_t packed = quick.queue_nodes[node].packed;
    const uint32_t region = quick.queue_nodes[node].region;
    quick.queue_nodes[node].next = quick.queue_free_head;
    quick.queue_free_head = node + 1u;
    const uint32_t y = packed >> 16u, x = packed & 65535u;
    const uint32_t index = y * quick.width + x;
    if (quick.hardware_labels[index] != UNASSIGNED) continue;
    const uint32_t base = region * 6u, rgba_index = index * 4u;
    quick.hardware_labels[index] = (uint16_t)region;
    quick.hardware_stats[base] += quick.rgba[rgba_index];
    quick.hardware_stats[base + 1u] += quick.rgba[rgba_index + 1u];
    quick.hardware_stats[base + 2u] += quick.rgba[rgba_index + 2u];
    quick.hardware_stats[base + 3u] += x;
    quick.hardware_stats[base + 4u] += y;
    quick.hardware_stats[base + 5u]++;
    if (y != quick.height - 1u && quick.hardware_labels[index + quick.width] == UNASSIGNED) {
      if (!queue_enqueue(((y + 1u) << 16u) | x, region,
                         distance_to_region(x, y + 1u, base), &pending, &minimum)) return 0;
    }
    if (y != 0u && quick.hardware_labels[index - quick.width] == UNASSIGNED) {
      if (!queue_enqueue(((y - 1u) << 16u) | x, region,
                         distance_to_region(x, y - 1u, base), &pending, &minimum)) return 0;
    }
    if (x != 0u && quick.hardware_labels[index - 1u] == UNASSIGNED) {
      if (!queue_enqueue((y << 16u) | (x - 1u), region,
                         distance_to_region(x - 1u, y, base), &pending, &minimum)) return 0;
    }
    if (x != quick.width - 1u && quick.hardware_labels[index + 1u] == UNASSIGNED) {
      if (!queue_enqueue((y << 16u) | (x + 1u), region,
                         distance_to_region(x + 1u, y, base), &pending, &minimum)) return 0;
    }
  }
  return 1;
}

static int build_superpixels(void) {
  uint32_t step = (quick.width < quick.height ? quick.width : quick.height);
  step = (step + 15u) / 30u;
  if (step == 0u) step = 1u;
  const uint32_t coarse_width = quick.width / step;
  const uint32_t coarse_height = quick.height / step;
  const uint64_t count64 = (uint64_t)coarse_width * coarse_height;
  if (count64 == 0u || count64 > 65525u) {
    quick.failed = 8;
    return 0;
  }
  const uint32_t count = (uint32_t)count64;
  const uint32_t seed_count = make_seed_grid(step, coarse_width, coarse_height);
  for (uint32_t i = 0u; i < quick.size; i++) quick.hardware_labels[i] = UNASSIGNED;
  for (uint32_t i = 0u; i < quick.max_regions * 6u; i++) quick.hardware_stats[i] = 0u;
  quick.hardware_count = count;
  quick.hardware_spatial = 30.0 / (double)step;
  if (!priority_grow(quick.seed_scratch, seed_count)) return 0;
  return 1;
}

static void restore_hardware_baseline(void) {
  for (uint32_t index = 0u; index < quick.size; index++) {
    quick.hardware_labels[index] = quick.hardware_labels_base[index];
  }
  for (uint32_t index = 0u; index < quick.hardware_count_base * 6u; index++) {
    quick.hardware_stats[index] = quick.hardware_stats_base[index];
  }
  quick.hardware_count = quick.hardware_count_base;
  quick.unified_count = 0u;
}

static void all_region_states(const uint16_t *labels, uint32_t count, const uint8_t *hard) {
  for (uint32_t region = 0u; region < count; region++) quick.region_state_scratch[region] = 0u;
  for (uint32_t index = 0u; index < quick.size; index++) {
    const uint8_t value = hard[index];
    if (value != 0u && value != 255u) continue;
    const uint32_t region = labels[index];
    quick.region_state_scratch[region] = (uint8_t)(2u - (value >> 7u));
  }
}

static int32_t first_mixed_region(const uint16_t *labels, uint32_t count, const uint8_t *hard) {
  for (uint32_t region = 0u; region < count; region++) quick.mixed_scratch[region] = 0u;
  for (uint32_t index = 0u; index < quick.size; index++) {
    const uint8_t value = hard[index];
    if (value != 0u && value != 255u) continue;
    const uint32_t region = labels[index];
    quick.mixed_scratch[region] |= (uint8_t)(2u - (value >> 7u));
    if (quick.mixed_scratch[region] == 3u) return (int32_t)region;
  }
  return -1;
}

static uint32_t mean_color_distance(const uint32_t *stats, uint32_t a, uint32_t b, double extra_spatial) {
  const uint32_t ia = a * 6u, ib = b * 6u;
  const double ca = 1.0 / (double)stats[ia + 5u], cb = 1.0 / (double)stats[ib + 5u];
  const double red = (double)stats[ia] * ca - (double)stats[ib] * cb;
  const double green = (double)stats[ia + 1u] * ca - (double)stats[ib + 1u] * cb;
  const double blue = (double)stats[ia + 2u] * ca - (double)stats[ib + 2u] * cb;
  const double dx = (double)stats[ia + 3u] * ca - (double)stats[ib + 3u] * cb;
  const double dy = (double)stats[ia + 4u] * ca - (double)stats[ib + 4u] * cb;
  return (uint32_t)(q_sqrt(red * red + green * green + blue * blue) +
                    extra_spatial * q_sqrt(dx * dx + dy * dy) + .5);
}

static uint32_t merge_superpixels(const uint16_t *labels, uint32_t count,
                                  const uint8_t *hard, uint32_t threshold) {
  all_region_states(labels, count, hard);
  union_reset(count);
  for (uint32_t row = 1u; row < quick.height; row++) {
    for (uint32_t col = 1u; col < quick.width; col++) {
      const uint32_t index = row * quick.width + col;
      const uint32_t current = labels[index];
      uint32_t neighbor = labels[index - 1u];
      if (neighbor != current && quick.region_state_scratch[neighbor] == quick.region_state_scratch[current] &&
          mean_color_distance(quick.hardware_stats, current, neighbor, 0.0) < threshold) union_link(current, neighbor);
      neighbor = labels[index - quick.width];
      if (neighbor != current && quick.region_state_scratch[neighbor] == quick.region_state_scratch[current] &&
          mean_color_distance(quick.hardware_stats, current, neighbor, 0.0) < threshold) union_link(current, neighbor);
    }
  }
  for (uint32_t region = 0u; region < count; region++) quick.component_ids[region] = UNASSIGNED;
  uint32_t next = 0u;
  for (uint32_t region = 0u; region < count; region++) {
    const uint32_t root = union_find(region);
    if (quick.component_ids[root] == UNASSIGNED) quick.component_ids[root] = (uint16_t)next++;
    quick.remapped_ids[region] = quick.component_ids[root];
  }
  for (uint32_t index = 0u; index < quick.size; index++) quick.unified_labels[index] = quick.remapped_ids[labels[index]];
  return next;
}

static uint32_t graph_similarity(const uint32_t *histogram, uint32_t a, uint32_t b) {
  double total = 0.0;
  const uint32_t ia = a * HISTOGRAM_STRIDE, ib = b * HISTOGRAM_STRIDE;
  for (uint32_t coarse_red = 0u; coarse_red < 16u; coarse_red++) {
    if (histogram[ia + 4360u + coarse_red] == 0u || histogram[ib + 4360u + coarse_red] == 0u) continue;
    for (uint32_t coarse_green = 0u; coarse_green < 16u; coarse_green++) {
      const uint32_t coarse = (coarse_red << 4u) | coarse_green;
      if (histogram[ia + 4100u + coarse] == 0u || histogram[ib + 4100u + coarse] == 0u) continue;
      const uint32_t a_start = ia + (coarse << 4u), b_start = ib + (coarse << 4u);
      for (uint32_t blue = 0u; blue < 16u; blue++) {
        total += q_sqrt((double)histogram[a_start + blue] * histogram[b_start + blue]);
      }
    }
  }
  const double denominator = q_sqrt((double)histogram[ia + 4096u] * histogram[ib + 4096u]);
  return (uint32_t)(999.99999 * (double)total / denominator);
}

static int region_histogram_and_graph(const uint16_t *labels, uint32_t count) {
  const uint64_t histogram_size = (uint64_t)count * HISTOGRAM_STRIDE;
  for (uint64_t i = 0u; i < histogram_size; i++) quick.base_histogram[i] = 0u;
  quick.base_graph.region_count = count;
  graph_reset(&quick.base_graph);
  for (uint32_t row = 0u; row < quick.height; row++) {
    for (uint32_t col = 0u; col < quick.width; col++) {
      const uint32_t index = row * quick.width + col;
      const uint32_t rgba_index = index * 4u, region = labels[index];
      const uint32_t base = region * HISTOGRAM_STRIDE;
      const uint32_t red = quick.rgba[rgba_index] >> 4u;
      const uint32_t green = quick.rgba[rgba_index + 1u] >> 4u;
      const uint32_t blue = quick.rgba[rgba_index + 2u] >> 4u;
      quick.base_histogram[base + ((red << 8u) | (green << 4u) | blue)]++;
      quick.base_histogram[base + 4096u]++;
      quick.base_histogram[base + 4100u + ((red << 4u) | green)]++;
      quick.base_histogram[base + 4360u + red]++;
      if (col != 0u) {
        const uint32_t other = labels[index - 1u];
        if (other != region && graph_pair_index(&quick.base_graph, region, other) == 0u) {
          graph_add(&quick.base_graph, region, other, 0u);
          graph_add(&quick.base_graph, other, region, 0u);
        }
      }
      if (row != 0u) {
        const uint32_t other = labels[index - quick.width];
        if (other != region && graph_pair_index(&quick.base_graph, region, other) == 0u) {
          graph_add(&quick.base_graph, region, other, 0u);
          graph_add(&quick.base_graph, other, region, 0u);
        }
      }
    }
  }
  for (uint32_t region = 0u; region < count; region++) {
    uint32_t node = quick.base_graph.heads[region];
    while (node != 0u) {
      quick.base_graph.weight[node] = graph_similarity(quick.base_histogram, region, quick.base_graph.neighbor[node]);
      node = quick.base_graph.next[node];
    }
  }
  return quick.failed ? 0 : 1;
}

static void merge_graph_edges(Graph *graph, uint32_t *histogram, uint32_t a, uint32_t b) {
  graph_remove_pair(graph, a, b);
  graph_remove_pair(graph, b, a);
  uint32_t node = graph->heads[b];
  while (node != 0u) {
    const uint32_t neighbor = graph->neighbor[node];
    graph_remove_pair(graph, neighbor, b);
    if (graph_pair_index(graph, neighbor, a) == 0u) {
      graph_add(graph, neighbor, a, 0u);
      graph_add(graph, a, neighbor, 0u);
    }
    node = graph->next[node];
  }
  node = graph->heads[a];
  while (node != 0u) {
    const uint32_t neighbor = graph->neighbor[node];
    const uint32_t value = graph_similarity(histogram, a, neighbor);
    graph->weight[node] = value;
    const uint32_t reverse = graph_pair_index(graph, neighbor, a);
    if (reverse != 0u) graph->weight[reverse] = value;
    node = graph->next[node];
  }
  /* Region b is marked as merged and is never queried again. JS retains its
     stale array, but reclaiming these nodes does not change any live graph. */
  graph_clear_region(graph, b);
}

static uint32_t strongest_neighbor(const Graph *graph, uint32_t region) {
  uint32_t node = graph->heads[region], best = graph->heads[region];
  uint32_t best_weight = 0u;
  while (node != 0u) {
    if (graph->weight[node] > best_weight) {
      best_weight = graph->weight[node];
      best = node;
    }
    node = graph->next[node];
  }
  return best == 0u ? NO_NEIGHBOR : graph->neighbor[best];
}

static int classify_regions(const uint16_t *labels, uint32_t count, const uint8_t *hard,
                            uint32_t *histogram, Graph *graph, uint8_t *output) {
  all_region_states(labels, count, hard);
  union_reset(count);
  int32_t foreground = -1;
  for (uint32_t region = 0u; region < count; region++) {
    if (quick.region_state_scratch[region] != 1u) continue;
    if (foreground == -1) foreground = (int32_t)region;
    else union_link(region, (uint32_t)foreground);
  }
  if (foreground == -1) {
    for (uint32_t i = 0u; i < quick.size; i++) output[i] = hard[i] == 255u ? 255u : 0u;
    return 1;
  }
  int running = 1;
  while (running && !quick.failed) {
    running = 0;
    for (uint32_t region = 0u; region < count; region++) {
      if (quick.region_state_scratch[region] != 0u) continue;
      const uint32_t neighbor = strongest_neighbor(graph, region);
      if (neighbor != NO_NEIGHBOR && quick.region_state_scratch[neighbor] == 1u) {
        quick.region_state_scratch[region] = quick.region_state_scratch[neighbor];
        running = 1;
        union_link(region, neighbor);
      }
    }
    running = 1;
    uint32_t merged = 0u;
    while (running && !quick.failed) {
      running = 0;
      for (uint32_t region = 0u; region < count; region++) {
        if (quick.region_state_scratch[region] != 0u) continue;
        const uint32_t neighbor = strongest_neighbor(graph, region);
        if (neighbor == NO_NEIGHBOR || quick.region_state_scratch[neighbor] != 0u) continue;
        const uint32_t target_base = region * HISTOGRAM_STRIDE;
        const uint32_t source_base = neighbor * HISTOGRAM_STRIDE;
        for (uint32_t i = 0u; i < HISTOGRAM_STRIDE; i += 2u) {
          histogram[target_base + i] += histogram[source_base + i];
          histogram[target_base + i + 1u] += histogram[source_base + i + 1u];
        }
        merge_graph_edges(graph, histogram, region, neighbor);
        merged++;
        quick.region_state_scratch[neighbor] = 3u;
        running = 1;
        union_link(region, neighbor);
      }
    }
    running = merged != 0u;
  }
  const uint32_t foreground_root = union_find((uint32_t)foreground);
  for (uint32_t region = 0u; region < count; region++) {
    quick.region_state_scratch[region] = union_find(region) == foreground_root ? 255u : 0u;
  }
  for (uint32_t i = 0u; i < quick.size; i++) output[i] = quick.region_state_scratch[labels[i]];
  for (uint32_t i = 0u; i < quick.size; i++) if (hard[i] == 0u || hard[i] == 255u) output[i] = hard[i];
  return quick.failed ? 0 : 1;
}

static int ensure_region_capacity(uint32_t required) {
  if (required <= quick.max_regions) return 1;
  uint32_t new_capacity = quick.max_regions == 0u ? required : quick.max_regions * 2u;
  if (new_capacity < required) new_capacity = required;
  if (new_capacity > 65525u) {
    quick.failed = 5;
    return 0;
  }
  const uint32_t old_capacity = quick.max_regions;
  const uint32_t old_hardware_count = quick.hardware_count;
  const uint32_t old_unified_count = quick.unified_count;
  uint32_t *new_stats = (uint32_t *)quick_alloc((uint64_t)new_capacity * 6u, sizeof(uint32_t));
  uint8_t *new_region_states = (uint8_t *)quick_alloc(new_capacity, sizeof(uint8_t));
  uint8_t *new_mixed = (uint8_t *)quick_alloc(new_capacity, sizeof(uint8_t));
  uint32_t *new_roots = (uint32_t *)quick_alloc(new_capacity, sizeof(uint32_t));
  uint8_t *new_ranks = (uint8_t *)quick_alloc(new_capacity, sizeof(uint8_t));
  uint16_t *new_components = (uint16_t *)quick_alloc(new_capacity, sizeof(uint16_t));
  uint16_t *new_remapped = (uint16_t *)quick_alloc(new_capacity, sizeof(uint16_t));
  Seed *new_seed_scratch = (Seed *)quick_alloc(new_capacity, sizeof(Seed));
  uint32_t *new_base_hist = (uint32_t *)quick_alloc((uint64_t)new_capacity * HISTOGRAM_STRIDE, sizeof(uint32_t));
  uint32_t *new_work_hist = (uint32_t *)quick_alloc((uint64_t)new_capacity * HISTOGRAM_STRIDE, sizeof(uint32_t));
  const uint32_t graph_capacity = new_capacity * 16u + 64u;
  if (!new_stats || !new_region_states || !new_mixed || !new_roots || !new_ranks ||
      !new_components || !new_remapped || !new_seed_scratch || !new_base_hist ||
      !new_work_hist || !graph_init(&quick.base_graph, new_capacity, graph_capacity) ||
      !graph_init(&quick.work_graph, new_capacity, graph_capacity)) {
    quick.failed = 5;
    return 0;
  }
  for (uint32_t i = 0u; i < old_hardware_count * 6u; i++) new_stats[i] = quick.hardware_stats[i];
  for (uint64_t i = 0u; i < (uint64_t)old_unified_count * HISTOGRAM_STRIDE; i++) {
    new_base_hist[i] = quick.base_histogram[i];
    new_work_hist[i] = quick.work_histogram[i];
  }
  for (uint32_t i = 0u; i < old_capacity && i < new_capacity; i++) {
    new_region_states[i] = quick.region_state_scratch[i];
    new_mixed[i] = quick.mixed_scratch[i];
    new_roots[i] = quick.union_roots[i];
    new_ranks[i] = quick.union_ranks[i];
    new_components[i] = quick.component_ids[i];
    new_remapped[i] = quick.remapped_ids[i];
    new_seed_scratch[i] = quick.seed_scratch[i];
  }
  quick.max_regions = new_capacity;
  quick.hardware_stats = new_stats;
  quick.region_state_scratch = new_region_states;
  quick.mixed_scratch = new_mixed;
  quick.union_roots = new_roots;
  quick.union_ranks = new_ranks;
  quick.component_ids = new_components;
  quick.remapped_ids = new_remapped;
  quick.seed_scratch = new_seed_scratch;
  quick.base_histogram = new_base_hist;
  quick.work_histogram = new_work_hist;
  return 1;
}

static int split_mixed_region(uint32_t mixed, const uint8_t *hard) {
  uint32_t background_count = 0u, foreground_count = 0u;
  uint32_t old_region = UNASSIGNED;
  for (uint32_t row = 0u; row < quick.height; row++) {
    for (uint32_t col = 0u; col < quick.width; col++) {
      const uint32_t index = row * quick.width + col;
      if (quick.hardware_labels[index] != mixed) continue;
      if (hard[index] == 0u) {
        if (old_region == UNASSIGNED) old_region = quick.hardware_labels[index];
        quick.split_seeds[background_count].x = col;
        quick.split_seeds[background_count].y = row;
        quick.split_seeds[background_count].region = old_region;
        background_count++;
      }
    }
  }
  const uint32_t new_count = quick.hardware_count + 1u;
  if (!ensure_region_capacity(new_count)) return 0;
  for (uint32_t i = 0u; i < 6u; i++) quick.hardware_stats[old_region * 6u + i] = 0u;
  for (uint32_t i = 0u; i < 6u; i++) quick.hardware_stats[(new_count - 1u) * 6u + i] = 0u;
  for (uint32_t i = 0u; i < quick.size; i++) if (quick.hardware_labels[i] == mixed) quick.hardware_labels[i] = UNASSIGNED;
  for (uint32_t row = 0u; row < quick.height; row++) {
    for (uint32_t col = 0u; col < quick.width; col++) {
      const uint32_t index = row * quick.width + col;
      if (quick.hardware_labels[index] != UNASSIGNED) continue;
      /* Only pixels from the old mixed region were cleared above. */
      const uint8_t value = hard[index];
      if (value == 255u) {
        quick.split_seeds[background_count + foreground_count].x = col;
        quick.split_seeds[background_count + foreground_count].y = row;
        quick.split_seeds[background_count + foreground_count].region = new_count - 1u;
        foreground_count++;
      }
    }
  }
  quick.split_seed_count = background_count + foreground_count;
  if (old_region == UNASSIGNED || foreground_count == 0u || background_count == 0u) {
    quick.failed = 6;
    return 0;
  }
  if (!priority_grow(quick.split_seeds, quick.split_seed_count)) return 0;
  quick.hardware_count = new_count;
  return 1;
}

#define MASK_SMOOTH_RADIUS 3u
#define MASK_SMOOTH_DIAMETER (MASK_SMOOTH_RADIUS * 2u + 1u)

static void smooth_mask_edges(uint8_t *rgba, uint32_t width, uint32_t height) {
  const uint32_t size = width * height;
  for (uint32_t index = 0u; index < size; index++) {
    quick.mask_alpha[index] = rgba[index * 4u + 3u];
  }
  for (uint32_t y = 0u; y < height; y++) {
    for (uint32_t x = 0u; x < width; x++) {
      const uint32_t offset = (y * width + x) * 4u;
      const uint8_t center = quick.mask_alpha[y * width + x];
      uint32_t minimum = center;
      uint32_t maximum = center;
      uint32_t total = center;
      uint32_t count = 1u;
      const uint32_t first_y = y > MASK_SMOOTH_RADIUS ? y - MASK_SMOOTH_RADIUS : 0u;
      const uint32_t last_y = y + MASK_SMOOTH_RADIUS < height ? y + MASK_SMOOTH_RADIUS : height - 1u;
      const uint32_t first_x = x > MASK_SMOOTH_RADIUS ? x - MASK_SMOOTH_RADIUS : 0u;
      const uint32_t last_x = x + MASK_SMOOTH_RADIUS < width ? x + MASK_SMOOTH_RADIUS : width - 1u;
      for (uint32_t neighbor_y = first_y; neighbor_y <= last_y; neighbor_y++) {
        for (uint32_t neighbor_x = first_x; neighbor_x <= last_x; neighbor_x++) {
          if (neighbor_x == x && neighbor_y == y) continue;
          const uint32_t alpha = quick.mask_alpha[neighbor_y * width + neighbor_x];
          if (alpha < minimum) minimum = alpha;
          if (alpha > maximum) maximum = alpha;
          total += alpha;
          count++;
        }
      }
      if (minimum != maximum) rgba[offset + 3u] = (uint8_t)((total + count / 2u) / count);
    }
  }
}

static void merge_glow_candidate(uint8_t *target, uint8_t source, uint32_t cost) {
  const uint32_t candidate = source > cost ? (uint32_t)source - cost : 0u;
  if (candidate > *target) *target = (uint8_t)candidate;
}

static uint32_t alpha_column_sum(const uint8_t *source, uint32_t width,
                                 uint32_t first_y, uint32_t last_y, uint32_t x) {
  uint32_t total = 0u;
  for (uint32_t y = first_y; y <= last_y; y++) total += source[y * width + x];
  return total;
}

/* Clipped 7x7 average, with one integer rounding after the full sum.
 * Rolling column sums avoid repeatedly loading all 49 neighbors. Constant
 * neighborhoods already average to themselves, so min/max scans are unnecessary. */
__attribute__((export_name("mask_alpha_smooth")))
int32_t mask_alpha_smooth(uint32_t source_ptr, uint32_t output_ptr,
                          uint32_t width, uint32_t height) {
  if (!source_ptr || !output_ptr || source_ptr == output_ptr || !width || !height) return 0;
  const uint8_t *source = (const uint8_t *)(uintptr_t)source_ptr;
  uint8_t *output = (uint8_t *)(uintptr_t)output_ptr;
  for (uint32_t y = 0u; y < height; y++) {
    const uint32_t first_y = y > MASK_SMOOTH_RADIUS ? y - MASK_SMOOTH_RADIUS : 0u;
    const uint32_t last_y = y + MASK_SMOOTH_RADIUS < height ? y + MASK_SMOOTH_RADIUS : height - 1u;
    const uint32_t rows = last_y - first_y + 1u;
    uint32_t sums[MASK_SMOOTH_DIAMETER];
    uint32_t total = 0u;
    for (uint32_t x = 0u; x < width && x <= MASK_SMOOTH_RADIUS; x++) {
      sums[x] = alpha_column_sum(source, width, first_y, last_y, x);
      total += sums[x];
    }
    for (uint32_t x = 0u; x < width; x++) {
      const uint32_t first_x = x > MASK_SMOOTH_RADIUS ? x - MASK_SMOOTH_RADIUS : 0u;
      const uint32_t last_x = x + MASK_SMOOTH_RADIUS < width ? x + MASK_SMOOTH_RADIUS : width - 1u;
      const uint32_t columns = last_x - first_x + 1u;
      const uint32_t count = rows * columns;
      output[y * width + x] = (uint8_t)((total + count / 2u) / count);
      if (x >= MASK_SMOOTH_RADIUS) total -= sums[(x - MASK_SMOOTH_RADIUS) % MASK_SMOOTH_DIAMETER];
      const uint32_t incoming = x + MASK_SMOOTH_RADIUS + 1u;
      if (incoming < width) {
        const uint32_t column_sum = alpha_column_sum(source, width, first_y, last_y, incoming);
        sums[incoming % MASK_SMOOTH_DIAMETER] = column_sum;
        total += column_sum;
      }
    }
  }
  return 1;
}

/* Same chamfer propagation and rounding as the RGBA reference, on compact coverage.
 * No neighbor can raise a value already >= 255-cardinal_cost, so skip those pixels. */
__attribute__((export_name("mask_alpha_glow")))
int32_t mask_alpha_glow(uint32_t alpha_ptr, uint32_t width, uint32_t height, uint32_t glow) {
  if (!alpha_ptr || !width || !height || glow > 128u) return 0;
  if (!glow) return 1;
  uint8_t *alpha = (uint8_t *)(uintptr_t)alpha_ptr;
  const uint32_t cardinal = (255u + glow) / (glow + 1u);
  const uint32_t diagonal = (cardinal * 181u + 127u) / 128u;
  const uint32_t ceiling = 255u - cardinal;
  for (uint32_t y = 0u; y < height; y++) {
    for (uint32_t x = 0u; x < width; x++) {
      const uint32_t offset = y * width + x;
      uint8_t *target = &alpha[offset];
      if (*target >= ceiling) continue;
      if (x > 0u) merge_glow_candidate(target, alpha[offset - 1u], cardinal);
      if (y > 0u) merge_glow_candidate(target, alpha[offset - width], cardinal);
      if (x > 0u && y > 0u) merge_glow_candidate(target, alpha[offset - width - 1u], diagonal);
      if (x + 1u < width && y > 0u) merge_glow_candidate(target, alpha[offset - width + 1u], diagonal);
    }
  }
  for (uint32_t y = height; y > 0u; y--) {
    const uint32_t row = y - 1u;
    for (uint32_t x = width; x > 0u; x--) {
      const uint32_t column = x - 1u;
      const uint32_t offset = row * width + column;
      uint8_t *target = &alpha[offset];
      if (*target >= ceiling) continue;
      if (column + 1u < width) merge_glow_candidate(target, alpha[offset + 1u], cardinal);
      if (row + 1u < height) merge_glow_candidate(target, alpha[offset + width], cardinal);
      if (column + 1u < width && row + 1u < height) merge_glow_candidate(target, alpha[offset + width + 1u], diagonal);
      if (column > 0u && row + 1u < height) merge_glow_candidate(target, alpha[offset + width - 1u], diagonal);
    }
  }
  return 1;
}

/*
 * Grow a mask with a monotonic, linear alpha falloff. A box blur averages the
 * opaque edge with transparent pixels, so its first halo pixel is immediately
 * dimmed. The two chamfer passes below instead propagate coverage outward and
 * subtract a fixed amount per pixel. The source edge therefore stays at its
 * original alpha and the glow rolls off smoothly outside that edge.
 *
 * The propagation is in-place: it needs no second full-resolution image and
 * keeps the effect path bounded to the RGBA input plus the anti-alias scratch
 * plane. Cardinal and diagonal costs approximate Euclidean distance while the
 * forward/backward passes cover all directions.
 */
static void add_mask_glow(uint8_t *rgba, uint32_t width, uint32_t height, uint32_t glow) {
  if (glow == 0u) return;

  /* Keep glow=1 useful while leaving the configured value as the visual span. */
  const uint32_t cardinal_cost = (255u + glow) / (glow + 1u);
  const uint32_t diagonal_cost = (cardinal_cost * 181u + 127u) / 128u;

  for (uint32_t y = 0u; y < height; y++) {
    for (uint32_t x = 0u; x < width; x++) {
      const uint32_t offset = (y * width + x) * 4u;
      uint8_t *target = &rgba[offset + 3u];
      if (x > 0u) merge_glow_candidate(target, rgba[offset - 4u + 3u], cardinal_cost);
      if (y > 0u) merge_glow_candidate(target, rgba[offset - width * 4u + 3u], cardinal_cost);
      if (x > 0u && y > 0u) {
        merge_glow_candidate(target, rgba[offset - width * 4u - 4u + 3u], diagonal_cost);
      }
      if (x + 1u < width && y > 0u) {
        merge_glow_candidate(target, rgba[offset - width * 4u + 4u + 3u], diagonal_cost);
      }
    }
  }

  for (uint32_t y = height; y > 0u; y--) {
    const uint32_t row = y - 1u;
    for (uint32_t x = width; x > 0u; x--) {
      const uint32_t column = x - 1u;
      const uint32_t offset = (row * width + column) * 4u;
      uint8_t *target = &rgba[offset + 3u];
      if (column + 1u < width) {
        merge_glow_candidate(target, rgba[offset + 4u + 3u], cardinal_cost);
      }
      if (row + 1u < height) {
        merge_glow_candidate(target, rgba[offset + width * 4u + 3u], cardinal_cost);
      }
      if (column + 1u < width && row + 1u < height) {
        merge_glow_candidate(target, rgba[offset + width * 4u + 4u + 3u], diagonal_cost);
      }
      if (column > 0u && row + 1u < height) {
        merge_glow_candidate(target, rgba[offset + width * 4u - 4u + 3u], diagonal_cost);
      }
    }
  }
}

/*
 * App-owned mask presentation kernel. It deliberately lives beside pin selection rather than in
 * yugilife-core: the core renderer receives an already prepared mask and remains reusable by the
 * CLI and other consumers. The operation mutates RGBA alpha in place and reuses its anti-alias
 * scratch plane across requests in this worker's WASM instance.
 */
__attribute__((export_name("mask_effects_apply")))
int32_t mask_effects_apply(uint32_t rgba_ptr, uint32_t width, uint32_t height,
                           uint32_t anti_alias, uint32_t glow) {
  if (rgba_ptr == 0u || width == 0u || height == 0u || glow > 128u) return 0;
  const uint64_t size64 = (uint64_t)width * height;
  if (size64 == 0u || size64 > 0xffffffffu) return 0;
  const uint32_t size = (uint32_t)size64;
  uint8_t *rgba = (uint8_t *)(uintptr_t)rgba_ptr;
  if (anti_alias != 0u) {
    if (!ensure_mask_alpha_capacity(size)) return 0;
    smooth_mask_edges(rgba, width, height);
  }
  if (glow > 0u) {
    add_mask_glow(rgba, width, height, glow);
  }
  return 1;
}

__attribute__((export_name("quick_prepare")))
int32_t quick_prepare(uint32_t rgba_ptr, uint32_t width, uint32_t height) {
  quick.initialized = 0;
  quick.failed = 0;
  quick.width = width;
  quick.height = height;
  quick.size = width * height;
  quick.rgba = (const uint8_t *)(uintptr_t)rgba_ptr;
  quick.hardware_count = 0u;
  quick.unified_count = 0u;
  quick.split_seed_count = 0u;
  if (width == 0u || height == 0u || quick.size / width != height) {
    quick.failed = 8;
    return 0;
  }
  uint32_t step = (width < height ? width : height);
  step = (step + 15u) / 30u;
  if (step == 0u) step = 1u;
  const uint64_t initial_count64 = (uint64_t)(width / step) * (height / step);
  if (initial_count64 == 0u || initial_count64 > 65525u) {
    quick.failed = 8;
    return 0;
  }
  quick.max_regions = (uint32_t)initial_count64 + MAX_SUBDIVISIONS;

  quick.hardware_labels = (uint16_t *)quick_alloc(quick.size, sizeof(uint16_t));
  quick.hardware_stats = (uint32_t *)quick_alloc(quick.max_regions * 6u, sizeof(uint32_t));
  quick.unified_labels = (uint16_t *)quick_alloc(quick.size, sizeof(uint16_t));
  quick.base_histogram = (uint32_t *)quick_alloc((uint64_t)quick.max_regions * HISTOGRAM_STRIDE, sizeof(uint32_t));
  quick.work_histogram = (uint32_t *)quick_alloc((uint64_t)quick.max_regions * HISTOGRAM_STRIDE, sizeof(uint32_t));
  quick.region_state_scratch = (uint8_t *)quick_alloc(quick.max_regions, sizeof(uint8_t));
  quick.mixed_scratch = (uint8_t *)quick_alloc(quick.max_regions, sizeof(uint8_t));
  quick.union_roots = (uint32_t *)quick_alloc(quick.max_regions, sizeof(uint32_t));
  quick.union_ranks = (uint8_t *)quick_alloc(quick.max_regions, sizeof(uint8_t));
  quick.component_ids = (uint16_t *)quick_alloc(quick.max_regions, sizeof(uint16_t));
  quick.remapped_ids = (uint16_t *)quick_alloc(quick.max_regions, sizeof(uint16_t));
  quick.seed_scratch = (Seed *)quick_alloc(quick.max_regions, sizeof(Seed));
  quick.split_seeds = (Seed *)quick_alloc(quick.size, sizeof(Seed));
  quick.queue_capacity = quick.size * 4u + quick.max_regions + 16u;
  quick.queue_nodes = (QueueNode *)quick_alloc(quick.queue_capacity, sizeof(QueueNode));
  quick.hardware_labels_base = (uint16_t *)quick_alloc(quick.size, sizeof(uint16_t));
  quick.hardware_stats_base = (uint32_t *)quick_alloc((uint64_t)quick.max_regions * 6u,
                                                       sizeof(uint32_t));
  quick.bucket_count = 65536u;
  const uint32_t requested_buckets = height + 1000u;
  if (requested_buckets > quick.bucket_count) quick.bucket_count = requested_buckets;
  quick.bucket_heads = (uint32_t *)quick_alloc(quick.bucket_count, sizeof(uint32_t));
  const uint32_t graph_capacity = quick.max_regions * 16u + 64u;
  if (!quick.hardware_labels || !quick.hardware_stats || !quick.unified_labels ||
      !quick.base_histogram || !quick.work_histogram || !quick.region_state_scratch ||
      !quick.mixed_scratch || !quick.union_roots || !quick.union_ranks ||
      !quick.component_ids || !quick.remapped_ids || !quick.seed_scratch ||
      !quick.split_seeds || !quick.queue_nodes || !quick.bucket_heads ||
      !quick.hardware_labels_base || !quick.hardware_stats_base ||
      !graph_init(&quick.base_graph, quick.max_regions, graph_capacity) ||
      !graph_init(&quick.work_graph, quick.max_regions, graph_capacity)) {
    quick.failed = 5;
    return 0;
  }
  if (!build_superpixels()) return 0;
  for (uint32_t index = 0u; index < quick.size; index++) {
    quick.hardware_labels_base[index] = quick.hardware_labels[index];
  }
  for (uint32_t index = 0u; index < quick.hardware_count * 6u; index++) {
    quick.hardware_stats_base[index] = quick.hardware_stats[index];
  }
  quick.hardware_count_base = quick.hardware_count;
  quick.initialized = 1;
  return 1;
}

__attribute__((export_name("quick_refine")))
int32_t quick_refine(uint32_t hard_ptr, uint32_t output_ptr) {
  if (!quick.initialized || quick.failed) return 0;
  /* A refine may split mixed superpixels. Those splits are a per-edit working state, not part of
     the prepared artwork. Restore the prepared baseline before the next edit so repeated pin
     moves cannot accumulate region allocations or drift the graph toward its capacity ceiling. */
  if (quick.hardware_count != quick.hardware_count_base) restore_hardware_baseline();
  const uint8_t *hard = (const uint8_t *)(uintptr_t)hard_ptr;
  uint8_t *output = (uint8_t *)(uintptr_t)output_ptr;
  int can_reuse = quick.unified_count != 0u && first_mixed_region(quick.unified_labels, quick.unified_count, hard) == -1;
  if (!can_reuse) {
    int32_t mixed = first_mixed_region(quick.hardware_labels, quick.hardware_count, hard);
    uint32_t subdivisions = 0u;
    while (mixed != -1) {
      if (!split_mixed_region((uint32_t)mixed, hard)) return 0;
      mixed = first_mixed_region(quick.hardware_labels, quick.hardware_count, hard);
      subdivisions++;
      if (subdivisions >= MAX_SUBDIVISIONS) break;
    }
    quick.unified_count = merge_superpixels(quick.hardware_labels, quick.hardware_count, hard, 12u);
    if (!region_histogram_and_graph(quick.unified_labels, quick.unified_count)) return 0;
  }
  const uint64_t histogram_size = (uint64_t)quick.unified_count * HISTOGRAM_STRIDE;
  for (uint64_t i = 0u; i < histogram_size; i++) quick.work_histogram[i] = quick.base_histogram[i];
  graph_copy(&quick.base_graph, &quick.work_graph);
  if (quick.failed) return 0;
  return classify_regions(quick.unified_labels, quick.unified_count, hard,
                          quick.work_histogram, &quick.work_graph, output);
}

__attribute__((export_name("quick_error")))
int32_t quick_error(void) {
  return quick.failed;
}

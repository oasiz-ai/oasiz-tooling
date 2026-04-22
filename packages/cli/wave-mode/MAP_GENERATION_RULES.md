# Wave Mode Map Generation Rules
Based on frame analysis from reference gameplay

## Core Corridor Structure Rules

### 1. Path Geometry
- **Angles**: Only 0° (horizontal) and 45° (diagonal) segments allowed
- **Segment Length**: Fixed `SEG_DX = 90px` for consistent zigzag pattern
- **Quantization**: All path changes must snap to exact 45° angles relative to previous segment
- **Straight Segments**: Prefer longer straight runs early game, shorter segments later

### 2. Corridor Height
- **Base Height**: `MIN_HEIGHT = 150px` to `MAX_HEIGHT = 320px`
- **Early Game (0-120m)**: Wider corridors (closer to MAX_HEIGHT)
- **Late Game (120m+)**: Narrower corridors (closer to MIN_HEIGHT)
- **Height Tightening**: Gradually reduce corridor height as difficulty increases
- **Minimum Clearance**: Always maintain at least `MIN_HEIGHT` between top and bottom walls

### 3. Wall Movement Rules
- **Independent Movement**: Top and bottom walls can move independently
- **Turn Frequency**: 
  - Early: 25% chance per segment to change direction
  - Late: 55% chance per segment to change direction
- **Turn Bias**: 
  - Early: 18% chance to turn (vs flat)
  - Late: 45% chance to turn (vs flat)
- **Bounds Enforcement**: Walls must stay within `WALL_MARGIN` from screen edges

## Obstacle Placement Rules

### 4. Spike Placement
- **Location**: Spikes ONLY on flat (horizontal) segments, NEVER on slopes
- **Detection**: Check if `Math.abs(b.y - a.y) < 0.1` (essentially flat)
- **Density Scaling**:
  - Early: 25% chance for spike strip on flat segment
  - Late: 65% chance for spike strip on flat segment
- **Spacing**: `SPIKE_SPACING = 34px` between spikes
- **Inset**: Spikes inset `SPIKE_W * 0.7` from segment edges

### 5. Block Placement
- **Frequency**:
  - Early: 10% chance per chunk
  - Late: 34% chance per chunk
- **Position**: 
  - Early: 55% through chunk
  - Late: 45% through chunk (more challenging placement)
- **Size**:
  - Width: 120-180px
  - Height: 80-260px (but must leave `minH * 0.55` clearance)
- **Edge Spikes**:
  - Early: 20% chance for spikes on top/bottom edges
  - Late: 55% chance for spikes on top/bottom edges
  - Spikes evenly distributed along edges

### 6. T-Structure Rules (Future Enhancement)
- **Frequency**: 40-70% chance per chunk (scales with difficulty)
- **Position**: Random X within chunk (20-80% through)
- **Size**: 
  - Width: 60-100px
  - Height: 30-40% of corridor height
- **Orientation**: Random top/bottom placement
- **Spikes**: Always include spikes on extending edge

### 7. Continuous Spike Lines (Future Enhancement)
- **Frequency**: 50-80% chance per chunk
- **Length**: 30-50% of chunk width
- **Position**: Random X within chunk
- **Spacing**: 18-20px between spikes
- **Orientation**: Random top/bottom placement

### 8. Target/Collectible Objects (Future Enhancement)
- **Appearance**: Only after 50m distance
- **Frequency**: 30% chance per chunk (after 50m)
- **Size**: 35-60px diameter
- **Position**: Random within corridor (30-70% through chunk)
- **Design**: Starburst/gear pattern with 8 points

## Visual Theme Rules

### 9. Color Themes
- **Purple/Magenta Theme (0-100m)**:
  - Background: `#ff00ff` (bright magenta)
  - Walls: `#8b2a8b` (dark purple)
  - Obstacles: `#8b2a8b` fill, white outline
  - Spikes: White
  
- **Red Theme (100m+)**:
  - Background: `#ff0000` (bright red)
  - Walls: `#8b0000` (dark red)
  - Obstacles: `#8b0000` fill, white outline
  - Spikes: White

### 10. Pattern Design
- **Wall Patterns**: Geometric shapes (diamonds, circles, crosses, squares) in alternating grid
- **Pattern Size**: 24px grid spacing
- **Pattern Opacity**: 40% alpha
- **Obstacle Patterns**: Checkered/diamond pattern inside obstacles
- **Pattern Color**: Matches theme (magenta/red)

## Difficulty Scaling Rules

### 11. Difficulty Curve
- **Easy Phase (0-120m)**: 
  - Wide corridors
  - Few obstacles
  - Mostly flat segments
  - Low spike density
  
- **Ramp Phase (120-2320m)**:
  - Gradual tightening of corridors
  - Increasing obstacle frequency
  - More frequent turns
  - Higher spike density
  
- **Hard Phase (2320m+)**:
  - Narrow corridors (MIN_HEIGHT)
  - Maximum obstacle frequency
  - Frequent 45° turns
  - High spike density

### 12. Speed Scaling
- **Base Speed**: `SPEED_BASE = 1.0`
- **Max Speed**: `SPEED_MAX = 1.8`
- **Scaling**: Linear interpolation based on difficulty factor
- **Speed Multiplier**: Applied to both horizontal and vertical movement

## Safety & Fairness Rules

### 13. Navigability Guarantees
- **Minimum Height**: Always maintain navigable corridor
- **No Impossible Gaps**: Corridor height never drops below MIN_HEIGHT
- **No Blind Spikes**: Spikes only on flat segments (predictable)
- **Block Clearance**: Blocks must leave adequate clearance for passage
- **Chunk Boundaries**: Ensure smooth transitions between chunks

### 14. Pattern Avoidance
- **Repetition Prevention**: Track recent chunk patterns
- **Variety**: Ensure different obstacle combinations
- **Spacing**: Minimum spacing between major obstacles

## Implementation Notes

### Current Implementation Status
- ✅ Corridor structure with 45° angles
- ✅ Spike placement on flat segments only
- ✅ Block placement with edge spikes
- ✅ Difficulty scaling
- ✅ Color theme switching
- ⚠️ T-structures: Not yet implemented
- ⚠️ Continuous spike lines: Not yet implemented
- ⚠️ Target objects: Not yet implemented

### Future Enhancements
1. Add T-structure generation
2. Add continuous spike line generation
3. Add target/collectible objects
4. Improve pattern variety
5. Add more obstacle types from frames

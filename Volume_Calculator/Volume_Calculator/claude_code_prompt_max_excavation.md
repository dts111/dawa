# Feature Request: Maximum Excavation Profile Module

## Context
I have an existing volume calculator app that works with LandXML files exported from Civil 3D (surfaces, alignments, corridors). I want to add a new module to this app that generates a "maximum excavation profile" and flags tie-in issues against existing ground.

Please review the existing codebase structure first (surface parsing, alignment parsing, any existing LandXML utilities) and integrate this feature using existing conventions/classes where possible, rather than duplicating parsing logic.

## Background / Problem
On road and rail design projects, I receive multiple LandXML surface layers per corridor:
- **HBXC** — the lowest-level design surface (foundation/formation level)
- **Intermediate surfaces** — layers between HBXC and existing ground (e.g. sub-base, capping) — may or may not be present at a given station
- **EG (Existing Ground)** — the surface everything must ultimately tie into

I need to determine the actual excavation extent required, and flag anywhere the design doesn't cleanly tie into existing ground so I can raise it with the designer.

## Required Functionality

### 1. Isopach generation (HBXC vs EG)
- Compute a thickness grid between HBXC and EG surfaces.
- Where HBXC is below EG → excavation zone (retain).
- Where HBXC is above EG → fill zone (disregard entirely — not part of this analysis).
- Extract the zero-thickness contour as the excavation boundary line.

### 2. Cross-sectional analysis (station-by-station, left and right side independently)
- At a user-configurable chainage interval along the corridor, extract 2D profiles (elevation vs offset) for: HBXC edge point, any intermediate surfaces present at that station, and EG.
- Process left and right sides of the corridor independently — they may behave completely differently.

### 3. Batter tracing logic (per station, per side)
For each station/side, starting at the HBXC edge point:
- **First check whether an intermediate surface exists** covering that segment.
  - **If yes:** follow that intermediate surface's *actual* profile geometry (its true recorded gradient — do not apply any artificial slope or flattening) until reaching that surface's own edge/extent. If a further intermediate surface exists beyond that, repeat.
  - **If no intermediate surface governs a segment:** this is where a batter angle/ratio is required to project the line. Do NOT hardcode this value.
- **Batter angle input should be auto-detected/contextual, not blanket-prompted:**
  - The tool should first determine geometrically whether any station/side actually requires a user-defined batter angle (i.e. has a segment with no intermediate surface to follow).
  - Only prompt the user for the batter angle/ratio when at least one such segment exists — and ideally prompt once per distinct scenario/run rather than once per station, to avoid repetitive prompting.
  - Accept input as either a ratio (e.g. `1:1`, `1:3`) or degrees (e.g. `45`), auto-detecting format based on presence of a colon, and normalise internally to a consistent representation.

### 4. Tie-in check
- At the end of each traced path (whether that's a raw batter line or the edge of the last intermediate surface followed), calculate the **true 3D straight-line distance** from that end point to the nearest point on the EG surface.
- If this distance is at/near zero (define a small negligible rounding tolerance, e.g. 1mm, purely for floating-point noise — NOT a design tolerance) → tied in.
- If not → record the numeric 3D variation for that station/side.

### 5. Logging / reporting
- Group consecutive stations on the same side with non-zero variation into chainage ranges.
- Report format per range: chainage start–end, side (left/right), max variation, average variation.
- Example: `Ch 1+240–1+310, right edge: not tied in, max variation 340mm, avg 180mm`
- Output as both a human-readable report (text/markdown table) and structured data (CSV/JSON) for further processing.

### 6. Excavation surface output
- Rebuild a new surface from all successfully tied-in points (both sides, all stations) plus the isopach excavation boundary.
- Leave failed/untied ranges as visible gaps in the surface — do NOT interpolate over them.
- Export the result as a LandXML TIN surface, following the same export conventions as the rest of the app.

## Non-functional requirements
- Reuse existing LandXML parsing/surface classes from the app if they exist; don't reinvent parsing.
- Make the chainage interval, negligible-tolerance value, and batter angle handling all configurable (via config file or CLI args — match whatever pattern the rest of the app already uses).
- Include unit tests using a small synthetic LandXML dataset (simple straight corridor, one intermediate surface present at some stations only, deliberate tie-in gap at a known chainage range) to verify the logic before testing against real project files.
- Keep this as a self-contained module/class so it can be tested and used independently of the rest of the volume calculator, then wired into the existing app's workflow/CLI/UI.

## Deliverable
A working module with:
1. Isopach + boundary extraction function
2. Cross-section extraction function
3. Batter tracing function (with contextual angle prompting)
4. Tie-in check function (3D distance)
5. Report/log generator (range-merged output)
6. LandXML surface export for the final excavation profile
7. Unit tests against synthetic data
8. A short README section explaining how to run this specific feature

Please propose a file/class structure first before writing the implementation, so I can confirm it fits my existing app before you proceed.

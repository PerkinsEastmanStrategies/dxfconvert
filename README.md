# AISD-ESA DXF → SVG Converter

Simple browser tool for converting CAFM DXF floor plans into SVG files compatible with the AISD-ESA survey app.

## What it does

1. Reads a `.dxf` file in the browser
2. Keeps only the layers needed for AISD-ESA:
   - **CAFM_ID** — room number / label text
   - **CAFM_SPACE** — room boundary geometry
   - **WALLS** — exterior wall linework
3. Produces two SVG files:
   - **Desktop** (`Your School ES L1.svg`) — core layers plus doors and bathroom/plumbing fixtures
   - **Mobile** (`Your School ES L1.mobile.svg`) — CAFM_ID and CAFM_SPACE only
4. Lets you pick a **school** (from AISD geojson) and **floor**, then suggests the filename
5. Uploads both SVGs to Supabase Storage and upserts school + floor + filename into `floor_plan_manifest`
6. Wraps each room label in `TEXT`/`MTEXT` groups (matches native CAFM exports and the ESA survey app parser)
7. Strips leftover CAD fragments far from room spaces
8. Applies the same high-contrast black-on-white styling used by the survey app

## Quick start

```bash
cd AISD-ESA-dxfconvert
npm install
npm run dev
```

Open http://localhost:5174, choose a DXF, convert, pick school + floor, then save to Supabase.

## Supabase setup

### 1. Create the manifest table (once)

In the Supabase SQL editor, run:

[`supabase/floor_plan_manifest.sql`](supabase/floor_plan_manifest.sql)

This creates `public.floor_plan_manifest` with a unique key on `(campus_id, floor_level_id)`.

### 2. Service role key in the app

1. Paste your **Supabase service role key** under Supabase upload settings
2. The key is stored in `localStorage` only — it is not committed to git

Default bucket: `floor-plans`  
Default URL: `https://mgflyiwrzcmxxuxpfotk.supabase.co`

### Workflow

1. Convert a DXF
2. Search/select the school (must match geojson `NAME` / `CAMPUS_ID`)
3. Select floor (Basement, Floor 1–5, Mezzanine)
4. Confirm or edit the suggested filename
5. **Save to Supabase** → uploads `.svg` + `.mobile.svg` and records the mapping

ESA still reads the Google Sheet today. Once the table is populated, the survey app can be switched to load from `floor_plan_manifest` instead.

## Layer matching

| Export group | Typical DXF layer names |
|---|---|
| CAFM_ID | `CAFM_ID` |
| CAFM_SPACE | `CAFM_SPACE`, `SPACE` |
| WALLS | `WALL`, `A-WALL`, exterior wall layers |
| DOORS (desktop only) | `DOOR`, `A-DOOR`, etc. |
| FIXTURES (desktop only) | `P-FIXT`, `FIXTURE`, `PLUMB`, `TOILET`, etc. |

Unmatched layers are listed in the layer summary table but are not exported.

## Build for static hosting

```bash
npm run build
```

Output is in `dist/`.

# AISD-ESA DXF → SVG Converter

Simple browser tool for converting CAFM DXF floor plans into SVG files compatible with the AISD-ESA survey app.

## What it does

1. Reads a `.dxf` file in the browser
2. Keeps only the layers needed for AISD-ESA:
   - **CAFM_ID** — room number / label text
   - **CAFM_SPACE** — room boundary geometry
   - **WALLS** — exterior wall linework
3. Produces two SVG files:
   - **Desktop** (`Your School ES.svg`) — core layers plus doors and bathroom/plumbing fixtures
   - **Mobile** (`Your School ES.mobile.svg`) — CAFM_ID and CAFM_SPACE only
4. Applies the same high-contrast black-on-white styling used by the survey app
5. Uploads both files to Supabase Storage (`floor-plans` bucket)

## Quick start

```bash
cd dev/AISD-ESA-dxfconvert
npm install
npm run dev
```

Open http://localhost:5174, choose a DXF, convert, enter the output filename (e.g. `ALLISON ES.svg`), then save to Supabase.

## Supabase setup

1. Copy `config.example.js` to `config.local.js` if you want defaults in source (optional)
2. In the app, paste your **Supabase service role key** under Supabase upload settings
3. The key is stored in `localStorage` only — it is not committed to git

Default bucket: `floor-plans`  
Default URL: `https://mgflyiwrzcmxxuxpfotk.supabase.co`

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

# LandXML Surface Volume Calculator

A full-stack web application for calculating cut/fill earthwork volumes from LandXML TIN surfaces.

## Features

- **LandXML import** — supports LandXML 1.1 and 1.2 TIN surfaces
- **Cut/Fill volume calculation** — grid-based interpolation using SciPy
- **2D heatmap** — D3.js colour-coded cut (red) / fill (green) map with zoom/pan
- **3D surface viewer** — Three.js interactive mesh with elevation colouring
- **Report export** — PDF (ReportLab) and Excel (openpyxl) with embedded map image

---

## Project Structure

```
Volume Calculator/
├── backend/          Python FastAPI service
│   ├── main.py
│   ├── landxml_parser.py
│   ├── landxml_writer.py   LandXML TIN surface serialization (write path)
│   ├── volume_calculator.py
│   ├── geometry_utils.py   Spatial index + nearest-point-on-mesh queries
│   ├── excavation_profile.py  Maximum Excavation Profile module
│   ├── report_generator.py
│   ├── tests/              pytest suite (excavation profile, geometry, LandXML writer)
│   ├── requirements.txt
│   └── render.yaml         Render.com deployment config
└── frontend/         React + Vite app
    ├── src/
    │   ├── App.jsx
    │   ├── api.js
    │   └── components/
    │       ├── Header.jsx
    │       ├── FileUpload.jsx
    │       ├── SurfaceSelector.jsx
    │       ├── CutFillMap2D.jsx
    │       ├── CutFillMap3D.jsx
    │       ├── ReportPanel.jsx
    │       └── ExcavationProfilePanel.jsx
    ├── package.json
    └── netlify.toml        Netlify deployment config
```

---

## Local Development

### 1. Start the Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

### 2. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.  
The Vite proxy forwards `/api/*` requests to the backend automatically.

---

## Deployment

### Backend → Render.com (free tier)

1. Push the repository to GitHub.
2. Go to [render.com](https://render.com) → **New Web Service**.
3. Connect your repo and set **Root Directory** to `backend`.
4. Render will detect `render.yaml` and configure automatically.
5. Note your service URL (e.g. `https://landxml-volume-api.onrender.com`).

### Frontend → Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**.
2. Connect your repo, set **Base directory** to `frontend`.
3. Build command: `npm run build` · Publish directory: `dist`
4. Under **Environment variables**, add:
   ```
   VITE_API_URL = https://landxml-volume-api.onrender.com
   ```
5. Deploy. Your app will be live at your Netlify URL.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/parse` | Upload & parse LandXML file |
| POST | `/api/calculate` | Calculate cut/fill volumes |
| POST | `/api/mesh` | Get Three.js mesh for a surface |
| POST | `/api/section` | Elevation profiles along a section line |
| POST | `/api/report/pdf` | Download PDF report |
| POST | `/api/report/excel` | Download Excel report |
| POST | `/api/excavation/batter-check` | Check whether any station/side needs a batter angle |
| POST | `/api/excavation/compute` | Run the Maximum Excavation Profile pipeline |
| POST | `/api/excavation/station-profile` | Full traced path for one station/side |
| POST | `/api/excavation/export/landxml` | Download the rebuilt excavation surface as LandXML |
| POST | `/api/excavation/export/csv` | Download the chainage-range report as CSV |

---

## Volume Calculation Method

Cut/fill volumes are computed using a **grid-based interpolation** approach:

1. Both TIN surfaces are interpolated onto a regular grid using `scipy.interpolate.LinearNDInterpolator`.
2. At each grid cell, `dz = z_surface1 − z_surface2`.
3. Volume per cell = `|dz| × cell_area`.
4. Cells where `dz > 0` are **cut** (surface 1 above surface 2).
5. Cells where `dz < 0` are **fill** (surface 2 above surface 1).

Grid resolution is auto-selected based on the surface extent (max ~600 cells per axis).

---

## Maximum Excavation Profile

Traces the excavation extent between a design formation surface (HBXC) and existing ground (EG)
along a user-supplied corridor centreline, following any intermediate surfaces' real geometry
(sub-base, capping, etc.) where present and projecting a batter line where none exist, then flags
any station/side that doesn't cleanly tie into existing ground.

1. Complete Step 1 (import) with all the surfaces you need — HBXC, EG, and any intermediate layers
   — as named TIN surfaces in the same session (one or more LandXML files).
2. In **Step 5 — Maximum Excavation Profile**, select the HBXC and EG surfaces, tick any intermediate
   surfaces, and enter the corridor centreline as a straight-segment polyline (X/Y vertices) —
   real curved alignments are not parsed; approximate with enough vertices if needed.
3. Click **Check Requirements**. A batter angle/ratio input only appears if at least one
   station/side actually has no intermediate coverage and needs one — enter it as `H:V` (e.g. `1:2`)
   or plain degrees (e.g. `45`).
4. Click **Compute Excavation Profile**. Untied chainage ranges are grouped and reported with max/avg
   3D variation; click a range to see its cross-section. The 3D tie-in check uses the true nearest
   point on the EG surface (not just a vertical offset), and the tolerance is a ~1mm floating-point
   rounding allowance, not a design tolerance.
5. Export the rebuilt excavation surface as a LandXML TIN (gaps at untied ranges are left as gaps,
   never interpolated over) or the chainage-range report as CSV.

Backend tests: `cd backend && pytest tests/`

## LandXML Coordinate Convention

LandXML `<P>` elements follow the **northing easting elevation** order (Y X Z).  
Ensure your LandXML file was exported with this convention (standard for Civil 3D, 12d, MAGNET Office, etc.).

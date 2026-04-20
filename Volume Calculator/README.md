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
│   ├── volume_calculator.py
│   ├── report_generator.py
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
    │       └── ReportPanel.jsx
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
| POST | `/api/report/pdf` | Download PDF report |
| POST | `/api/report/excel` | Download Excel report |

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

## LandXML Coordinate Convention

LandXML `<P>` elements follow the **northing easting elevation** order (Y X Z).  
Ensure your LandXML file was exported with this convention (standard for Civil 3D, 12d, MAGNET Office, etc.).

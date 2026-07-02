I want to build a GIS-based highway diversion design system for M25 DBFO TTRO planning. This is an engineering decision-support tool for traffic management designers, not a consumer navigation app.

Before writing any code, produce:
1. System architecture
2. Database design (PostgreSQL + PostGIS)
3. Routing engine design (pgRouting)
4. API structure
5. Frontend structure

Do not write any code yet.

---

PROJECT CONTEXT

This application is used to design, assess, and consult on diversion routes for Temporary Traffic Regulation Orders (TTROs) on the M25 DBFO network.

It must support closures on:
- Mainline carriageways (Clockwise and Anticlockwise)
- Entry slip roads
- Exit slip roads
- Interchange links

---

CORE FUNCTIONAL REQUIREMENTS

1. Closure Definition
Users must be able to define closures:
- Type: mainline / slip road / interchange
- Direction: CW / ACW
- Start point (junction/chainage/node)
- End point
- Date/time range
- Reason for closure

---

2. Network Model (GIS Graph)
Build a routable network using PostGIS containing:
- M25 mainline
- Junctions
- Slip roads
- Interchanges
- Surrounding A-roads and strategic network

Each road segment must include:
- Geometry
- Road type
- Speed limit
- HGV suitability
- Height/weight/width restrictions
- Local authority ownership
- Emergency service region

---

3. Routing Engine (pgRouting)
Use PostgreSQL + PostGIS + pgRouting.

Routing must:
- Start at last available exit BEFORE closure
- End at first available re-entry AFTER closure
- Respect all vehicle restrictions
- Avoid unsuitable roads
- Prefer strategic roads (motorways, trunk roads, A-roads)

Cost function must prioritise:
1. Travel time
2. Distance
3. Road hierarchy
4. Optional congestion weighting

---

4. Diversion Output
For each closure generate:
- Primary diversion route
- At least 2 alternative routes
- Distance
- Travel time
- Entry and exit nodes

---

5. Diversion Assessment
Each route must be scored out of 100 based on:
- Distance efficiency
- Travel time impact
- HGV suitability
- Emergency service access
- Local authority impact
- Network resilience

---

6. Stakeholder Identification
Automatically identify affected stakeholders:
- Local Authorities
- National Highways regions
- Police
- Ambulance services
- Fire services
- Bus/freight operators (if applicable)

---

7. Consultation Pack Generator
Generate outputs:
- PDF report
- GIS export (GeoJSON)

Must include:
- Closure details
- Diversion route map
- Impact assessment
- Stakeholder list

---

8. Diversion Library
Store all generated and approved diversions:
- Closure definition
- Route geometry
- Approval status
- Stakeholder feedback
- Version history

Must suggest previously approved diversions when similar closures are entered.

---

9. GIS Frontend
Build using React + Leaflet or OpenLayers.

Must support:
- Drawing closures on map
- Viewing diversion routes
- Editing routes manually
- Comparing alternatives
- Overlaying restrictions and boundaries

---

SYSTEM ARCHITECTURE REQUIREMENTS

Backend:
- .NET 8 Web API or Node.js (choose best design)

Database:
- PostgreSQL + PostGIS
- pgRouting extension

Frontend:
- React + TypeScript
- GIS mapping library

Deployment:
- Docker-based system
- Cloud ready (Azure preferred)

---

IMPORTANT BUSINESS RULES

- Diversions MUST start at closure entry point
- Diversions MUST end at closure exit point
- Must avoid restricted roads unless explicitly allowed
- Must prioritise safety and strategic network hierarchy over shortest path
- Must be suitable for TTRO consultation submissions

---

DELIVERABLES YOU MUST PRODUCE

1. Architecture diagram (text-based)
2. Database schema (PostGIS-ready)
3. Routing engine logic (pgRouting SQL examples)
4. Backend API design
5. Frontend UI structure
6. Example M25 closure scenario with generated diversion
7. Deployment plan using Docker
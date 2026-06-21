from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import closures, routes, stakeholders, library, export, network

app = FastAPI(
    title="M25 TTRO Diversion Planner",
    description="GIS-based TTRO diversion design system for the M25 DBFO network",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(closures.router, prefix="/api/closures", tags=["closures"])
app.include_router(routes.router, prefix="/api/routes", tags=["routes"])
app.include_router(stakeholders.router, prefix="/api/stakeholders", tags=["stakeholders"])
app.include_router(library.router, prefix="/api/library", tags=["library"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(network.router, prefix="/api/network", tags=["network"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "M25 TTRO Diversion Planner"}

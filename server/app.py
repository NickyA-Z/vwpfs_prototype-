"""HTTP API that glues the pieces together for the frontend.

Three responsibilities:

- ``POST /api/rank``   deterministic filtering/ranking (no LLM involved), used
  every time the filter cards or the rejected list change;
- ``POST /api/chat``   one conversational turn through Gemini
  (``model.search.continue_car_search``) -- returns 503 when no key is set,
  the frontend then falls back to the deterministic question flow only;
- ``GET  /api/models/{slug}.glb``  the 3D assets from ``car_3d/models``.

Every car in a response carries ``spec``: the ``car_3d.render_spec`` output
with ``model_url`` rewritten to this API's own /api/models route, so the
viewer can load it directly.

Run with:  uvicorn server.app:app --reload --port 8000
"""
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from car_3d import MODELS, render_spec
from car_3d.catalog import REPO_ROOT
from model.car_filter import ALLOWED_OPERATORS, SEARCHABLE_FIELDS, filter_and_rank_cars

app = FastAPI(title="VWPFS car finder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# fields of the raw csv row worth sending to the browser
CAR_FIELDS = [
    "id", "type", "merk", "model", "uitvoering", "kleur", "bouwjaar",
    "carrosserie", "brandstof", "transmissie", "zitplaatsen", "deuren",
    "vermogen_pk", "verbruik_l_100km", "actieradius_km", "co2_uitstoot_g_km",
    "bagageruimte_liter", "kilometerstand", "conditie", "aanschafprijs",
    "aantal_opties", "opties_lijst",
]
COMPUTED_FIELDS = [
    "match_score", "matched_preferences", "contractvorm", "is_alternatief",
    "budget_overschrijding", "lease_klantprijs", "marge_bedrag", "lease_prijzen",
]


class SearchFilter(BaseModel):
    field: str
    operator: str
    value: object
    importance: str = "required"


class RankRequest(BaseModel):
    filters: list[SearchFilter] = Field(default_factory=list)
    contractvorm: str = "koop"
    looptijd_maanden: int = 48
    km_per_jaar: int = 15_000
    max_maandbedrag: float | None = None
    max_aankoopbedrag: float | None = None
    exclude_ids: list[str] = Field(default_factory=list)
    limit: int = 5


class ChatRequest(BaseModel):
    message: str
    state: dict | None = None
    contractvorm: str = "koop"
    looptijd_maanden: int = 48
    km_per_jaar: int = 15_000
    max_maandbedrag: float | None = None
    max_aankoopbedrag: float | None = None
    limit: int = 5


def _validated(filters: list[SearchFilter]) -> list[dict]:
    out = []
    for f in filters:
        if (f.field in SEARCHABLE_FIELDS and f.operator in ALLOWED_OPERATORS
                and f.importance in {"required", "preferred"}):
            out.append({"field": f.field, "operator": f.operator,
                        "value": f.value, "importance": f.importance})
    return out


def _car_payload(row: dict) -> dict:
    spec = render_spec(row)
    spec["model_url"] = f"/api/models/{spec['model']}.glb"
    car = {k: row.get(k) for k in CAR_FIELDS + COMPUTED_FIELDS if k in row}
    car["spec"] = spec
    return car


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "gemini": bool(os.getenv("GEMINI_KEY"))}


@app.post("/api/rank")
def rank(req: RankRequest) -> dict:
    filters = _validated(req.filters)
    excluded = set(req.exclude_ids)
    cars = filter_and_rank_cars(
        filters,
        limit=req.limit + len(excluded) + 10,
        contractvorm=req.contractvorm,
        looptijd_maanden=req.looptijd_maanden,
        km_per_jaar=req.km_per_jaar,
        max_maandbedrag=req.max_maandbedrag,
        max_aankoopbedrag=req.max_aankoopbedrag,
    )
    cars = [c for c in cars if c["id"] not in excluded][:req.limit]
    return {"filters": filters, "cars": [_car_payload(c) for c in cars]}


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    if not os.getenv("GEMINI_KEY"):
        raise HTTPException(503, "GEMINI_KEY is not configured on the server")
    from model.search import continue_car_search

    try:
        result = continue_car_search(
            req.message,
            state=req.state,
            limit=req.limit,
            contractvorm=req.contractvorm,
            looptijd_maanden=req.looptijd_maanden,
            km_per_jaar=req.km_per_jaar,
            max_maandbedrag=req.max_maandbedrag,
            max_aankoopbedrag=req.max_aankoopbedrag,
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    result["cars"] = [_car_payload(c) for c in result["cars"]]
    return result


@app.get("/api/models/{slug}.glb")
def model_glb(slug: str) -> FileResponse:
    if slug not in MODELS:
        raise HTTPException(404, f"unknown model {slug!r}")
    path = os.path.join(REPO_ROOT, MODELS[slug]["file"])
    return FileResponse(path, media_type="model/gltf-binary")

# vwpfs_prototype-
making a prototype for the online auto selling platform of vwpfs

A user opens the site, talks to the mascotte, answers a few deterministic
questions, and every classification appears as a removable card. The best
matching car from `advanced/cars.csv` is rendered as a 3D model in the
correct paint, with its relevant specs; rejecting it serves the next match.

## Modules

| module | what |
| --- | --- |
| `advanced/lease_pricing.py` | lease and occasion pricing formulas |
| `car_3d/` | which 3D model and paint represents a car — see `car_3d/README.md` |
| `model/` | Gemini-driven interpretation of free text into filters + deterministic filtering/ranking |
| `server/` | FastAPI glue: `/api/rank`, `/api/chat`, `/api/models/{slug}.glb` |
| `frontend/` | React + three.js UI (Find My Car) |

## Running the app

Backend (Python 3.12+):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server.app:app --reload --port 8000
```

Optional: copy `.env.example` to `.env` and set `GEMINI_KEY` + `GEMINI_MODEL`
to enable the conversational AI. Without it the app still works — matching is
then driven by the deterministic questions only.

Frontend (dev server proxies `/api` to port 8000):

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

# car_3d

Given a car from the dataset, decide which 3D model represents it and in which
paint. Peer of `advanced/lease_pricing.py`: standalone, tool-call shaped
functions for the chat agent to call once it has picked a car.

## Use

```python
from car_3d import load_cars, spec_for_id, render_spec

cars = load_cars()                      # advanced/cars.csv + styling attached
spec = spec_for_id('hyundai-i20-comfort-042', cars)
```

```json
{
  "car_id": "hyundai-i20-comfort-042",
  "label": "Hyundai i20 Comfort",
  "model": "compact",
  "model_url": "car_3d/models/compact.glb",
  "length_m": 3.9,
  "paint_hex": "#1d4e93",
  "paint_finish": "metallic",
  "metalness": 0.85,
  "roughness": 0.22,
  "paint_mask": "albedo.alpha"
}
```

Hand that to the viewer and you are done. `render_spec(row)` does the same for
a row you already have, without a lookup.

**No third-party dependencies at runtime** — standard library only. Pillow and
numpy appear in `tools/` and are needed only to re-export the assets.

## Layout

| path | what |
| --- | --- |
| `styling.py` | the decision logic: model choice, colour, finish. No I/O |
| `catalog.py` | reading the dataset, lookup by id, optional CSV annotation |
| `models/*.glb` | the seven models, ~9 MB total |
| `viewer/paint.js` | the paint contract for a three.js viewer |
| `tools/` | offline exporter that produced the .glb files |

`styling.py` holds no state and touches no files, so the rules can be reused
(or ported to another language) without the dataset.

## How a car gets its model

`CURATED` maps all 94 make+model pairs in the dataset by hand — superminis to
`compact`, family hatches to `hatchback`, estates to `wagon`, and so on.
Anything unlisted falls back to a rule on body style and power. Every result
carries `model_source`, either `curated` or `rule:...`, so a choice can always
be explained to a user.

```python
pick_model({'merk': 'Volvo', 'model': 'V60', 'carrosserie': 'Stationwagon'})
# ('wagon', 'curated')
```

Seven of the pack's ten models are used. `offroad` (boxy 4x4), `pickup` and
`sport` (mid-engine) have no close counterpart in this dataset and stay unused.
To bring one back: add a line to `CURATED`, add its entry to `MODELS`, and
re-export it with `tools/build_glb.py`.

## The paint contract

**A .glb loaded without `viewer/paint.js` renders in its original factory
colour, whatever `paint_hex` says.** This is the one non-obvious part.

The pack bakes each car's paint into the albedo texture together with its
glass, lights and trim, so paint is not a separate material to swap. The
exporter detects the sprayed region and stores it in the **alpha channel** of
the albedo texture — alpha 1 is paint, alpha 0 is everything that must keep its
own colour. The viewer tints only the masked pixels, so baked detail survives
any colour.

```js
import { applyPaint } from './car_3d/viewer/paint.js';

const gltf = await new GLTFLoader().loadAsync(spec.model_url);
applyPaint(gltf.scene, spec);     // returns how many materials it painted
scene.add(gltf.scene);
```

`applyPaint` returns `0` if it painted nothing — treat that as a failed
integration rather than a silent pass. Call it again on the same object to
change colour without reloading.

`paint_finish` also drives `metalness` and `roughness`, so metallic colours
read differently from solid ones.

## Data

The styling is derived on read, not stored, so `advanced/cars.csv` stays the
single source of truth — change a rule and every car follows on the next load.
If something outside Python needs the mapping:

```python
from car_3d import annotate_csv
annotate_csv()      # -> advanced/cars_with_3d.csv
```

That adds `styling_3d` (JSON), `model_3d`, `verf_hex` and `verf_finish`.

## Regenerating the models

The source art (26 MB FBX pack) is deliberately not in the repo.

```sh
CAR_PACK_DIR=/path/to/generic-passenger-car-pack python car_3d/tools/build_glb.py
```

Takes about ten seconds and rewrites `models/`. The exporter reads the binary
FBX directly — no Blender or assimp needed.

## Tests

```sh
python tests/test_car_3d.py        # or: pytest tests/
```

Covers the parts that break quietly: every car resolving to a model file that
exists, every dataset colour being mapped, `render_spec` keeping its shape, and
the runtime staying free of third-party imports.

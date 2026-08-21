"""3D representation of a car: which model to show, and in which paint.

Sits alongside ``lease_pricing.py`` as a set of standalone, tool-call shaped
functions the chat agent can call once it has picked a car for the user.

    from car_3d import render_spec, load_cars

    cars = load_cars()                     # advanced/cars.csv + styling
    spec = render_spec(cars[0])
    # {'model_url': 'car_3d/models/compact.glb', 'paint_hex': '#e9ecef', ...}

The runtime needs nothing outside the standard library. Pillow and numpy are
only used by ``car_3d.tools``, which regenerates the .glb assets offline.
"""
from .styling import (
    BY_BODY,
    COLOURS,
    CURATED,
    FINISH,
    MODELS,
    UNKNOWN_COLOUR,
    model_file,
    paint_for,
    pick_model,
    render_spec,
    styling_for,
)
from .catalog import (
    DEFAULT_DATASET,
    annotate_csv,
    index_by_id,
    load_cars,
    spec_for_id,
)

__all__ = [
    'BY_BODY', 'COLOURS', 'CURATED', 'FINISH', 'MODELS', 'UNKNOWN_COLOUR',
    'model_file', 'paint_for', 'pick_model', 'render_spec', 'styling_for',
    'DEFAULT_DATASET', 'annotate_csv', 'index_by_id', 'load_cars', 'spec_for_id',
]

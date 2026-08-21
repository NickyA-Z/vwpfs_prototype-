"""Which 3D model represents a car, and in which paint.

Pure decision logic -- no file access, no dataset. Standard library only.

The dataset has 94 make+model combinations and the model pack has 10 shapes.
``CURATED`` maps every combination to the closest shape by hand; anything not
listed falls back to a rule on body style and power. ``model_source`` in the
output records which route was taken, so a mapping can always be explained.
"""
from __future__ import annotations

__all__ = [
    'COLOURS', 'UNKNOWN_COLOUR', 'FINISH', 'MODELS', 'CURATED', 'BY_BODY',
    'pick_model', 'paint_for', 'styling_for', 'render_spec', 'model_file',
]

MODEL_DIR = 'car_3d/models'

# ---------------------------------------------------------------- paint
# dataset colour name -> (hex, finish, english name)
# The tones are softened a step from showroom-realistic so the cars sit in
# the pastel UI rather than against it; each still reads as its Dutch name.
COLOURS = {
    'Zwart':            ('#2b2e34', 'solid',    'Black'),
    'Wit':              ('#eef0f3', 'solid',    'White'),
    'Zilver metallic':  ('#c3c9d0', 'metallic', 'Silver'),
    'Grijs metallic':   ('#878d95', 'metallic', 'Grey'),
    'Blauw metallic':   ('#3d68b2', 'metallic', 'Blue'),
    'Rood metallic':    ('#bb3d4c', 'metallic', 'Red'),
    'Groen metallic':   ('#3d7d5b', 'metallic', 'Green'),
    'Bruin metallic':   ('#7d5b40', 'metallic', 'Brown'),
}
UNKNOWN_COLOUR = ('#9aa0a6', 'solid', 'Unknown')

# metallic paint keeps a hint more sheen than solid, but both sit closer to
# a toy/matte look than to real car lacquer
FINISH = {
    'metallic': {'metalness': 0.4, 'roughness': 0.5},
    'solid':    {'metalness': 0.05, 'roughness': 0.62},
}

# --------------------------------------------------------------- models
# The pack also ships `offroad` (boxy 4x4), `pickup` and `sport` (mid-engine).
# Nothing in this dataset resembles those, so they stay unused. Adding a line
# to CURATED is enough to bring one back -- see tools/ to export it.
MODELS = {
    'compact':   {'file': MODEL_DIR + '/compact.glb', 'length_m': 3.9},
    'hatchback': {'file': MODEL_DIR + '/hatchback.glb', 'length_m': 4.1},
    'sedan':     {'file': MODEL_DIR + '/sedan.glb',     'length_m': 4.8},
    'coupe':     {'file': MODEL_DIR + '/coupe.glb',     'length_m': 4.5},
    'wagon':     {'file': MODEL_DIR + '/wagon.glb',     'length_m': 4.8},
    'suv':       {'file': MODEL_DIR + '/suv.glb',       'length_m': 4.6},
    'minivan':   {'file': MODEL_DIR + '/minivan.glb',   'length_m': 4.9},
}

CURATED = {
    # city cars and superminis
    ('Volkswagen', 'up!'): 'compact', ('Volkswagen', 'Polo'): 'compact',
    ('Toyota', 'Aygo X'): 'compact', ('Toyota', 'Yaris'): 'compact',
    ('Fiat', '500e'): 'compact', ('MINI', 'Cooper'): 'compact',
    ('Hyundai', 'i20'): 'compact', ('Peugeot', '208'): 'compact',
    ('Opel', 'Corsa'): 'compact', ('Renault', 'Clio'): 'compact',
    ('SEAT', 'Ibiza'): 'compact', ('Škoda', 'Fabia'): 'compact',
    ('Citroën', 'C3'): 'compact', ('Audi', 'A1 Sportback'): 'compact',
    # family hatchbacks
    ('Volkswagen', 'Golf'): 'hatchback', ('Volkswagen', 'ID.3'): 'hatchback',
    ('Škoda', 'Scala'): 'hatchback', ('SEAT', 'Leon'): 'hatchback',
    ('Cupra', 'Leon'): 'hatchback', ('Cupra', 'Born'): 'hatchback',
    ('Audi', 'A3 Sportback'): 'hatchback', ('BMW', '1 Serie'): 'hatchback',
    ('Mercedes-Benz', 'A-Klasse'): 'hatchback',
    ('Renault', 'Megane E-Tech'): 'hatchback', ('Toyota', 'Corolla'): 'hatchback',
    # saloons
    ('Mercedes-Benz', 'C-Klasse'): 'sedan', ('Audi', 'A6'): 'sedan',
    ('Tesla', 'Model 3'): 'sedan',
    # low, sleek four-doors
    ('Audi', 'A5 Sportback'): 'coupe', ('Tesla', 'Model S'): 'coupe',
    ('Porsche', 'Taycan'): 'coupe',
    # estates
    ('Audi', 'A4 Avant'): 'wagon', ('BMW', '3 Serie Touring'): 'wagon',
    ('BMW', '5 Serie Touring'): 'wagon', ('Ford', 'Focus Wagon'): 'wagon',
    ('MINI', 'Clubman'): 'wagon', ('Opel', 'Astra Sports Tourer'): 'wagon',
    ('Peugeot', '508 SW'): 'wagon', ('Volkswagen', 'Arteon Shooting Brake'): 'wagon',
    ('Volkswagen', 'Passat Variant'): 'wagon', ('Volvo', 'V60'): 'wagon',
    ('Škoda', 'Octavia Combi'): 'wagon', ('Škoda', 'Superb Combi'): 'wagon',
    # MPV
    ('Volkswagen', 'Multivan'): 'minivan', ('Volkswagen', 'Touran'): 'minivan',
}

BY_BODY = {'SUV': 'suv', 'Hatchback': 'hatchback', 'Stationwagon': 'wagon',
           'Sedan': 'sedan', 'MPV': 'minivan'}


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def pick_model(row: dict) -> tuple[str, str]:
    """Return (model_slug, source) for a dataset row.

    Source is 'curated' when the make/model was mapped by hand, otherwise
    'rule:...', so any mapping can be traced back to why it was chosen.
    """
    key = (row.get('merk', ''), row.get('model', ''))
    if key in CURATED:
        return CURATED[key], 'curated'
    body = row.get('carrosserie', '')
    pk = _to_float(row.get('vermogen_pk'))
    if body == 'Hatchback':
        return ('compact' if pk <= 105 else 'hatchback'), 'rule:hatch-by-power'
    if body == 'Sedan':
        return ('coupe' if pk >= 350 else 'sedan'), 'rule:sedan-by-power'
    return BY_BODY.get(body, 'sedan'), 'rule:body-style'


def paint_for(kleur: str) -> tuple[str, str, str]:
    """Dataset colour name -> (hex, 'metallic'|'solid', english name)."""
    return COLOURS.get(kleur, UNKNOWN_COLOUR)


def styling_for(row: dict) -> dict:
    """The full 3D styling for one car -- the value of the `styling_3d` column."""
    model, source = pick_model(row)
    hex_colour, finish, english = paint_for(row.get('kleur', ''))
    return {
        'model': model,
        'model_source': source,
        'paint_hex': hex_colour,
        'paint_finish': finish,
        'paint_name_nl': row.get('kleur', ''),
        'paint_name_en': english,
        **FINISH[finish],
    }


def model_file(slug: str) -> str:
    """Repo-relative path to the .glb file for a model slug."""
    if slug not in MODELS:
        raise KeyError('unknown model %r (known: %s)' % (slug, ', '.join(sorted(MODELS))))
    return MODELS[slug]['file']


def render_spec(row: dict) -> dict:
    """Everything a viewer needs to show this car -- the tool-call output.

    ``paint_mask`` records the contract the .glb files were built to: the
    paint region lives in the albedo alpha channel. See viewer/paint.js.
    """
    s = styling_for(row)
    return {
        'car_id': row.get('id', ''),
        'label': ' '.join(x for x in (row.get('merk'), row.get('model'),
                                      row.get('uitvoering')) if x),
        'model': s['model'],
        'model_url': model_file(s['model']),
        'length_m': MODELS[s['model']]['length_m'],
        'paint_hex': s['paint_hex'],
        'paint_finish': s['paint_finish'],
        'metalness': s['metalness'],
        'roughness': s['roughness'],
        'paint_mask': 'albedo.alpha',
    }



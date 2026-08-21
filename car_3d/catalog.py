"""Reading the car dataset and attaching its 3D styling.

The styling is derived on load rather than stored in the CSV, so the dataset
stays the single source of truth: change a rule in ``styling.py`` and every
car follows on the next read. Use ``annotate_csv`` when you do want the
columns materialised into a file.
"""
from __future__ import annotations

import csv
import json
import os

from .styling import render_spec, styling_for

__all__ = [
    'REPO_ROOT', 'DEFAULT_DATASET', 'SIMPLE_DATASET',
    'load_cars', 'index_by_id', 'spec_for_id', 'annotate_csv',
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATASET = os.path.join(REPO_ROOT, 'advanced', 'cars.csv')
SIMPLE_DATASET = os.path.join(REPO_ROOT, 'simple', 'cars.csv')

STYLING_COLUMN = 'styling_3d'


def load_cars(path: str | None = None, attach: bool = True) -> list[dict]:
    """Read a cars csv into dicts, with ``styling_3d`` attached to each row.

    ``path`` defaults to advanced/cars.csv. Pass ``attach=False`` for the raw
    rows. The styling is a dict here, not a JSON string -- see ``annotate_csv``
    if you need the serialised form.
    """
    path = path or DEFAULT_DATASET
    with open(path, encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    if attach:
        for row in rows:
            row[STYLING_COLUMN] = styling_for(row)
    return rows


def index_by_id(rows: list[dict]) -> dict[str, dict]:
    """Map the dataset's ``id`` column to its row, for direct lookup."""
    return {row['id']: row for row in rows}


def spec_for_id(car_id: str, rows: list[dict] | None = None) -> dict:
    """Tool call: given a car id, return what the viewer needs to render it.

    Pass ``rows`` to reuse an already-loaded dataset; without it the default
    dataset is read on every call, which is fine for a one-off but wasteful
    in a request loop.
    """
    rows = rows if rows is not None else load_cars()
    try:
        row = index_by_id(rows)[car_id]
    except KeyError:
        raise KeyError('no car with id %r in the dataset' % car_id) from None
    return render_spec(row)


def annotate_csv(src: str | None = None, dst: str | None = None) -> int:
    """Write a copy of the dataset with the styling columns added.

    Adds ``styling_3d`` (JSON), ``model_3d``, ``verf_hex`` and ``verf_finish``.
    Only needed when something outside Python has to read the mapping -- the
    Python side should call ``load_cars`` instead and avoid the duplicate.
    """
    src = src or DEFAULT_DATASET
    dst = dst or os.path.join(os.path.dirname(src), 'cars_with_3d.csv')
    with open(src, encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    fields = list(rows[0].keys())
    extra = [c for c in (STYLING_COLUMN, 'model_3d', 'verf_hex', 'verf_finish')
             if c not in fields]
    for row in rows:
        styling = styling_for(row)
        row[STYLING_COLUMN] = json.dumps(styling, ensure_ascii=False,
                                         separators=(',', ':'))
        row['model_3d'] = styling['model']
        row['verf_hex'] = styling['paint_hex']
        row['verf_finish'] = styling['paint_finish']
    with open(dst, 'w', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=fields + extra)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)

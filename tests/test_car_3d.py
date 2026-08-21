"""Checks that the 3D mapping stays consistent with the dataset and the assets.

Runs under pytest, or standalone: python tests/test_car_3d.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import car_3d
from car_3d.catalog import REPO_ROOT, SIMPLE_DATASET

CARS = car_3d.load_cars()


def test_dataset_is_not_empty():
    assert len(CARS) > 1000


def test_every_car_gets_a_model_that_exists_on_disk():
    for car in CARS:
        slug = car['styling_3d']['model']
        path = os.path.join(REPO_ROOT, car_3d.model_file(slug))
        assert os.path.exists(path), '%s -> missing %s' % (car['id'], path)


def test_every_dataset_colour_is_mapped():
    unmapped = {c['kleur'] for c in CARS if c['kleur'] not in car_3d.COLOURS}
    assert not unmapped, 'unmapped colours: %s' % unmapped


def test_paint_is_always_a_hex_colour():
    for car in CARS:
        paint = car['styling_3d']['paint_hex']
        assert len(paint) == 7 and paint[0] == '#', paint
        int(paint[1:], 16)


def test_render_spec_has_the_keys_a_viewer_needs():
    spec = car_3d.render_spec(CARS[0])
    for key in ('car_id', 'model', 'model_url', 'paint_hex', 'paint_finish',
                'metalness', 'roughness', 'paint_mask'):
        assert key in spec, 'render_spec is missing %r' % key
    assert spec['paint_mask'] == 'albedo.alpha'


def test_curated_mapping_only_points_at_models_we_ship():
    unknown = {v for v in car_3d.CURATED.values() if v not in car_3d.MODELS}
    assert not unknown, 'CURATED points at unshipped models: %s' % unknown


def test_model_source_is_always_explainable():
    for car in CARS:
        source = car['styling_3d']['model_source']
        assert source == 'curated' or source.startswith('rule:'), source


def test_lookup_by_id_round_trips():
    car = CARS[len(CARS) // 2]
    assert car_3d.spec_for_id(car['id'], CARS)['car_id'] == car['id']


def test_unknown_id_raises():
    try:
        car_3d.spec_for_id('does-not-exist', CARS)
    except KeyError:
        return
    raise AssertionError('expected a KeyError for an unknown car id')


def test_simple_dataset_maps_too():
    rows = car_3d.load_cars(SIMPLE_DATASET)
    assert rows and all(r['styling_3d']['model'] in car_3d.MODELS for r in rows)


def test_manifest_agrees_with_the_shipped_models():
    manifest = json.load(open(os.path.join(REPO_ROOT, 'car_3d/models/manifest.json')))
    assert set(manifest) == set(car_3d.MODELS)


def test_runtime_imports_no_third_party_packages():
    """The agent backend should not need Pillow or numpy to serve a car."""
    import car_3d.catalog
    import car_3d.styling
    for module in (car_3d.styling, car_3d.catalog):
        source = open(module.__file__, encoding='utf-8').read()
        for banned in ('import numpy', 'from PIL', 'import PIL'):
            assert banned not in source, '%s pulls in %s' % (module.__name__, banned)


if __name__ == '__main__':
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                passed += 1
                print('  ok   %s' % name)
            except Exception as exc:
                failed += 1
                print('  FAIL %s: %s' % (name, exc))
    print('\n%d passed, %d failed' % (passed, failed))
    sys.exit(1 if failed else 0)

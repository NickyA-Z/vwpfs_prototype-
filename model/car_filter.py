"""Deterministic filtering and ranking for the car inventory."""
from __future__ import annotations

import csv
from pathlib import Path

from advanced.lease_pricing import (
	KM_PER_JAAR_OPTIES,
	LOOPTIJDEN_MAANDEN,
	bepaal_marge,
	bereken_klantprijs,
	bereken_leaseprijs,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CARS_PATH = PROJECT_ROOT / "advanced" / "cars.csv"
DEFAULT_LOOPTIJD_MAANDEN = 48
DEFAULT_KM_PER_JAAR = 15_000

SEARCHABLE_FIELDS = {
	"type": "text",
	"merk": "text",
	"model": "text",
	"uitvoering": "text",
	"kleur": "text",
	"bouwjaar": "number",
	"carrosserie": "text",
	"brandstof": "text",
	"transmissie": "text",
	"zitplaatsen": "number",
	"deuren": "number",
	"vermogen_pk": "number",
	"verbruik_l_100km": "number",
	"actieradius_km": "number",
	"co2_uitstoot_g_km": "number",
	"bagageruimte_liter": "number",
	"kilometerstand": "number",
	"aantal_vorige_eigenaren": "number",
	"conditie": "text",
	"aanschafprijs": "number",
	"airconditioning": "boolean",
	"cruise_control": "boolean",
	"apple_carplay_android_auto": "boolean",
	"navigatiesysteem": "boolean",
	"parkeersensoren_achter": "boolean",
	"achteruitrijcamera": "boolean",
	"stoelverwarming": "boolean",
	"led_koplampen": "boolean",
	"keyless_entry": "boolean",
	"lane_assist": "boolean",
	"parkeersensoren_voor": "boolean",
	"adaptive_cruise_control": "boolean",
	"trekhaak": "boolean",
	"elektrische_achterklep": "boolean",
	"panoramadak": "boolean",
	"camera_360_graden": "boolean",
	"aantal_opties": "number",
}

ALLOWED_OPERATORS = {"eq", "contains", "min", "max"}


def matches_filter(row: dict, search_filter: dict) -> bool:
	"""Return whether one inventory row satisfies one validated filter."""
	field = search_filter["field"]
	operator = search_filter["operator"]
	expected = search_filter["value"]
	actual = row.get(field, "")
	field_type = SEARCHABLE_FIELDS[field]

	if actual in {"", None}:
		return False
	if field_type == "number":
		try:
			actual_number = float(actual)
			expected_number = float(expected)
		except (TypeError, ValueError):
			return False
		if operator == "min":
			return actual_number >= expected_number
		if operator == "max":
			return actual_number <= expected_number
		return actual_number == expected_number
	if field_type == "boolean":
		expected_boolean = str(expected).lower() in {"true", "1", "yes"}
		actual_boolean = str(actual).lower() in {"true", "1", "yes"}
		return actual_boolean == expected_boolean

	actual_text = str(actual).casefold()
	expected_text = str(expected).casefold()
	if operator == "contains":
		return expected_text in actual_text
	return actual_text == expected_text


def filter_and_rank_cars(
	filters: list[dict],
	*,
	cars_path: Path | str = DEFAULT_CARS_PATH,
	limit: int = 10,
	contractvorm: str = "lease",
	looptijd_maanden: int = DEFAULT_LOOPTIJD_MAANDEN,
	km_per_jaar: int = DEFAULT_KM_PER_JAAR,
	max_maandbedrag: float | None = None,
	max_aankoopbedrag: float | None = None,
) -> list[dict]:
	"""Filter cars and rank equal matches by their calculated contract margin."""
	if contractvorm not in {"lease", "koop"}:
		raise ValueError("contractvorm moet 'lease' of 'koop' zijn")

	with Path(cars_path).open(encoding="utf-8", newline="") as csv_file:
		cars = list(csv.DictReader(csv_file))

	required = [item for item in filters if item["importance"] == "required"]
	preferred = [item for item in filters if item["importance"] == "preferred"]
	matching_cars = [
		car for car in cars if all(matches_filter(car, item) for item in required)
	]

	for car in matching_cars:
		car["match_score"] = sum(matches_filter(car, item) for item in preferred)
		car["matched_preferences"] = [
			item["field"] for item in preferred if matches_filter(car, item)
		]
		catalogusprijs = float(car["aanschafprijs"])
		car["contractvorm"] = contractvorm
		if contractvorm == "lease":
			marge_factor = bepaal_marge(car["merk"])
			lease_kostprijs = bereken_leaseprijs(
				catalogusprijs, looptijd_maanden, km_per_jaar
			)
			lease_klantprijs = bereken_klantprijs(
				catalogusprijs, looptijd_maanden, km_per_jaar, car["merk"]
			)
			car["marge_percentage"] = marge_factor * 100
			car["lease_kostprijs"] = lease_kostprijs
			car["lease_klantprijs"] = lease_klantprijs
			car["marge_bedrag"] = round(lease_klantprijs - lease_kostprijs, 2)
			car["lease_prijzen"] = {
				looptijd: {
					jaarkilometers: bereken_klantprijs(
						catalogusprijs,
						looptijd,
						jaarkilometers,
						car["merk"],
					)
					for jaarkilometers in KM_PER_JAAR_OPTIES
				}
				for looptijd in LOOPTIJDEN_MAANDEN
			}
			car["is_alternatief"] = False
			car["budget_overschrijding"] = 0.0
		else:
			car["marge_percentage"] = None
			car["lease_kostprijs"] = None
			car["lease_klantprijs"] = None
			car["marge_bedrag"] = None
			car["lease_prijzen"] = None
			car["is_alternatief"] = False
			car["budget_overschrijding"] = 0.0

	if contractvorm == "lease":
		if max_maandbedrag is not None:
			binnen_budget = [
				car for car in matching_cars
				if car["lease_klantprijs"] <= max_maandbedrag
			]
			if binnen_budget:
				matching_cars = binnen_budget
			else:
				for car in matching_cars:
					car["is_alternatief"] = True
					car["budget_overschrijding"] = round(
						car["lease_klantprijs"] - max_maandbedrag, 2
					)
				matching_cars.sort(
					key=lambda car: (
						car["budget_overschrijding"],
						-car["match_score"],
						-car["marge_bedrag"],
					)
				)
				return matching_cars[:limit]

		matching_cars.sort(
			key=lambda car: (
				-car["match_score"],
				-car["marge_bedrag"],
				float(car["aanschafprijs"]),
			)
		)
	else:
		if max_aankoopbedrag is not None:
			binnen_budget = [
				car for car in matching_cars
				if float(car["aanschafprijs"]) <= max_aankoopbedrag
			]
			if binnen_budget:
				matching_cars = binnen_budget
			else:
				for car in matching_cars:
					car["is_alternatief"] = True
					car["budget_overschrijding"] = round(
						float(car["aanschafprijs"]) - max_aankoopbedrag, 2
					)
				matching_cars.sort(
					key=lambda car: (
						car["budget_overschrijding"],
						-car["match_score"],
					)
				)
				return matching_cars[:limit]

		matching_cars.sort(
			key=lambda car: (
				-car["match_score"],
				float(car["aanschafprijs"]),
			)
		)
	return matching_cars[:limit]

"""Orchestrate natural-language interpretation and deterministic car filtering."""
from __future__ import annotations

from model.car_filter import filter_and_rank_cars
from model.prompts import interpret_search_turn


def continue_car_search(
	user_message: str,
	*,
	state: dict | None = None,
	limit: int = 10,
	contractvorm: str | None = None,
	looptijd_maanden: int = 48,
	km_per_jaar: int = 15_000,
	max_maandbedrag: float | None = None,
) -> dict:
	"""Process one conversation turn and return matches plus the next question."""
	contractvorm = contractvorm or (state or {}).get("contractvorm")
	if contractvorm not in {"lease", "koop"}:
		raise ValueError("Kies eerst contractvorm 'lease' of 'koop'")
	leasevoorkeuren = (state or {}).get("leasevoorkeuren", {})
	if contractvorm == "lease":
		looptijd_maanden = leasevoorkeuren.get("looptijd_maanden", looptijd_maanden)
		km_per_jaar = leasevoorkeuren.get("km_per_jaar", km_per_jaar)
		max_maandbedrag = leasevoorkeuren.get("max_maandbedrag", max_maandbedrag)

	new_state = interpret_search_turn(user_message, state)
	new_state["contractvorm"] = contractvorm
	if contractvorm == "lease":
		new_state["leasevoorkeuren"] = {
			"looptijd_maanden": looptijd_maanden,
			"km_per_jaar": km_per_jaar,
			"max_maandbedrag": max_maandbedrag,
		}
	cars = filter_and_rank_cars(
		new_state["filters"],
		limit=limit,
		contractvorm=contractvorm,
		looptijd_maanden=looptijd_maanden,
		km_per_jaar=km_per_jaar,
		max_maandbedrag=max_maandbedrag,
	)
	return {
		"state": new_state,
		"filters": new_state["filters"],
		"cars": cars,
		"alternatieven": any(car["is_alternatief"] for car in cars),
		"follow_up": new_state["follow_up"],
		"complete": new_state["follow_up"] is None,
	}


def search_cars(
	user_request: str,
	*,
	limit: int = 10,
	contractvorm: str,
	looptijd_maanden: int = 48,
	km_per_jaar: int = 15_000,
	max_maandbedrag: float | None = None,
) -> dict:
	"""Start a natural-language car-search conversation."""
	return continue_car_search(
		user_request,
		limit=limit,
		contractvorm=contractvorm,
		looptijd_maanden=looptijd_maanden,
		km_per_jaar=km_per_jaar,
		max_maandbedrag=max_maandbedrag,
	)

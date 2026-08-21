import json

import pytest

from model.car_filter import normalize_filter_value
from model.chat import _parse_euro_amount
from model import prompts


@pytest.mark.parametrize(
	("raw", "expected"),
	[
		("€30.000,-", 30_000),
		("30k", 30_000),
		("30,5k", 30_500),
		("500 euro", 500),
	],
)
def test_parse_euro_amount(raw, expected):
	assert _parse_euro_amount(raw) == expected


def test_filter_values_are_normalized_against_inventory():
	assert normalize_filter_value("merk", "skoda") == "Škoda"
	assert normalize_filter_value("carrosserie", "crossover") == "SUV"
	assert normalize_filter_value("transmissie", "automatisch") == "Automaat"
	assert normalize_filter_value("brandstof", "waterstof") is None


def test_filter_operator_must_match_field_type():
	assert prompts._validate_filters([
		{"field": "brandstof", "operator": "min", "value": "Elektrisch", "importance": "required"}
	]) == []


def test_turn_can_replace_and_remove_filters(monkeypatch):
	response = {
		"set_filters": [
			{"field": "brandstof", "operator": "eq", "value": "ev", "importance": "preferred"}
		],
		"remove_filters": ["merk"],
		"no_preference_fields": ["merk"],
		"follow_up_field": "transmissie",
	}
	monkeypatch.setattr(prompts, "call_gemini", lambda *args, **kwargs: json.dumps(response))
	state = {
		"filters": [
			{"field": "merk", "operator": "eq", "value": "BMW", "importance": "preferred"},
			{"field": "brandstof", "operator": "eq", "value": "Benzine", "importance": "preferred"},
		],
		"answered_fields": ["merk", "brandstof"],
	}

	result = prompts.interpret_search_turn("Geen merkvoorkeur; toch elektrisch", state)

	assert result["filters"] == [
		{"field": "brandstof", "operator": "eq", "value": "Elektrisch", "importance": "preferred"}
	]
	assert "merk" in result["answered_fields"]
	assert result["follow_up"] == {
		"field": "transmissie",
		"question": "Wil je een automaat of een handgeschakelde auto?",
	}

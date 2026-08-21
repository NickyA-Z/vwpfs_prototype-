"""Gemini client and Dutch request-to-filter conversion."""
from __future__ import annotations

import json
import os

import requests
from dotenv import load_dotenv

from model.car_filter import ALLOWED_OPERATORS, SEARCHABLE_FIELDS


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL")


def call_gemini(prompt: str, *, json_response: bool = False) -> str:
	if not GEMINI_API_KEY:
		raise RuntimeError("GEMINI_KEY is not set in the environment")
	if not GEMINI_MODEL:
		raise RuntimeError("GEMINI_MODEL is not set in the environment")

	url = (
		"https://generativelanguage.googleapis.com/v1beta/models/"
		f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
	)
	payload = {"contents": [{"parts": [{"text": prompt}]}]}
	if json_response:
		payload["generationConfig"] = {"responseMimeType": "application/json"}

	response = requests.post(url, json=payload, timeout=30)
	response.raise_for_status()
	data = response.json()
	return data["candidates"][0]["content"]["parts"][0]["text"]


def _validate_filters(filters: object) -> list[dict]:
	"""Discard malformed or unsupported filters returned by Gemini."""
	validated = []
	if not isinstance(filters, list):
		return validated

	for item in filters:
		if not isinstance(item, dict):
			continue
		field = item.get("field")
		operator = item.get("operator")
		importance = item.get("importance")
		if (
			field in SEARCHABLE_FIELDS
			and operator in ALLOWED_OPERATORS
			and importance in {"required", "preferred"}
			and "value" in item
		):
			validated.append(
				{
					"field": field,
					"operator": operator,
					"value": item["value"],
					"importance": importance,
				}
			)
	return validated


def interpret_search_turn(user_message: str, state: dict | None = None) -> dict:
	"""Interpret one message and choose one unresolved label to ask about."""
	state = state or {}
	known_filters = _validate_filters(state.get("filters", []))
	answered_fields = {
		field for field in state.get("answered_fields", []) if field in SEARCHABLE_FIELDS
	}
	answered_fields.update(item["field"] for item in known_filters)
	previous_question = state.get("follow_up")
	field_description = ", ".join(
		f"{name} ({field_type})" for name, field_type in SEARCHABLE_FIELDS.items()
	)

	prompt = f"""
Je begeleidt een Nederlandstalige autokoper. Verwerk het nieuwste antwoord en
stel daarna precies één korte vervolgvraag over een veldlabel waarvoor de
voorkeur nog onbekend is. De labels zijn exacte CSV-kolomnamen; vertaal of
hernoem ze nooit.

Geef uitsluitend dit JSON-object terug:
{{
  "filters": [nieuwe of gewijzigde filters uit het nieuwste bericht],
  "answered_fields": [labels die door het nieuwste bericht zijn beantwoord],
  "follow_up": {{"field": "exact_label", "question": "Nederlandse vraag"}} of null
}}

Elk filter bevat field, operator, value en importance. De operator is eq,
contains, min of max. Importance is required voor een expliciete grens of harde
eis en preferred voor een voorkeur. Geef alleen nieuwe of gewijzigde filters
terug en voeg geen voorkeuren toe die de koper niet noemt.

Als de gebruiker zegt dat een kenmerk niet uitmaakt, voeg het label dan wel toe
aan answered_fields, maar maak er geen filter voor. Kies voor follow_up één label
dat nog niet in de lijst met beantwoorde labels staat. Als alle labels beantwoord
zijn, gebruik null.

Voorbeelden van Nederlandse tekst naar exacte labels:
- "onder €30.000" -> aanschafprijs, max, 30000
- "minstens vijf zitplaatsen" -> zitplaatsen, min, 5
- "elektrisch" -> brandstof, eq, "Elektrisch"
- "automaat" -> transmissie, eq, "Automaat"
- "achteruit kunnen kijken bij parkeren" -> achteruitrijcamera, eq, true

Gebruik tekstwaarden zoals ze in het Nederlandse CSV-bestand staan. Verzin geen
numerieke grens voor subjectieve woorden zoals "zuinig" of "ruim".

Beschikbare veldlabels: {field_description}
Al beantwoorde veldlabels: {json.dumps(sorted(answered_fields), ensure_ascii=False)}
Bestaande filters: {json.dumps(known_filters, ensure_ascii=False)}
Vorige vervolgvraag: {json.dumps(previous_question, ensure_ascii=False)}
Nieuwste bericht: {json.dumps(user_message, ensure_ascii=False)}
""".strip()

	raw_response = call_gemini(prompt, json_response=True)
	try:
		result = json.loads(raw_response)
	except json.JSONDecodeError as error:
		raise ValueError("Gemini returned invalid search-state JSON") from error

	filter_updates = _validate_filters(result.get("filters", []))
	filters_by_field = {item["field"]: item for item in known_filters}
	filters_by_field.update({item["field"]: item for item in filter_updates})
	merged_filters = list(filters_by_field.values())

	newly_answered = result.get("answered_fields", [])
	if isinstance(newly_answered, list):
		answered_fields.update(
			field for field in newly_answered if field in SEARCHABLE_FIELDS
		)
	answered_fields.update(item["field"] for item in filter_updates)

	missing_fields = [field for field in SEARCHABLE_FIELDS if field not in answered_fields]
	follow_up = result.get("follow_up")
	if not missing_fields:
		follow_up = None
	elif not (
		isinstance(follow_up, dict)
		and follow_up.get("field") in missing_fields
		and isinstance(follow_up.get("question"), str)
		and follow_up["question"].strip()
	):
		field = missing_fields[0]
		follow_up = {
			"field": field,
			"question": f"Wat is je voorkeur voor {field}?",
		}

	return {
		"filters": merged_filters,
		"answered_fields": sorted(answered_fields),
		"follow_up": follow_up,
	}


def extract_search_filters(user_request: str) -> list[dict]:
	"""Translate one buyer request into validated filters."""
	return interpret_search_turn(user_request)["filters"]

"""Gemini client and Dutch request-to-filter conversion."""
from __future__ import annotations

import json
import os

import requests
from dotenv import load_dotenv

from model.car_filter import (
	ALLOWED_FIELD_VALUES,
	OPERATORS_BY_TYPE,
	SEARCHABLE_FIELDS,
	normalize_filter_value,
)


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL")

FIELD_QUESTIONS = {
	"type": "Wil je een nieuwe of tweedehands auto?",
	"merk": "Heb je een voorkeur voor een automerk?",
	"model": "Heb je een voorkeur voor een specifiek model?",
	"uitvoering": "Heb je een voorkeur voor een bepaalde uitvoering?",
	"kleur": "Welke kleur heeft je voorkeur?",
	"bouwjaar": "Vanaf welk bouwjaar wil je zoeken?",
	"carrosserie": "Welke carrosserievorm heeft je voorkeur?",
	"brandstof": "Welke brandstofsoort heeft je voorkeur?",
	"transmissie": "Wil je een automaat of een handgeschakelde auto?",
	"zitplaatsen": "Hoeveel zitplaatsen heb je minimaal nodig?",
	"deuren": "Hoeveel deuren wil je minimaal?",
	"vermogen_pk": "Hoeveel vermogen wil je minimaal, uitgedrukt in pk?",
	"verbruik_l_100km": "Wat is je maximale gewenste brandstofverbruik per 100 km?",
	"actieradius_km": "Welke minimale actieradius wil je?",
	"co2_uitstoot_g_km": "Wat is de maximale CO₂-uitstoot die je accepteert?",
	"bagageruimte_liter": "Hoeveel bagageruimte heb je minimaal nodig?",
	"kilometerstand": "Wat is de maximale kilometerstand die je accepteert?",
	"aantal_vorige_eigenaren": "Hoeveel vorige eigenaren accepteer je maximaal?",
	"conditie": "Welke conditie moet de auto minimaal hebben?",
	"aanschafprijs": "Wat is de maximale aanschafprijs die je overweegt?",
	"airconditioning": "Wil je airconditioning?",
	"cruise_control": "Wil je cruise control?",
	"apple_carplay_android_auto": "Wil je Apple CarPlay of Android Auto?",
	"navigatiesysteem": "Wil je een ingebouwd navigatiesysteem?",
	"parkeersensoren_achter": "Wil je parkeersensoren achter?",
	"achteruitrijcamera": "Wil je een achteruitrijcamera?",
	"stoelverwarming": "Wil je stoelverwarming?",
	"led_koplampen": "Wil je LED-koplampen?",
	"keyless_entry": "Wil je keyless entry?",
	"lane_assist": "Wil je lane assist?",
	"parkeersensoren_voor": "Wil je parkeersensoren voor?",
	"adaptive_cruise_control": "Wil je adaptive cruise control?",
	"trekhaak": "Heb je een trekhaak nodig?",
	"elektrische_achterklep": "Wil je een elektrische achterklep?",
	"panoramadak": "Wil je een panoramadak?",
	"camera_360_graden": "Wil je een 360-gradencamera?",
	"aantal_opties": "Hoeveel uitrustingsopties wil je minimaal?",
}


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
		normalized_value = (
			normalize_filter_value(field, item.get("value"))
			if field in SEARCHABLE_FIELDS and "value" in item
			else None
		)
		if (
			field in SEARCHABLE_FIELDS
			and operator in OPERATORS_BY_TYPE[SEARCHABLE_FIELDS[field]]
			and importance in {"required", "preferred"}
			and normalized_value is not None
		):
			validated.append(
				{
					"field": field,
					"operator": operator,
					"value": normalized_value,
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
	allowed_value_description = json.dumps(ALLOWED_FIELD_VALUES, ensure_ascii=False)

	prompt = f"""
Je begeleidt een Nederlandstalige autokoper. Verwerk het nieuwste antwoord en
stel daarna precies één korte vervolgvraag over een veldlabel waarvoor de
voorkeur nog onbekend is. De labels zijn exacte CSV-kolomnamen; vertaal of
hernoem ze nooit.

Geef uitsluitend dit JSON-object terug:
{{
  "set_filters": [nieuwe of gewijzigde filters uit het nieuwste bericht],
  "remove_filters": [exacte labels waarvan de bestaande voorkeur vervalt],
  "no_preference_fields": [labels waarvoor de gebruiker zegt dat het niet uitmaakt],
  "follow_up_field": "exact_label" of null
}}

Elk filter bevat field, operator, value en importance. De operator is eq,
contains, min of max. Importance is required voor een expliciete grens of harde
eis en preferred voor een voorkeur. Geef alleen nieuwe of gewijzigde filters
terug in set_filters. Als de koper een bestaande eis intrekt, zet het exacte
label in remove_filters. Als de koper een voorkeur wijzigt, zet de vervangende
waarde in set_filters; deze vervangt de bestaande waarde voor dat label.

Als de gebruiker zegt dat een kenmerk niet uitmaakt, voeg het label dan toe aan
no_preference_fields en remove_filters, maar maak er geen filter voor. Kies voor
follow_up_field één label
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
Zet synoniemen, informele woorden en afwijkende spelling om naar exact één van de
toegestane waarden. Retourneer nooit een andere tekstwaarde. Voor numerieke
velden mag je wel iedere concrete grenswaarde gebruiken.

Beschikbare veldlabels: {field_description}
Toegestane waarden per categorisch veld: {allowed_value_description}
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

	filter_updates = _validate_filters(result.get("set_filters", []))
	remove_filters = result.get("remove_filters", [])
	if not isinstance(remove_filters, list):
		remove_filters = []
	remove_fields = {
		field for field in remove_filters if field in SEARCHABLE_FIELDS
	}
	filters_by_field = {item["field"]: item for item in known_filters}
	for field in remove_fields:
		filters_by_field.pop(field, None)
	filters_by_field.update({item["field"]: item for item in filter_updates})
	merged_filters = list(filters_by_field.values())
	answered_fields.difference_update(remove_fields)

	no_preference_fields = result.get("no_preference_fields", [])
	if isinstance(no_preference_fields, list):
		answered_fields.update(
			field for field in no_preference_fields if field in SEARCHABLE_FIELDS
		)
	answered_fields.update(item["field"] for item in filter_updates)

	missing_fields = [field for field in SEARCHABLE_FIELDS if field not in answered_fields]
	follow_up_field = result.get("follow_up_field")
	if not missing_fields:
		follow_up = None
	else:
		field = follow_up_field if follow_up_field in missing_fields else missing_fields[0]
		follow_up = {
			"field": field,
			"question": FIELD_QUESTIONS[field],
		}

	return {
		"filters": merged_filters,
		"answered_fields": sorted(answered_fields),
		"follow_up": follow_up,
	}


def extract_search_filters(user_request: str) -> list[dict]:
	"""Translate one buyer request into validated filters."""
	return interpret_search_turn(user_request)["filters"]

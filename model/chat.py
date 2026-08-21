"""Run the car finder as a turn-based terminal chat."""
from advanced.lease_pricing import KM_PER_JAAR_OPTIES, LOOPTIJDEN_MAANDEN
from model.search import continue_car_search


EXIT_COMMANDS = {"stop", "quit", "exit", "afsluiten"}
LEASE_ANSWERS = {"lease", "leasen", "private lease"}
BUY_ANSWERS = {"koop", "kopen", "aankoop"}

OPERATOR_LABELS = {
	"eq": "is",
	"contains": "bevat",
	"min": "minimaal",
	"max": "maximaal",
}

IMPORTANCE_LABELS = {
	"required": "harde eis",
	"preferred": "voorkeur",
}


def print_filters(filters: list[dict]) -> None:
	"""Print all filters currently active in the conversation state."""
	if not filters:
		print("\nActieve filters: nog geen")
		return

	print("\nActieve filters:")
	for search_filter in filters:
		operator = OPERATOR_LABELS.get(
			search_filter["operator"], search_filter["operator"]
		)
		importance = IMPORTANCE_LABELS.get(
			search_filter["importance"], search_filter["importance"]
		)
		value = search_filter["value"]
		if isinstance(value, bool):
			value = "ja" if value else "nee"
		elif search_filter.get("source") == "aankoopbudget":
			value = f"€{float(value):,.0f}"
		print(
			f"- {search_filter['field']} {operator} {value} "
			f"({importance})"
		)


def print_cars(cars: list[dict]) -> None:
	"""Print a compact overview of the current best matches."""
	if not cars:
		print("\nEr zijn momenteel geen auto's die aan alle harde eisen voldoen.")
		return

	if any(car["is_alternatief"] for car in cars):
		budget_type = (
			"maandbudget" if cars[0]["contractvorm"] == "lease" else "aankoopbudget"
		)
		print(f"\nGeen exacte match binnen het {budget_type}.")
		print("Dichtstbijzijnde alternatieven:")
	else:
		print("\nBeste matches op dit moment:")
	for position, car in enumerate(cars, start=1):
		price = float(car["aanschafprijs"])
		line = (
			f"{position}. {car['merk']} {car['model']} {car['uitvoering']} "
			f"— €{price:,.0f} — {car['brandstof']} — {car['transmissie']}"
		)
		if car["contractvorm"] == "lease":
			line += (
				f" — lease €{car['lease_klantprijs']:.2f}/mnd"
				f" — marge €{car['marge_bedrag']:.2f}/mnd"
			)
			if car["is_alternatief"]:
				line += f" — €{car['budget_overschrijding']:.2f} boven budget"
		elif car["is_alternatief"]:
			line += f" — €{car['budget_overschrijding']:.2f} boven budget"
		print(line)
		if car["contractvorm"] == "lease":
			print_lease_matrix(car["lease_prijzen"])


def print_lease_matrix(prices: dict) -> None:
	"""Print all supported duration and annual-mileage combinations."""
	header = "maanden" + "".join(f" | {km // 1000:>2}k km" for km in KM_PER_JAAR_OPTIES)
	print(f"   {header}")
	for months in LOOPTIJDEN_MAANDEN:
		amounts = "".join(
			f" | €{prices[months][km]:>6.2f}" for km in KM_PER_JAAR_OPTIES
		)
		print(f"   {months:>7}{amounts}")


def ask_contractvorm() -> str:
	"""Ask whether the customer wants to lease or buy before car questions."""
	while True:
		try:
			answer = input("Assistent: Wil je een auto leasen of kopen?\nJij: ").strip()
		except (EOFError, KeyboardInterrupt):
			raise SystemExit("\nGesprek afgesloten.")
		answer = answer.casefold()
		if answer in EXIT_COMMANDS:
			raise SystemExit("Gesprek afgesloten.")
		if answer in LEASE_ANSWERS:
			return "lease"
		if answer in BUY_ANSWERS:
			return "koop"
		print("Kies alsjeblieft 'leasen' of 'kopen'.\n")


def _ask_option(question: str, options: list[int]) -> int:
	"""Ask until the customer enters one supported numeric option."""
	options_text = ", ".join(str(option) for option in options)
	while True:
		answer = input(f"Assistent: {question} ({options_text})\nJij: ").strip()
		if answer.casefold() in EXIT_COMMANDS:
			raise SystemExit("Gesprek afgesloten.")
		try:
			value = int(answer.replace(".", ""))
		except ValueError:
			value = None
		if value in options:
			return value
		print(f"Kies een van deze opties: {options_text}.\n")


def _ask_monthly_budget() -> float:
	"""Ask for a positive maximum monthly lease budget."""
	while True:
		answer = input("Assistent: Wat is je maximale maandbudget in euro's?\nJij: ").strip()
		if answer.casefold() in EXIT_COMMANDS:
			raise SystemExit("Gesprek afgesloten.")
		budget = _parse_euro_amount(answer)
		if budget > 0:
			return budget
		print("Vul een positief bedrag in, bijvoorbeeld 500.\n")


def _parse_euro_amount(answer: str) -> float:
	"""Parse common Dutch money notation, including 30k and €30.000,-."""
	normalized = (
		answer.casefold()
		.replace("€", "")
		.replace("euro", "")
		.replace(" ", "")
		.removesuffix(",-" )
		.removesuffix(".-")
	)
	multiplier = 1_000 if normalized.endswith("k") else 1
	if multiplier == 1_000:
		normalized = normalized[:-1].replace(",", ".")
	elif "," in normalized:
		normalized = normalized.replace(".", "").replace(",", ".")
	elif normalized.count(".") == 1 and len(normalized.rsplit(".", 1)[1]) == 3:
		normalized = normalized.replace(".", "")
	try:
		return float(normalized) * multiplier
	except ValueError:
		return 0


def _ask_purchase_budget() -> float:
	"""Ask for a positive maximum purchase budget."""
	while True:
		answer = input("Assistent: Wat is je maximale aankoopbudget in euro's?\nJij: ").strip()
		if answer.casefold() in EXIT_COMMANDS:
			raise SystemExit("Gesprek afgesloten.")
		budget = _parse_euro_amount(answer)
		if budget > 0:
			return budget
		print("Vul een positief bedrag in, bijvoorbeeld 30000.\n")


def ask_lease_preferences() -> dict:
	"""Collect the terms required for deterministic lease pricing."""
	looptijd = _ask_option(
		"Welke looptijd wil je in maanden?", LOOPTIJDEN_MAANDEN
	)
	kilometers = _ask_option(
		"Hoeveel kilometer verwacht je per jaar te rijden?", KM_PER_JAAR_OPTIES
	)
	budget = _ask_monthly_budget()
	return {
		"looptijd_maanden": looptijd,
		"km_per_jaar": kilometers,
		"max_maandbedrag": budget,
	}


def main() -> None:
	state = None
	print("Welkom bij de autozoeker. Typ 'stop' om af te sluiten.\n")
	contractvorm = ask_contractvorm()
	leasevoorkeuren = ask_lease_preferences() if contractvorm == "lease" else {}
	max_aankoopbedrag = _ask_purchase_budget() if contractvorm == "koop" else None
	print("\nAssistent: Beschrijf nu je ideale auto.\n")

	while True:
		try:
			user_message = input("Jij: ").strip()
		except (EOFError, KeyboardInterrupt):
			print("\nGesprek afgesloten.")
			break

		if not user_message:
			continue
		if user_message.casefold() in EXIT_COMMANDS:
			print("Gesprek afgesloten.")
			break

		try:
			result = continue_car_search(
				user_message,
				state=state,
				limit=5,
				contractvorm=contractvorm,
				looptijd_maanden=leasevoorkeuren.get("looptijd_maanden", 48),
				km_per_jaar=leasevoorkeuren.get("km_per_jaar", 15_000),
				max_maandbedrag=leasevoorkeuren.get("max_maandbedrag"),
				max_aankoopbedrag=max_aankoopbedrag,
			)
		except Exception as error:
			print(f"\nDe zoekopdracht kon niet worden verwerkt: {error}")
			continue

		state = result["state"]
		print_filters(result["filters"])
		print_cars(result["cars"])

		if result["complete"]:
			print("\nAssistent: Alle zoekvoorkeuren zijn ingevuld.")
			break

		print(f"\nAssistent: {result['follow_up']['question']}\n")


if __name__ == "__main__":
	main()

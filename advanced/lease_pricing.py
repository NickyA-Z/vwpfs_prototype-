"""
Vaste formules voor private lease- en occasionprijzen.

Losstaand van generate_dataset.py, zodat dit ook direct als tool-call
functie gebruikt kan worden in de chatbot (bv. "bereken de leaseprijs voor
auto X met 48 maanden en 15.000 km/jaar" zonder de hele lease_prices.json
te hoeven doorzoeken).

De formules zijn een vereenvoudigd maar realistisch model van hoe private
lease-maandbedragen tot stand komen: catalogusprijs min geschatte
restwaarde (die daalt naarmate de looptijd en het kilometrage toenemen),
plus renteopslag en vaste servicekosten (onderhoud, banden, verzekering).
Dit zijn representatieve cijfers voor de workshop, geen actuele
marktprijzen van een leasemaatschappij.
"""

LOOPTIJDEN_MAANDEN = [24, 36, 48, 60]
KM_PER_JAAR_OPTIES = [10_000, 15_000, 20_000, 25_000, 30_000]

# Restwaarde daalt nooit onder dit percentage van de catalogusprijs
MIN_RESTWAARDE_FACTOR = 0.30
MIN_OCCASION_FACTOR = 0.20

AFSCHRIJVING_PER_MAAND = 0.0075     # ~0.75% van de catalogusprijs per maand looptijd (tijdsgebonden)
AFSCHRIJVING_PER_KM = 0.0000015     # extra afschrijving per gereden kilometer
RENTEOPSLAG_PER_MAAND = 0.0022      # rente/marge over de catalogusprijs, per maand
VASTE_SERVICEKOSTEN_PER_MAAND = 79  # onderhoud, banden, verzekeringsbijdrage (EUR)
VASTE_OPSTARTKOSTEN = 1500          # afleverkosten/kenteken/administratie, uitgesmeerd over de looptijd

AFSCHRIJVING_PER_JAAR_OCCASION = 0.14   # leeftijd-gedreven waardedaling voor occasions
AFSCHRIJVING_PER_KM_OCCASION = 0.0000028

# VWPFS-marge: lagere marge op het eigen Volkswagen-concern, hogere marge
# op overige merken die VWPFS ook least.
VWPFS_GROEP_MERKEN = {"Volkswagen", "Audi", "Škoda", "SEAT", "Cupra", "Porsche"}
MARGE_VWPFS_GROEP = 0.05
MARGE_OVERIGE_MERKEN = 0.10


def bereken_leaseprijs(catalogusprijs: float, looptijd_maanden: int, km_per_jaar: int) -> float:
    """Vaste formule voor het maandbedrag van een nieuwe private lease auto.

    Hogere km/jaar -> lagere restwaarde -> hoger maandbedrag.
    Langere looptijd -> vaste opstartkosten worden over meer maanden verdeeld
    -> lager maandbedrag (bij gelijk km/jaar), zoals in de praktijk.
    """
    if looptijd_maanden not in LOOPTIJDEN_MAANDEN:
        raise ValueError(f"looptijd_maanden moet een van {LOOPTIJDEN_MAANDEN} zijn")
    if km_per_jaar not in KM_PER_JAAR_OPTIES:
        raise ValueError(f"km_per_jaar moet een van {KM_PER_JAAR_OPTIES} zijn")

    totale_km = km_per_jaar * (looptijd_maanden / 12)

    restwaarde_factor = max(
        MIN_RESTWAARDE_FACTOR,
        1 - (AFSCHRIJVING_PER_MAAND * looptijd_maanden) - (AFSCHRIJVING_PER_KM * totale_km),
    )
    restwaarde = catalogusprijs * restwaarde_factor

    maandelijkse_afschrijving = (catalogusprijs - restwaarde) / looptijd_maanden
    rentekosten = catalogusprijs * RENTEOPSLAG_PER_MAAND
    opstartkosten_per_maand = VASTE_OPSTARTKOSTEN / looptijd_maanden

    maandbedrag = (
        maandelijkse_afschrijving + rentekosten + VASTE_SERVICEKOSTEN_PER_MAAND + opstartkosten_per_maand
    )
    return round(maandbedrag, 2)


def bepaal_marge(merk: str) -> float:
    """5% marge op auto's van het Volkswagen-concern, 10% op overige merken."""
    return MARGE_VWPFS_GROEP if merk in VWPFS_GROEP_MERKEN else MARGE_OVERIGE_MERKEN


def bereken_klantprijs(catalogusprijs: float, looptijd_maanden: int, km_per_jaar: int, merk: str) -> float:
    """Leaseprijs inclusief VWPFS-marge — dit is de prijs die de klant ziet.

    bereken_leaseprijs() blijft de onderliggende kostprijsformule; deze
    functie past daar de merkafhankelijke marge overheen.
    """
    kostprijs = bereken_leaseprijs(catalogusprijs, looptijd_maanden, km_per_jaar)
    return round(kostprijs * (1 + bepaal_marge(merk)), 2)


def bereken_occasion_prijs(
    catalogusprijs: float, bouwjaar: int, kilometerstand: int, huidig_jaar: int = 2026
) -> float:
    """Vaste formule voor de vraagprijs van een tweedehands auto, op basis
    van leeftijd en kilometerstand."""
    leeftijd_jaar = max(0, huidig_jaar - bouwjaar)

    restwaarde_factor = max(
        MIN_OCCASION_FACTOR,
        1 - (AFSCHRIJVING_PER_JAAR_OCCASION * leeftijd_jaar) - (AFSCHRIJVING_PER_KM_OCCASION * kilometerstand),
    )
    # Afgerond op 100 euro, zoals gangbaar bij occasion-vraagprijzen
    return round(catalogusprijs * restwaarde_factor / 100) * 100


if __name__ == "__main__":
    # Snelle handmatige check van de formule
    voorbeeld_prijs = 44_990
    for looptijd in LOOPTIJDEN_MAANDEN:
        for km in KM_PER_JAAR_OPTIES:
            bedrag = bereken_leaseprijs(voorbeeld_prijs, looptijd, km)
            print(f"{looptijd} mnd, {km:>6} km/jr -> €{bedrag}/maand")

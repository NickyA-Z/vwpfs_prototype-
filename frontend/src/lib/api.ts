// Client for server/app.py plus the deterministic answer -> filter mapping.

export type SearchFilter = {
  field: string
  operator: 'eq' | 'contains' | 'min' | 'max'
  value: string | number | boolean
  importance: 'required' | 'preferred'
}

export type RenderSpec = {
  car_id: string
  label: string
  model: string
  model_url: string
  length_m: number
  paint_hex: string
  paint_finish: string
  metalness: number
  roughness: number
}

export type Car = {
  id: string
  merk: string
  model: string
  uitvoering: string
  kleur: string
  bouwjaar: string
  carrosserie: string
  brandstof: string
  transmissie: string
  zitplaatsen: string
  deuren: string
  vermogen_pk: string
  actieradius_km: string
  verbruik_l_100km: string
  bagageruimte_liter: string
  kilometerstand: string
  conditie: string
  aanschafprijs: string
  aantal_opties: string
  opties_lijst: string
  match_score: number
  matched_preferences: string[]
  is_alternatief: boolean
  budget_overschrijding: number
  lease_klantprijs: number | null
  spec: RenderSpec
}

export type ChatState = {
  filters: SearchFilter[]
  answered_fields: string[]
  follow_up: { field: string; question: string } | null
}

export type Contractvorm = 'koop' | 'lease'

export async function rankCars(
  filters: SearchFilter[],
  excludeIds: string[],
  limit = 4,
  contractvorm: Contractvorm = 'koop',
): Promise<Car[]> {
  const res = await fetch('/api/rank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, exclude_ids: excludeIds, contractvorm, limit }),
  })
  if (!res.ok) throw new Error(`rank failed: ${res.status}`)
  const data = await res.json()
  return data.cars as Car[]
}

// One conversational turn through the backend AI (Gemini). Throws when the
// server has no key configured; callers treat that as "AI not available".
export async function chatTurn(
  message: string,
  state: ChatState | null,
  contractvorm: Contractvorm = 'koop',
): Promise<{
  state: ChatState
  filters: SearchFilter[]
  cars: Car[]
  follow_up: { field: string; question: string } | null
  complete: boolean
}> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, state, contractvorm }),
  })
  if (!res.ok) throw new Error(`chat failed: ${res.status}`)
  return res.json()
}

// ---- deterministic question answers -> dataset filters --------------------

const BODY: Record<string, string> = {
  Sedan: 'Sedan',
  SUV: 'SUV',
  Hatchback: 'Hatchback',
  Estate: 'Stationwagon',
  MPV: 'MPV',
}
const FUEL: Record<string, string> = {
  Petrol: 'Benzine',
  Diesel: 'Diesel',
  Hybrid: 'Hybride',
  Electric: 'Elektrisch',
}
const GEARBOX: Record<string, string> = {
  Manual: 'Handgeschakeld',
  Automatic: 'Automaat',
}
const BUDGET_MAX: Record<string, number> = {
  'Under €15k': 15000,
  '€15–30k': 30000,
  '€30–50k': 50000,
  '€50k+': 120000,
}
const BRAND_GROUPS: Record<string, string[]> = {
  German: ['Volkswagen', 'Audi', 'BMW', 'Mercedes-Benz', 'Opel', 'Porsche'],
  Japanese: ['Toyota', 'Nissan'],
  Korean: ['Hyundai', 'Kia'],
  American: ['Tesla', 'Ford'],
}
const PRIORITY_FEATURES: Record<string, string[]> = {
  Tech: ['navigatiesysteem', 'apple_carplay_android_auto', 'camera_360_graden'],
  Safety: ['lane_assist', 'adaptive_cruise_control', 'achteruitrijcamera'],
  Comfort: ['stoelverwarming', 'keyless_entry', 'panoramadak'],
}

export function answersToFilters(answers: Record<string, string>): SearchFilter[] {
  const filters: SearchFilter[] = []
  const add = (f: SearchFilter) => filters.push(f)

  if (BODY[answers.body]) add({ field: 'carrosserie', operator: 'eq', value: BODY[answers.body], importance: 'required' })
  if (answers.doors === '4' || answers.doors === '5') add({ field: 'deuren', operator: 'eq', value: Number(answers.doors), importance: 'required' })
  if (answers.seats === '7+') add({ field: 'zitplaatsen', operator: 'min', value: 7, importance: 'required' })
  if (FUEL[answers.fuel]) add({ field: 'brandstof', operator: 'eq', value: FUEL[answers.fuel], importance: 'required' })
  if (GEARBOX[answers.gearbox]) add({ field: 'transmissie', operator: 'eq', value: GEARBOX[answers.gearbox], importance: 'required' })
  if (BUDGET_MAX[answers.budget]) add({ field: 'aanschafprijs', operator: 'max', value: BUDGET_MAX[answers.budget], importance: 'required' })
  for (const merk of BRAND_GROUPS[answers.brand] ?? []) {
    add({ field: 'merk', operator: 'eq', value: merk, importance: 'preferred' })
  }
  for (const feature of PRIORITY_FEATURES[answers.priority] ?? []) {
    add({ field: feature, operator: 'eq', value: true, importance: 'preferred' })
  }
  if (answers.priority === 'Running cost') {
    add({ field: 'co2_uitstoot_g_km', operator: 'max', value: 110, importance: 'preferred' })
  }
  return filters
}

// stable identity for a filter, used for the remove buttons on the cards
export function filterKey(f: SearchFilter): string {
  return `${f.field}|${f.operator}|${String(f.value)}`
}

const FIELD_LABELS: Record<string, string> = {
  carrosserie: 'Body',
  deuren: 'Doors',
  zitplaatsen: 'Seats',
  brandstof: 'Fuel',
  transmissie: 'Gearbox',
  aanschafprijs: 'Price',
  merk: 'Brand',
  co2_uitstoot_g_km: 'CO₂',
  navigatiesysteem: 'Navigation',
  apple_carplay_android_auto: 'CarPlay / Android Auto',
  camera_360_graden: '360° camera',
  lane_assist: 'Lane assist',
  adaptive_cruise_control: 'Adaptive cruise',
  achteruitrijcamera: 'Rear camera',
  stoelverwarming: 'Heated seats',
  keyless_entry: 'Keyless entry',
  panoramadak: 'Panoramic roof',
  airconditioning: 'Air conditioning',
  cruise_control: 'Cruise control',
  led_koplampen: 'LED headlights',
  trekhaak: 'Tow bar',
  elektrische_achterklep: 'Electric tailgate',
  parkeersensoren_voor: 'Front sensors',
  parkeersensoren_achter: 'Rear sensors',
  vermogen_pk: 'Power',
  actieradius_km: 'Range',
  bagageruimte_liter: 'Boot space',
  kilometerstand: 'Mileage',
  bouwjaar: 'Year',
  kleur: 'Colour',
  conditie: 'Condition',
  merk_model: 'Model',
}

export function describeFilter(f: SearchFilter): { label: string; value: string } {
  const label = FIELD_LABELS[f.field] ?? f.field.replaceAll('_', ' ')
  if (typeof f.value === 'boolean') {
    return { label, value: f.value ? 'yes' : 'no' }
  }
  const prefix = f.operator === 'min' ? '≥ ' : f.operator === 'max' ? '≤ ' : ''
  const value = f.field === 'aanschafprijs' ? `€${Number(f.value).toLocaleString()}` : String(f.value)
  return { label, value: `${prefix}${value}` }
}

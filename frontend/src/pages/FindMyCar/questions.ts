// Deterministic questions the mascotte asks in the popup, each with the UI
// control that fits the answer. Options mirror the values that actually occur
// in advanced/cars.csv (see lib/api.ts answersToFilters).

export type SliderConfig = { min: number; max: number; step: number; start: number }

export type Question = {
  id: string
  title: string
  body: string
  control: 'choice' | 'segmented' | 'slider' | 'dropdown' | 'text'
  options?: string[]
  // slider config may depend on an earlier answer (buy vs lease budget)
  slider?: (answers: Record<string, string>) => SliderConfig
  placeholder?: string
  skippable: boolean
}

export const QUESTIONS: Question[] = [
  {
    id: 'contract',
    title: 'Buy or lease?',
    body: 'This decides whether I match on purchase price or on a monthly lease amount.',
    control: 'segmented',
    options: ['Buy', 'Lease'],
    skippable: false,
  },
  {
    id: 'body',
    title: 'What shape?',
    body: 'Pick the body that fits your life — you can change it later.',
    control: 'choice',
    options: ['Sedan', 'SUV', 'Hatchback', 'Estate', 'MPV'],
    skippable: true,
  },
  {
    id: 'doors',
    title: 'How many doors?',
    body: 'Four for the clean look, five for easy loading.',
    control: 'segmented',
    options: ['4', '5'],
    skippable: true,
  },
  {
    id: 'seats',
    title: 'How many seats?',
    body: 'Count the people you carry on a normal week.',
    control: 'segmented',
    options: ['5', '7+'],
    skippable: true,
  },
  {
    id: 'fuel',
    title: 'What should it run on?',
    body: 'This moves the running cost more than anything else.',
    control: 'choice',
    options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
    skippable: true,
  },
  {
    id: 'gearbox',
    title: 'Manual or automatic?',
    body: 'No wrong answer — automatics dominate the electric stock.',
    control: 'segmented',
    options: ['Manual', 'Automatic'],
    skippable: true,
  },
  {
    id: 'budget',
    title: "What's your budget?",
    body: 'I’ll stay under this — or get as close as I can.',
    control: 'slider',
    slider: (answers) =>
      answers.contract === 'Lease'
        ? { min: 150, max: 1500, step: 25, start: 500 }
        : { min: 5000, max: 120000, step: 1000, start: 35000 },
    skippable: true,
  },
  {
    id: 'brand',
    title: 'Leaning toward a badge?',
    body: "Only if you care — otherwise I'll look everywhere.",
    control: 'dropdown',
    options: ['No preference', 'German', 'Japanese', 'Korean', 'American'],
    skippable: true,
  },
  {
    id: 'mileage',
    title: 'Maximum mileage?',
    body: 'For used cars: the most kilometres you’d accept on the clock. Leave empty for any.',
    control: 'text',
    placeholder: 'e.g. 60000',
    skippable: true,
  },
  {
    id: 'priority',
    title: 'What matters most?',
    body: 'The tie-breaker when two cars are otherwise equal.',
    control: 'choice',
    options: ['Tech', 'Safety', 'Comfort', 'Running cost'],
    skippable: true,
  },
]

export const EXAMPLES = ['family car', 'sporty and fast', 'electric SUV']

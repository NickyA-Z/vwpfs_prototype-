export type Question = {
  id: string
  facet: 'body' | 'fuel' | 'budget' | 'brand' | 'features'
  kicker: string
  title: string
  body: string
  options: string[]
}

// Deterministic questions the mascotte asks; options mirror the values that
// actually occur in advanced/cars.csv (see lib/api.ts answersToFilters).
export const QUESTIONS: Question[] = [
  { id: 'body', facet: 'body', kicker: 'Question 1 of 8', title: 'What shape?', body: "Pick the body that fits your life — you can change it later.", options: ['Sedan', 'SUV', 'Hatchback', 'Estate', 'MPV'] },
  { id: 'doors', facet: 'body', kicker: 'Question 2 of 8', title: 'How many doors?', body: 'Four for the clean look, five for easy loading.', options: ['4', '5'] },
  { id: 'seats', facet: 'body', kicker: 'Question 3 of 8', title: 'How many seats?', body: 'Count the people you carry on a normal week.', options: ['5', '7+'] },
  { id: 'fuel', facet: 'fuel', kicker: 'Question 4 of 8', title: 'What should it run on?', body: 'This moves the running cost more than anything else.', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'] },
  { id: 'gearbox', facet: 'fuel', kicker: 'Question 5 of 8', title: 'Manual or automatic?', body: 'No wrong answer — automatics dominate the electric stock.', options: ['Manual', 'Automatic'] },
  { id: 'budget', facet: 'budget', kicker: 'Question 6 of 8', title: "What's your range?", body: "All-in price, before I filter anything out.", options: ['Under €15k', '€15–30k', '€30–50k', '€50k+'] },
  { id: 'brand', facet: 'brand', kicker: 'Question 7 of 8', title: 'Leaning toward a badge?', body: "Only if you care — otherwise I'll look everywhere.", options: ['No preference', 'German', 'Japanese', 'Korean', 'American'] },
  { id: 'priority', facet: 'features', kicker: 'Question 8 of 8', title: 'What matters most?', body: 'The tie-breaker when two cars are otherwise equal.', options: ['Tech', 'Safety', 'Comfort', 'Running cost'] },
]

export const EXAMPLES = ['family car', 'sporty and fast', 'electric SUV']

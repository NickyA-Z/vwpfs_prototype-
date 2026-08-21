import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './FindMyCar.css'
import { QUESTIONS, EXAMPLES, type Question, type SliderConfig } from './questions'
import {
  answersToFilters, chatTurn, describeFilter, filterKey, rankCars,
  type Car, type ChatState, type Contractvorm, type SearchFilter,
} from '../../lib/api'
import CarViewer from '../../components/CarViewer'
import Mascotte from '../../components/Mascotte'

type Phase = 'intro' | 'questions' | 'done'
type Answers = Record<string, string>

function dedupeFilters(filters: SearchFilter[]): SearchFilter[] {
  const seen = new Set<string>()
  return filters.filter((f) => {
    const key = filterKey(f)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function euro(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return `€${Number(value).toLocaleString('nl-NL')}`
}

function SliderControl({ config, lease, initial, onDone }: {
  config: SliderConfig
  lease: boolean
  initial: string
  onDone: (value: number) => void
}) {
  const [value, setValue] = useState(Number(initial) || config.start)
  return (
    <div className="fmc-control">
      <div className="fmc-slider-readout">
        {euro(value)}
        {lease && <span> / month</span>}
      </div>
      <input
        type="range"
        className="fmc-slider"
        min={config.min}
        max={config.max}
        step={config.step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        autoFocus
      />
      <div className="fmc-slider-bounds">
        <span>{euro(config.min)}</span>
        <span>{euro(config.max)}</span>
      </div>
      <button type="button" className="fmc-next-btn" onClick={() => onDone(value)}>
        Next
      </button>
    </div>
  )
}

function TextControl({ placeholder, initial, onDone }: {
  placeholder?: string
  initial: string
  onDone: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  const submit = () => onDone(value.trim())
  return (
    <div className="fmc-control">
      <input
        className="fmc-text-input"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
      <button type="button" className="fmc-next-btn" onClick={submit}>
        Next
      </button>
    </div>
  )
}

// deep-link straight into a phase (?phase=questions&step=3, ?phase=done) —
// used for demos and visual testing
function initialPhase(): Phase {
  const phase = new URLSearchParams(window.location.search).get('phase')
  return phase === 'questions' || phase === 'done' ? phase : 'intro'
}
function initialStep(): number {
  const step = Number(new URLSearchParams(window.location.search).get('step'))
  return Number.isInteger(step) && step >= 0 && step < QUESTIONS.length ? step : 0
}

export default function FindMyCar() {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [introLeaving, setIntroLeaving] = useState(false)
  const [step, setStep] = useState(initialStep)
  const [answers, setAnswers] = useState<Answers>({})
  const [draft, setDraft] = useState('')
  const [awake, setAwake] = useState(false)

  // classifications from the backend AI's reading of the free-text brief
  const [aiFilters, setAiFilters] = useState<SearchFilter[]>([])
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [chatState, setChatState] = useState<ChatState | null>(null)
  const [aiOffline, setAiOffline] = useState(false)

  // matching
  const [cars, setCars] = useState<Car[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const rankSeq = useRef(0)

  const isIntro = phase === 'intro'
  const isQuestions = phase === 'questions'
  const isDone = phase === 'done'

  const question: Question = QUESTIONS[Math.min(step, QUESTIONS.length - 1)]
  const contractvorm: Contractvorm = answers.contract === 'Lease' ? 'lease' : 'koop'
  const leaseBudget = contractvorm === 'lease' && Number(answers.budget) > 0 ? Number(answers.budget) : null

  const filters = useMemo(
    () => dedupeFilters([...answersToFilters(answers), ...aiFilters])
      .filter((f) => !removedKeys.has(filterKey(f))),
    [answers, aiFilters, removedKeys],
  )

  useEffect(() => {
    if (!isDone) return
    const seq = ++rankSeq.current
    setSearching(true)
    rankCars(filters, rejected, 4, contractvorm, leaseBudget)
      .then((found) => {
        if (rankSeq.current !== seq) return
        setCars(found)
        setSearchError(false)
      })
      .catch(() => {
        if (rankSeq.current !== seq) return
        setSearchError(true)
      })
      .finally(() => {
        if (rankSeq.current === seq) setSearching(false)
      })
  }, [isDone, filters, rejected, contractvorm, leaseBudget])

  async function classifyBrief(message: string) {
    try {
      const result = await chatTurn(message, chatState, contractvorm)
      setChatState(result.state)
      setAiFilters(result.state.filters)
      setAiOffline(false)
    } catch {
      setAiOffline(true)
    }
  }

  // The chatbar only exists on first landing: it collapses away and the
  // deterministic question popup takes over.
  function leaveIntro(brief: string) {
    if (introLeaving) return
    if (brief) void classifyBrief(brief)
    setIntroLeaving(true)
    window.setTimeout(() => {
      setPhase('questions')
      setIntroLeaving(false)
    }, 380)
  }

  function pick(id: string, value: string) {
    const nextAnswers = { ...answers, [id]: value }
    setAnswers(nextAnswers)
    const nextStep = step + 1
    setStep(nextStep)
    if (nextStep >= QUESTIONS.length) setPhase('done')
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  function skip() {
    pick(question.id, '')
  }

  function reset() {
    setPhase('intro')
    setIntroLeaving(false)
    setStep(0)
    setAnswers({})
    setDraft('')
    setAwake(false)
    setAiFilters([])
    setRemovedKeys(new Set())
    setChatState(null)
    setAiOffline(false)
    setCars([])
    setRejected([])
    setSearchError(false)
  }

  function removeFilter(key: string) {
    setRemovedKeys((prev) => new Set(prev).add(key))
  }

  function clearLeaseBudget() {
    setAnswers((prev) => ({ ...prev, budget: '' }))
  }

  function rejectCar(id: string) {
    setRejected((prev) => [...prev, id])
  }

  function onIntroKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && draft.trim()) leaveIntro(draft.trim())
  }

  const current = cars[0]
  const alternatives = cars.slice(1)

  const doneTitle = searching && !current
    ? 'Searching…'
    : current
      ? `${current.merk} ${current.model} ${current.uitvoering}`
      : 'No car fits everything'
  const doneBody = current
    ? `This ${current.kleur.toLowerCase()} ${current.carrosserie.toLowerCase()} matches ${current.matched_preferences.length} of your preferences${current.is_alternatief ? ` — it's ${euro(current.budget_overschrijding)} over budget, the closest I could get` : ''}. Not the one? Reject it and I'll find another.`
    : searching
      ? 'Give me a second — lining up the best match.'
      : filters.length || leaseBudget
        ? 'Every card on the left is a hard requirement right now — remove one and I’ll look again.'
        : 'Nothing left to show. Reset to start over and bring rejected cars back.'

  const specs = current
    ? [
        [contractvorm === 'lease' ? 'Lease price' : 'Price',
          contractvorm === 'lease' && current.lease_klantprijs !== null
            ? `${euro(current.lease_klantprijs)} / month`
            : euro(current.aanschafprijs)],
        ['Fuel', current.brandstof],
        ['Gearbox', current.transmissie],
        ['Power', `${current.vermogen_pk} hp`],
        ['Seats · doors', `${current.zitplaatsen} · ${current.deuren}`],
        current.brandstof === 'Elektrisch'
          ? ['Range', `${current.actieradius_km} km`]
          : ['Consumption', current.verbruik_l_100km ? `${current.verbruik_l_100km} l/100km` : '—'],
        ['Boot', `${current.bagageruimte_liter} l`],
        ['Condition', `${current.conditie} (${current.bouwjaar})`],
      ]
    : []

  const showCriteria = isQuestions || isDone

  return (
    <div className="fmc">
      <div className="fmc-card">
        <div className="fmc-overlay-1" />
        <div className="fmc-overlay-2" />
        <div className="fmc-overlay-3" />

        <header className="fmc-header">
          <span className="fmc-brand">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2v-4l-2-5H5L3 13v4h2" />
              <path d="M5 17h14" />
              <circle cx="7.5" cy="17" r="2" />
              <circle cx="16.5" cy="17" r="2" />
            </svg>
            Find My Car
          </span>
          <button type="button" className="fmc-reset-btn" onClick={reset}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            Reset
          </button>
        </header>

        <main className="fmc-main">
          {showCriteria && (
            <section className="fmc-rail">
              <span className="fmc-filter-heading">Your criteria</span>
              {filters.length === 0 && !leaseBudget && (
                <span className="fmc-filter-empty">Nothing yet — answer the questions and they’ll appear here.</span>
              )}
              {leaseBudget !== null && (
                <div className="fmc-filter-card">
                  <span className="fmc-rail-text">
                    <span className="fmc-rail-title">Monthly budget</span>
                    <span className="fmc-rail-value filled">{`≤ ${euro(leaseBudget)} / month`}</span>
                  </span>
                  <button type="button" className="fmc-filter-remove" aria-label="Remove monthly budget" onClick={clearLeaseBudget}>
                    ×
                  </button>
                </div>
              )}
              {filters.map((f) => {
                const key = filterKey(f)
                const { label, value } = describeFilter(f)
                return (
                  <div key={key} className={`fmc-filter-card${f.importance === 'preferred' ? ' preferred' : ''}`}>
                    <span className="fmc-rail-text">
                      <span className="fmc-rail-title">
                        {label}
                        {f.importance === 'preferred' && <em> · preference</em>}
                      </span>
                      <span className="fmc-rail-value filled">{value}</span>
                    </span>
                    <button type="button" className="fmc-filter-remove" aria-label={`Remove ${label}`} onClick={() => removeFilter(key)}>
                      ×
                    </button>
                  </div>
                )
              })}
              {aiOffline && <span className="fmc-filter-empty">AI advisor is offline — matching on your answers only.</span>}
            </section>
          )}

          <section className="fmc-stage">
            <div className="fmc-stage-plate" />
            {isDone && current && <CarViewer spec={current.spec} />}
            {/* the mascotte stands beside the spotlight; the car gets the stage */}
            {!isQuestions && (
              <Mascotte
                state={isDone ? (current ? 'found' : 'thinking') : awake ? 'talking' : 'idle'}
                className="fmc-buddy"
              />
            )}
          </section>

          <section className="fmc-panel">
            <div className="fmc-bubble">
              <span className="fmc-bubble-kicker">
                {isDone ? (current ? 'Your match' : searching ? 'One moment' : 'No match') : 'Your car advisor'}
              </span>
              <span className="fmc-bubble-title">
                {isIntro ? 'Hey there!' : isQuestions ? 'Let’s find your car.' : doneTitle}
              </span>
              <span className="fmc-bubble-body">
                {isIntro
                  ? 'Tell me what you’re looking for in your own words — or jump straight in and I’ll ask you a few quick questions.'
                  : isQuestions
                    ? 'Answer the questions in the popup. Every answer becomes a card on the left that you can remove again.'
                    : doneBody}
              </span>
            </div>

            {isDone && searchError && (
              <div className="fmc-matches">
                <span className="fmc-filter-empty">Couldn’t reach the search server — is `uvicorn server.app:app` running?</span>
              </div>
            )}

            {isDone && current && (
              <div className="fmc-matches">
                <div className="fmc-match-card fmc-specs">
                  {specs.map(([label, value]) => (
                    <div key={label} className="fmc-match-row">
                      <span className="fmc-match-spec">{label}</span>
                      <span className="fmc-match-name">{value}</span>
                    </div>
                  ))}
                </div>
                <button type="button" className="fmc-reject-btn" onClick={() => rejectCar(current.id)}>
                  Not this one — find another
                </button>
                {alternatives.length > 0 && <span className="fmc-filter-heading">Up next</span>}
                {alternatives.map((car) => (
                  <div key={car.id} className="fmc-match-card">
                    <div className="fmc-match-row">
                      <span className="fmc-match-name">{`${car.merk} ${car.model} ${car.uitvoering}`}</span>
                      <span className="fmc-match-price">
                        {contractvorm === 'lease' && car.lease_klantprijs !== null
                          ? `${euro(car.lease_klantprijs)} /mo`
                          : euro(car.aanschafprijs)}
                      </span>
                    </div>
                    <span className="fmc-match-spec">
                      {[car.brandstof, car.transmissie, `${car.zitplaatsen} seats`, car.kleur].join('  ·  ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        {isQuestions && (
          <div className="fmc-popup-backdrop">
            <div className="fmc-popup" key={question.id}>
              <Mascotte state="thinking" className="fmc-popup-mascotte" />
              <span className="fmc-bubble-kicker">{`Question ${step + 1} of ${QUESTIONS.length}`}</span>
              <span className="fmc-popup-title">{question.title}</span>
              <span className="fmc-popup-body">{question.body}</span>

              {question.control === 'choice' && (
                <div className="fmc-options">
                  {question.options!.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className={`fmc-option-btn${answers[question.id] === label ? ' selected' : ''}`}
                      onClick={() => pick(question.id, label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {question.control === 'segmented' && (
                <div className="fmc-segmented">
                  {question.options!.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className={`fmc-segment${answers[question.id] === label ? ' selected' : ''}`}
                      onClick={() => pick(question.id, label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {question.control === 'slider' && (
                <SliderControl
                  config={question.slider!(answers)}
                  lease={contractvorm === 'lease'}
                  initial={answers[question.id] ?? ''}
                  onDone={(value) => pick(question.id, String(value))}
                />
              )}

              {question.control === 'dropdown' && (
                <select
                  className="fmc-select"
                  value={answers[question.id] ?? ''}
                  onChange={(e) => pick(question.id, e.target.value)}
                  autoFocus
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {question.options!.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              )}

              {question.control === 'text' && (
                <TextControl
                  placeholder={question.placeholder}
                  initial={answers[question.id] ?? ''}
                  onDone={(value) => pick(question.id, value)}
                />
              )}

              <div className="fmc-popup-footer">
                {step > 0 ? (
                  <button type="button" className="fmc-back-btn" onClick={back}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5" />
                      <path d="M11 18l-6-6 6-6" />
                    </svg>
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <span className="fmc-progress-track">
                  <span className="fmc-progress-fill" style={{ width: `${(step / QUESTIONS.length) * 100}%` }} />
                </span>
                {question.skippable ? (
                  <button type="button" className="fmc-skip-btn" onClick={skip}>
                    Skip
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>
        )}

        {isIntro && (
          <footer className="fmc-footer">
            <div className={`fmc-intro-row${introLeaving ? ' leaving' : ''}`}>
              <span className="fmc-intro-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
                  <path d="M18 16.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
                </svg>
              </span>
              <span className="fmc-intro-col">
                <input
                  className="fmc-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onIntroKeyDown}
                  onFocus={() => setAwake(true)}
                  placeholder="Describe the car you're looking for…"
                />
                <span className="fmc-examples">
                  {EXAMPLES.map((label) => (
                    <button key={label} type="button" className="fmc-example-btn" onClick={() => leaveIntro(label)}>
                      e.g. {label}
                    </button>
                  ))}
                  <button type="button" className="fmc-example-btn fmc-skip-intro" onClick={() => leaveIntro('')}>
                    Just ask me questions →
                  </button>
                </span>
              </span>
              <button
                type="button"
                className="fmc-submit-btn"
                onClick={() => draft.trim() && leaveIntro(draft.trim())}
                aria-label="Submit"
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="M6 11l6-6 6 6" />
                </svg>
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

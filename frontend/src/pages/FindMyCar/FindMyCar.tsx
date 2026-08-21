import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import './FindMyCar.css'
import { QUESTIONS, EXAMPLES } from './questions'
import {
  answersToFilters, chatTurn, describeFilter, filterKey, rankCars,
  type Car, type ChatState, type Contractvorm, type SearchFilter,
} from '../../lib/api'
import CarViewer from '../../components/CarViewer'

type Phase = 'intro' | 'flow' | 'done'
type Answers = Record<string, string>

const RAIL_FALLBACK = {
  body: 'Sedan, SUV, Hatchback…',
  budget: "What's your range?",
  fuel: 'Petrol, Diesel, Electric…',
  features: 'Tech, Safety, Comfort…',
  brand: 'Your preferred brands',
}

const RAIL_ITEMS: { facet: keyof typeof RAIL_FALLBACK; label: string; icon: ReactNode }[] = [
  {
    facet: 'body',
    label: 'Body type',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 17h2v-4l-2-5H5L3 13v4h2" />
        <path d="M5 17h14" />
        <circle cx="7.5" cy="17" r="2" />
        <circle cx="16.5" cy="17" r="2" />
      </svg>
    ),
  },
  {
    facet: 'budget',
    label: 'Budget',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20" />
        <path d="M16 6.5C16 5 14.2 4 12 4S8 5 8 6.8 9.6 9.4 12 10s4 1.6 4 3.4S14.2 16 12 16s-4-1-4-2.5" />
      </svg>
    ),
  },
  {
    facet: 'fuel',
    label: 'Fuel type',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18" />
        <path d="M3 12h10" />
        <path d="M16 8h3l2 3v8a2 2 0 0 1-4 0v-5h-1" />
      </svg>
    ),
  },
  {
    facet: 'features',
    label: 'Features',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
      </svg>
    ),
  },
  {
    facet: 'brand',
    label: 'Brand',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6z" />
      </svg>
    ),
  },
]

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

export default function FindMyCar() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [contractvorm, setContractvorm] = useState<Contractvorm | null>(null)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [draft, setDraft] = useState('')
  const [brief, setBrief] = useState('')

  // classifications: deterministic (from the button answers) + AI (from chat)
  const [aiFilters, setAiFilters] = useState<SearchFilter[]>([])
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [chatState, setChatState] = useState<ChatState | null>(null)
  const [aiQuestion, setAiQuestion] = useState<string | null>(null)
  const [aiOffline, setAiOffline] = useState(false)
  const [refineDraft, setRefineDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  // matching
  const [cars, setCars] = useState<Car[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const rankSeq = useRef(0)

  const question = QUESTIONS[Math.min(step, QUESTIONS.length - 1)]
  const isIntro = phase === 'intro'
  const isFlow = phase === 'flow'
  const isDone = phase === 'done'

  const filters = useMemo(
    () => dedupeFilters([...answersToFilters(answers), ...aiFilters])
      .filter((f) => !removedKeys.has(filterKey(f))),
    [answers, aiFilters, removedKeys],
  )

  useEffect(() => {
    if (!isDone) return
    const seq = ++rankSeq.current
    setSearching(true)
    rankCars(filters, rejected, 4, contractvorm ?? 'koop')
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
  }, [isDone, filters, rejected, contractvorm])

  async function sendToAi(message: string): Promise<boolean> {
    if (!message.trim() || chatBusy) return false
    setChatBusy(true)
    try {
      const result = await chatTurn(message.trim(), chatState, contractvorm ?? 'koop')
      setChatState(result.state)
      setAiFilters(result.state.filters)
      setAiQuestion(result.follow_up?.question ?? null)
      setAiOffline(false)
      return true
    } catch {
      setAiOffline(true)
      return false
    } finally {
      setChatBusy(false)
    }
  }

  function pick(id: string, value: string) {
    const nextAnswers = { ...answers, [id]: value }
    const nextStep = step + 1
    setAnswers(nextAnswers)
    setStep(nextStep)
    if (nextStep >= QUESTIONS.length) {
      setPhase('done')
      // best effort: let the backend AI classify the free-text brief too
      if (brief) void sendToAi(brief)
    } else {
      setPhase('flow')
    }
  }

  async function start(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !contractvorm) return
    setBrief(trimmed)
    setDraft(trimmed)
    setStep(0)
    // The model branch drives the conversation one free-text answer at a time.
    // Keep the deterministic button flow as a no-AI fallback.
    setPhase('done')
    const online = await sendToAi(trimmed)
    if (!online) setPhase('flow')
  }

  function back() {
    if (step === 0) {
      setPhase('intro')
      return
    }
    setStep(step - 1)
    setPhase('flow')
  }

  function skip() {
    pick(question.id, '')
  }

  function reset() {
    setPhase('intro')
    setContractvorm(null)
    setStep(0)
    setAnswers({})
    setDraft('')
    setBrief('')
    setAiFilters([])
    setRemovedKeys(new Set())
    setChatState(null)
    setAiQuestion(null)
    setCars([])
    setRejected([])
    setSearchError(false)
    setRefineDraft('')
  }

  function removeFilter(key: string) {
    setRemovedKeys((prev) => new Set(prev).add(key))
  }

  function rejectCar(id: string) {
    setRejected((prev) => [...prev, id])
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void start(draft)
  }

  function onRefineKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void sendToAi(refineDraft)
      setRefineDraft('')
    }
  }

  function facetValue(facet: keyof typeof RAIL_FALLBACK) {
    const values = QUESTIONS.filter((q) => q.facet === facet)
      .map((q) => answers[q.id])
      .filter(Boolean)
    return values.length ? values.join(' · ') : RAIL_FALLBACK[facet]
  }

  const current = cars[0]
  const alternatives = cars.slice(1)

  const bubbleKicker = isIntro ? 'Your car advisor' : isDone ? 'Your match' : question.kicker
  const bubbleTitle = isIntro
    ? contractvorm
      ? contractvorm === 'koop' ? 'Welke auto wil je kopen?' : 'Welke auto wil je leasen?'
      : 'Wil je kopen of leasen?'
    : isDone
      ? searching && !current
        ? 'Searching…'
        : current
          ? `${current.merk} ${current.model} ${current.uitvoering}`
          : 'Geen auto meer beschikbaar'
      : question.title
  const bubbleBody = isIntro
    ? contractvorm
      ? "Beschrijf wat voor auto je zoekt. Ik interpreteer je wensen en stel steeds één korte vervolgvraag."
      : 'Deze keuze bepaalt of ik op aanschafprijs of maandelijkse leaseprijs zoek.'
    : isDone
      ? aiQuestion
        ? aiQuestion
        : current
          ? `This ${current.kleur.toLowerCase()} ${current.carrosserie.toLowerCase()} matches ${current.matched_preferences.length} of your preferences${current.is_alternatief ? ` — it's €${current.budget_overschrijding.toLocaleString('nl-NL')} over budget, the closest I could get` : ''}. Not the one? Reject it and I'll find another.`
          : filters.length
            ? 'Er voldoet geen auto meer aan al je criteria. Verwijder één of meer filters aan de linkerkant; daarna zoek ik automatisch opnieuw.'
            : 'Er zijn geen auto’s meer beschikbaar. Reset de zoekopdracht om opnieuw te beginnen.'
      : question.body

  const progressLabel = `Question ${step + 1} of ${QUESTIONS.length}`
  const progressWidth = `${(step / QUESTIONS.length) * 100}%`

  const specs = current
    ? [
        [contractvorm === 'lease' ? 'Lease price' : 'Price', contractvorm === 'lease' && current.lease_klantprijs !== null ? `${euro(current.lease_klantprijs)} / month` : euro(current.aanschafprijs)],
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
          <span className="fmc-status">
            <span className="fmc-status-dot" />
            Online
          </span>
          <button type="button" className="fmc-reset-btn" onClick={reset}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            Reset
          </button>
          <button type="button" className="fmc-menu-btn" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </header>

        <main className="fmc-main">
          <section className="fmc-rail">
            {!isDone &&
              RAIL_ITEMS.map((item) => {
                const value = facetValue(item.facet)
                const filled = value !== RAIL_FALLBACK[item.facet]
                return (
                  <div key={item.facet} className="fmc-rail-item">
                    <span className="fmc-rail-icon">{item.icon}</span>
                    <span className="fmc-rail-text">
                      <span className="fmc-rail-title">{item.label}</span>
                      <span className={`fmc-rail-value${filled ? ' filled' : ''}`}>{value}</span>
                    </span>
                  </div>
                )
              })}

            {isDone && (
              <>
                <span className="fmc-filter-heading">Your criteria</span>
                {filters.length === 0 && <span className="fmc-filter-empty">No criteria — showing everything.</span>}
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
              </>
            )}
          </section>

          <section className="fmc-mascot-section">
            <div className="fmc-mascot-plate" />
            {isDone && current ? (
              <CarViewer spec={current.spec} />
            ) : (
              <div className="fmc-mascot-frame">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 17h2v-4l-2-5H5L3 13v4h2" />
                  <path d="M5 17h14" />
                  <circle cx="7.5" cy="17" r="2" />
                  <circle cx="16.5" cy="17" r="2" />
                </svg>
              </div>
            )}
          </section>

          <section className="fmc-panel">
            <div className="fmc-bubble">
              <span className="fmc-bubble-kicker">{bubbleKicker}</span>
              <span className="fmc-bubble-title">{bubbleTitle}</span>
              <span className="fmc-bubble-body">{bubbleBody}</span>
            </div>

            {isIntro && !contractvorm && (
              <div className="fmc-options">
                <button type="button" className="fmc-option-btn" onClick={() => setContractvorm('koop')}>
                  Kopen
                </button>
                <button type="button" className="fmc-option-btn" onClick={() => setContractvorm('lease')}>
                  Leasen
                </button>
              </div>
            )}

            {isFlow && (
              <div className="fmc-options">
                {question.options.map((label) => (
                  <button key={label} type="button" className="fmc-option-btn" onClick={() => pick(question.id, label)}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {isDone && searchError && (
              <div className="fmc-matches">
                <span className="fmc-filter-empty">Couldn’t reach the search server — is `uvicorn server.app:app` running?</span>
              </div>
            )}

            {isDone && !searching && !searchError && !current && (
              <div className="fmc-matches">
                <div className="fmc-match-card">
                  <span className="fmc-match-name">Geen passende auto gevonden</span>
                  <span className="fmc-match-spec">
                    {filters.length
                      ? 'Verwijder één of meer filters links om meer auto’s toe te laten.'
                      : 'Reset de zoekopdracht om afgewezen auto’s opnieuw mee te nemen.'}
                  </span>
                </div>
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
                <button type="button" className="fmc-see-all fmc-reject" onClick={() => rejectCar(current.id)}>
                  Not this one — find another
                </button>
                {alternatives.map((car) => (
                  <div key={car.id} className="fmc-match-card">
                    <div className="fmc-match-row">
                      <span className="fmc-match-name">{`${car.merk} ${car.model} ${car.uitvoering}`}</span>
                      <span className="fmc-match-price">
                        {contractvorm === 'lease' && car.lease_klantprijs !== null
                          ? `${euro(car.lease_klantprijs)} / month`
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

        <footer className="fmc-footer">
          <div className="fmc-footer-inner">
            {isIntro && contractvorm && (
              <div className="fmc-intro-row">
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
                    onKeyDown={onKeyDown}
                    placeholder="Describe the car you're looking for…"
                  />
                  <span className="fmc-examples">
                    {EXAMPLES.map((label) => (
                      <button key={label} type="button" className="fmc-example-btn" onClick={() => void start(label)}>
                        e.g. {label}
                      </button>
                    ))}
                  </span>
                </span>
                <button type="button" className="fmc-submit-btn" onClick={() => void start(draft)} aria-label="Submit">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5" />
                    <path d="M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
            )}

            {isFlow && (
              <div className="fmc-flow-row">
                <span className="fmc-progress-group">
                  <span className="fmc-progress-label">{progressLabel}</span>
                  <span className="fmc-progress-track">
                    <span className="fmc-progress-fill" style={{ width: progressWidth }} />
                  </span>
                </span>
                <span className="fmc-flow-actions">
                  <button type="button" className="fmc-back-btn" onClick={back}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5" />
                      <path d="M11 18l-6-6 6-6" />
                    </svg>
                    Back
                  </button>
                  <button type="button" className="fmc-skip-btn" onClick={skip}>
                    Skip
                  </button>
                </span>
              </div>
            )}

            {isDone && !aiOffline && (
              <div className="fmc-intro-row">
                <span className="fmc-intro-col">
                  <input
                    className="fmc-input"
                    value={refineDraft}
                    onChange={(e) => setRefineDraft(e.target.value)}
                    onKeyDown={onRefineKeyDown}
                    placeholder={chatBusy ? 'Thinking…' : aiQuestion ?? 'Tell me more, or answer my question…'}
                    disabled={chatBusy}
                  />
                </span>
                <button
                  type="button"
                  className="fmc-submit-btn"
                  onClick={() => {
                    void sendToAi(refineDraft)
                    setRefineDraft('')
                  }}
                  aria-label="Send"
                >
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5" />
                    <path d="M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

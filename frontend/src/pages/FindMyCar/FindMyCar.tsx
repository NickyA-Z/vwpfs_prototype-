import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './FindMyCar.css'
import { QUESTIONS, EXAMPLES, FIXED_QUESTION_COUNT, type Question, type SliderConfig } from './questions'
import {
  answersToFilters, chatTurn, describeFilter, fetchFields, fieldLabel, filterKey, rankCars,
  type Car, type ChatState, type Contractvorm, type FieldsMeta, type SearchFilter,
} from '../../lib/api'
import CarViewer from '../../components/CarViewer'
import Mascotte from '../../components/Mascotte'

type Phase = 'intro' | 'questions' | 'done'
type Answers = Record<string, string>
// fixed lease terms used by the deterministic pricing (advanced/lease_pricing.py)
const LEASE_TERMS = { months: 48, kmPerYear: '15.000 km' }
// how many follow-ups the AI advisor may ask before we show the match
const MAX_AI_QUESTIONS = 6

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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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

function TextControl({ placeholder, initial, numeric, onDone }: {
  placeholder?: string
  initial: string
  numeric: boolean
  onDone: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  const submit = () => onDone(value.trim())
  return (
    <div className="fmc-control">
      <input
        className="fmc-text-input"
        inputMode={numeric ? 'numeric' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(numeric ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
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
  const [brief, setBrief] = useState('')
  const [awake, setAwake] = useState(false)

  // the AI advisor: filter classifications plus its follow-up questions,
  // asked about whatever searchable labels are still missing
  const [aiFilters, setAiFilters] = useState<SearchFilter[]>([])
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [chatState, setChatState] = useState<ChatState | null>(null)
  const [aiQ, setAiQ] = useState<{ field: string; question: string } | null>(null)
  const [aiTurns, setAiTurns] = useState(0)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiOffline, setAiOffline] = useState(false)
  const [fieldsMeta, setFieldsMeta] = useState<FieldsMeta | null>(null)

  // matching
  const [cars, setCars] = useState<Car[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const rankSeq = useRef(0)

  const isIntro = phase === 'intro'
  const isQuestions = phase === 'questions'
  const isDone = phase === 'done'

  const contractvorm: Contractvorm = answers.contract === 'Lease' ? 'lease' : 'koop'
  const leaseBudget = contractvorm === 'lease' && Number(answers.budget) > 0 ? Number(answers.budget) : null

  useEffect(() => {
    fetchFields().then(setFieldsMeta).catch(() => {})
  }, [])

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

  function applyAiResult(result: Awaited<ReturnType<typeof chatTurn>>, turns: number) {
    setChatState(result.state)
    setAiFilters(result.state.filters)
    setAiOffline(false)
    if (result.follow_up && !result.complete && turns < MAX_AI_QUESTIONS) {
      setAiQ(result.follow_up)
    } else {
      setAiQ(null)
      setPhase('done')
    }
  }

  // Kick off the AI advisor once the fixed questions (contract, budget) are
  // answered: the free-text brief (or a neutral opener) is its first turn.
  async function startAi(answersNow: Answers) {
    setAiBusy(true)
    try {
      const cv: Contractvorm = answersNow.contract === 'Lease' ? 'lease' : 'koop'
      const budget = Number(answersNow.budget) > 0 ? Number(answersNow.budget) : null
      // seed the conversation so the AI won't re-ask what the slider answered
      const seed: ChatState | null = cv === 'koop' && budget
        ? {
            filters: [{ field: 'aanschafprijs', operator: 'max', value: budget, importance: 'required' }],
            answered_fields: ['aanschafprijs'],
            follow_up: null,
          }
        : null
      const result = await chatTurn(
        brief || 'Ik zoek een auto.',
        seed,
        cv,
        cv === 'lease' && budget ? budget : undefined,
      )
      applyAiResult(result, 0)
    } catch {
      setAiOffline(true) // the hardcoded question list takes over
    } finally {
      setAiBusy(false)
    }
  }

  async function answerAi(message: string) {
    if (aiBusy) return
    setAiBusy(true)
    setAiQ(null)
    try {
      const result = await chatTurn(message, chatState, contractvorm, leaseBudget ?? undefined)
      const turns = aiTurns + 1
      setAiTurns(turns)
      applyAiResult(result, turns)
    } catch {
      setAiOffline(true) // continue with the hardcoded questions instead
    } finally {
      setAiBusy(false)
    }
  }

  // The chatbar only exists on first landing: it collapses away and the
  // question popup takes over.
  function leaveIntro(text: string) {
    if (introLeaving) return
    setBrief(text)
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
    if (nextStep === FIXED_QUESTION_COUNT && !aiOffline) {
      void startAi(nextAnswers)
      return
    }
    if (nextStep >= QUESTIONS.length) setPhase('done')
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  function reset() {
    setPhase('intro')
    setIntroLeaving(false)
    setStep(0)
    setAnswers({})
    setDraft('')
    setBrief('')
    setAwake(false)
    setAiFilters([])
    setRemovedKeys(new Set())
    setChatState(null)
    setAiQ(null)
    setAiTurns(0)
    setAiBusy(false)
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

  // What the popup shows right now: an AI follow-up about a missing label
  // (control picked from the field's type and stock values), or the next
  // hardcoded question (the fixed lead-ins, and the whole list as fallback).
  type ActiveQuestion = {
    id: string
    title: string
    body: string
    control: Question['control']
    options?: string[]
    slider?: SliderConfig
    placeholder?: string
    skippable: boolean
    ai: boolean
  }

  const activeQuestion: ActiveQuestion | null = (() => {
    if (!isQuestions) return null
    if (aiQ) {
      const meta = fieldsMeta?.[aiQ.field]
      const base = { id: aiQ.field, title: capitalize(fieldLabel(aiQ.field)), body: aiQ.question, skippable: true, ai: true }
      if (meta?.type === 'boolean') return { ...base, control: 'segmented', options: ['Yes', 'No'] }
      const options = meta?.values?.map(String)
      if (options?.length) {
        if (options.length <= 2) return { ...base, control: 'segmented', options }
        if (options.length <= 6) return { ...base, control: 'choice', options }
        return { ...base, control: 'dropdown', options }
      }
      return { ...base, control: 'text', placeholder: meta?.type === 'number' ? 'e.g. 50000' : 'Type your answer…' }
    }
    const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)]
    return {
      id: q.id, title: q.title, body: q.body, control: q.control,
      options: q.options, slider: q.slider?.(answers), placeholder: q.placeholder,
      skippable: q.skippable, ai: false,
    }
  })()

  // waiting for the AI's next follow-up (no hardcoded question should show)
  const aiPending = isQuestions && aiBusy && !aiQ

  function submitAnswer(value: string) {
    if (!activeQuestion) return
    if (activeQuestion.ai) {
      const field = activeQuestion.id
      const answer = value === 'Yes' ? 'ja' : value === 'No' ? 'nee' : value
      void answerAi(answer ? `${field}: ${answer}` : `${field} maakt niet uit`)
    } else {
      pick(activeQuestion.id, value)
    }
  }

  const questionNumber = aiQ || aiPending ? FIXED_QUESTION_COUNT + aiTurns + 1 : step + 1
  const totalQuestions = aiQ || aiPending ? FIXED_QUESTION_COUNT + MAX_AI_QUESTIONS : QUESTIONS.length

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
              {contractvorm === 'lease' && (
                <div className="fmc-filter-card preferred">
                  <span className="fmc-rail-text">
                    <span className="fmc-rail-title">Lease terms</span>
                    <span className="fmc-rail-value filled">{`${LEASE_TERMS.months} months · ${LEASE_TERMS.kmPerYear}/yr`}</span>
                  </span>
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

        {isQuestions && (activeQuestion || aiPending) && (
          <div className="fmc-popup-backdrop">
            <div className="fmc-popup" key={aiPending ? 'ai-pending' : activeQuestion!.id}>
              <Mascotte state="thinking" className="fmc-popup-mascotte" />
              <span className="fmc-bubble-kicker">{`Question ${questionNumber} of ${totalQuestions}`}</span>

              {aiPending ? (
                <>
                  <span className="fmc-popup-title">Hmm…</span>
                  <span className="fmc-popup-body">Let me think about what to ask you next.</span>
                </>
              ) : (
                <>
                  <span className="fmc-popup-title">{activeQuestion!.title}</span>
                  <span className="fmc-popup-body">{activeQuestion!.body}</span>

                  {activeQuestion!.control === 'choice' && (
                    <div className="fmc-options">
                      {activeQuestion!.options!.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className={`fmc-option-btn${answers[activeQuestion!.id] === label ? ' selected' : ''}`}
                          onClick={() => submitAnswer(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeQuestion!.control === 'segmented' && (
                    <div className="fmc-segmented">
                      {activeQuestion!.options!.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className={`fmc-segment${answers[activeQuestion!.id] === label ? ' selected' : ''}`}
                          onClick={() => submitAnswer(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeQuestion!.control === 'slider' && (
                    <SliderControl
                      config={activeQuestion!.slider!}
                      lease={contractvorm === 'lease'}
                      initial={answers[activeQuestion!.id] ?? ''}
                      onDone={(value) => submitAnswer(String(value))}
                    />
                  )}

                  {activeQuestion!.control === 'dropdown' && (
                    <select
                      className="fmc-select"
                      value={answers[activeQuestion!.id] ?? ''}
                      onChange={(e) => submitAnswer(e.target.value)}
                      autoFocus
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {activeQuestion!.options!.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}

                  {activeQuestion!.control === 'text' && (
                    <TextControl
                      placeholder={activeQuestion!.placeholder}
                      initial={answers[activeQuestion!.id] ?? ''}
                      numeric={!activeQuestion!.ai || fieldsMeta?.[activeQuestion!.id]?.type === 'number'}
                      onDone={(value) => submitAnswer(value)}
                    />
                  )}
                </>
              )}

              <div className="fmc-popup-footer">
                {!aiPending && !activeQuestion!.ai && step > 0 ? (
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
                  <span className="fmc-progress-fill" style={{ width: `${((questionNumber - 1) / totalQuestions) * 100}%` }} />
                </span>
                {!aiPending && activeQuestion!.skippable ? (
                  <button type="button" className="fmc-skip-btn" onClick={() => submitAnswer('')}>
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

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import './FindMyCar.css'
import { QUESTIONS, EXAMPLES, computeMatches } from './questions'

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

export default function FindMyCar() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [draft, setDraft] = useState('')
  const [brief, setBrief] = useState('')

  const question = QUESTIONS[Math.min(step, QUESTIONS.length - 1)]
  const isIntro = phase === 'intro'
  const isFlow = phase === 'flow'
  const isDone = phase === 'done'

  function pick(id: string, value: string) {
    const nextAnswers = { ...answers, [id]: value }
    const nextStep = step + 1
    setAnswers(nextAnswers)
    setStep(nextStep)
    setPhase(nextStep >= QUESTIONS.length ? 'done' : 'flow')
  }

  function start(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setBrief(trimmed)
    setDraft(trimmed)
    setPhase('flow')
    setStep(0)
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
    setStep(0)
    setAnswers({})
    setDraft('')
    setBrief('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') start(draft)
  }

  function facetValue(facet: keyof typeof RAIL_FALLBACK) {
    const values = QUESTIONS.filter((q) => q.facet === facet)
      .map((q) => answers[q.id])
      .filter(Boolean)
    return values.length ? values.join(' · ') : RAIL_FALLBACK[facet]
  }

  const bubbleKicker = isIntro ? 'Your car advisor' : isDone ? 'Result' : question.kicker
  const bubbleTitle = isIntro ? 'Hey there!' : isDone ? 'Three to drive.' : question.title
  const bubbleBody = isIntro
    ? "Tell me what kind of car you're looking for and I'll help you find it — after that it's all buttons."
    : isDone
      ? `Based on “${brief || 'your brief'}” and your eight answers, these fit best.`
      : question.body

  const progressLabel = `Question ${step + 1} of ${QUESTIONS.length}`
  const progressWidth = `${(step / QUESTIONS.length) * 100}%`

  const matches = isDone ? computeMatches(answers) : []

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
            {RAIL_ITEMS.map((item) => {
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
          </section>

          <section className="fmc-mascot-section">
            <div className="fmc-mascot-plate" />
            <div className="fmc-mascot-frame">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 17h2v-4l-2-5H5L3 13v4h2" />
                <path d="M5 17h14" />
                <circle cx="7.5" cy="17" r="2" />
                <circle cx="16.5" cy="17" r="2" />
              </svg>
            </div>
          </section>

          <section className="fmc-panel">
            <div className="fmc-bubble">
              <span className="fmc-bubble-kicker">{bubbleKicker}</span>
              <span className="fmc-bubble-title">{bubbleTitle}</span>
              <span className="fmc-bubble-body">{bubbleBody}</span>
            </div>

            {isFlow && (
              <div className="fmc-options">
                {question.options.map((label) => (
                  <button key={label} type="button" className="fmc-option-btn" onClick={() => pick(question.id, label)}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {isDone && (
              <div className="fmc-matches">
                {matches.map((m) => (
                  <div key={m.name} className="fmc-match-card">
                    <div className="fmc-match-row">
                      <span className="fmc-match-name">{m.name}</span>
                      <span className="fmc-match-price">{m.price}</span>
                    </div>
                    <span className="fmc-match-spec">{m.spec}</span>
                  </div>
                ))}
                <button type="button" className="fmc-see-all">
                  See all matches
                </button>
              </div>
            )}
          </section>
        </main>

        <footer className="fmc-footer">
          <div className="fmc-footer-inner">
            {isIntro && (
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
                      <button key={label} type="button" className="fmc-example-btn" onClick={() => start(label)}>
                        e.g. {label}
                      </button>
                    ))}
                  </span>
                </span>
                <button type="button" className="fmc-submit-btn" onClick={() => start(draft)} aria-label="Submit">
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
          </div>
        </footer>
      </div>
    </div>
  )
}

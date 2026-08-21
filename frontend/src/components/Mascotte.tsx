import idle from '../../../assets/assistant/idle.png'
import talking from '../../../assets/assistant/default.png'
import thinking from '../../../assets/assistant/thinking.png'
import found from '../../../assets/assistant/found.png'

export type MascotteState = 'idle' | 'talking' | 'thinking' | 'found'

const IMAGES: Record<MascotteState, string> = { idle, talking, thinking, found }

export default function Mascotte({ state, className }: { state: MascotteState; className?: string }) {
  return (
    <img
      src={IMAGES[state]}
      alt={`Mascotte (${state})`}
      draggable={false}
      className={`fmc-mascotte is-${state}${className ? ` ${className}` : ''}`}
    />
  )
}

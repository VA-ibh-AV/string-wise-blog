/**
 * Renders a string from src/portfolio.js, flagging anything still marked TODO.
 *
 * Placeholder copy is going to be live on the site until it is replaced, so it
 * should be impossible to miss rather than blend into the prose.
 */
export default function Copy({ children }) {
  const text = String(children ?? '')
  return text.startsWith('TODO') ? <span className="pf-todo">{text}</span> : <>{text}</>
}

/** True when a value is missing or still a placeholder — use it to skip a row. */
export function isTodo(value) {
  return value == null || String(value).startsWith('TODO')
}

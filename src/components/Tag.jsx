export default function Tag({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">
      {children}
    </span>
  )
}

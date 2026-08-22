import Copy from './Copy'
import Section from './Section'
import { now } from '../../portfolio'

/** "What has my attention this month" — the section that dates fastest. */
export default function NowBlock() {
  return (
    <Section id="now" index={1} title="Now" lede={<Copy>{now.headline}</Copy>}>
      <div className="now-list">
        {now.items.map((item, i) => (
          <p className="now-item" key={i}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <Copy>{item}</Copy>
          </p>
        ))}
      </div>
    </Section>
  )
}

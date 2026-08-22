import Copy from './Copy'
import Section from './Section'
import Tag from '../Tag'
import { skills } from '../../portfolio'

/**
 * Grouped stack. Deliberately no proficiency bars — a percentage on "Go" is a
 * claim nobody can check and everybody discounts.
 */
export default function SkillGrid() {
  const total = skills.reduce((n, g) => n + g.items.length, 0)

  return (
    <Section id="skills" index={2} title="Stack" count={`${total} things`}
             lede="What I reach for, grouped by the layer it lives at.">
      <div className="skill-groups">
        {skills.map(group => (
          <div className="skill-group" key={group.group}>
            <h3>{group.group}</h3>
            <div className="skill-items">
              {group.items.map((item, i) => (
                <Tag key={`${item}-${i}`}><Copy>{item}</Copy></Tag>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

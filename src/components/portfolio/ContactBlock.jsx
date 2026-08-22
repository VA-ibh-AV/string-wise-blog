import Section from './Section'
import { contact, profile } from '../../portfolio'

/**
 * Contact links. Anything still null in src/portfolio.js is simply not rendered,
 * so the section degrades to whatever is actually set rather than showing a
 * broken mailto: or an empty GitHub link.
 */
export default function ContactBlock() {
  const links = [
    contact.email    && { label: 'email',    value: contact.email.replace(/^mailto:/, ''), href: `mailto:${contact.email}` },
    contact.github   && { label: 'github',   value: contact.github.replace(/^https?:\/\//, ''), href: contact.github },
    contact.linkedin && { label: 'linkedin', value: 'in/vaibhav-bhardwaj', href: contact.linkedin },
  ].filter(Boolean)

  return (
    <Section id="contact" index={6} title="Contact"
             lede="Happy to talk about distributed systems, storage internals, or anything in the posts above.">
      <div className="contact-grid">
        {links.map(link => (
          <a
            key={link.label}
            className="contact-link"
            href={link.href}
            {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <span>{link.label}</span>
            {link.value}
          </a>
        ))}
      </div>

      <p className="contact-note">
        Written by {profile.name}. Everything here is my own opinion, not my employer&rsquo;s.
      </p>
    </Section>
  )
}

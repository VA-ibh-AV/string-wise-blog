import registry from '../registry'
import PostCard from '../components/PostCard'
import Hero from '../components/portfolio/Hero'
import NowBlock from '../components/portfolio/NowBlock'
import SkillGrid from '../components/portfolio/SkillGrid'
import ExperienceTimeline from '../components/portfolio/ExperienceTimeline'
import ProjectGrid from '../components/portfolio/ProjectGrid'
import ContactBlock from '../components/portfolio/ContactBlock'
import Section from '../components/portfolio/Section'

/**
 * The whole portfolio is one page.
 *
 * Deliberately: `allRoutes` in seo.js is derived from the post registry, so
 * only `/` and `/<post-slug>` are ever prerendered — and nginx.conf has no SPA
 * fallback. A separate /about or /work route would 404 on a hard refresh in
 * production while working fine in dev. Sections with anchors avoid all of it.
 */
export default function Home() {
  return (
    <div className="home-page">
      <Hero />
      <NowBlock />
      <SkillGrid />
      <ExperienceTimeline />
      <ProjectGrid />

      <Section
        id="writing"
        index={5}
        title="Writing"
        count={`${registry.length} entries`}
        lede="Long-form pieces on how systems actually behave, each with interactive visualizers you can break on purpose."
      >
        <div className="post-grid">
          {registry.map((post, i) => <PostCard key={post.slug} post={post} index={i} />)}
        </div>
      </Section>

      <ContactBlock />
    </div>
  )
}

import Link from "next/link";
import { PublicShell } from "./PublicShell";
import styles from "./PublicSite.module.css";

const STEPS = [
  ["Save your next favorite.", "Import recipes with AI or discover dishes shared by other cooks. Keep them together in your recipe library.", "SAVE RECIPES"],
  ["Plan your meals.", "Choose what you want to cook and organize your week in one place.", "PLAN YOUR WEEK"],
  ["Shop for what you need.", "Turn your meal plan into a grocery list and find products for the ingredients you need.", "BUY GROCERIES"],
  ["Cook with confidence.", "Follow guided tutorials and keep track of each step as you make your dish.", "GUIDED COOKING"],
];

export function HomePage() {
  return (
    <PublicShell>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <h1 id="home-title">A little closer<br />to <em>home.</em></h1>
            <p className={styles.heroIntro}>Save recipes, plan meals, simplify grocery shopping, and cook with step-by-step guidance.</p>
            <Link href="/library" className={styles.primaryLink}>Open app</Link>
          </div>
          <figure className={styles.menuFigure}>
            <img
              className={styles.dinnerPhoto}
              src="/brand/editorial-dinner.png"
              width={1448}
              height={1086}
              alt="Mapo tofu served with steamed rice and stir-fried greens"
              fetchPriority="high"
            />
            <figcaption className={styles.menuCaption}>
              <div className={styles.menuCaptionTitle}>
                <h2>Comfort on the menu.</h2>
                <div className={styles.dishTitle}>Mapo tofu</div>
                <p className={styles.menuSides}>Steamed rice · Stir-fried greens</p>
              </div>
              <ol className={styles.mealJourney} aria-label="From recipe to dinner">
                {["Save a recipe", "Plan a meal", "Buy groceries", "Cook with guidance"].map((step, i) => <li key={step}><span>0{i + 1}</span>{step}</li>)}
              </ol>
            </figcaption>
          </figure>
        </section>
        <section className={styles.howItWorks} aria-labelledby="works-title">
          <p className={styles.eyebrow}>FROM INSPIRATION TO DINNER</p>
          <h2 id="works-title">Less juggling. More cooking.</h2>
          <ol className={styles.steps}>
            {STEPS.map(([title, description, label], i) => (
              <li key={label}>
                <span className={styles.stepNumber}>0{i + 1}</span>
                <div><p className={styles.stepLabel}>{label}</p><h3>{title}</h3><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.partnership} aria-labelledby="partner-title">
          <div><p className={styles.eyebrow}>PARTNERSHIPS</p><h2 id="partner-title">Let’s work together.</h2></div>
          <p>We welcome ideas from creators, brands, retailers, and anyone who shares a love of cooking.</p>
          <Link href="/contact" className={styles.lightLink}>Get in touch</Link>
        </section>
      </main>
    </PublicShell>
  );
}

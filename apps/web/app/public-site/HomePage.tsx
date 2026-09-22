import Link from "next/link";
import { PublicShell } from "./PublicShell";
import styles from "./PublicSite.module.css";

const STEPS = [
  ["Save your next favorite.", "Import recipes with AI or discover dishes shared by other cooks. Keep them together in your recipe library.", "SAVE RECIPES"],
  ["Plan your meals.", "Choose what you want to cook and organize your week in one place.", "PLAN YOUR WEEK"],
  ["Shop for what you need.", "Turn your meal plan into a grocery list and find products for the ingredients you need.", "BUY GROCERIES"],
  ["Cook with confidence.", "Follow guided tutorials and keep track of each step as you make your dish.", "GUIDED COOKING"],
];

function DinnerIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 440 270" className={styles.dinnerArt} fill="none">
      <ellipse cx="204" cy="224" rx="143" ry="18" fill="#31443b" opacity=".13" />
      <path d="M58 132c10 74 48 104 145 104s135-30 145-104" fill="#f4eddf" stroke="#c6c9b7" strokeWidth="3" />
      <ellipse cx="203" cy="131" rx="147" ry="78" fill="#faf5ea" stroke="#c6c9b7" strokeWidth="3" />
      <ellipse cx="203" cy="132" rx="131" ry="62" fill="#a64830" />
      <ellipse cx="203" cy="131" rx="118" ry="51" fill="#bd5c39" />
      <g fill="#ebba70" stroke="#f4cf8f" strokeWidth="3" strokeLinejoin="round">
        <path d="m99 115 33-13 28 17-35 15z" /><path d="m132 143 35-14 28 16-34 15z" />
        <path d="m165 99 30-11 29 16-33 14z" /><path d="m199 139 34-12 27 16-34 15z" />
        <path d="m238 108 32-12 29 17-34 16z" /><path d="m245 164 29-12 26 13-31 15z" />
        <path d="m287 140 23-11 18 11-25 13z" /><path d="m168 172 26-10 24 13-27 12z" />
      </g>
      <g stroke="#40634a" strokeWidth="6" strokeLinecap="round">
        <path d="m148 116 7-5m64 10 9-2m-50 22 8-3m58-9 8 3m-54 28 7-4m-87-11 6-2m144-29 8 2" />
      </g>
      <g fill="#743b2d"><circle cx="155" cy="99" r="3" /><circle cx="217" cy="165" r="4" /><circle cx="281" cy="156" r="3" /><circle cx="188" cy="125" r="3" /><circle cx="243" cy="90" r="3" /></g>
      <path d="m320 190 90-139m-77 147 80-135" stroke="#654b38" strokeWidth="7" strokeLinecap="round" />
      <path d="M184 55c-13-17 12-21 0-38m35 32c-13-17 12-21 0-38" stroke="#faf5ea" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

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
          <figure className={styles.menuFigure} aria-label="Mapo tofu, from recipe to dinner">
            <div className={styles.menuCard}>
              <h2>Comfort on the menu.</h2>
              <DinnerIllustration />
              <div className={styles.dishTitle}>Mapo tofu</div>
              <p className={styles.menuSides}>Steamed rice · Stir-fried greens</p>
              <ol className={styles.mealJourney} aria-label="From recipe to dinner">
                {["Save a recipe", "Plan a meal", "Buy groceries", "Cook with guidance"].map((step, i) => <li key={step}><span>0{i + 1}</span>{step}</li>)}
              </ol>
            </div>
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

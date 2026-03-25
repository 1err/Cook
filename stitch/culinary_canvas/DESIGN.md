# Design System Strategy: The Culinary Editorial

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Sous-Chef."** 

We are moving away from the cluttered, utility-first look of traditional recipe apps. Instead, we are building a high-end editorial experience that feels like a premium coffee-table cookbook brought to life. The system rejects the "app-in-a-box" aesthetic in favor of **Organic Sophistication**. 

By utilizing intentional asymmetry—such as oversized imagery paired with tight, functional typography—and a refusal to use standard dividers, we create an environment that is calm, organized, and unmistakably premium. We treat white space as a functional ingredient, not a void.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a "Warm Minimalist" foundation, utilizing earthy neutrals and a sophisticated terracotta accent (`primary: #9a442d`) that evokes the warmth of a preheated oven or aged ceramic.

### The "No-Line" Rule
To maintain a high-end feel, **1px solid borders are strictly prohibited** for sectioning. Boundaries must be defined through:
*   **Background Shifts:** Transitioning from `surface` (#faf9f8) to `surface-container-low` (#f4f3f2).
*   **Tonal Nesting:** Placing a `surface-container-lowest` (pure white) card on a `surface-container` (#eeeeed) background to create definition.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. 
*   **Base:** `surface` (#faf9f8)
*   **Secondary Content:** `surface-container-low` (#f4f3f2)
*   **Interactive Cards:** `surface-container-lowest` (#ffffff)
*   **Overlays/Modals:** `surface-bright` (#faf9f8) with a 24px backdrop blur.

### The "Glass & Gradient" Rule
For floating elements (like a "Start Cooking" FAB), use Glassmorphism. Apply `surface` at 80% opacity with a `backdrop-filter: blur(20px)`. To add "soul," use a subtle linear gradient on primary CTAs: `primary` (#9a442d) to `primary-container` (#e07a5f) at a 135-degree angle.

---

## 3. Typography: The Editorial Voice
We utilize a dual-font strategy to balance character with utility.

*   **Display & Headlines (Manrope):** Chosen for its modern, geometric construction. Use `display-lg` (3.5rem) for hero recipe titles to create an authoritative, editorial impact.
*   **Body & UI (Inter):** The workhorse. Inter provides the functional clarity of Notion. Use `body-md` (0.875rem) for ingredient lists and instructions to ensure maximum legibility during active cooking.

**Hierarchy Tip:** Always pair a `headline-sm` in `on-surface` (#1a1c1c) with a `label-md` in `on-surface-variant` (#55423e) to create a clear "Title/Subtitle" relationship without needing lines.

---

## 4. Elevation & Depth
In this system, depth is felt, not seen. We favor **Tonal Layering** over heavy shadows.

*   **The Layering Principle:** To lift a recipe card, do not reach for a shadow first. Instead, place a `#ffffff` (`surface-container-lowest`) card on a `#f4f3f2` (`surface-container-low`) background.
*   **Ambient Shadows:** If a shadow is required (e.g., for a floating navigation bar), use a "Kitchen Glow": `0px 12px 32px rgba(26, 28, 28, 0.04)`. The shadow color is a tint of our `on-surface` (#1a1c1c), mimicking natural light.
*   **The Ghost Border:** For accessibility in high-glare environments (like a bright kitchen), use the `outline-variant` (#dbc1ba) at **15% opacity**. This provides a hint of structure without breaking the minimal aesthetic.

---

## 5. Components

### Buttons
*   **Primary:** Background: `primary` gradient; Text: `on-primary` (#ffffff); Radius: `lg` (1rem).
*   **Secondary:** Background: `secondary-container` (#dcddff); Text: `on-secondary-container` (#5e617d); Radius: `lg`.
*   **States:** On hover, shift elevation from Tonal Layering to a subtle Ambient Shadow.

### Cards & Lists (The "No-Divider" Rule)
*   **Forbid dividers.** To separate ingredients or recipe steps, use the Spacing Scale.
*   **Ingredient Item:** Use `3` (1rem) vertical padding. Group items within a `surface-container-lowest` wrapper.
*   **Recipe Card:** Use `xl` (1.5rem) corner radius. Imagery should be full-bleed at the top with a subtle 4% inner glow to prevent washing out against light backgrounds.

### Input Fields
*   **Styling:** No bottom line. Use `surface-container-high` (#e9e8e7) as the fill color with an `xl` (1.5rem) corner radius.
*   **Focus:** Transition the background to `surface-container-lowest` and apply a 1px "Ghost Border" using `primary` at 20% opacity.

### Specific Culinary Components
*   **Step Progress Bar:** Use a thick `3` (1rem) height bar in `surface-container-highest` with a `primary` fill.
*   **The "Prep Timer" Chip:** A glassmorphic pill using `tertiary-container` (#19a992) at 20% opacity to highlight active time-sensitive info.

---

## 6. Do's and Don'ts

### Do:
*   **Use Asymmetry:** Offset a recipe title to the left while keeping the calorie count `label-sm` tucked into the bottom right of a card.
*   **Embrace White Space:** If you think a section needs more breathing room, add `8` (2.75rem) from the Spacing Scale.
*   **Use Tonal Shifts:** Use `surface-dim` (#dadad9) for footer areas to create a grounded conclusion to a long recipe scroll.

### Don't:
*   **Don't use 1px dividers.** Ever. Use whitespace or a subtle shift from `surface` to `surface-container-low`.
*   **Don't use pure black.** Always use `on-surface` (#1a1c1c) for text to maintain the soft, premium feel.
*   **Don't use sharp corners.** Everything must have at least a `DEFAULT` (0.5rem) radius to keep the "Calm" brand pillar intact.
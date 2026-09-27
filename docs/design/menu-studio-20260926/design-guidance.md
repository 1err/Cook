# Chef World menu studio: visual direction

These are authored design concepts, not screenshots of implemented or deployed software. The two PNGs were generated with the built-in image generation tool from the user's supplied menu references. They contain sample dishes solely to show composition. Production menus retain the user's selected recipes and editable text, with actual owned recipe photographs or user-supplied images.

- `menu-direction-board.png`: three distinct finished menu compositions.
- `menu-editor-concept.png`: studio interface composition showing independent design and per-dish controls.

## Intent

A menu should feel like a small restaurant's own printed object. Food imagery, section grouping, whitespace, lettering, paper and illustration work together. Changing the design must change composition as well as palette. Keep the three starting layouts flexible; do not introduce a one-layout-per-color system.

## Layouts

| Layout | Composition | Page density | Distinctive detail |
| --- | --- | --- | --- |
| Photo catalog | Large expressive title; 2 or 3 columns; image above dish label | 6 dishes on an airy portrait page, 9 compact; paginate rather than shrinking | Plate/circle, rounded photograph or sticker image treatment; optional short caption |
| Category board | Uneven category panels grouped into 2 or 3 columns; short editable section names | Density set by measured line height, with category continuation on another page | Apricot, butter, sage and coral sections; small occasional image/sticker, handwritten or serif headers |
| Illustrated list | Image gutter at left, prominent dish name and short description at right | 5 or 6 generous rows; fewer when descriptions wrap | Dotted rules, small ribbon category headings, editorial hierarchy |

Reference dimensions for a 720 × 1018 portrait preview: 40–48 px outer margin, 20–28 px column gap, 150–170 px wide dish images in a three-column catalog, 22–26 px dish names, 13–15 px captions, 44–58 px title. These are design proportions, not a requirement to hardcode pixel sizes instead of measuring text.

## Palettes

- Warm bakery: paper `#FBF3E4`, ink `#432C21`, accent `#B77046`.
- Pastel board: paper `#FFFCF3`, ink `#342C24`, apricot `#F6D8A2`, butter `#F5EDAD`, sage `#DEE8BE`, coral `#E7A28D`.
- Little kitchen: paper `#F9EDDA`, ink `#452C22`, terracotta `#B95936`, olive `#637C4F`.

Paper, ink and accent remain independently editable. Validate enough contrast for menu text; decoration may be lighter because it does not convey essential content.

## Editor composition

A calm top toolbar contains document name, Preview and Download. The left design inspector starts with a natural-language brief and Design with AI, followed by layout thumbnails, colors, typography and finishing controls. The central canvas is the actual paginated menu. Selecting a dish opens a compact inspector for its name, description, section, image and order. A page selector belongs below the canvas, never inside the exported menu.

At desktop widths, use a 280–310 px design column, flexible canvas, and an optional 240–270 px selected-dish inspector. On phones, place the preview first with Design / Dishes tabs opening a bottom sheet or stacked controls. Keep a direct path from a changed control to a visible preview.

Controls should be independently meaningful:

- Layout: photo catalog / category board / illustrated list.
- Columns: 2 / 3 where supported; do not show an inert option.
- Density: airy / compact.
- Typography: distinct, locally available type treatments with the same export font available as the preview.
- Image treatment: plate / rounded / sticker. Never imply background removal occurred when only CSS masking occurred.
- Colors: paper / ink / accent.
- Descriptions: show / hide.
- Decorations: none / subtle / playful, or equivalent supported levels.
- Editable category names, dish order and dish images.

## AI design behavior

A natural-language brief suggests a validated composition and color/type/spacing settings; users can change those settings afterward. It must preserve selected recipe identities, exact dish names, descriptions already edited by the user, and the current menu admission session. The existing one-new-menu-per-UTC-day rule stays in effect for non-admins; editing, retries and exports within that admission do not create another menu.

Recipe imagery is actual library imagery. Decorative AI art can add paper texture, utensils, herbs, doodles and original mascots. Do not manufacture a photo that is presented as the user's dish. If an item has no image, use an intentional text-only layout or prompt to add a photo, rather than a stock photograph of another meal.

Implemented art placement contract (816 × 1056 renderer units):

- Header: a full-width 816 × 190 illustration band across the top of the page. Menu text begins below it.
- Sidebar: a 180 × 916 illustration strip at the right side of the page; content remains in the left 540-unit column area.
- Inset: a 176 × 176 illustration at the upper right. The title reserves that space.

Artwork uses centered cover cropping into its selected box. The prompt should keep important decorative subjects inside that crop. These are separate image regions, not an opaque white panel laid over full-page art. Owned food photos remain separate item images and flow with their editable labels.

## Tool outcome

Figma access was verified and a blank design file was created in the sole available team. Subsequent asset discovery was rejected by Figma: “You've reached the Figma MCP tool call limit on the Starter plan.” No canvas concepts were authored there; the blank file must not be presented as a completed deliverable. The visual concepts above are the authorized alternative using built-in image generation.

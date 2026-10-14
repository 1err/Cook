export type PublicDocumentKind = "about" | "privacy" | "terms" | "contact";

export type PublicDocumentSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type PublicDocumentContent = {
  eyebrow: string;
  title: string;
  intro: string;
  updated?: string;
  sections: PublicDocumentSection[];
};

export const CONTACT_EMAIL = "jerryxiang24@gmail.com";

export const PUBLIC_DOCUMENTS: Record<PublicDocumentKind, PublicDocumentContent> = {
  about: {
    eyebrow: "From meal ideas to dinner",
    title: "About Chef World",
    intro:
      "Chef World brings recipes, meal planning, cooking, and grocery shopping together to make everyday meals easier.",
    sections: [
      {
        heading: "Save recipes your way",
        paragraphs: [
          "Keep the recipes you find online in one place. Import them with AI or add your own, ready whenever you want to cook.",
        ],
      },
      {
        heading: "Discover something new",
        paragraphs: [
          "Explore recipes shared by the community and friends, save your favorites, and share your own.",
        ],
      },
      {
        heading: "Plan your week",
        paragraphs: [
          "Choose meals for the days ahead and keep them together in a weekly plan, ready whenever you are.",
        ],
      },
      {
        heading: "Cook with guidance",
        paragraphs: [
          "Follow step-by-step instructions, tutorials, and timers to keep your place as you cook.",
        ],
      },
      {
        heading: "Make grocery shopping simpler",
        paragraphs: [
          "Get a grocery list from your meal plan and find matching products, ready to shop with a retailer.",
        ],
      },
    ],
  },
  privacy: {
    eyebrow: "Your information",
    title: "Privacy Notice",
    intro:
      "This notice explains how Chef World handles information when you use its recipe, meal-planning, shopping, and cooking features. For privacy questions or data requests, contact jerryxiang24@gmail.com.",
    updated: "Last updated: October 13, 2026",
    sections: [
      {
        heading: "Information used to provide the service",
        paragraphs: [
          "When you create an account, Chef World stores your email address, an account identifier, your library-sharing setting, and a password hash used to verify your password. Your original password is submitted for registration or sign-in; the account database stores its hash.",
          "The service stores information you save, including recipe titles, ingredients, instructions, tags, source links, image links, meal plans, and cooking progress. Saved imports can include the original text and guidance you submitted. If you email us, we receive your address, message, and any attachments you choose to include.",
          "Operational records can include request status, timing, error information, AI usage counters, and grocery search terms. These records help operate the service, investigate problems, and manage usage.",
          "Chef World uses first-party analytics to understand registrations, successful logins, page visits, recipe saves, meal planning, cooking, and retailer handoffs. Administrators can view account emails, signup dates, and account-linked activity. Browser analytics use random visitor and visit identifiers, normalized page paths, referrer domains, campaign labels, and broad browser/device categories; they do not collect passwords, recipe contents, full page URLs, or keystrokes. A visitor identifier may be linked to your account when you sign in or register.",
          "Browser analytics respect Do Not Track and Global Privacy Control signals. Visitor identifiers expire after 90 days; visits expire after 30 minutes of inactivity. Detailed events are retained for 90 days, with non-identifying daily totals retained for 13 months. Account-level last-activity and first-use milestones remain with the account. Browser privacy controls do not disable the operational recording of successful sign-ins and authenticated product actions.",
        ],
      },
      {
        heading: "AI-assisted features and service providers",
        paragraphs: [
          "When you request a recipe import, relevant source text, notes, and instructions may be sent to OpenAI or Google Gemini to organize the recipe. Video or audio imports send the supplied media, retrieved public-post media, or a supported public video URL, together with recipe instructions and notes, to Google Gemini for analysis. Ingredient refinement and cooking-time estimates send the relevant ingredient or recipe text to OpenAI. A link import may involve requesting content from the source website. Avoid submitting sensitive personal information in these inputs.",
          "If you request an AI recipe image, Chef World sends the recipe title, description, ingredients, and steps to OpenAI. The generated preview is stored by Chef World's file-storage service and is attached to a recipe only when you choose to use it. A generated image is an illustration of the dish, not evidence that anyone cooked it.",
          "The mobile app asks you to allow sharing with OpenAI and Google Gemini before you first use an AI-assisted feature. That choice is saved for your account on that device. You can review or withdraw it in Settings; manual recipes and saved non-AI features remain available. Withdrawal prevents new AI requests from that device and does not recall information already sent to a provider. A provider's processing and retention depend on the applicable service and account settings.",
          "For some YouTube imports, the public video URL may be sent to Jina Reader to retrieve the video description when direct access fails.",
          "Hosting, database, file-storage, and other service providers handle information needed to run the service. Their processing and retention of information depend on the services and applicable terms in use.",
          "Some pages load fonts from Google Fonts or images from external hosts, including Unsplash on the sign-in pages. Those hosts receive the network and browser information needed to deliver the resource, such as your IP address and browser details.",
        ],
      },
      {
        heading: "Sharing recipes and images",
        paragraphs: [
          "If you turn on library sharing, other signed-in users who know your email address can find your account and browse and copy your recipes. Turning sharing off stops access through that shared library, but does not remove copies another user has already saved. Recipes published to the public catalog are also visible through the catalog.",
          "Only eligible photos uploaded to Chef World can be approved for display to other accounts through shared libraries or the public catalog. Images linked from external sources remain in your private recipe; attach an image you have permission to upload if you want it reviewed for sharing. You can still view your own saved photos while they await review. Changing the photos requires a new review; rejected or pending photos are hidden from those shared views. Authorized reviewers can inspect the submitted photo set to decide whether it may be shared.",
          "Uploaded recipe images use URLs whose access is separate from the recipe-sharing setting. Someone with an accessible image URL may be able to view the image without access to your recipe. Do not upload images you need to keep private.",
          "If you report a shared recipe, Chef World stores the reason, any details you provide, and a snapshot of the shared recipe so the review team can assess the report even if the author changes it. Private import guidance is excluded from that snapshot. Blocks and review decisions are stored to enforce sharing restrictions. Report information is available to authorized reviewers.",
        ],
      },
      {
        heading: "Grocery searches and retailer links",
        paragraphs: [
          "Ingredient queries may be sent to grocery retailers to find products. When an available shopping-list export is used, the list title, selected item names, quantities, and measurements may be sent to the selected retailer to create a shopping link.",
          "Following a product or shopping link interacts with the retailer's website or app, which can receive the usual browser or device information associated with your visit. Retailer accounts, purchases, payments, delivery details, and their privacy practices are handled by the retailer under its own terms.",
        ],
      },
      {
        heading: "Cookies and browser storage",
        paragraphs: [
          "The web service uses a sign-in cookie to keep you authenticated. Browser storage also supports language preferences, shopping selections, meal-planner state, and cooking progress, including pending offline actions and a device identifier used for cooking synchronization.",
          "The mobile app keeps a sign-in token in the device's secure storage. Device storage also supports preferences and account-scoped cooking or meal-planning state. Cooking timer alerts are scheduled locally on your device if you enable notifications. The device identifier used for cooking synchronization is sent to Chef World's API with cooking actions.",
          "When you share a link or video into the installed website, a temporary copy stays in browser storage so you can sign in and review it. It is removed after a successful import or when you discard it. Pending shares expire after 15 minutes and expired copies are removed the next time the share receiver runs.",
          "You can manage cookies and stored site data in your browser. Clearing or blocking them can sign you out, reset preferences, or remove locally stored progress. Signing out is not a request to delete information stored with your account, and device preferences may remain after sign-out.",
        ],
      },
      {
        heading: "Retention, deletion, and your choices",
        paragraphs: [
          "Saved account and recipe information remains available to support your use of Chef World unless it is removed. Different types of data have different lifecycles; there is no single automatic deletion period covering account records, uploaded images, logs, backups, and third-party systems.",
          "You can edit or delete recipes and change library sharing in the app. Deleting a recipe does not automatically remove its uploaded images, another user's saved copy, or a snapshot used by an active cooking session. Copies of information may also remain in backups, logs, or third-party systems.",
          "You can request deletion of your account from Settings and confirm using your account password. Account deletion removes the account and its owned recipes, plans, cooking records, AI allowance records, and other account-linked records from the active database. It stops access to your shared library. Separate recipe copies saved by other users remain with those users; references to the deleted account's owned images and private source text are removed from those copies.",
          "Deletion also queues removal of uploaded and generated images with storage ownership tied to your account. File removal can complete after the account record is deleted. Older image objects without a verified account owner require a separate ownership review and are not automatically erased by this process. Backups, infrastructure logs, and information already held by third-party services follow their separate lifecycles.",
          "For access, correction, or additional deletion requests, email jerryxiang24@gmail.com from the address associated with your account when possible. We may need to verify your identity and clarify the information involved.",
        ],
      },
      {
        heading: "Questions and updates",
        paragraphs: [
          "Contact jerryxiang24@gmail.com with questions about this notice or the handling of your information. This notice may be updated as the service changes; the date above identifies the current version.",
        ],
      },
    ],
  },
  terms: {
    eyebrow: "Using Chef World",
    title: "Terms of Use",
    intro:
      "These terms describe the basic responsibilities that come with using Chef World. Please read them along with the Privacy Notice. Questions can be sent to jerryxiang24@gmail.com.",
    updated: "Last updated: October 13, 2026",
    sections: [
      {
        heading: "Your account and use of the service",
        paragraphs: [
          "Use an email address you control, keep your sign-in details secure, and contact us if you suspect unauthorized access. Use Chef World lawfully and respect other users. Do not attempt to access another person's account, disrupt the service, or bypass access controls or usage limits.",
        ],
      },
      {
        heading: "Recipes, images, and other content",
        paragraphs: [
          "Only submit, import, upload, or share content you have permission to use in that way. A source link, an AI-assisted import, or another user's shared recipe does not by itself give you permission to reproduce someone else's text, photos, or other protected material.",
          "The service processes and stores the content you provide to perform the features you request. When you enable library sharing, other users can browse and save separate copies of your recipes. Turning sharing off or deleting your original does not recall those copies.",
          "To report a content-rights concern, email jerryxiang24@gmail.com with the relevant recipe or page, a description of the material, and how we can contact you.",
          "Do not share harassment, threats, sexual or exploitative material, hate, or other unlawful or abusive content. Shared recipes must be suitable for a cooking service. Reports can be reviewed by Chef World, and catalog entries or library sharing may be removed or disabled when they violate these rules. Users can report shared recipes and block another account through the sharing screens.",
          "Eligible photos uploaded to Chef World must be reviewed before they appear in another user's view of a shared library or catalog. External source images are hidden from shared views; upload only content you have permission to share. Review applies to the particular photo set submitted; changing it requires another review. Your private access to your saved photos does not establish that they have been approved for sharing.",
        ],
      },
      {
        heading: "Review recipes before cooking",
        paragraphs: [
          "AI-assisted imports, ingredient suggestions, quantities, cooking steps, and time estimates can be incomplete or wrong. Review and edit them before use. Timers and recipe instructions do not verify that food is safe to eat.",
          "Check ingredient labels, allergens, substitutions, safe handling, and appropriate cooking temperatures for your situation. Chef World is a planning aid and does not provide personalized medical or dietary advice.",
        ],
      },
      {
        heading: "Shopping with third parties",
        paragraphs: [
          "Grocery links help you explore products on third-party services. Prices, product details, stock, delivery areas, and promotions can change. Confirm the item and final price with the retailer before purchasing.",
          "Checkout, payment, order fulfillment, returns, and refunds are handled by the retailer under its terms. A product link or a completed handoff in Chef World does not confirm that an item was added to a retailer's cart or that an order was placed. A retailer's name or link does not by itself indicate a partnership or endorsement.",
        ],
      },
      {
        heading: "Availability and support",
        paragraphs: [
          "Chef World is an early-stage service. Features and supported connections may change, and errors or interruptions can occur. Keep your own copy of recipes or other information that is important to you.",
          "For help, account or data requests, or questions about these terms, contact jerryxiang24@gmail.com. These terms may be updated as the service develops; the date above identifies the current version.",
        ],
      },
    ],
  },
  contact: {
    eyebrow: "Stay in touch",
    title: "Contact Chef World",
    intro:
      "For product help, privacy questions, content concerns, or partnership inquiries, email jerryxiang24@gmail.com.",
    sections: [
      {
        heading: "Product and account support",
        paragraphs: [
          "Tell us what you were trying to do, what happened, and which device or browser you were using. A relevant page link or screenshot can help. Do not include passwords, payment details, or other sensitive information.",
        ],
      },
      {
        heading: "Privacy and content requests",
        paragraphs: [
          "For account access, correction, or deletion requests, write from your account email when possible and describe what you need. For a recipe or image concern, include the relevant page or source and explain the issue.",
        ],
      },
      {
        heading: "Partnerships and collaboration",
        paragraphs: [
          "We welcome conversations with recipe creators, grocery retailers, and organizations serving home cooks. Include your organization or project, what you have in mind, and the best way to reach you.",
          "For all inquiries: jerryxiang24@gmail.com.",
        ],
      },
    ],
  },
};

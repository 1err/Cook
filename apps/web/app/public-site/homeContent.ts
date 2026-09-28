export type HomeLanguage = "en" | "zh";

export const HOME_COPY = {
  "en": {
    "navHome": "Home",
    "navAbout": "About",
    "navContact": "Contact",
    "navPrivacy": "Privacy",
    "navTerms": "Terms",
    "openApp": "Open app",
    "heroIntro": "Your favorite recipes, a plan for the week, and a little less guesswork before dinner.",
    "watch": "See it in 30 seconds",
    "heroCaption": "Your recipes. Your table.",
    "heroProof": "A real recipe library and the menu it inspired.",
    "featuresIntro": "From the dish you saved to the meal you share. Take a look inside Chef World.",
    "enlarge": "Look closer",
    "scrollHint": "Scroll to explore",
    "cookPlay": "Play cooking preview",
    "cookReplay": "Replay cooking preview",
    "cookVideoLabel": "Short cooking preview",
    "cookVideoNote": "A short preview of guided cooking, made with actual app screens.",
    "cookUnavailable": "The cooking preview could not play. Here’s a cooking screenshot.",
    "screensNote": "Actual app screens. Select a feature to explore.",
    "previewEyebrow": "A look inside",
    "previewIntro": "A quick tour of recipes, menus, meal planning, shopping, and guided cooking — made with actual app screens.",
    "play": "Play the 30-second preview",
    "videoNote": "Preview based on actual Chef World screens. Playback starts only when you press play.",
    "partnershipTitle": "Let’s work together.",
    "partnershipBody": "We welcome ideas from creators, brands, retailers, and anyone who shares a love of cooking.",
    "contact": "Get in touch",
    "videoError": "The preview could not play. Please try again, or explore the feature screenshots above."
  },
  "zh": {
    "navHome": "首页",
    "navAbout": "关于",
    "navContact": "联系",
    "navPrivacy": "隐私",
    "navTerms": "条款",
    "openApp": "开始使用",
    "heroIntro": "收藏想做的菜，安排这周吃什么，把做饭前的琐事变得简单一点。",
    "watch": "30 秒看看怎么用",
    "heroCaption": "自己的菜谱，自己的餐桌。",
    "heroProof": "真实菜谱库，和用这些菜生成的菜单。",
    "featuresIntro": "从刷到一道想做的菜，到和朋友一起开饭。看看 Chef World 能帮你做什么。",
    "enlarge": "放大查看",
    "scrollHint": "向下滚动，继续看看",
    "cookPlay": "播放烹饪预览",
    "cookReplay": "重播烹饪预览",
    "cookVideoLabel": "烹饪功能短预览",
    "cookVideoNote": "用实际应用画面，看看跟着步骤做饭的过程。",
    "cookUnavailable": "烹饪预览暂时无法播放，先看看烹饪截图。",
    "screensNote": "真实应用截图，选择一个功能看看。",
    "previewEyebrow": "看看功能预览",
    "previewIntro": "用实际应用画面，快速看看菜谱、菜单、餐单、购物和烹饪步骤。",
    "play": "播放 30 秒功能预览",
    "videoNote": "使用 Chef World 实际画面制作。点击后才会播放。",
    "partnershipTitle": "一起把做饭变得更好。",
    "partnershipBody": "欢迎热爱做饭的创作者、品牌、零售商和朋友们，和我们聊聊你的想法。",
    "contact": "联系我们",
    "videoError": "预览暂时无法播放。请重试，或先查看上方的功能截图。"
  }
} as const;

export const HOME_FEATURES = [
  {
    "id": "recipes",
    "image": "/brand/features/06-recipe.webp",
    "path": "/library",
    "en": {
      "label": "Recipes",
      "title": "Save the dishes you’ll actually cook.",
      "body": "Import a supported link, upload a video, or paste a recipe. Review the draft, make it yours, and keep it close for next time.",
      "cta": "Explore recipes",
      "caption": "A saved recipe, with ingredients and cooking steps.",
      "note": "Link imports depend on source access. Always review an AI-generated draft."
    },
    "zh": {
      "label": "菜谱收藏",
      "title": "把“下次一定做”，存成自己的菜谱。",
      "body": "粘贴支持的链接、上传视频，或直接粘贴文字。核对食材和步骤，存进自己的菜谱库，下次想做就能找到。",
      "cta": "打开菜谱库",
      "caption": "已保存的菜谱：食材和烹饪步骤一目了然。",
      "note": "链接导入受原平台访问限制；AI 整理的草稿需要核对。"
    },
    "preview": "scroll",
    "scrollImage": "/brand/features/recipes-scroll.webp"
  },
  {
    "id": "planner",
    "image": "/brand/features/07-planner.webp",
    "path": "/planner",
    "en": {
      "label": "Planner",
      "title": "A week of meals, with a little less “what’s for dinner?”",
      "body": "Put your recipes into breakfast, lunch, and dinner. See the week together and make room for the dishes you’re excited to cook.",
      "cta": "Plan your week",
      "caption": "Recipes arranged across a weekly meal plan.",
      "note": ""
    },
    "zh": {
      "label": "每周餐单",
      "title": "提前想好这周吃什么，少纠结几次晚饭。",
      "body": "把收藏的菜安排进早、中、晚餐，一眼看到整周计划。忙着上课或工作时，也知道回家能做什么。",
      "cta": "安排这周吃什么",
      "caption": "把自己的菜谱安排到一周的早、中、晚餐。",
      "note": ""
    },
    "preview": "image"
  },
  {
    "id": "shopping",
    "image": "/brand/features/01-shopping-weee.webp",
    "path": "/shopping-list",
    "en": {
      "label": "Shopping",
      "title": "One grocery list for the meals you’ve planned.",
      "body": "Bring your ingredients together and browse matching Weee products. Open a product link to buy directly on Weee, or choose Muse to help prepare your cart.",
      "cta": "See the shopping list",
      "caption": "A planned grocery list with matching Weee products.",
      "note": "Review prices, stock, quantities, and your cart on Weee. Checkout stays with the retailer."
    },
    "zh": {
      "label": "购物清单",
      "title": "这几顿饭要买什么，放在同一张清单里。",
      "body": "按餐单汇总食材，合并兼容用量，再查看匹配的 Weee 商品。点击商品链接就能去 Weee 购买，也可以选择让 Muse 协助准备购物车。",
      "cta": "查看购物清单",
      "caption": "根据餐单汇总的清单，和匹配的 Weee 商品。",
      "note": "商品价格、库存和实际购物车以 Weee 为准；在零售商平台自行结账。"
    },
    "preview": "scroll",
    "scrollImage": "/brand/features/shopping-scroll.webp"
  },
  {
    "id": "muse",
    "image": "/brand/features/05-muse.webp",
    "path": "/shopping-list",
    "en": {
      "label": "Muse",
      "title": "Your shopping plan, ready to hand to Muse.",
      "body": "Prefer a little help? Review products, pack counts, and your budget, then copy the shopping request into Muse to ask it to prepare your Weee cart.",
      "cta": "Prepare with Muse",
      "caption": "Review quantities before copying a request for Muse.",
      "note": "Requires your own Muse account. Check the result and complete checkout yourself on Weee."
    },
    "zh": {
      "label": "交给 Muse",
      "title": "确认好买多少，再把购物请求交给 Muse。",
      "body": "检查选好的商品、包数和预算，复制购物请求，粘贴到 Muse，让它帮你准备 Weee 购物车。",
      "cta": "准备 Muse 购物请求",
      "caption": "核对商品包数后，再复制购物请求给 Muse。",
      "note": "需要自己的 Muse 账户。请检查执行结果，并自行在 Weee 结账。"
    },
    "preview": "image"
  },
  {
    "id": "menus",
    "image": "/brand/features/menu-maker-demo.webp",
    "path": "/library",
    "en": {
      "label": "Menu maker",
      "title": "Make your table feel like your own little restaurant.",
      "body": "Choose your dishes and describe a style. Turn them into an illustrated menu to download and share before friends come over.",
      "cta": "Make a menu",
      "caption": "The menu-making page, with the finished illustrated menu.",
      "note": "AI-generated image. Check dish names before sharing. One new menu per UTC day."
    },
    "zh": {
      "label": "生成菜单",
      "title": "朋友来家里吃饭，也有一张专属菜单。",
      "body": "选好拿手菜，描述喜欢的风格，让 AI 画成一张菜单。下载发给室友或朋友，聚餐也可以很有仪式感。",
      "cta": "去生成菜单",
      "caption": "菜单制作页面，和实际生成的插画菜单。",
      "note": "菜单为 AI 生成图片，分享前请核对菜名。每天可生成一张，按 UTC 重置。"
    },
    "preview": "image"
  },
  {
    "id": "cook",
    "image": "/brand/features/08-cook.webp",
    "path": "/cook",
    "en": {
      "label": "Cook",
      "title": "Keep your place, even with a few dishes on the go.",
      "body": "Follow the steps, track your progress, and start timers for timed cooking steps. Keep an eye on what needs your attention next.",
      "cta": "Start cooking",
      "caption": "Guided steps and timers in a cooking session.",
      "note": "Keep the browser open for cooking sounds and notifications."
    },
    "zh": {
      "label": "一起做饭",
      "title": "几道菜一起做，也知道下一步该忙什么。",
      "body": "跟着步骤推进，记录每道菜的进度，有计时的步骤可以开启提醒。把注意力留给眼前这顿饭。",
      "cta": "开始做饭",
      "caption": "烹饪过程中的步骤、进度和计时。",
      "note": "请保持浏览器打开，以接收烹饪声音和通知。"
    },
    "preview": "video",
    "video": "/brand/features/cook-preview.mp4"
  }
] as const;

"use client";

import { useI18n } from "./i18n";

const copy = {
  en: {
    "library.tagline": "A little inspiration for your next meal.",
    "library.friends": "Friends",
    "planner.tagline": "Make room for a good week.",
    "cook.settings": "Cooking preferences",
    "import.tagline": "Import a public video or recipe text, or write your own recipe.",
    "settings.tagline": "Manage your account and choose how your recipe library is shared.",
    "friends.tagline": "Find shared recipes from people you know.",
    "shopping.tagline": "Ingredients from your planned meals.",
    "shopping.thisWeek": "This week",
    "shopping.originalList": "Original list",
    "shopping.prepareDescription": "Organize ingredients by what to buy, then choose products when you are ready.",
  },
  zh: {
    "library.tagline": "为下一餐，找一点灵感。",
    "library.friends": "好友",
    "planner.tagline": "为美好的一周留出空间。",
    "cook.settings": "烹饪偏好",
    "import.tagline": "通过公开视频或文本导入食谱，也可以自己编写。",
    "settings.tagline": "管理你的账户，并选择如何分享食谱库。",
    "friends.tagline": "查找你认识的人分享的食谱。",
    "shopping.tagline": "来自本周膳食计划的食材。",
    "shopping.thisWeek": "本周",
    "shopping.originalList": "原始清单",
    "shopping.prepareDescription": "整理待买食材，准备好后再选择商品。",
  },
};

export function useEditorialCopy() {
  const { language } = useI18n();
  return copy[language];
}

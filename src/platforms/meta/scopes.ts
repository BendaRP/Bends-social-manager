/**
 * Meta OAuth scopes, kept in one place and deliberately minimal.
 *
 * The principle is least privilege: each scope here exists because a specific
 * feature cannot work without it. Notably absent, and intentionally so:
 *
 *   pages_manage_metadata    — would let the app rewrite page settings
 *   pages_manage_engagement  — would let the app delete other people's comments
 *   publish_video            — superseded by the page/IG publishing scopes
 *   business_management      — only needed to administer the Business portfolio
 *                              itself, which this app never does
 *
 * We connect only the owner's own accounts, so the app can stay in Development
 * mode with the Instagram account added as a Tester and never face App Review.
 * Review becomes necessary only if other people's accounts are ever connected.
 */

export const META_SCOPES = [
  // Read the Instagram professional account's profile and media.
  "instagram_basic",
  // Create media containers and publish them. The core of phase 1.
  "instagram_content_publish",
  // Post-level and account-level insights. Feeds phases 2 and 3.
  "instagram_manage_insights",
  // Enumerate which pages the user administers, to find the linked IG account.
  "pages_show_list",
  // Read page-level insights.
  "pages_read_engagement",
  // Publish to the Facebook Page itself.
  "pages_manage_posts",
] as const;

export type MetaScope = (typeof META_SCOPES)[number];

export const META_SCOPE_STRING = META_SCOPES.join(",");

/**
 * Why each scope is requested, shown in the connection UI so the permissions
 * screen is not a black box.
 */
export const SCOPE_EXPLANATIONS: Record<MetaScope, string> = {
  instagram_basic: "קריאת פרטי חשבון האינסטגרם והמדיה שבו",
  instagram_content_publish: "פרסום פוסטים, קרוסלות ורילס לאינסטגרם",
  instagram_manage_insights: "שאיבת נתוני ביצועים (חשיפה, engagement, שמירות)",
  pages_show_list: "איתור עמוד הפייסבוק המקושר לחשבון האינסטגרם",
  pages_read_engagement: "קריאת נתוני ביצועים של עמוד הפייסבוק",
  pages_manage_posts: "פרסום פוסטים לעמוד הפייסבוק",
};

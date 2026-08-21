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

/**
 * The scopes actually requested at login.
 *
 * Overridable via the META_SCOPES environment variable because Meta gates
 * permissions behind per-app "use case" configuration, and an app that has not
 * enabled a given permission rejects the whole login with "Invalid Scopes"
 * rather than ignoring the one it does not recognise. Being able to narrow the
 * list without a code change makes it possible to connect with what the app
 * already has, confirm the rest of the flow works, and widen it as permissions
 * are switched on in the dashboard.
 *
 * Anything absent here simply disables the feature that needed it — publishing
 * without `pages_manage_posts`, insights without `instagram_manage_insights` —
 * so a narrowed list degrades the app rather than breaking it.
 */
export function metaScopes(): string[] {
  const override = process.env.META_SCOPES?.trim();
  if (override) {
    return override
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return [...META_SCOPES];
}

export function metaScopeString(): string {
  return metaScopes().join(",");
}

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

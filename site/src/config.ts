/** Things to change as Clipt ships. */

/** The notarized DMG. While null, the button reads "Coming soon". */
export const DOWNLOAD_URL: string | null =
  "https://github.com/eduardoalba00/clipt/releases/latest/download/Clipt.dmg";

export const GITHUB_URL = "https://github.com/eduardoalba00/clipt";

/** The Product Hunt launch, shown above the launcher. Null hides the badge. */
export const PRODUCT_HUNT: { url: string; badge: string } | null = {
  url: "https://www.producthunt.com/products/clipt-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-clipt-2",
  badge: "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1286172&theme=dark",
};

/**
 * A real screen recording (in public/) to open in the editor after a
 * pretend recording. While null, the take is a redraw of the pretend screen.
 */
export const DEMO_VIDEO: string | null = null;

export const VERSION = "0.1.0";

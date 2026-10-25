/**
 * Your projects. Each one becomes a landmark in the world.
 *
 *  id          unique slug; also used for deep links (#project=id)
 *  title       shown on the label, prompt and overlay
 *  tech        short tech summary shown in the overlay bar
 *  description used in the fallback card
 *  url         what the overlay loads (iframe) or links to (card)
 *  source      optional repo link (shown on the card)
 *  image       optional screenshot for the card (put files in /public)
 *  embed       true → load `url` in an iframe. Only works if that site allows framing
 *              (no X-Frame-Options / CSP frame-ancestors blocking). GitHub blocks it.
 *              false → show a project card with an "Open" button instead.
 *  position    [x, z] in world units (world is roughly -240..240 on each axis)
 *  landmark    one of: 'office' | 'kitchen' | 'restaurant' | 'tower' | 'lighthouse' | 'arch' | 'pyramid' | 'windmill' | 'observatory'
 *  color       accent color for the landmark and pad
 *  padLogo     optional image (in /public) painted around the edge of this project's helipad
 *              in place of the standard markings. padH: false also hides the H.
 *  gallery     ('office' only) the projects hung as paintings inside the building. Each entry
 *              takes the same fields as a top-level project minus position/landmark; the
 *              painting shows `image` (a screenshot in /public) when given, otherwise a poster
 *              painted from the title, tech line and color. Walk up to one and press E to open it.
 *              frame: true shows an embedded site inside a gilded picture frame (with the
 *              screenshot behind it while it loads) instead of edge to edge.
 */
export const projects = [
  {
    id: 'zen-of-cooking',
    title: 'The Zen of Cooking',
    tech: 'Editorial recipe site',
    description:
      'A dark-themed editorial recipe website focused on braises, whole-animal cooking and seasonal, locally sourced ingredients.',
    url: 'https://www.thezenofcooking.com',
    embed: true,
    frame: true,
    image: '/zen-of-cooking.jpg',
    position: [110, -80],
    landmark: 'kitchen',
    color: '#ff7a45',
    // Custom helipad: the logo (in /public) is painted on the pad instead of the standard
    // markings. padH: false drops the gold-circled H so the logo owns the pad.
    padLogo: '/zen-logo.png',
    padH: false,
  },
  {
    id: 'projects',
    title: 'Projects',
    tech: 'Land, get out, and walk in through the lobby',
    description:
      'An office building with a gallery inside. Land on the pad, climb out of the helicopter and walk through the front doors to see the paintings.',
    url: '',
    embed: false,
    position: [-120, -100],
    landmark: 'office',
    color: '#4cc9f0',
    gallery: [
      {
        id: 'feltfolio',
        title: 'FeltFolio',
        tech: 'Portfolio tracker',
        description: 'FeltFolio — a portfolio tracker. Point this entry at the live site and drop a screenshot in /public to show it on the painting.',
        url: 'https://example.com/feltfolio',
        embed: false,
        color: '#2ec4b6',
      },
      {
        id: 'zen-of-cooking-gallery',
        title: 'The Zen of Cooking',
        tech: 'Editorial recipe site · gallery, collections, cook\'s notes',
        description:
          'A quiet kitchen: a dark-themed editorial recipe site about intentional cooking — braises, whole-animal cooking and seasonal, locally sourced ingredients.',
        url: 'https://www.thezenofcooking.com',
        embed: true,
        frame: true,
        color: '#ff7a45',
        image: '/zen-of-cooking.jpg',
      },
      {
        id: 'zoltan-speaks',
        title: 'Zoltan Speaks',
        tech: 'Fortune-telling machine · ask by text or voice',
        description: 'Zoltan Speaks — a boardwalk fortune-telling machine on a moonlit pier. Type or speak your question, and the spirits shall answer.',
        url: 'https://www.zoltanspeaks.com',
        embed: true,
        frame: true,
        color: '#b388ff',
        image: '/zoltan-speaks.jpg',
      },
      {
        id: 'prestige-worldwide-ffl',
        title: 'Prestige Worldwide FFL',
        tech: '10-team dynasty league · live matchups, odds, dynasty analyzer, history',
        description: 'Prestige Worldwide — the hub for a 10-team dynasty fantasy football league: live matchup odds, start/sit, a dynasty analyzer, league chat and eight seasons of history, fed by Sleeper.',
        url: 'https://www.prestigeworldwideffl.com',
        embed: true,
        frame: true,    // the site opens inside a gilded picture frame
        color: '#ffd166',
        image: '/prestige-worldwide.jpg',
      },
    ],
  },
  {
    id: 'three-sandbox',
    title: 'Three.js Sandbox',
    tech: 'Three.js · Vite',
    description: 'Small interactive 3D experiments. (Example of an embeddable project — it opens inside the app.)',
    url: 'https://threejs.org/examples/webgl_geometry_minecraft.html',
    embed: true,
    position: [-40, 140],
    landmark: 'observatory',
    color: '#b388ff',
  },
  {
    id: 'about',
    title: 'About Sean',
    tech: 'Backend developer · Home cook · Vermont',
    description:
      'Backend developer working in .NET / C#, PostgreSQL and AWS. Also a home cook and food writer. This page is a placeholder — point it at your about page or résumé.',
    url: 'https://example.com/about',
    embed: false,
    position: [140, 120],
    landmark: 'lighthouse',
    color: '#ffd166',
  },
  {
    id: 'playground',
    title: 'Playground',
    tech: 'Knock stuff over',
    description: 'Nothing to open here — just a pile of crates to drive through. Add your next project in src/data/projects.js.',
    url: '',
    embed: false,
    position: [0, -190],
    landmark: 'arch',
    color: '#7ee787',
  },
];

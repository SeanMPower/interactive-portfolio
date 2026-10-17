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
 *  landmark    one of: 'kitchen' | 'restaurant' | 'tower' | 'lighthouse' | 'arch' | 'pyramid' | 'windmill' | 'observatory'
 *  color       accent color for the landmark and pad
 *  padLogo     optional image (in /public) painted around the edge of this project's helipad
 *              in place of the standard markings. padH: false also hides the H.
 */
export const projects = [
  {
    id: 'zen-of-cooking',
    title: 'The Zen of Cooking',
    tech: 'Editorial recipe site',
    description:
      'A dark-themed editorial recipe website focused on braises, whole-animal cooking and seasonal, locally sourced ingredients.',
    url: 'https://example.com/zen-of-cooking',
    embed: false,
    position: [110, -80],
    landmark: 'kitchen',
    color: '#ff7a45',
    // Custom helipad: the logo (in /public) is painted on the pad instead of the standard
    // markings. padH: false drops the gold-circled H so the logo owns the pad.
    padLogo: '/zen-logo.png',
    padH: false,
  },
  {
    id: 'json-api',
    title: 'JSON:API Platform',
    tech: 'ASP.NET Core · JsonApiDotNetCore · PostgreSQL',
    description:
      'Backend API platform built on JsonApiDotNetCore with EF Core, deployed to AWS through a CI/CD pipeline.',
    url: 'https://github.com/',
    source: 'https://github.com/',
    embed: false,
    position: [-120, -100],
    landmark: 'tower',
    color: '#4cc9f0',
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

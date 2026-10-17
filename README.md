# Where Dreams Take Flight — seanpower.dev

A 3D portfolio in the spirit of [bruno-simon.com](https://bruno-simon.com): fly an RC helicopter
around a colorful low-poly world, hover over a landmark's pad, and open the project it represents inside the app.

**Stack:** [Three.js](https://threejs.org) (rendering) · [cannon-es](https://github.com/pmndrs/cannon-es) (collisions) · [Vite](https://vitejs.dev) (dev/build) · [lil-gui](https://lil-gui.georgealways.com) (tuning panel)

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

Add `?debug` to the URL for a live tuning panel (acceleration, climb rate, yaw, input easing, camera).

## Controls

| Key | Action |
|---|---|
| W / ↑, S / ↓ | fly forward / backward |
| A / ←, D / → | turn |
| Space (or Q) | climb |
| Shift (or Z) | descend |
| E / Enter | open the project whose pad you're hovering over (within 12 m) |
| Shift over a helipad | land — the rotors wind down; hold Space ~1.5 s to spool up and take off again |
| R | reset the helicopter |
| Esc | close the project overlay |
| Scroll / pinch | zoom |

Touch devices get on-screen buttons automatically.

## Adding a project

Everything is driven by `src/data/projects.js`. Add an entry:

```js
{
  id: 'my-app',                 // slug; deep-linkable as #project=my-app
  title: 'My App',
  tech: 'React · Postgres',
  description: 'What it is.',
  url: 'https://my-app.example.com',
  source: 'https://github.com/you/my-app',   // optional
  image: '/my-app.png',                      // optional, put the file in /public
  embed: true,                               // iframe it (see below) or show a card
  position: [40, 80],                        // [x, z]; world is roughly ±120
  landmark: 'windmill',                      // restaurant | tower | lighthouse | arch | pyramid | windmill | observatory
  color: '#ffb547',
  padLogo: '/my-logo.png',                   // optional: paint this image around the helipad edge
  padH: false,                               // optional: hide the H when the logo owns the pad
}
```

The terrain flattens itself around each landmark and its pad, so you can drop one anywhere.

### `embed: true` — the iframe caveat

A site only loads inside the overlay if it allows being framed. Sites that send
`X-Frame-Options: DENY/SAMEORIGIN` or `Content-Security-Policy: frame-ancestors ...` (GitHub, most big
sites) render a blank iframe, and the browser gives JavaScript no way to detect it.

* **Your own deployments:** add `Content-Security-Policy: frame-ancestors 'self' https://<your-portfolio-domain>`
  to their responses and set `embed: true`.
* **Anything else:** leave `embed: false`; the overlay shows a card with a screenshot and an "Open" link.

The overlay pauses physics and releases the keyboard while open, so WASD inside an embedded app won't fly the helicopter.

## Ring Run leaderboard

Finishing the ring course prompts for three initials and saves the time to a shared leaderboard
(the **Leaderboard ›** link in the Ring Run HUD box opens the top 10). The backend is one
CloudFormation stack — a DynamoDB table and a Lambda behind a Function URL — in `infra/leaderboard.yml`.

```bash
aws cloudformation deploy --template-file infra/leaderboard.yml \
  --stack-name portfolio-leaderboard --capabilities CAPABILITY_IAM --region us-east-1
aws cloudformation describe-stacks --stack-name portfolio-leaderboard --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
```

Put the printed URL in `VITE_LEADERBOARD_URL`:

* **Prod:** Amplify console → the app → *Hosting › Environment variables*, then redeploy
  (`amplify.yml` writes it into `.env.production` before `vite build`).
* **Dev:** `cp .env.example .env.local` and fill it in.
* **Unset:** the board falls back to localStorage so the UI still works offline.

`GET` returns the top 10 (`{ scores: [{ initials, timeMs, date }] }`); `POST { initials, timeMs }` stores a
run and returns its 1-based `rank` over every run plus the fresh top 10. The Lambda rejects initials
outside `[A-Z0-9]{1,3}` and times under 5 s or over an hour. That keeps junk out, but it is not
anti-cheat — anyone can POST a time with curl or devtools.

## Project layout

```
src/
  main.js              bootstraps renderer, physics, world, loop, HUD
  Controls.js          keyboard + touch input
  Camera.js            fixed-angle follow camera (Bruno-style), scroll/pinch zoom
  data/projects.js     ← your projects
  ui/Overlay.js        iframe / card overlay
  ui/Leaderboard.js    initials prompt + top-10 modal
  leaderboard/api.js   fetch/submit against VITE_LEADERBOARD_URL (localStorage fallback)
infra/
  leaderboard.yml      CloudFormation: DynamoDB + Lambda Function URL for the leaderboard
  world/
    Terrain.js         procedural heightmap → smooth-shaded mesh + water + cannon Heightfield
    Helicopter.js      arcade flight model (altitude hold, eased inputs) + low-poly heli visual
    Truck.js           the original RaycastVehicle monster truck (unused; kept for reference)
    Landmarks.js       builds landmarks, pads, labels, proximity detection
    landmarkShapes.js  procedural landmark builders (swap for GLTF later)
    Props.js           instanced pines, round trees, bushes, flowers, rocks, clouds, dynamic crates
    Dust.js            rotor-wash dust particles
    noise.js           tiny value noise
```

## Next steps / ideas

* Replace a `landmarkShapes` builder with a Blender-made GLTF (`GLTFLoader`); keep the `{ group, colliders }` return shape.
* Model the helicopter in Blender and swap `Helicopter.#buildVisual`.
* Rotor sound pitched by throttle, wind, impact thuds.
* Minimap or compass pointing to unvisited landmarks.
* Baked lighting / matcaps à la Bruno for a cleaner look and better mobile performance.
* Deploy `dist/` to GitHub Pages, Cloudflare Pages or Netlify.

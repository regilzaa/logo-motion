# logo-motion

A 5-second logo sting built entirely in code. A city light on Earth's night side charges up and fires
a laser at the Moon. The beam engraves the logo into the lunar surface stroke by stroke, then the
official logo resolves on top of the strokes.

- Real-time three.js scene, rendered frame by frame in headless Chrome. Time is `frame / 60`, never the wall clock, so every render is deterministic.
- 300 frames at 60 fps. 8 jittered sub-frames per frame give motion blur and supersampling AA. The camera whip at 1.45–1.85 s uses 32 sub-frames with a narrower shutter.
- Post-processing: bloom (dual-filter mip chain), lens-flare kick, faint chromatic edge, ACES tonemapping, fine film grain.
- One continuous camera move with no cuts. Hermite keys give C1-continuous position, target, roll and fov.
- Two framings: 16:9 at 1920×1080 and a real 9:16 re-layout at 1080×1920. The 9:16 opening is rolled about 35° so Earth and Moon stack vertically, then unrolls through the whip. The final framing is computed per layout so the logo is 35 % (16:9) or 70 % (9:16) of frame width.

## Deliverables (`out/deliver/`, not committed: large binaries)

| file | |
|---|---|
| `logo_motion_16x9.mp4`, `logo_motion_9x16.mp4` | H.264 High, CRF 12, `-preset slow`, BT.709, AAC 320k |
| `logo_motion_16x9_ProRes422HQ.mov`, `..._9x16_...` | ProRes 422 HQ (`prores_ks` profile 3), 10-bit 4:2:2, 24-bit PCM |
| `logo_motion_sound.wav` | 48 kHz / 24-bit stereo, -14 LUFS integrated, ≤ -1 dBTP |
| `logo_motion_16x9_final_frame.png`, `..._9x16_...` | frame 299 (the clean lock-up) |

## Re-render

Requires Node 18+, Python 3 with numpy, scipy, Pillow and potracer, ffmpeg, and Chromium. The default
path is `/opt/pw-browsers/chromium`; override it with `CHROME_PATH=...`.

```bash
npm install
```

```bash
npm run all
```

`npm run all` runs `render/build_all.js`: it builds the sound, then each layout (MP4, ProRes, PNG), then muxes the audio.

Useful partial commands:

```bash
npm run preview
```

```bash
node render/render.js --layout portrait --scale 0.5 --subframes 2 --out out/p.mp4 --fast
```

```bash
node render/render.js --layout landscape --frames 72,102,299 --png-dir out/stills
```

```bash
python3 sound/make_sound.py
```

To re-extract the trace paths after changing the logo, run this, then `tools/review_still.py` for the review still:

```bash
python3 tools/vectorize_logo.py logo.png assets/logo_paths.json
```

At full quality a frame takes about 5–10 s on a 4-core CPU with SwiftShader software WebGL.

## Timing

All beats live in **`timing.json`**: phases, events, per-path trace windows, layout framing, colours,
sub-frame settings. The camera, laser, trace, logo, post-processing and every sound cue read from it.
Change a number there and both picture and sound follow.

| s | beat |
|---|---|
| 0.00–0.60 | open: slow push to Earth's night side, city light (Cairo) pulses from 0.15 |
| 0.60–1.20 | charge: core + ring contracting (0.70–1.15), atmosphere shimmer, anticipation pull-back 1.05 |
| 1.20–1.70 | fire: muzzle flash + flare kick, beam head eases out of the atmosphere then races to the Moon, camera whips alongside |
| 1.70–2.20 | impact: white flash, dust plume, shockwave across the surface, 3-frame shake |
| 2.20–3.60 | trace: 5 strokes engraved into the Moon (starts 2.20 / 2.75 / 3.20 / 3.30 / 3.45), sparks, strokes cool from white-hot to the laser colour |
| 3.60–4.20 | resolve: beam cuts from Earth's side 3.62, trace flash 3.72, logo fades in 3.75–4.15, Moon dims and recedes |
| 4.20–5.00 | hold: 1.5 % linear push-in, light sweep 4.35–4.85; the last 0.8 s is a clean still |

## The logo

- `logo.png` is 8333×8333, a black mark on a transparent background. It is never redrawn.
- **Trace routes.** `tools/vectorize_logo.py` runs potrace on the PNG's alpha only to get trace routes (`assets/logo_paths.json`). Order: left outer arc, right outer arc, the two small edge fragments top to bottom, then the centre dot.
- **The resolved logo** is the original PNG's alpha channel (`assets/logo_alpha_4096.png`, a Lanczos downscale of the alpha), filled pure `#FFFFFF`, as approved. It is composited after bloom and tonemapping, so its edges are never blurred or bloomed. A separate emissive copy inside the HDR scene supplies the resolve glow and the light sweep.
- **Please check the source file:** the PNG contains thin wedge-shaped spikes (for example from the top of the left arc toward the centre, and below the left arc). They look like a broken bezier from an export. They are kept as-is because the logo must stay pixel-exact. If they are not intended, drop in a corrected `logo.png` and re-run `tools/vectorize_logo.py`.

## Texture credits (NASA, public domain)

Direct downloads from `svs.gsfc.nasa.gov` and `eoimages.gsfc.nasa.gov` were blocked by this build
environment's network proxy. The same NASA imagery was taken from the MIT-licensed npm packages
`three-globe` and `globe.gl`, which ship it in their examples:

| file | source | credit |
|---|---|---|
| `earth_day.jpg` (4096×2048) | `three-globe/example/img/earth-blue-marble.jpg` | NASA Visible Earth, *Blue Marble* (public domain) |
| `earth_night.jpg` (4096×2048) | `three-globe/example/img/earth-night.jpg` | NASA Earth Observatory city-lights / *Black Marble* imagery (public domain). This copy has a dim blue base; the shader keeps only the warm lights. |
| `earth_water.png` | `three-globe/example/img/earth-water.png` | ocean mask derived from NASA Blue Marble (public domain) |
| `moon_color.jpg` (4096×2048) | `globe.gl/example/moon-landing-sites/lunar_surface.jpg` | NASA Scientific Visualization Studio, *CGI Moon Kit* (LRO LROC colour) (public domain) |
| `moon_disp.jpg` (1024×512) | `globe.gl/example/moon-landing-sites/lunar_bumpmap.jpg` | lunar height/bump map shipped with globe.gl, used for subtle displacement + bump |

**Upgrade path.** For higher-fidelity relief, replace `moon_disp.jpg` with the CGI Moon Kit LOLA
displacement map (`ldem_*`, https://svs.gsfc.nasa.gov/4720). For the city lights, use NASA
*Black Marble 2016* (https://earthobservatory.nasa.gov/features/NightLights). Keep the filenames and
re-render; no code changes are needed.

## Sound

- `sound/make_sound.py` synthesises every cue from `timing.json`:
  - space ambience bed, city-light blips
  - rising charge hum (0.60–1.20)
  - laser zap panned left→right with the beam (1.20)
  - impact boom with sub (1.70)
  - crackles under the trace, with a tick on every new path start
  - shimmer + soft sting on resolve (3.60), and an airy whoosh under the light sweep
  - ring-out to digital silence by 5.00
- Mastering: gain to -14 LUFS, then a 4× oversampled true-peak limiter at -1.2 dBTP. Both are measured with ffmpeg `ebur128`.
- **Using your own SFX:** put WAVs in `./sfx/` named `ambience`, `charge`, `zap`, `impact`, `crackle`, `tick`, `shimmer`, `sting` or `sweep`. Each one replaces the synthesised cue at the same time.

## Layout

```
timing.json            single source of truth for all timing
logo.png               the supplied logo (untouched)
assets/                logo alpha texture, trace paths, NASA textures
tools/                 vectorize_logo.py (potrace routes), review_still.py (step-2 still)
web/                   the scene: world, camera, earth, moon, stars, laser, trace, logo, post, main
render/                render.js (puppeteer-core + ffmpeg), build_all.js
sound/                 make_sound.py
review/                review stills / contact sheets
```

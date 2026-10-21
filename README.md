# Twenty-Four

A 24 hour track ultramarathon, in real time. 400 meters, 24 hours, one oval.
Play in VR on a Meta Quest (WebXR) or in any browser, including phones.

- **Run** by swinging your arms (VR), or tapping L/R in rhythm (phone; F/J on a keyboard).
- **Don't stop dead.** Stop moving your legs at speed and you trip.
- **Eat ~100 kcal per mile**, drink, and get salt from the aid table just before the finish line.
  In VR, grip an item and lift it to your mouth. On a phone, tap it as you pass. Slow down or you'll fumble it.
- The race clock is real and never stops. Leave and you're sitting in a camp chair.

A good day is ~100 miles. A heroic one is ~200.

## Run locally

```bash
python3 -m http.server 8024
```

Open http://localhost:8024. No build step; Three.js loads from a CDN.

To play on a Quest over USB without publishing anywhere:

```bash
adb reverse tcp:8024 tcp:8024
```

Then open `http://localhost:8024` in the Quest Browser and press **Enter VR**.

### Dev flags

- `?dev`: `C` toggles cruise control, `T` skips an hour (in the chair). `window.__t24` exposes state.
- `?ts=60`: race clock runs 60x faster.

## Tuning

`src/sim.js` is the physiology model (fuel, gut absorption, sweat, sodium, leg damage, drowsiness).
`node tools/simulate.mjs` runs scripted 24 hour races to check the distance balance, and
`node tools/armswing.mjs` checks the VR arm-swing detector with synthetic motion.

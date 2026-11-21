# Domain Expansion

Webcam hand-sign game: make a Jujutsu Kaisen domain-expansion hand sign, hold it, and your
camera turns into the domain. Runs in the browser; the phone version works offline.

**Play on your phone:** https://dhruv-k24.github.io/Domain_Expansion/phone.html
(open once online, wait ~30s, then "Add to Home screen" — after that it works without internet)

## Domains
Malevolent Shrine · Unlimited Void · Chimera Shadow Garden · Coffin of the Iron Mountain

## Run it
```
npm install
npm run dev          # laptop: training UI, test keys T/Y/U/I
npm run dev:phone    # phone over Wi-Fi (HTTPS), open <network address>/phone.html
npm run eval         # accuracy report for the trained signs
npm run deploy       # build + publish to GitHub Pages
```

## How it works
- **Hand tracking:** MediaPipe Hand Landmarker, smoothed (One Euro filter) with memory + zoomed re-detection
- **Sign recognition:** k-nearest neighbours on normalised hand landmarks (`data/signs.json`)
- **Effects:** Canvas 2D domains (`src/domains/`) + WebGL post-processing (bloom, heat haze)
- **You:** body segmentation, face landmarks (Sukuna's eyes, Gojo's eyes)
- **Offline:** a service worker caches the app and AI models

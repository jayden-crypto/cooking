# Sightline

A cinema booking app where you **see the exact view from your seat before you book**.

Pick a showtime and you're dropped into a 3D model of that screen, looking from the best free seat. The film is playing, the people who already bought tickets are sitting in front of you, and a card underneath gives you the numbers:

- **Distance to the screen**, **how much of your view the picture fills** (field of view) and **how far off centre** you are
- A verdict: *Sweet spot*, *Great view*, *Up close*, *Side view* or *Relaxed view*
- Whether you'll see over the heads in front (the sightline "C-value" cinema designers use) and whether you'll be craning your neck

Swipe the card up for the seat map. Tap a seat to jump there, or drag your finger across the map and the 3D view follows you around the room. Drag the 3D view itself to look around. **Best available** takes you to the best free seat, and **Colour seats by view quality** turns the map into a heat map.

Booking for a group: tap **Add** on each seat, then **Continue**. The ticket keeps a picture of your view.

> This is a design prototype. The cinema, films, prices and audience are made up, no payment is taken, and bookings are only saved in your browser.

## What's in it

| | |
| --- | --- |
| **3 screens** | *Grand* (16 m curved screen, 286 seats), *Studio* (11 m, 180 seats), *Salon* (8.5 m, 72 recliners). Each has its own rake, row spacing, aisles and curved rows. |
| **5 films** | Original animated scenes drawn live on the 3D screen. The room is lit by whatever's on screen. |
| **A week of showtimes** | 12 a day. Seats sold depend on the film, the time of day and how good the seat is, so evening shows fill up and the sweet spots go first. |

## Run it

It's plain HTML, CSS and JavaScript with no build step.

```bash
cd seat-view
npm run dev      # http://localhost:3001
npm test         # seat geometry, scoring and occupancy
```

Any static file server works too (`npx serve seat-view`, `python3 -m http.server -d seat-view`). It has to be served over http(s); opening `index.html` straight from disk won't load the modules.

### Put it online

On [Vercel](https://vercel.com): **Add New → Project**, pick this repository, set **Root Directory** to `seat-view` and press **Deploy**. On your phone, open the address and use **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android).

## How it works

| File | What it does |
| --- | --- |
| `js/layout.js` | Turns a screen's spec (screen size, rows, blocks, rake, spacing) into seat positions and eye heights, then works out each seat's distance, field of view, offset, viewing angles, sightline clearance and a 0–100 score. The 3D room, the map and the numbers all come from here, so they always agree. |
| `js/theater.js` | The 3D room (three.js): curved stepped floor, instanced seats with velvet shading, heads for sold seats, curtains, aisle lights. The camera sits at the seat's eye height with a fixed lens, so seats can be compared fairly. |
| `js/films.js` | The five films, drawn on a canvas each frame and used as the screen texture and the posters. |
| `js/seatmap.js` | SVG seat map built from the layout, with tap, drag-to-scrub and heat-map colouring. |
| `js/data.js` | The cinema, screens, films, showtimes, prices and seeded seat sales. |
| `js/store.js` | Bookings and preferences in `localStorage`. |
| `js/app.js` | Screens, the pull-up sheet, booking flow. |
| `js/routes.js` | Page addresses like `#show-2026-11-12-tidewater-2000-seat-F8`, so a seat view can be shared as a link. |
| `vendor/` | three.js r170 (MIT), so the app works without a CDN. |

### Scoring

A seat's score blends four things:

- **Field of view (42%)**: best around 53–59°, falling off as the picture gets too big (front rows) or too small (back rows)
- **Off-axis angle (30%)**: how far you're looking at the screen from the side
- **Neck angle (16%)**: how far you look up (or down) to the middle of the picture
- **Sightline (12%)**: how far the line from your eye to the bottom of the screen clears the eyes of the person in front (6 cm is the usual minimum, 12 cm means a clear view over heads)

A score of 93 or more is a *Sweet spot*. Change the weights in `seatMetrics()` and the labels in `verdict()`.

### Adding a real cinema

Describe each screen the way `AUDITORIUMS` in `js/data.js` does (screen width and height off the floor, number of rows, seats per block, seat and row spacing, aisle width, distance to the first row, step height). Everything else follows. Swap `takenSeats()` for a call to your ticketing system, and the films' animated scenes for trailer stills or video.

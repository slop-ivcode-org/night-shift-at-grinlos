# Night Shift at Grinlo's

A browser horror game in the style of *Five Nights at Freddy's*. You work the night shift at Grinlo's Pizza Party. Watch the security cameras, manage your power, and shut the doors before the animatronics get into your office. Survive from 12 AM to 6 AM.

The game is plain HTML, CSS and JavaScript. There are no dependencies and no build step. All graphics are drawn on a `<canvas>` and all sounds are made with the Web Audio API, so there are no image or audio files.

## Running

Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari).

You can also serve the folder over HTTP if you like:

```sh
npx serve .
# or
python -m http.server
```

Use headphones if you can. Browsers block sound until you interact with the page, so click anywhere first.

## Controls

| Key | Action |
|-----|--------|
| `Space` / `S` | Raise or lower the camera monitor |
| `←` / `→` | Previous / next camera (while the monitor is up) |
| Click map | Switch to that camera |
| `A` / `D` | Close or open the left / right door |
| `Q` / `E` | Turn the left / right hall light on or off |

You can also click the buttons on screen.

## How to Play

- Each hour lasts 45 seconds, so a full night (12 AM to 6 AM) takes about 4.5 minutes.
- Doors, lights and cameras all use **power**. The usage meter shows how fast it is draining. If power reaches 0%, everything shuts off and Grinlo comes for you.
- You can't use the doors or lights while the monitor is up.
- Turn on a hall light to see whether something is standing in that doorway.
- If a door or light button stops working, a monster is already inside the office. Lowering the monitor at that point is a bad idea.

### The Animatronics

| Name | Animal | Door | Behavior |
|------|--------|------|----------|
| **Patches** | Rabbit | Left | Wanders through Backstage, the West Hall and the Supply Closet, then shows up at the left door. Shut the door and he gives up and goes back. |
| **Clank** | Crow | Right | Moves through the Restrooms, the Kitchen (audio only) and the East Hall, then shows up at the right door. |
| **Grinlo** | Bear | Right | Only moves when you are **not** watching him on camera. Laughs when he moves. Gets in only while your cameras are up and the right door is open. |
| **Mimi** | Fox | Left | Hides behind the curtain in Curtain Cove (CAM 1C). If you don't check the cameras she slowly comes out, then **runs** down the West Hall. Close the left door in time. Each time she bangs on the door it costs you more power. |

### Progression

- **Nights 1–5** get harder each night, and the monsters also get more active as each night goes on.
- **Night 6** unlocks after you beat Night 5.
- **Custom Night** lets you set each monster's difficulty (AI) from 0 to 20.
- Your progress is saved in `localStorage`. Use **Continue** on the main menu to pick up at the highest night you've reached.

## Project Structure

```
index.html   Page layout: menus, HUD, door buttons, camera map
style.css    Styling and responsive 16:9 scaling
game.js      Game loop, monster AI, rendering and synthesized audio
```

### Tweaking

These values in `game.js` are easy to change:

- `HOUR_SECONDS`: how long each in-game hour lasts.
- `NIGHT_AI`: each monster's difficulty (AI level) for each night.
- `DEFS`: each monster's movement routes, starting room and how often it tries to move.
- `CAPTIONS`: the phone-call messages shown on each night.
- The power drain rate is set in `update()`.

`window.__nightShiftDebug()` returns the current game state, which helps when testing from the browser console.

## Credits

A fan-style homage to *Five Nights at Freddy's* by Scott Cawthon. All characters, art and audio in this project are original.

# Damage numbers

Each damage or healing event creates its own number. Its family, colour, gradient, outline and shadow remain the existing game style. All ordinary values use the same smaller base size; only critical hits receive the source critical animation. Nearby numbers can overlap naturally.

## iGame reference

The registered reference project is `E:\WindowsWorkspace\igame-tft`. Its `src/render/battle/overlay.ts` implements `pickRow`, `waypoints`, `addPopup` and the `DAMAGE_ALPHA`, `CRIT_ALPHA`, `CRIT_SCALE`, and `CRIT_Y` keyframes. That overlay reads the generated `src/lua/igame/Config/SkillDamagePopup.lua`, whose source table is read-only `D:\P4\main\Client\CsvTable\SkillDamagePopup.csv`. The local mirror and source table were read without checkout.

| Use | SkillDamagePopup row | Total life | Travel time | Path data used here |
|---|---:|---:|---:|---|
| Damage | 11 | 1.5 s | 0.5 s | Mode 1; start jitter 0.1 / 0.15; destination variation 0.25 / 0.05; initial velocity 150 / 132; velocity variation 0.15 / 0.1; acceleration −250 / −612 |
| Critical | 5 | 1.5 s | 0.1 s | Mode 2; row scale 0.5, 50 px glyph size, source critical scale, alpha and vertical keyframes |
| Heal / label | 9 | 1.5 s | 1.0 s | Mode 2; key points (0.3, 0, 0) and (1.0, 0, 20); scale 1.1 |

`public/js/render/dmgNumbers.js` carries those rows and the source keyframes; `public/js/render/fx.js` projects the sampled UI-unit path using 56 UI units per world tile, as the iGame-TFT overlay does. Damage direction follows the known attacker; without one it uses the source overlay's default positive direction. Same-frame events use iGame's per-kind launch delays (damage 0.07 s, critical 0.09 s, heal 0.03 s, text 0.15 s, repeating each three events).

Normal numbers use `anui_font_battle_damage` alpha keys (1.0 at birth, 0.9 at 0.25 s, 0 at 0.5 s), while their record remains for the row's 1.5 s total time. Critical numbers use the source critical alpha, scale and y keys. No HP-share tiers, value-based font sizes, running-total merge, density-based life adjustment, per-unit cap, box reservation, lane search, overlap fade or trajectory avoidance remain. Pooling only reuses Pixi text objects after a popup expires.

The base font scale is uniformly 0.8 of the previous normal scale to satisfy the requested smaller on-board text. Critical glyphs retain the source 50:22 critical-to-normal font-size ratio and row-5 0.5 object scale. Heal and fallback numbers no longer use separate HP-based size tiers. The 2D fallback uses the same source waypoints, time, colours and font family, with Web Animations for the per-hit path; it retains its existing fallback outline/shadow treatment.

## Validation

`node --test test/render/dmgnumbers.test.js test/render/fxnumbers.test.js` verifies the source row values, path endpoints and holds, alpha/critical keyframes, one number per event, heal and crit display, pooling, and that crowd overlap does not reposition or shorten a popup. Browser evidence is stored at `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\growth-destination-20261008\damage-popup`.

# Damage numbers (跳字)

The rules for the floating numbers over units in battle. Code: `public/js/render/dmgNumbers.js` holds the rules.
`render/fx.js` (`FxSystem.number`) applies them, and so does the 2D fallback field (`ui/fallbackField.js`, tiers only).
Tests: `test/render/dmgnumbers.test.js` and `test/render/fxnumbers.test.js`.

Before this change, numbers had one size, except for a single 1.35× step at ≥ 18 % of max HP.
They hopped between five lanes (centre, left, right, far left, far right), taking whichever slot was lowest at that moment.
To a viewer this read as random scatter.
Chip damage (element gauge ticks, damage over time) was as loud as a skill hit.
Crits and dodges showed only as particles, never on the number.

## Inputs

| Input | Source |
|---|---|
| Amount and type | the `['dmg', target, amount, type, attackerId?, attackId?]` tuple, and `['heal', id, amount]` |
| Attacker | the tuple's `attackerId` |
| Crit | an fx `'crit'` in the same frame at the target's spot. The sim sends it before or after the hit's `dmg`; both orders are handled |
| Dodge | an fx `'dodge'` on the unit |
| Max HP | the target view |

Older streams and recordings have no `attackerId`. Their numbers simply rise.

## Rules

1. **Number per event, not per recipe.** Every `dmg` and `heal` cue gets its number in `FxSystem.play()`, after the cue's recipe has run.
   - Character VFX recipes (fxRecipes.js) only draw the hit.
   - *Why:* a recipe that replaces the hit flash (迷迭香, 锏) used to drop the number with it.
2. **Tier = share of the target's max HP.**
   - Tiers: chip < 3 % ≤ normal < 12 % ≤ heavy < 30 % ≤ massive.
   - Without max HP, a 1000 HP reference applies.
   - Heals and element gauge fills (not HP) stop at normal.
   - A crit is at least heavy.
   - A merged running total is re-tiered from its total.
   - *Why relative, not a fixed scale:* HP ranges from a few hundred (drones) to 400k (bosses), and damage grows by round. The same 500 is news on a 2000 HP caster and noise on a boss. "How much of this unit did that take" is what the viewer reads the number for.
3. **Look per tier** (`TIER_LOOK`):

   | Tier | Scale | Birth pop | Life (s) | Opacity | Merge window (s) |
   |---|---|---|---|---|---|
   | chip | 0.78 | 1.08 | 0.7 | 0.8 | 0.5 |
   | normal | 1 | 1.3 | 0.9 | 1 | 0.3 |
   | heavy | 1.28 | 1.5 | 1.1 | 1 | 0.3 |
   | massive | 1.55 | 1.65 | 1.3 | 1 | 0.3 |

   - *Why:* big hits must stand out and small ones must not compete. Size, pop and life all scale together, so one glance ranks them.
4. **Path means something.**
   - **arc**: there is a known attacker. The number drifts 0.42 tile away from the attacker on screen, decelerating over 0.5 s, while it rises. Target right of the attacker means it drifts right.
   - **rise**: no attacker is known (area, damage over time, element gauge), or it is a heal or a label. The number goes straight up.
   - **crit**: no drift. It punches in place while it rises.
   - All paths rise the same 0.45 tile over 0.9 s (easeOut).
   - *Why:* sideways means "knocked away from that attacker" and straight up means "no single attacker". A shared rise curve keeps the layout's no-overlap guarantee: a younger number never catches up with an older one in its column.
5. **Placement is deterministic.**
   - A number starts at its unit's head.
   - If that spot is taken, it stacks up in its own column, up to 2 lines.
   - It then spills outwards, on its drift side only: lanes 0, +1, +2, or 0, −1, −2.
   - With no attacker, the order alternates 0, +1, −1 / 0, −1, +1 by the unit's hit count.
   - The layout reserves each box swept over its remaining drift, so a drifting number never runs into a neighbour.
   - Hard limits:
     - at most 5 lines up
     - at most 4 numbers per unit (then the hit merges, or the oldest fades)
     - more than 6 numbers near a spot shortens lives to 62 %
   - Nothing uses `Math.random`. The same event stream gives the same picture.
   - *Why:* lanes chosen by "lowest free slot right now" were the random look. The no-overlap guarantee is kept, from the '41509' fix.
6. **Merging.**
   - A same-style hit on a unit joins its youngest number when:
     - it lands within that number's merge window after its last hit, and
     - that number is younger than 0.5 s.
   - The total re-pops and stays up longer (≤ 1.8 s).
   - Chip numbers keep a 0.5 s window, so damage-over-time and gauge ticks fold into one growing number.
   - Crits and labels never merge.
   - *Why:* rapid small hits are one event to a viewer. A crit is its own event.
7. **Markers and font effects.**
   - Colour is by damage type, unchanged: physical orange-white, arts purple, true white, element orange, heal green.
   - Heals get `+`.
   - Crits get a trailing `!`, ×1.12 scale and a punch: 1.9× → 0.85× → 1.05× → 1× in 0.2 s.
   - A dodge shows `MISS` as a small, quiet label that rises.
   - The font effects stay: gradient fill, 7 px outline, drop shadow. The font family is unchanged; only `M I S` were added to the bitmap glyph set.
   - *Why:* these are the reference games' markers; see the next section.

## Where the rules came from

**igame-tft** (`src/render/battle/overlay.ts`, after iGame's BattlePopup.lua):
- The crit punch keyframes: `anui_font_battle_critical`, compressed.
- Crits don't drift.
- The normal popup's sideways parabola away from `dir`: SkillDamagePopup row 11, about 44 UI units over 0.5 s, ≈ 0.42 tile here.
- Heals go straight up: row 9.
- Per-type glyph colours plus a crit marker; here `!` stands in for the crit icon glyph.
- Same-tick popups on one unit are ordered rather than piled: iGame staggers them by delay. Here they stack in the unit's column.

Dropped from iGame:
- Its random start and destination jitter (`RandomIniPos` / `RandomDestPos`). It is exactly the "random scatter" being removed.

**League of Legends / TFT** (patch notes 1.0.0.138 and 9.13, the client settings page):
- One colour per damage type, with true damage white. A crit keeps its type's colour and differs by an icon and a punchier animation.
- The crit animation is never put on non-crit hits.
- Dodge, miss and block get their own text, which can be toggled separately.
- Riot documents no size scaling, merging or arc rules, so those come from igame-tft and the reasoning above.

## Upstream

The `attackerId` / `attackId` fields of `dmg` are this fork's protocol extension. Upstream's tuples end at `type`.
Without them, every number takes the rise path; tiers, merging, crit and dodge markers work as is.

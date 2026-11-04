# Existing game reference

- Source commit: `4ed1ad32ec10da15c23f9d7939dade603950759b`
- Source repository: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol`
- Active workshop roster: 101
- Compatibility design entries: 53
- Design entries: 154
- Active roster with normal and elite skills, talents, and native growth attributes: 101/101
- Missing records: 0

The JSON retains the complete source objects for workshop forms, native roster metadata, designs, player facing text, native power records, strategy choices, bonds, bands, garrisons, equipment, effects, and faction classifications. Source fields are preserved as authored; derived coverage is limited to roster resolution and category enumeration.

## Source files
- `data/chess.json`
- `data/bonds.json`
- `data/items.json`
- `data/choices.json`
- `data/bands.json`
- `data/garrisons.json`
- `data/effects.json`
- `data/factions.json`
- `data/native-factions.json`
- `data/native-skill-trigger-source.json`
- `data/independent-design.json`
- `data/independent-game-text.json`
- `data/independent-native-power.json`
- `data/independent-source-reference.json`
- `data/independent-roster-plan.json`
- `data/independent-darkmoon-design-addon.json`
- `data/independent-darkmoon-game-text-addon.json`

## Missing active roster records
- None

## Enumerated categories
- professions: CASTER, MEDIC, PIONEER, SNIPER, SPECIAL, SUPPORT, TANK, TOKEN, WARRIOR
- bondTypes: REGULAR, SEASON
- itemTypes: EQUIP, MAGIC
- choiceTypes: BOUNTY_HUNT, BUFF_SELECT, EQUIP_FREE, PERSONAL_CHOOSE
- choiceEffectTypes: BUFF_GAIN, ENEMY_GAIN, EQUIP
- choiceFamilies: bounty, shop, supply, tactic
- garrisonEventTypes: IN_BATTLE, SERVER_CHESS_SOLD, SERVER_GAIN, SERVER_PREP_FIN, SERVER_PREP_START, SERVER_PRICE, SERVER_REFRESH_SHOP
- garrisonEffectTypes: ADD_BOND, GAIN_BUFF, NONE, SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER, SERVER_ADD_BOND, SERVER_ADD_BOND_ACTIVATED_MOST_LAYER, SERVER_ADD_BOND_CHESS_ALL, SERVER_ADD_BOND_IN_HAND, SERVER_ADD_BOND_METHOD, SERVER_ADD_BOND_POSITION, SERVER_ADD_BOND_ROUND_COIN_COST, SERVER_ADD_MULTIPLE_BOND, SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER, SERVER_CHESS_PRICE, SERVER_FRONT_SAME_EFFECT_PREP_FIN, SERVER_FRONT_SAME_EFFECT_PREP_START, SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT, SERVER_GAIN_EQUIP, SERVER_GAIN_FREE_REFRESH_COUNT, SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL, SERVER_MOST_BOND, SERVER_ONCE_GOLD, SERVER_ONCE_GOLD_WITH_BOND_CONDITION, SERVER_POOL_CHAR, SERVER_POOL_EQUIP, SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS, SERVER_TRIGGER_ANOTHER, SERVER_TRIGGER_FRONT_COUNT
- effectTypes: BAND_INITIAL, BOND, BUFF_GAIN, CHAR_MAP, ENEMY, ENEMY_GAIN, EQUIP
- IDs retained in JSON: bondIds 23; bandIds 40; bandEffectIds 40; garrisonIds 249; itemIds 115; effectIds 361

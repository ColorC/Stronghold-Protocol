# TFT Set18 reference

- Sources: CommunityDragon client 16.20.1; TFTraits publication 18-18.4.0.BF63CD5E.u09ac2d13s5 (last modified Wed, 07 Oct 2026 23:29:53 GMT); Riot 18.4B announcement dated 2026-10-07.
- Mutator: `TFTSet18`; source set number: 18; raw legacy name: `Set10`; displayed as Set18.
- Exact native recruitable identities: 65; published champion references: 65; ability forms: 79; published traits: 36; published items: 571 (257 marked augment); Wisp cards: 152.
- Native shop pool by tier: T1 14 kinds / 420 copies; T2 13 kinds / 325 copies; T3 14 kinds / 252 copies; T4 14 kinds / 140 copies; T5 10 kinds / 90 copies. Published/candidate augment lists do not establish the currently active legal pool; live availability is unknown.
- TFTraits champion stats, cast data, roles and traits are reference data. Build recommendations and simulated DPS fields are excluded. Each form lists only source variable indices 1★, 2★ and 3★; no fourth-star claim is inferred from later array elements.
- Skill tokens: 648 exact variable substitutions; unresolved entries 0. Icon tokens are rendered as stat labels only.

## Champions and ability forms

Each champion is joined by exact `characterId` to one native Set18 shop identity. Ability values are shown per source variable index; form stats and original variable objects remain in JSON.

### Akali — `DA_18_Akali_AD`

Cost 1; role ADFighter; traits Ravager, Inferno, Adaptor; native shop tier 1, copies 30.
Stats: HP 650, mana 0/25, AD 40, armor/MR 35/35, attack speed 0.75, range 1.

**base**; role ADFighter; stats HP 650, mana 0/25, AD 40, AS 0.75.
Ability: Kunai Strike.
- 1★: Adaptor AD: Throw a volley of kunai at the target, dealing <physicalDamage>145%&nbsp;(AD) + 10&nbsp;(AP)</physicalDamage> physical damage. If the target is Burning, deal an additional 35%&nbsp;(AD) damage. Adaptor AP: If the Ability kills, cast it again.
- 2★: Adaptor AD: Throw a volley of kunai at the target, dealing <physicalDamage>220%&nbsp;(AD) + 15&nbsp;(AP)</physicalDamage> physical damage. If the target is Burning, deal an additional 52%&nbsp;(AD) damage. Adaptor AP: If the Ability kills, cast it again.
- 3★: Adaptor AD: Throw a volley of kunai at the target, dealing <physicalDamage>380%&nbsp;(AD) + 25&nbsp;(AP)</physicalDamage> physical damage. If the target is Burning, deal an additional 80%&nbsp;(AD) damage. Adaptor AP: If the Ability kills, cast it again.

**base.adaptorAlt** (AP); role APFighter; stats HP 650, mana 0/25, AD 30, AS 0.75.
Ability: Kunai Strike.
- 1★: Adaptor AP: Throw a volley of kunai at the target, dealing <magicDamage>140&nbsp;(AP)</magicDamage> magic damage, increased by 50% if they're a Tank. If the target dies, cast again at 70% effectiveness. Adaptor AD: Bonus damage to Burning enemies.
- 2★: Adaptor AP: Throw a volley of kunai at the target, dealing <magicDamage>210&nbsp;(AP)</magicDamage> magic damage, increased by 50% if they're a Tank. If the target dies, cast again at 70% effectiveness. Adaptor AD: Bonus damage to Burning enemies.
- 3★: Adaptor AP: Throw a volley of kunai at the target, dealing <magicDamage>365&nbsp;(AP)</magicDamage> magic damage, increased by 50% if they're a Tank. If the target dies, cast again at 70% effectiveness. Adaptor AD: Bonus damage to Burning enemies.

### Camille — `DA_18_Camille`

Cost 1; role ADFighter; traits Ravager, Coven; native shop tier 1, copies 30.
Stats: HP 700, mana 0/25, AD 40, armor/MR 40/40, attack speed 0.75, range 1.

**base**; role ADFighter; stats HP 700, mana 0/25, AD 40, AS 0.75.
Ability: Defensive Sweep.
- 1★: Slice the target for <physicalDamage>150%&nbsp;(AD) + 10&nbsp;(AP)</physicalDamage> physical damage and gain <healing>60</healing> Shield for <healing>2</healing> seconds.
- 2★: Slice the target for <physicalDamage>225%&nbsp;(AD) + 15&nbsp;(AP)</physicalDamage> physical damage and gain <healing>90</healing> Shield for <healing>2</healing> seconds.
- 3★: Slice the target for <physicalDamage>375%&nbsp;(AD) + 25&nbsp;(AP)</physicalDamage> physical damage and gain <healing>200</healing> Shield for <healing>2</healing> seconds.

### Cinderling — `DA_Cinderling18`

Cost 1; role ADCaster; traits Riftbeast, Hunter; native shop tier 1, copies 30.
Stats: HP 500, mana 0/50, AD 40, armor/MR 25/25, attack speed 0.7, range 4.

**base**; role ADCaster; stats HP 500, mana 0/50, AD 40, AS 0.7.
Ability: Razor Leaves.
- 1★: Summon five razor-sharp leaves that converge on the current target, dealing a total of <physicalDamage>310%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage and applying 20% Wound and 1% Burn for 4 seconds. Scarlet Buff: Cinderling gains 22% Attack Damage each cast. Wound: Reduces healing received. Burn: Deals a percent of the target’s max Health as true damage every second.
- 2★: Summon five razor-sharp leaves that converge on the current target, dealing a total of <physicalDamage>465%&nbsp;(AD) + 45&nbsp;(AP)</physicalDamage> physical damage and applying 20% Wound and 1% Burn for 4 seconds. Scarlet Buff: Cinderling gains 22% Attack Damage each cast. Wound: Reduces healing received. Burn: Deals a percent of the target’s max Health as true damage every second.
- 3★: Summon five razor-sharp leaves that converge on the current target, dealing a total of <physicalDamage>700%&nbsp;(AD) + 70&nbsp;(AP)</physicalDamage> physical damage and applying 20% Wound and 1% Burn for 4 seconds. Scarlet Buff: Cinderling gains 22% Attack Damage each cast. Wound: Reduces healing received. Burn: Deals a percent of the target’s max Health as true damage every second.

### Karma — `DA_Karma18`

Cost 1; role APCaster; traits Blossom, Spellweaver; native shop tier 1, copies 30.
Stats: HP 500, mana 0/40, AD 25, armor/MR 25/25, attack speed 0.7, range 4.

**base**; role APCaster; stats HP 500, mana 0/40, AD 25, AS 0.7.
Ability: Karmic Bond.
- 1★: Tether the current target, dealing <magicDamage>280&nbsp;(AP)</magicDamage> magic damage over 1.5 seconds. Then release a burst of power around them, dealing <magicDamage>125&nbsp;(AP)</magicDamage> magic damage to all enemies in a 1 Hex radius and 30% Slowing them for 2 seconds. Slow: Reduce Attack Speed
- 2★: Tether the current target, dealing <magicDamage>420&nbsp;(AP)</magicDamage> magic damage over 1.5 seconds. Then release a burst of power around them, dealing <magicDamage>185&nbsp;(AP)</magicDamage> magic damage to all enemies in a 1 Hex radius and 30% Slowing them for 2 seconds. Slow: Reduce Attack Speed
- 3★: Tether the current target, dealing <magicDamage>630&nbsp;(AP)</magicDamage> magic damage over 1.5 seconds. Then release a burst of power around them, dealing <magicDamage>300&nbsp;(AP)</magicDamage> magic damage to all enemies in a 1 Hex radius and 30% Slowing them for 2 seconds. Slow: Reduce Attack Speed

### Kobuko — `DA_18_Kobuko`

Cost 1; role APTank; traits Sprykin, Brawler; native shop tier 1, copies 30.
Stats: HP 700, mana 0/90, AD 55, armor/MR 40/40, attack speed 0.65, range 1.

**base**; role APTank; stats HP 700, mana 0/90, AD 55, AS 0.65.
Ability: Dance of Life.
- 1★: Restore <healing>285&nbsp;(AP) + 7%&nbsp;(HP) max Health</healing> over 2 seconds. The next attack is replaced with a bash that deals <magicDamage>10%&nbsp;(HP) max Health + 70&nbsp;(AP)</magicDamage> magic damage.
- 2★: Restore <healing>335&nbsp;(AP) + 7%&nbsp;(HP) max Health</healing> over 2 seconds. The next attack is replaced with a bash that deals <magicDamage>10%&nbsp;(HP) max Health + 105&nbsp;(AP)</magicDamage> magic damage.
- 3★: Restore <healing>480&nbsp;(AP) + 7%&nbsp;(HP) max Health</healing> over 2 seconds. The next attack is replaced with a bash that deals <magicDamage>10%&nbsp;(HP) max Health + 150&nbsp;(AP)</magicDamage> magic damage.

### Leona — `DA_18_Leona`

Cost 1; role APTank; traits Solar, Defender; native shop tier 1, copies 30.
Stats: HP 750, mana 0/90, AD 50, armor/MR 40/40, attack speed 0.65, range 1.

**base**; role APTank; stats HP 750, mana 0/90, AD 50, AS 0.65.
Ability: Shield Bash.
- 1★: Passive: Start combat with 60&nbsp;(AP) bonus Armor and Magic Resist that decays over 12 seconds. Active: Bash the current target, dealing <magicDamage>150%&nbsp;(%i:scaleArmor%)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 2★: Passive: Start combat with 80&nbsp;(AP) bonus Armor and Magic Resist that decays over 12 seconds. Active: Bash the current target, dealing <magicDamage>270%&nbsp;(%i:scaleArmor%)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 3★: Passive: Start combat with 100&nbsp;(AP) bonus Armor and Magic Resist that decays over 12 seconds. Active: Bash the current target, dealing <magicDamage>405%&nbsp;(%i:scaleArmor%)</magicDamage> magic damage and Stunning them for 1.5 seconds.

### Ornn — `DA_18_Ornn`

Cost 1; role APTank; traits Elderwood, Defender; native shop tier 1, copies 30.
Stats: HP 700, mana 30/100, AD 40, armor/MR 40/40, attack speed 0.6, range 1.

**base**; role APTank; stats HP 700, mana 30/100, AD 40, AS 0.6.
Ability: Bellows Breath.
- 1★: Active: Gain <healing>400&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and deal <magicDamage>200&nbsp;(AP)</magicDamage> magic damage to enemies in a cone. Quest: Each player combat, Ornn stores damage blocked as Forge Power, increased by 85% at 3-star. Gain an Artifact Anvil each time he gains enough Forge Power.
- 2★: Active: Gain <healing>460&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and deal <magicDamage>300&nbsp;(AP)</magicDamage> magic damage to enemies in a cone. Quest: Each player combat, Ornn stores damage blocked as Forge Power, increased by 85% at 3-star. Gain an Artifact Anvil each time he gains enough Forge Power.
- 3★: Active: Gain <healing>550&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and deal <magicDamage>450&nbsp;(AP)</magicDamage> magic damage to enemies in a cone. Quest: Each player combat, Ornn stores damage blocked as Forge Power, increased by 85% at 3-star. Gain an Artifact Anvil each time he gains enough Forge Power.

### Pebbles — `DA_18_Sentry`

Cost 1; role APCaster; traits Riftbeast, Invoker; native shop tier 1, copies 30.
Stats: HP 500, mana 0/70, AD 35, armor/MR 25/25, attack speed 0.8, range 4.

**base**; role APCaster; stats HP 500, mana 0/70, AD 35, AS 0.8.
Ability: Azure Laser.
- 1★: Begin consuming 35% max Mana per second and channeling a laser on the target. Each second while casting, deal <magicDamage>160&nbsp;(AP)</magicDamage> magic damage to them and reduce their Magic Resist by 3. Teal Buff: Gain 2 Mana Regen for every 4 seconds channeled.
- 2★: Begin consuming 35% max Mana per second and channeling a laser on the target. Each second while casting, deal <magicDamage>240&nbsp;(AP)</magicDamage> magic damage to them and reduce their Magic Resist by 3. Teal Buff: Gain 2 Mana Regen for every 4 seconds channeled.
- 3★: Begin consuming 35% max Mana per second and channeling a laser on the target. Each second while casting, deal <magicDamage>360&nbsp;(AP)</magicDamage> magic damage to them and reduce their Magic Resist by 3. Teal Buff: Gain 2 Mana Regen for every 4 seconds channeled.

### Rakan — `DA_18_Rakan`

Cost 1; role APTank; traits Juggernaut, Fae, Vanguard; native shop tier 1, copies 30.
Stats: HP 700, mana 0/105, AD 45, armor/MR 35/35, attack speed 0.6, range 1.

**base**; role APTank; stats HP 700, mana 0/105, AD 45, AS 0.6.
Ability: Entrancing Dance.
- 1★: Gain <healing>290&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds. Then grant the ally who has dealt the most damage this combat 1.9&nbsp;(AP) + 1&nbsp;(AP) decaying Attack Speed for 4 seconds.
- 2★: Gain <healing>340&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds. Then grant the ally who has dealt the most damage this combat 2&nbsp;(AP) + 1&nbsp;(AP) decaying Attack Speed for 4 seconds.
- 3★: Gain <healing>435&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds. Then grant the ally who has dealt the most damage this combat 2.3&nbsp;(AP) + 1&nbsp;(AP) decaying Attack Speed for 4 seconds.

### Rek'Sai — `DA_18_RekSai`

Cost 1; role APTank; traits Brawler, Blackthorn; native shop tier 1, copies 30.
Stats: HP 700, mana 0/100, AD 50, armor/MR 40/40, attack speed 0.55, range 1.

**base**; role APTank; stats HP 700, mana 0/100, AD 50, AS 0.55.
Ability: Uproot.
- 1★: Passive: Restore <healing>10</healing> Health each second, tripled for 3 seconds after casting. Active: Lunge out of the ground, Stunning adjacent enemies for 1 second and dealing <magicDamage>70&nbsp;(AP)</magicDamage> magic damage to them.
- 2★: Passive: Restore <healing>14</healing> Health each second, tripled for 3 seconds after casting. Active: Lunge out of the ground, Stunning adjacent enemies for 1 second and dealing <magicDamage>105&nbsp;(AP)</magicDamage> magic damage to them.
- 3★: Passive: Restore <healing>20</healing> Health each second, tripled for 3 seconds after casting. Active: Lunge out of the ground, Stunning adjacent enemies for 1 second and dealing <magicDamage>160&nbsp;(AP)</magicDamage> magic damage to them.

### Varus — `DA_18_Varus`

Cost 1; role ADCaster; traits Rapidfire, Inferno; native shop tier 1, copies 30.
Stats: HP 500, mana 0/120, AD 40, armor/MR 25/25, attack speed 0.75, range 4.

**base**; role ADCaster; stats HP 500, mana 0/120, AD 40, AS 0.75.
Ability: Piercing Arrow.
- 1★: Wind up, then fire an arrow at the most enemies in line with the target. It deals <physicalDamage>415%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage to enemies hit, reduced by 40% for each enemy it passes through (minimum 40%).
- 2★: Wind up, then fire an arrow at the most enemies in line with the target. It deals <physicalDamage>625%&nbsp;(AD) + 45&nbsp;(AP)</physicalDamage> physical damage to enemies hit, reduced by 40% for each enemy it passes through (minimum 40%).
- 3★: Wind up, then fire an arrow at the most enemies in line with the target. It deals <physicalDamage>1000%&nbsp;(AD) + 70&nbsp;(AP)</physicalDamage> physical damage to enemies hit, reduced by 40% for each enemy it passes through (minimum 40%).

### Veigar — `DA_18_Veigar`

Cost 1; role APCaster; traits Sprykin, Spellweaver, Blackthorn; native shop tier 1, copies 30.
Stats: HP 500, mana 0/30, AD 25, armor/MR 25/25, attack speed 0.7, range 4.

**base**; role APCaster; stats HP 500, mana 0/30, AD 25, AS 0.7.
Ability: Primordial Burst.
- 1★: Launch a giant blast at the target that deals <magicDamage>190&nbsp;(AP)</magicDamage> magic damage, increased to 285&nbsp;(AP) if they're below 30% max Health. If they die, permanently gain 2% Ability Power.
- 2★: Launch a giant blast at the target that deals <magicDamage>285&nbsp;(AP)</magicDamage> magic damage, increased to 430&nbsp;(AP) if they're below 30% max Health. If they die, permanently gain 2% Ability Power.
- 3★: Launch a giant blast at the target that deals <magicDamage>430&nbsp;(AP)</magicDamage> magic damage, increased to 640&nbsp;(AP) if they're below 30% max Health. If they die, permanently gain 2% Ability Power.

### Xayah — `DA_18_Xayah`

Cost 1; role ADCarry; traits Elderwood, Fae, Rapidfire; native shop tier 1, copies 30.
Stats: HP 450, mana 0/50, AD 45, armor/MR 25/25, attack speed 0.7, range 4.

**base**; role ADCarry; stats HP 450, mana 0/50, AD 45, AS 0.7.
Ability: Deadly Plumage.
- 1★: Gain 50% Attack Speed for the next 5 attacks. These attacks are replaced with feathers that deal <physicalDamage>73%&nbsp;(AD)</physicalDamage> physical damage and reduce Armor by 2&nbsp;(AP).
- 2★: Gain 50% Attack Speed for the next 5 attacks. These attacks are replaced with feathers that deal <physicalDamage>108%&nbsp;(AD)</physicalDamage> physical damage and reduce Armor by 2&nbsp;(AP).
- 3★: Gain 50% Attack Speed for the next 5 attacks. These attacks are replaced with feathers that deal <physicalDamage>165%&nbsp;(AD)</physicalDamage> physical damage and reduce Armor by 2&nbsp;(AP).

### Yorick — `DA_18_Yorick`

Cost 1; role ADTank; traits Juggernaut, Summoner, Blossom; native shop tier 1, copies 30.
Stats: HP 650, mana 0/110, AD 50, armor/MR 35/35, attack speed 0.6, range 1.

**base**; role ADTank; stats HP 650, mana 0/110, AD 50, AS 0.6.
Ability: Last Rites.
- 1★: Passive: On death, spawn a Spirit Walker with 200 + 20%&nbsp;(HP) max Health max Health which immediately taunts, forcing enemies to attack it. Active: Restore <healing>280&nbsp;(AP)</healing> Health and strike the target, dealing <physicalDamage>150&nbsp;(AP)</physicalDamage> physical damage.
- 2★: Passive: On death, spawn a Spirit Walker with 400 + 20%&nbsp;(HP) max Health max Health which immediately taunts, forcing enemies to attack it. Active: Restore <healing>325&nbsp;(AP)</healing> Health and strike the target, dealing <physicalDamage>225&nbsp;(AP)</physicalDamage> physical damage.
- 3★: Passive: On death, spawn a Spirit Walker with 750 + 20%&nbsp;(HP) max Health max Health which immediately taunts, forcing enemies to attack it. Active: Restore <healing>435&nbsp;(AP)</healing> Health and strike the target, dealing <physicalDamage>340&nbsp;(AP)</physicalDamage> physical damage.

### Alistar — `DA_18_Alistar`

Cost 2; role APTank; traits Elderwood, Brawler; native shop tier 2, copies 25.
Stats: HP 950, mana 0/90, AD 50, armor/MR 45/45, attack speed 0.6, range 1.

**base**; role APTank; stats HP 950, mana 0/90, AD 50, AS 0.6.
Ability: Triumphant Roar.
- 1★: Roar, restoring <healing>8%&nbsp;(HP) max Health</healing>, cleansing disables, and healing the two lowest percent Health allies for 80&nbsp;(AP). Then slam the current target, dealing <magicDamage>100&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 2★: Roar, restoring <healing>8%&nbsp;(HP) max Health</healing>, cleansing disables, and healing the two lowest percent Health allies for 105&nbsp;(AP). Then slam the current target, dealing <magicDamage>150&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 3★: Roar, restoring <healing>8%&nbsp;(HP) max Health</healing>, cleansing disables, and healing the two lowest percent Health allies for 130&nbsp;(AP). Then slam the current target, dealing <magicDamage>225&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.5 seconds.

### Caitlyn — `DA_18_Caitlyn`

Cost 2; role ADSpecialist; traits Hunter, Coven; native shop tier 2, copies 25.
Stats: HP 550, mana 0/3, AD 50, armor/MR 30/30, attack speed 0.7, range 4.

**base**; role ADSpecialist; stats HP 550, mana 0/3, AD 50, AS 0.7.
Ability: Headshot.
- 1★: Passive: Every third attack is replaced with a Headshot that deals <physicalDamage>190%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage.
- 2★: Passive: Every third attack is replaced with a Headshot that deals <physicalDamage>285%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage.
- 3★: Passive: Every third attack is replaced with a Headshot that deals <physicalDamage>470%&nbsp;(AD) + 45&nbsp;(AP)</physicalDamage> physical damage.

### Elise — `DA_18_Elise`

Cost 2; role APTank; traits Vanguard, Coven; native shop tier 2, copies 25.
Stats: HP 900, mana 0/70, AD 20, armor/MR 45/45, attack speed 0.65, range 1.

**base**; role APTank; stats HP 900, mana 0/70, AD 20, AS 0.65.
Ability: Spider Queen.
- 1★: Transform into a spider and gain 375 max Health. Attacks while in Spider Form deal 35&nbsp;(AP) bonus magic damage and heal for <healing>55&nbsp;(AP)</healing>. Subsequent casts grant 175% decaying Attack Speed for 4 seconds.
- 2★: Transform into a spider and gain 475 max Health. Attacks while in Spider Form deal 50&nbsp;(AP) bonus magic damage and heal for <healing>90&nbsp;(AP)</healing>. Subsequent casts grant 175% decaying Attack Speed for 4 seconds.
- 3★: Transform into a spider and gain 725 max Health. Attacks while in Spider Form deal 80&nbsp;(AP) bonus magic damage and heal for <healing>170&nbsp;(AP)</healing>. Subsequent casts grant 175% decaying Attack Speed for 4 seconds.

### Gromp — `DA_Gromp18_AP`

Cost 2; role APCaster; traits Riftbeast, Adaptor; native shop tier 2, copies 25.
Stats: HP 550, mana 0/45, AD 30, armor/MR 30/30, attack speed 0.7, range 4.

**base**; role APCaster; stats HP 550, mana 0/45, AD 30, AS 0.7.
Ability: Belchy Bubble.
- 1★: Adaptor AP: Belch a noxious bubble at the current target that explodes on the first enemy hit, dealing <magicDamage>225&nbsp;(AP)</magicDamage> magic damage. Enemies within a 1 hex radius of the explosion take <magicDamage>160&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Heavily slows the target. Purple Buff: Every 5 seconds, Gromp gains 30% Ability Power.
- 2★: Adaptor AP: Belch a noxious bubble at the current target that explodes on the first enemy hit, dealing <magicDamage>340&nbsp;(AP)</magicDamage> magic damage. Enemies within a 1 hex radius of the explosion take <magicDamage>240&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Heavily slows the target. Purple Buff: Every 5 seconds, Gromp gains 30% Ability Power.
- 3★: Adaptor AP: Belch a noxious bubble at the current target that explodes on the first enemy hit, dealing <magicDamage>535&nbsp;(AP)</magicDamage> magic damage. Enemies within a 1 hex radius of the explosion take <magicDamage>375&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Heavily slows the target. Purple Buff: Every 5 seconds, Gromp gains 30% Ability Power.

**base.adaptorAlt** (AD); role ADCaster; stats HP 550, mana 0/70, AD 45, AS 0.7.
Ability: Belchy Bubble.
- 1★: Adaptor AD: Belch a heavy bubble at the current target exploding on the first enemy hit, dealing <physicalDamage>305%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage and 30% Slows for 3 seconds. Enemies within a 1 hex radius take <physicalDamage>100%&nbsp;(AD)</physicalDamage> physical damage. Adaptor AP: Poisons enemies hit, dealing damage over time. Purple Buff: Every 5 seconds, Gromp gains 30% Attack Damage.
- 2★: Adaptor AD: Belch a heavy bubble at the current target exploding on the first enemy hit, dealing <physicalDamage>460%&nbsp;(AD) + 45&nbsp;(AP)</physicalDamage> physical damage and 30% Slows for 3 seconds. Enemies within a 1 hex radius take <physicalDamage>150%&nbsp;(AD)</physicalDamage> physical damage. Adaptor AP: Poisons enemies hit, dealing damage over time. Purple Buff: Every 5 seconds, Gromp gains 30% Attack Damage.
- 3★: Adaptor AD: Belch a heavy bubble at the current target exploding on the first enemy hit, dealing <physicalDamage>725%&nbsp;(AD) + 70&nbsp;(AP)</physicalDamage> physical damage and 30% Slows for 3 seconds. Enemies within a 1 hex radius take <physicalDamage>240%&nbsp;(AD)</physicalDamage> physical damage. Adaptor AP: Poisons enemies hit, dealing damage over time. Purple Buff: Every 5 seconds, Gromp gains 30% Attack Damage.

### Kayle — `DA_18_Kayle`

Cost 2; role APSpecialist; traits Solar, Rapidfire; native shop tier 2, copies 25.
Stats: HP 550, mana 0/0, AD 10, armor/MR 30/30, attack speed 0.75, range 4.

**base**; role APSpecialist; stats HP 550, mana 0/0, AD 10, AS 0.75.
Ability: Solar Judgement.
- 1★: Passive: Kayle ascends based on her star level, granting her stacking bonuses. 1st Ascension: Attacks deal 65&nbsp;(AP) bonus magic damage. 2nd Ascension: Attacks 20% Shred enemies hit for 2 seconds. 3rd Ascension: Attacks fire waves, dealing <magicDamage>35&nbsp;(AP)</magicDamage> magic damage to all other units hit. 4th Ascension: Gain infinite range. Every 3rd wave is much larger. Shred: Reduce Magic Resist
- 2★: Passive: Kayle ascends based on her star level, granting her stacking bonuses. 1st Ascension: Attacks deal 97&nbsp;(AP) bonus magic damage. 2nd Ascension: Attacks 20% Shred enemies hit for 2 seconds. 3rd Ascension: Attacks fire waves, dealing <magicDamage>35&nbsp;(AP)</magicDamage> magic damage to all other units hit. 4th Ascension: Gain infinite range. Every 3rd wave is much larger. Shred: Reduce Magic Resist
- 3★: Passive: Kayle ascends based on her star level, granting her stacking bonuses. 1st Ascension: Attacks deal 110&nbsp;(AP) bonus magic damage. 2nd Ascension: Attacks 20% Shred enemies hit for 2 seconds. 3rd Ascension: Attacks fire waves, dealing <magicDamage>35&nbsp;(AP)</magicDamage> magic damage to all other units hit. 4th Ascension: Gain infinite range. Every 3rd wave is much larger. Shred: Reduce Magic Resist

### LeBlanc — `DA_18_LeBlanc`

Cost 2; role APCaster; traits Elderwood, Spellweaver; native shop tier 2, copies 25.
Stats: HP 550, mana 0/40, AD 30, armor/MR 30/30, attack speed 0.7, range 4.

**base**; role APCaster; stats HP 550, mana 0/40, AD 30, AS 0.7.
Ability: Mirror Image.
- 1★: Passive: After player combat, your strongest LeBlanc has a 10% chance to create a copy of an ally on your board, increased by 4% per takedown. Active: Launch a mirror image at the current target, dealing <magicDamage>260&nbsp;(AP)</magicDamage> magic damage and 100&nbsp;(AP) to adjacent enemies.
- 2★: Passive: After player combat, your strongest LeBlanc has a 15% chance to create a copy of an ally on your board, increased by 4% per takedown. Active: Launch a mirror image at the current target, dealing <magicDamage>390&nbsp;(AP)</magicDamage> magic damage and 150&nbsp;(AP) to adjacent enemies.
- 3★: Passive: After player combat, your strongest LeBlanc has a 30% chance to create a copy of an ally on your board, increased by 4% per takedown. Active: Launch a mirror image at the current target, dealing <magicDamage>615&nbsp;(AP)</magicDamage> magic damage and 230&nbsp;(AP) to adjacent enemies.

### Murkwolf — `DA_Murkwolf18`

Cost 2; role ADReaper; traits Riftbeast, Ravager; native shop tier 2, copies 25.
Stats: HP 700, mana 0/40, AD 50, armor/MR 40/40, attack speed 0.75, range 1.

**base**; role ADReaper; stats HP 700, mana 0/40, AD 50, AS 0.75.
Ability: Rending Claws.
- 1★: Leap to the lowest Health enemy within 3 Hexes and deal <physicalDamage>100%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage. The next 2 attacks gain 175% Attack Speed and deal 60%&nbsp;(AD) bonus physical damage. Grey Buff: Gain Precision and 25% Critical Strike Chance, increased up to 75% based on missing Health.
- 2★: Leap to the lowest Health enemy within 3 Hexes and deal <physicalDamage>150%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage. The next 2 attacks gain 175% Attack Speed and deal 90%&nbsp;(AD) bonus physical damage. Grey Buff: Gain Precision and 25% Critical Strike Chance, increased up to 75% based on missing Health.
- 3★: Leap to the lowest Health enemy within 3 Hexes and deal <physicalDamage>225%&nbsp;(AD) + 45&nbsp;(AP)</physicalDamage> physical damage. The next 2 attacks gain 175% Attack Speed and deal 135%&nbsp;(AD) bonus physical damage. Grey Buff: Gain Precision and 25% Critical Strike Chance, increased up to 75% based on missing Health.

### Scuttlecrab — `DA_Scuttlecrab18`

Cost 2; role ADTank; traits Juggernaut, Riftbeast; native shop tier 2, copies 25.
Stats: HP 950, mana 0/100, AD 50, armor/MR 45/45, attack speed 0.65, range 1.

**base**; role ADTank; stats HP 950, mana 0/100, AD 50, AS 0.65.
Ability: Can You Dig It?.
- 1★: Passive: Attacks are replaced by a dance that deals <physicalDamage>50%&nbsp;(AD)</physicalDamage> physical damage to all adjacent enemies. Active: Burrow underground, gaining 15% Durability for 3 seconds and healing 325&nbsp;(AP) over the duration. Green Buff: When allies fall below <healing>50%</healing> Health, they restore 15% max Health.
- 2★: Passive: Attacks are replaced by a dance that deals <physicalDamage>75%&nbsp;(AD)</physicalDamage> physical damage to all adjacent enemies. Active: Burrow underground, gaining 15% Durability for 3 seconds and healing 400&nbsp;(AP) over the duration. Green Buff: When allies fall below <healing>50%</healing> Health, they restore 15% max Health.
- 3★: Passive: Attacks are replaced by a dance that deals <physicalDamage>112.5%&nbsp;(AD)</physicalDamage> physical damage to all adjacent enemies. Active: Burrow underground, gaining 15% Durability for 3 seconds and healing 675&nbsp;(AP) over the duration. Green Buff: When allies fall below <healing>50%</healing> Health, they restore 15% max Health.

### Sejuani — `DA_18_Sejuani`

Cost 2; role APTank; traits Juggernaut, Solar; native shop tier 2, copies 25.
Stats: HP 900, mana 0/100, AD 50, armor/MR 45/45, attack speed 0.6, range 1.

**base**; role APTank; stats HP 900, mana 0/100, AD 50, AS 0.6.
Ability: Sun's Wrath.
- 1★: Gain <healing>225&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Then cleave in a cone, dealing <magicDamage>90&nbsp;(AP)</magicDamage> magic damage and strike in a line, dealing <magicDamage>120&nbsp;(AP)</magicDamage> magic damage to enemies hit.
- 2★: Gain <healing>250&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Then cleave in a cone, dealing <magicDamage>135&nbsp;(AP)</magicDamage> magic damage and strike in a line, dealing <magicDamage>180&nbsp;(AP)</magicDamage> magic damage to enemies hit.
- 3★: Gain <healing>275&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Then cleave in a cone, dealing <magicDamage>205&nbsp;(AP)</magicDamage> magic damage and strike in a line, dealing <magicDamage>270&nbsp;(AP)</magicDamage> magic damage to enemies hit.

### Shen — `DA_18_Shen`

Cost 2; role APTank; traits Inferno, Defender; native shop tier 2, copies 25.
Stats: HP 900, mana 0/90, AD 50, armor/MR 45/45, attack speed 0.65, range 1.

**base**; role APTank; stats HP 900, mana 0/90, AD 50, AS 0.65.
Ability: Ki Barrier.
- 1★: Grant <healing>375&nbsp;(AP)</healing> Shield to Shen and <healing>225&nbsp;(AP)</healing> Shield to a nearby damaged ally for 4 seconds. Both of their next 3 attacks gain 40% Attack Speed and deal 35&nbsp;(AP) bonus magic damage.
- 2★: Grant <healing>450&nbsp;(AP)</healing> Shield to Shen and <healing>300&nbsp;(AP)</healing> Shield to a nearby damaged ally for 4 seconds. Both of their next 3 attacks gain 40% Attack Speed and deal 55&nbsp;(AP) bonus magic damage.
- 3★: Grant <healing>575&nbsp;(AP)</healing> Shield to Shen and <healing>400&nbsp;(AP)</healing> Shield to a nearby damaged ally for 4 seconds. Both of their next 3 attacks gain 40% Attack Speed and deal 80&nbsp;(AP) bonus magic damage.

### Teemo — `DA_18_Teemo`

Cost 2; role APCaster; traits Sprykin, Invoker; native shop tier 2, copies 25.
Stats: HP 550, mana 0/50, AD 35, armor/MR 30/30, attack speed 0.75, range 4.

**base**; role APCaster; stats HP 550, mana 0/50, AD 35, AS 0.75.
Ability: Fungus Among Us.
- 1★: Throw 2 clusters of mushrooms that deal <magicDamage>55&nbsp;(AP)</magicDamage> magic damage to the 3 nearest enemies. Then hurl a giant mushroom that deals <magicDamage>135&nbsp;(AP)</magicDamage> magic damage to the target. Each cast has a 10% chance to forage an extra mushroom that can be collected for bonus effects. Red: 1 Reroll Green: 1 Tactician Health Yellow: 2 XP
- 2★: Throw 2 clusters of mushrooms that deal <magicDamage>82&nbsp;(AP)</magicDamage> magic damage to the 3 nearest enemies. Then hurl a giant mushroom that deals <magicDamage>200&nbsp;(AP)</magicDamage> magic damage to the target. Each cast has a 12% chance to forage an extra mushroom that can be collected for bonus effects. Red: 1 Reroll Green: 1 Tactician Health Yellow: 2 XP
- 3★: Throw 2 clusters of mushrooms that deal <magicDamage>155&nbsp;(AP)</magicDamage> magic damage to the 3 nearest enemies. Then hurl a giant mushroom that deals <magicDamage>310&nbsp;(AP)</magicDamage> magic damage to the target. Each cast has a 15% chance to forage an extra mushroom that can be collected for bonus effects. Red: 1 Reroll Green: 1 Tactician Health Yellow: 2 XP

### Warwick — `DA_18_Warwick`

Cost 2; role ADFighter; traits Ravager, Blackthorn; native shop tier 2, copies 25.
Stats: HP 750, mana 0/40, AD 45, armor/MR 45/45, attack speed 0.75, range 1.

**base**; role ADFighter; stats HP 750, mana 0/40, AD 45, AS 0.75.
Ability: Jaws of The Beast.
- 1★: Bite the current target, dealing <physicalDamage>215%&nbsp;(AD)</physicalDamage> physical damage and healing for <healing>20%&nbsp;(AP)</healing> of the damage dealt. Gain 20% Attack Speed for the rest of combat.
- 2★: Bite the current target, dealing <physicalDamage>325%&nbsp;(AD)</physicalDamage> physical damage and healing for <healing>20%&nbsp;(AP)</healing> of the damage dealt. Gain 20% Attack Speed for the rest of combat.
- 3★: Bite the current target, dealing <physicalDamage>500%&nbsp;(AD)</physicalDamage> physical damage and healing for <healing>20%&nbsp;(AP)</healing> of the damage dealt. Gain 20% Attack Speed for the rest of combat.

### Yunara — `DA_18_Yunara`

Cost 2; role ADCaster; traits Blossom, Executioner; native shop tier 2, copies 25.
Stats: HP 550, mana 0/35, AD 42, armor/MR 30/30, attack speed 0.75, range 4.

**base**; role ADCaster; stats HP 550, mana 0/35, AD 42, AS 0.75.
Ability: Cultivation of Spirit.
- 1★: Dash, then launch an orb at the current target that deals <physicalDamage>160%&nbsp;(AD)</physicalDamage> physical damage and splits, dealing 35% of <physicalDamage>160%&nbsp;(AD)</physicalDamage> physical damage to 2 nearby enemies.
- 2★: Dash, then launch an orb at the current target that deals <physicalDamage>240%&nbsp;(AD)</physicalDamage> physical damage and splits, dealing 35% of <physicalDamage>240%&nbsp;(AD)</physicalDamage> physical damage to 2 nearby enemies.
- 3★: Dash, then launch an orb at the current target that deals <physicalDamage>370%&nbsp;(AD)</physicalDamage> physical damage and splits, dealing 35% of <physicalDamage>370%&nbsp;(AD)</physicalDamage> physical damage to 2 nearby enemies.

### Azir — `DA_18_Azir`

Cost 3; role APCarry; traits Summoner, Executioner, Blackthorn; native shop tier 3, copies 18.
Stats: HP 650, mana 0/35, AD 30, armor/MR 35/35, attack speed 0.75, range 4.

**base**; role APCarry; stats HP 650, mana 0/35, AD 30, AS 0.75.
Ability: Arise!.
- 1★: Gain 150% Attack Speed and summon 2 soldiers for the next 6 attacks. These attacks are replaced by commands which direct each soldier to deal <magicDamage>46&nbsp;(AP)</magicDamage> magic damage per attack.
- 2★: Gain 150% Attack Speed and summon 2 soldiers for the next 6 attacks. These attacks are replaced by commands which direct each soldier to deal <magicDamage>69&nbsp;(AP)</magicDamage> magic damage per attack.
- 3★: Gain 150% Attack Speed and summon 2 soldiers for the next 6 attacks. These attacks are replaced by commands which direct each soldier to deal <magicDamage>110&nbsp;(AP)</magicDamage> magic damage per attack.

### Cassiopeia — `DA_18_Cassiopeia`

Cost 3; role APCaster; traits Spellweaver, Coven; native shop tier 3, copies 18.
Stats: HP 650, mana 0/30, AD 30, armor/MR 35/35, attack speed 0.75, range 4.

**base**; role APCaster; stats HP 650, mana 0/30, AD 30, AS 0.75.
Ability: Noxious Blast.
- 1★: Poison the target and the nearest non-poisoned enemy, dealing <magicDamage>420&nbsp;(AP)</magicDamage> magic damage over 15 seconds. Poisons stack.
- 2★: Poison the target and the nearest non-poisoned enemy, dealing <magicDamage>630&nbsp;(AP)</magicDamage> magic damage over 15 seconds. Poisons stack.
- 3★: Poison the target and the nearest non-poisoned enemy, dealing <magicDamage>1020&nbsp;(AP)</magicDamage> magic damage over 15 seconds. Poisons stack.

### Diana — `DA_18_Diana`

Cost 3; role APFighter; traits Lunar, Vanguard, Ravager; native shop tier 3, copies 18.
Stats: HP 850, mana 0/40, AD 30, armor/MR 50/50, attack speed 0.8, range 1.

**base**; role APFighter; stats HP 850, mana 0/40, AD 30, AS 0.8.
Ability: Pale Barrier.
- 1★: Gain <healing>150</healing> shield for <healing>2</healing> seconds and send out 6 moonlight orbs spread among enemies within 2 hexes, each dealing <magicDamage>75&nbsp;(AP)</magicDamage> magic damage.
- 2★: Gain <healing>275</healing> shield for <healing>2</healing> seconds and send out 6 moonlight orbs spread among enemies within 2 hexes, each dealing <magicDamage>115&nbsp;(AP)</magicDamage> magic damage.
- 3★: Gain <healing>500</healing> shield for <healing>2</healing> seconds and send out 6 moonlight orbs spread among enemies within 2 hexes, each dealing <magicDamage>180&nbsp;(AP)</magicDamage> magic damage.

### Fiddlesticks — `DA_Fiddlesticks18`

Cost 3; role APTank; traits Spellweaver, Defender, Flora Fatalis; native shop tier 3, copies 18.
Stats: HP 1000, mana 0/90, AD 50, armor/MR 55/55, attack speed 0.65, range 1.

**base**; role APTank; stats HP 1000, mana 0/90, AD 50, AS 0.65.
Ability: Harvest.
- 1★: Reduce the Magic Resist of the 3 nearest enemies by 10. Then drain life from them over 2 seconds, healing for <healing>410&nbsp;(AP)</healing> Health and dealing <magicDamage>70&nbsp;(AP)</magicDamage> magic damage to each over the duration.
- 2★: Reduce the Magic Resist of the 3 nearest enemies by 10. Then drain life from them over 2 seconds, healing for <healing>485&nbsp;(AP)</healing> Health and dealing <magicDamage>105&nbsp;(AP)</magicDamage> magic damage to each over the duration.
- 3★: Reduce the Magic Resist of the 3 nearest enemies by 10. Then drain life from them over 2 seconds, healing for <healing>850&nbsp;(AP)</healing> Health and dealing <magicDamage>170&nbsp;(AP)</magicDamage> magic damage to each over the duration.

### Hecarim — `DA_18_Hecarim`

Cost 3; role APTank; traits Elderwood, Vanguard; native shop tier 3, copies 18.
Stats: HP 1100, mana 0/110, AD 50, armor/MR 50/50, attack speed 0.65, range 1.

**base**; role APTank; stats HP 1100, mana 0/110, AD 50, AS 0.65.
Ability: Spirit of Dread.
- 1★: Gain 50 Armor and Magic Resist for 3 seconds and restore <healing>375&nbsp;(AP)</healing> Health over the duration. Launch spectral riders at the 3 nearest enemies, dealing <magicDamage>80&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 2★: Gain 50 Armor and Magic Resist for 3 seconds and restore <healing>475&nbsp;(AP)</healing> Health over the duration. Launch spectral riders at the 3 nearest enemies, dealing <magicDamage>120&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.5 seconds.
- 3★: Gain 50 Armor and Magic Resist for 3 seconds and restore <healing>685&nbsp;(AP)</healing> Health over the duration. Launch spectral riders at the 3 nearest enemies, dealing <magicDamage>195&nbsp;(AP)</magicDamage> magic damage and Stunning them for 1.75 seconds.

### Kha'Zix — `DA_18_KhaZix`

Cost 3; role APReaper; traits Rival; native shop tier 3, copies 18.
Stats: HP 950, mana 0/25, AD 40, armor/MR 55/55, attack speed 0.85, range 1.

**base**; role APReaper; stats HP 950, mana 0/25, AD 40, AS 0.85.
Ability: Taste Their Fear.
- 1★: Leap to the farthest enemy within 3 Hexes, dealing <magicDamage>265&nbsp;(AP)</magicDamage> magic damage. If they have no adjacent allies, deal <magicDamage>285&nbsp;(AP)</magicDamage> magic damage instead and gain 10 mana.
- 2★: Leap to the farthest enemy within 3 Hexes, dealing <magicDamage>370&nbsp;(AP)</magicDamage> magic damage. If they have no adjacent allies, deal <magicDamage>410&nbsp;(AP)</magicDamage> magic damage instead and gain 10 mana.
- 3★: Leap to the farthest enemy within 3 Hexes, dealing <magicDamage>535&nbsp;(AP)</magicDamage> magic damage. If they have no adjacent allies, deal <magicDamage>605&nbsp;(AP)</magicDamage> magic damage instead and gain 10 mana.

### Kog'Maw — `DA_KogMaw18_AD`

Cost 3; role ADCaster; traits Invoker, Adaptor, Caustic; native shop tier 3, copies 18.
Stats: HP 650, mana 0/55, AD 40, armor/MR 35/35, attack speed 0.8, range 4.

**base**; role ADCaster; stats HP 650, mana 0/55, AD 40, AS 0.8.
Ability: Raining Artillery.
- 1★: Adaptor AD: Launch acid at the target and the other nearest enemy, dealing <physicalDamage>145%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage. Enemies below 50% max Health take 140% of <physicalDamage>145%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage instead. AdaptorAP: Damages enemies over time.
- 2★: Adaptor AD: Launch acid at the target and the other nearest enemy, dealing <physicalDamage>220%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage. Enemies below 50% max Health take 140% of <physicalDamage>220%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage instead. AdaptorAP: Damages enemies over time.
- 3★: Adaptor AD: Launch acid at the target and the other nearest enemy, dealing <physicalDamage>375%&nbsp;(AD) + 50&nbsp;(AP)</physicalDamage> physical damage. Enemies below 50% max Health take 140% of <physicalDamage>375%&nbsp;(AD) + 50&nbsp;(AP)</physicalDamage> physical damage instead. AdaptorAP: Damages enemies over time.

**base.adaptorAlt** (AP); role APCaster; stats HP 650, mana 0/55, AD 30, AS 0.8.
Ability: Raining Artillery.
- 1★: Adaptor AP: Launch acid at the target and the other nearest enemy, dealing <magicDamage>160&nbsp;(AP)</magicDamage> magic damage and causing them to take an additional <magicDamage>48&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Deal bonus damage to enemies at low Health.
- 2★: Adaptor AP: Launch acid at the target and the other nearest enemy, dealing <magicDamage>240&nbsp;(AP)</magicDamage> magic damage and causing them to take an additional <magicDamage>72&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Deal bonus damage to enemies at low Health.
- 3★: Adaptor AP: Launch acid at the target and the other nearest enemy, dealing <magicDamage>415&nbsp;(AP)</magicDamage> magic damage and causing them to take an additional <magicDamage>115&nbsp;(AP)</magicDamage> magic damage over 3 seconds. Adaptor AD: Deal bonus damage to enemies at low Health.

### Krug — `DA_Krug18`

Cost 3; role ADTank; traits Riftbeast, Brawler; native shop tier 3, copies 18.
Stats: HP 1100, mana 0/135, AD 55, armor/MR 40/40, attack speed 0.6, range 1.

**base**; role ADTank; stats HP 1100, mana 0/135, AD 55, AS 0.6.
Ability: Rock and Roll.
- 1★: Passive: On death, split into two Kruglettes with <healing>50 + 12%&nbsp;(HP) max Health</healing> which immediately taunt, forcing enemies to attack them. Active: Gain 175&nbsp;(AP) max Health, then roll into the target, dealing 135%&nbsp;(AD) + 8%&nbsp;(HP) max Health damage. Slate Buff: On death, Krug and Kruglettes Shield allies for 8% max Health.
- 2★: Passive: On death, split into two Kruglettes with <healing>100 + 12%&nbsp;(HP) max Health</healing> which immediately taunt, forcing enemies to attack them. Active: Gain 225&nbsp;(AP) max Health, then roll into the target, dealing 200%&nbsp;(AD) + 8%&nbsp;(HP) max Health damage. Slate Buff: On death, Krug and Kruglettes Shield allies for 8% max Health.
- 3★: Passive: On death, split into two Kruglettes with <healing>180 + 12%&nbsp;(HP) max Health</healing> which immediately taunt, forcing enemies to attack them. Active: Gain 325&nbsp;(AP) max Health, then roll into the target, dealing 335%&nbsp;(AD) + 8%&nbsp;(HP) max Health damage. Slate Buff: On death, Krug and Kruglettes Shield allies for 8% max Health.

### Mama Beak — `DA_CrimsonRaptor18`

Cost 3; role ADCarry; traits Summoner, Riftbeast, Rapidfire; native shop tier 3, copies 18.
Stats: HP 650, mana 0/60, AD 55, armor/MR 35/35, attack speed 0.75, range 4.

**base**; role ADCarry; stats HP 650, mana 0/60, AD 55, AS 0.75.
Ability: Flock Family.
- 1★: Summon 4 untargetable Tiny Beaks nearby for 5&nbsp;(AP) seconds. Whenever Mama Beak attacks, Tiny Beaks attack the same enemy, dealing <physicalDamage>22%&nbsp;(AD)</physicalDamage> physical damage. Orange Buff: Dealing physical damage reduces enemy Armor by 2.
- 2★: Summon 4 untargetable Tiny Beaks nearby for 5&nbsp;(AP) seconds. Whenever Mama Beak attacks, Tiny Beaks attack the same enemy, dealing <physicalDamage>33%&nbsp;(AD)</physicalDamage> physical damage. Orange Buff: Dealing physical damage reduces enemy Armor by 2.
- 3★: Summon 4 untargetable Tiny Beaks nearby for 5&nbsp;(AP) seconds. Whenever Mama Beak attacks, Tiny Beaks attack the same enemy, dealing <physicalDamage>52%&nbsp;(AD)</physicalDamage> physical damage. Orange Buff: Dealing physical damage reduces enemy Armor by 2.

### Master Yi — `DA_18_MasterYi_AD`

Cost 3; role ADSpecialist; traits Blossom, Adaptor; native shop tier 3, copies 18.
Stats: HP 850, mana 0/3, AD 60, armor/MR 55/55, attack speed 0.8, range 1.

**base**; role ADSpecialist; stats HP 850, mana 0/3, AD 60, AS 0.8.
Ability: Wuju Style.
- 1★: Passive: Every third attack is a Double Strike. On takedown, gain a burst of movement speed. Adaptor AD: Double Strikes grant 12% + 3%&nbsp;(AP) stacking Attack Speed. Adaptor AP: Double Strikes deal bonus damage and heal.
- 2★: Passive: Every third attack is a Double Strike. On takedown, gain a burst of movement speed. Adaptor AD: Double Strikes grant 12% + 3%&nbsp;(AP) stacking Attack Speed. Adaptor AP: Double Strikes deal bonus damage and heal.
- 3★: Passive: Every third attack is a Double Strike. On takedown, gain a burst of movement speed. Adaptor AD: Double Strikes grant 12% + 3%&nbsp;(AP) stacking Attack Speed. Adaptor AP: Double Strikes deal bonus damage and heal.

**base.adaptorAlt** (AP); role —; stats HP 850, mana 0/3, AD 15, AS 0.85.
Ability: Wuju Style.
- 1★: Passive: Every third attack is a Double Strike that hits twice. On takedown, gain a burst of movement speed. Adaptor AP: Double Strikes deal 125&nbsp;(AP) bonus magic damage. Restore Health equal to 35% of bonus damage dealt. Adaptor AD: Double Strikes give stacking Attack Speed.
- 2★: Passive: Every third attack is a Double Strike that hits twice. On takedown, gain a burst of movement speed. Adaptor AP: Double Strikes deal 190&nbsp;(AP) bonus magic damage. Restore Health equal to 35% of bonus damage dealt. Adaptor AD: Double Strikes give stacking Attack Speed.
- 3★: Passive: Every third attack is a Double Strike that hits twice. On takedown, gain a burst of movement speed. Adaptor AP: Double Strikes deal 285&nbsp;(AP) bonus magic damage. Restore Health equal to 35% of bonus damage dealt. Adaptor AD: Double Strikes give stacking Attack Speed.

### Rammus — `DA_18_Rammus`

Cost 3; role ADTank; traits Sprykin, Defender; native shop tier 3, copies 18.
Stats: HP 1100, mana 0/80, AD 50, armor/MR 50/50, attack speed 0.6, range 1.

**base**; role ADTank; stats HP 1100, mana 0/80, AD 50, AS 0.6.
Ability: Defensive Ball Curl.
- 1★: Taunt, forcing enemies to attack this champion. For 4 seconds, gain <healing>400&nbsp;(AP)</healing> Shield and 60 Armor and Magic Resist. When the Shield breaks, deal <physicalDamage>50%&nbsp;(%i:scaleArmor%) + 50%&nbsp;(%i:scaleMR%)</physicalDamage> physical damage to enemies in 2 Hexes.
- 2★: Taunt, forcing enemies to attack this champion. For 4 seconds, gain <healing>550&nbsp;(AP)</healing> Shield and 60 Armor and Magic Resist. When the Shield breaks, deal <physicalDamage>75%&nbsp;(%i:scaleArmor%) + 75%&nbsp;(%i:scaleMR%)</physicalDamage> physical damage to enemies in 2 Hexes.
- 3★: Taunt, forcing enemies to attack this champion. For 4 seconds, gain <healing>700&nbsp;(AP)</healing> Shield and 60 Armor and Magic Resist. When the Shield breaks, deal <physicalDamage>120%&nbsp;(%i:scaleArmor%) + 120%&nbsp;(%i:scaleMR%)</physicalDamage> physical damage to enemies in 2 Hexes.

### Rengar — `DA_18_Rengar`

Cost 3; role ADFighter; traits Rival; native shop tier 3, copies 18.
Stats: HP 900, mana 0/50, AD 60, armor/MR 55/55, attack speed 0.75, range 1.

**base**; role ADFighter; stats HP 900, mana 0/50, AD 60, AS 0.75.
Ability: Savagery.
- 1★: Jump to the lowest percent Health enemy within 3 hexes and stab them, dealing <physicalDamage>255%&nbsp;(AD)</physicalDamage> physical damage. Then heal for <healing>60&nbsp;(AP)</healing>, increased to up to 120&nbsp;(AP) based on their missing Health.
- 2★: Jump to the lowest percent Health enemy within 3 hexes and stab them, dealing <physicalDamage>385%&nbsp;(AD)</physicalDamage> physical damage. Then heal for <healing>90&nbsp;(AP)</healing>, increased to up to 180&nbsp;(AP) based on their missing Health.
- 3★: Jump to the lowest percent Health enemy within 3 hexes and stab them, dealing <physicalDamage>650%&nbsp;(AD)</physicalDamage> physical damage. Then heal for <healing>90&nbsp;(AP)</healing>, increased to up to 180&nbsp;(AP) based on their missing Health.

### Tristana — `DA_18_Tristana`

Cost 3; role ADCarry; traits Sprykin, Fae, Hunter; native shop tier 3, copies 18.
Stats: HP 650, mana 0/60, AD 55, armor/MR 35/35, attack speed 0.75, range 4.

**base**; role ADCarry; stats HP 650, mana 0/60, AD 55, AS 0.75.
Ability: Explosive Charge.
- 1★: Attach an explosive charge to the target that lasts 4 seconds. While active, gain infinite range and 40% + 20%&nbsp;(AP) Attack Speed. After the duration, the charge explodes and splits damage between all enemies within 2 hexes, dealing <physicalDamage>175%&nbsp;(AD)</physicalDamage> physical damage + 10%&nbsp;(AD) for each attack while casting. If an enemy with an explosive charge on them dies, it attaches to Tristana's new target.
- 2★: Attach an explosive charge to the target that lasts 4 seconds. While active, gain infinite range and 40% + 20%&nbsp;(AP) Attack Speed. After the duration, the charge explodes and splits damage between all enemies within 2 hexes, dealing <physicalDamage>265%&nbsp;(AD)</physicalDamage> physical damage + 15%&nbsp;(AD) for each attack while casting. If an enemy with an explosive charge on them dies, it attaches to Tristana's new target.
- 3★: Attach an explosive charge to the target that lasts 4 seconds. While active, gain infinite range and 40% + 20%&nbsp;(AP) Attack Speed. After the duration, the charge explodes and splits damage between all enemies within 2 hexes, dealing <physicalDamage>420%&nbsp;(AD)</physicalDamage> physical damage + 25%&nbsp;(AD) for each attack while casting. If an enemy with an explosive charge on them dies, it attaches to Tristana's new target.

### Vi — `DA_Vi18`

Cost 3; role ADTank; traits Primal, Juggernaut; native shop tier 3, copies 18.
Stats: HP 1100, mana 0/60, AD 45, armor/MR 50/50, attack speed 0.75, range 1.

**base**; role ADTank; stats HP 1100, mana 0/60, AD 45, AS 0.75.
Ability: Furious Fists.
- 1★: Passive: On attack, restore <healing>2%&nbsp;(HP) max Health</healing>. Active: Unleash a primal roar, restoring <healing>200&nbsp;(AP)</healing> Health. Then gain 85% Attack Speed, 15% Durability, and is unstoppable for 3 seconds.
- 2★: Passive: On attack, restore <healing>2%&nbsp;(HP) max Health</healing>. Active: Unleash a primal roar, restoring <healing>265&nbsp;(AP)</healing> Health. Then gain 100% Attack Speed, 15% Durability, and is unstoppable for 3 seconds.
- 3★: Passive: On attack, restore <healing>2%&nbsp;(HP) max Health</healing>. Active: Unleash a primal roar, restoring <healing>360&nbsp;(AP)</healing> Health. Then gain 125% Attack Speed, 15% Durability, and is unstoppable for 3 seconds.

### Ahri — `DA_18_Ahri`

Cost 4; role APCaster; traits Blossom, Spellweaver; native shop tier 4, copies 10.
Stats: HP 850, mana 0/100, AD 40, armor/MR 40/40, attack speed 0.8, range 4.

**base**; role APCaster; stats HP 850, mana 0/100, AD 40, AS 0.8.
Ability: Spirit Bomb.
- 1★: Launch a spirit bomb at the location within 4 hexes that has the most surrounding enemies. It deals <magicDamage>455&nbsp;(AP)</magicDamage> magic damage to enemies in a 3 hex radius, reduced by 21% per hex away from the epicenter.
- 2★: Launch a spirit bomb at the location within 4 hexes that has the most surrounding enemies. It deals <magicDamage>685&nbsp;(AP)</magicDamage> magic damage to enemies in a 3 hex radius, reduced by 21% per hex away from the epicenter.
- 3★: Launch a spirit bomb at the location within 4 hexes that has the most surrounding enemies. It deals <magicDamage>3500&nbsp;(AP)</magicDamage> magic damage to enemies in a 3 hex radius, reduced by 21% per hex away from the epicenter.

### Amumu — `DA_Amumu18`

Cost 4; role APTank; traits Juggernaut, Inferno; native shop tier 4, copies 10.
Stats: HP 1300, mana 0/125, AD 70, armor/MR 60/60, attack speed 0.7, range 1.

**base**; role APTank; stats HP 1300, mana 0/125, AD 70, AS 0.7.
Ability: Tantrum.
- 1★: Passive: Every second, restore <healing>2.5%&nbsp;(HP) + 20&nbsp;(AP)</healing> Health and deal <magicDamage>12&nbsp;(AP)</magicDamage> magic damage to enemies within 1 hex. Active: Deal <magicDamage>100&nbsp;(AP)</magicDamage> magic damage to enemies within 2 hexes and Stun them for 1 seconds, increased to 1 seconds if the target is Burning. Burn: Deals a percent of the target’s max Health as true damage every second.
- 2★: Passive: Every second, restore <healing>2.5%&nbsp;(HP) + 25&nbsp;(AP)</healing> Health and deal <magicDamage>18&nbsp;(AP)</magicDamage> magic damage to enemies within 1 hex. Active: Deal <magicDamage>150&nbsp;(AP)</magicDamage> magic damage to enemies within 2 hexes and Stun them for 1 seconds, increased to 1 seconds if the target is Burning. Burn: Deals a percent of the target’s max Health as true damage every second.
- 3★: Passive: Every second, restore <healing>4%&nbsp;(HP) + 100&nbsp;(AP)</healing> Health and deal <magicDamage>150&nbsp;(AP)</magicDamage> magic damage to enemies within 1 hex. Active: Deal <magicDamage>2000&nbsp;(AP)</magicDamage> magic damage to enemies within 2 hexes and Stun them for 6 seconds, increased to 6 seconds if the target is Burning. Burn: Deals a percent of the target’s max Health as true damage every second.

### Aphelios — `DA_18_Aphelios`

Cost 4; role ADCarry; traits Rapidfire, Lunar; native shop tier 4, copies 10.
Stats: HP 850, mana 0/70, AD 60, armor/MR 40/40, attack speed 0.8, range 4.

**base**; role ADCarry; stats HP 850, mana 0/70, AD 60, AS 0.8.
Ability: Moonlight's Onslaught.
- 1★: Equip Severum and swipe the target 5 times over 2 seconds, each dealing <physicalDamage>70%&nbsp;(AD)</physicalDamage> physical damage. After the onslaught finishes, fire a blast that deals <physicalDamage>450%&nbsp;(AD) + 40&nbsp;(AP)</physicalDamage> physical damage split among all enemies in a 2 Hex radius.
- 2★: Equip Severum and swipe the target 5 times over 2 seconds, each dealing <physicalDamage>105%&nbsp;(AD)</physicalDamage> physical damage. After the onslaught finishes, fire a blast that deals <physicalDamage>675%&nbsp;(AD) + 60&nbsp;(AP)</physicalDamage> physical damage split among all enemies in a 2 Hex radius.
- 3★: Equip Severum and swipe the target 5 times over 2 seconds, each dealing <physicalDamage>850%&nbsp;(AD)</physicalDamage> physical damage. After the onslaught finishes, fire a blast that deals <physicalDamage>5000%&nbsp;(AD) + 225&nbsp;(AP)</physicalDamage> physical damage split among all enemies in a 2 Hex radius.

### Brambleback — `DA_Brambleback18`

Cost 4; role ADFighter; traits Riftbeast, Ravager; native shop tier 4, copies 10.
Stats: HP 1100, mana 0/40, AD 120, armor/MR 65/65, attack speed 0.55, range 1.

**base**; role ADFighter; stats HP 1100, mana 0/40, AD 120, AS 0.55.
Ability: Crimson Fury.
- 1★: Passive: When the target dies, leap at the next target, dealing <physicalDamage>135%&nbsp;(AD)</physicalDamage> physical damage. Active: Gain 100% Attack Damage for 8 seconds. During this time ignore 20% Armor. Red Buff: Attacks 1% Burn enemies and heal Brambleback for 4% max Health.
- 2★: Passive: When the target dies, leap at the next target, dealing <physicalDamage>205%&nbsp;(AD)</physicalDamage> physical damage. Active: Gain 100% Attack Damage for 8 seconds. During this time ignore 20% Armor. Red Buff: Attacks 1% Burn enemies and heal Brambleback for 4% max Health.
- 3★: Passive: When the target dies, leap at the next target, dealing <physicalDamage>1000%&nbsp;(AD)</physicalDamage> physical damage. Active: Gain 300% Attack Damage for 8 seconds. During this time ignore 20% Armor. Red Buff: Attacks 1% Burn enemies and heal Brambleback for 4% max Health.

### Ezreal — `DA_18_Ezreal`

Cost 4; role ADCaster; traits Elderwood, Executioner; native shop tier 4, copies 10.
Stats: HP 850, mana 0/30, AD 45, armor/MR 40/40, attack speed 0.75, range 4.

**base**; role ADCaster; stats HP 850, mana 0/30, AD 45, AS 0.75.
Ability: Forest's Flurry.
- 1★: Blink away from the current target, deal <physicalDamage>270%&nbsp;(AD)</physicalDamage> physical damage to them, and gain 30%&nbsp;(AP) Attack Speed. Every 4th cast consumes the Attack Speed granted from Forest's Flurry and fires a blast through the largest group of enemies that deals <physicalDamage>385%&nbsp;(AD)</physicalDamage> physical damage, reduced by 25% for each enemy it passes through (minimum 50%).
- 2★: Blink away from the current target, deal <physicalDamage>405%&nbsp;(AD)</physicalDamage> physical damage to them, and gain 30%&nbsp;(AP) Attack Speed. Every 4th cast consumes the Attack Speed granted from Forest's Flurry and fires a blast through the largest group of enemies that deals <physicalDamage>580%&nbsp;(AD)</physicalDamage> physical damage, reduced by 25% for each enemy it passes through (minimum 50%).
- 3★: Blink away from the current target, deal <physicalDamage>1200%&nbsp;(AD)</physicalDamage> physical damage to them, and gain 100%&nbsp;(AP) Attack Speed. Every 4th cast consumes the Attack Speed granted from Forest's Flurry and fires a blast through the largest group of enemies that deals <physicalDamage>2500%&nbsp;(AD)</physicalDamage> physical damage, reduced by 25% for each enemy it passes through (minimum 50%).

### Lillia — `DA_18_Lillia`

Cost 4; role APTank; traits Fae, Defender; native shop tier 4, copies 10.
Stats: HP 1300, mana 0/140, AD 40, armor/MR 60/60, attack speed 0.65, range 1.

**base**; role APTank; stats HP 1300, mana 0/140, AD 40, AS 0.65.
Ability: Lilting Lullaby.
- 1★: Restore <healing>350&nbsp;(AP)</healing> Health and send 4 butterflies at nearby enemies. Enemies hit take <magicDamage>90&nbsp;(AP)</magicDamage> magic damage and Sleep for 1.5 seconds. If they take 1000 damage, they wake up and take an additional <magicDamage>10% max Health</magicDamage> magic damage.
- 2★: Restore <healing>525&nbsp;(AP)</healing> Health and send 4 butterflies at nearby enemies. Enemies hit take <magicDamage>135&nbsp;(AP)</magicDamage> magic damage and Sleep for 1.75 seconds. If they take 1000 damage, they wake up and take an additional <magicDamage>10% max Health</magicDamage> magic damage.
- 3★: Restore <healing>800&nbsp;(AP)</healing> Health and send 4 butterflies at nearby enemies. Enemies hit take <magicDamage>2000&nbsp;(AP)</magicDamage> magic damage and Sleep for 8 seconds. If they take 1000 damage, they wake up and take an additional <magicDamage>10% max Health</magicDamage> magic damage.

### Malphite — `DA_18_Malphite`

Cost 4; role APTank; traits Monolith, Blackthorn; native shop tier 4, copies 10.
Stats: HP 1300, mana 0/80, AD 70, armor/MR 70/70, attack speed 0.55, range 1.

**base**; role APTank; stats HP 1300, mana 0/80, AD 70, AS 0.55.
Ability: Petrified Bark.
- 1★: Gain <healing>700&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and become petrified. When the shield breaks, unleash a wave of dark energy, dealing <magicDamage>30%&nbsp;(%i:scaleMR%) + 30%&nbsp;(%i:scaleArmor%) + 40&nbsp;(AP)</magicDamage> magic damage to enemies within 2 hexes.
- 2★: Gain <healing>850&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and become petrified. When the shield breaks, unleash a wave of dark energy, dealing <magicDamage>45%&nbsp;(%i:scaleMR%) + 45%&nbsp;(%i:scaleArmor%) + 60&nbsp;(AP)</magicDamage> magic damage to enemies within 2 hexes.
- 3★: Gain <healing>2000&nbsp;(AP)</healing> Shield for <healing>4</healing> seconds and become petrified. When the shield breaks, unleash a wave of dark energy, dealing <magicDamage>999%&nbsp;(%i:scaleMR%) + 999%&nbsp;(%i:scaleArmor%) + 2000&nbsp;(AP)</magicDamage> magic damage to enemies within 3 hexes.

### Morgana — `DA_18_Morgana`

Cost 4; role APFighter; traits Invoker, Coven; native shop tier 4, copies 10.
Stats: HP 1100, mana 0/65, AD 45, armor/MR 60/60, attack speed 0.75, range 2.

**base**; role APFighter; stats HP 1100, mana 0/65, AD 45, AS 0.75.
Ability: Withering Curse.
- 1★: Passive: Gain 25% Omnivamp. Active: Fire a dark blast at 3 nearby enemies, dealing <magicDamage>60&nbsp;(AP)</magicDamage> magic damage to them and cursing them for 4 seconds. Then, spawn a 2 Hex withering zone for the same duration that deals <magicDamage>33&nbsp;(AP)</magicDamage> magic damage per second. Cursed enemies take 22&nbsp;(AP) more damage per curse.
- 2★: Passive: Gain 25% Omnivamp. Active: Fire a dark blast at 3 nearby enemies, dealing <magicDamage>90&nbsp;(AP)</magicDamage> magic damage to them and cursing them for 4 seconds. Then, spawn a 2 Hex withering zone for the same duration that deals <magicDamage>50&nbsp;(AP)</magicDamage> magic damage per second. Cursed enemies take 33&nbsp;(AP) more damage per curse.
- 3★: Passive: Gain 25% Omnivamp. Active: Fire a dark blast at 3 nearby enemies, dealing <magicDamage>500&nbsp;(AP)</magicDamage> magic damage to them and cursing them for 4 seconds. Then, spawn a 2 Hex withering zone for the same duration that deals <magicDamage>500&nbsp;(AP)</magicDamage> magic damage per second. Cursed enemies take 240&nbsp;(AP) more damage per curse.

### Nidalee — `DA_Nidalee18_AP`

Cost 4; role APCarry; traits Primal, Adaptor; native shop tier 4, copies 10.
Stats: HP 850, mana 0/45, AD 35, armor/MR 30/30, attack speed 0.8, range 5.

**base**; role APCarry; stats HP 850, mana 0/45, AD 35, AS 0.8.
Ability: Javelin Toss.
- 1★: Adaptor AP: Gain 150% Attack Speed for the next 3 attacks. These attacks are replaced with javelins that deal <magicDamage>185&nbsp;(AP)</magicDamage> magic damage. The 3rd attack instead targets the furthest enemy with the least items and deals <magicDamage>330&nbsp;(AP)</magicDamage> magic damage. Adaptor AD: Transform into a Melee cougar Assassin that swipes enemies.
- 2★: Adaptor AP: Gain 150% Attack Speed for the next 3 attacks. These attacks are replaced with javelins that deal <magicDamage>275&nbsp;(AP)</magicDamage> magic damage. The 3rd attack instead targets the furthest enemy with the least items and deals <magicDamage>500&nbsp;(AP)</magicDamage> magic damage. Adaptor AD: Transform into a Melee cougar Assassin that swipes enemies.
- 3★: Adaptor AP: Gain 150% Attack Speed for the next 3 attacks. These attacks are replaced with javelins that deal <magicDamage>2000&nbsp;(AP)</magicDamage> magic damage. The 3rd attack instead targets the furthest enemy with the least items and deals <magicDamage>3000&nbsp;(AP)</magicDamage> magic damage. Adaptor AD: Transform into a Melee cougar Assassin that swipes enemies.

**base.adaptorAlt** (AD); role ADReaper; stats HP 1100, mana 0/20, AD 60, AS 0.85.
Ability: Prowler's Pounce.
- 1★: Adaptor AD Passive: When changing targets, leap to the enemy with the fewest items within 4 hexes, prioritizing farther enemies. Adaptor AD: Swipe the target, dealing <physicalDamage>200%&nbsp;(AD)</physicalDamage> physical damage which ignores 60% Armor. Every third cast restores <healing>300&nbsp;(AP)</healing> Health and deals up to 125% bonus damage based on the target's missing Health. Adaptor AP: Transform into a ranged human Marksman whose attacks throw javelins.
- 2★: Adaptor AD Passive: When changing targets, leap to the enemy with the fewest items within 4 hexes, prioritizing farther enemies. Adaptor AD: Swipe the target, dealing <physicalDamage>300%&nbsp;(AD)</physicalDamage> physical damage which ignores 60% Armor. Every third cast restores <healing>450&nbsp;(AP)</healing> Health and deals up to 125% bonus damage based on the target's missing Health. Adaptor AP: Transform into a ranged human Marksman whose attacks throw javelins.
- 3★: Adaptor AD Passive: When changing targets, leap to the enemy with the fewest items within 4 hexes, prioritizing farther enemies. Adaptor AD: Swipe the target, dealing <physicalDamage>3000%&nbsp;(AD)</physicalDamage> physical damage which ignores 80% Armor. Every third cast restores <healing>2000&nbsp;(AP)</healing> Health and deals up to 125% bonus damage based on the target's missing Health. Adaptor AP: Transform into a ranged human Marksman whose attacks throw javelins.

### Sentinel — `DA_Sentinel18`

Cost 4; role APTank; traits Riftbeast, Invoker, Vanguard; native shop tier 4, copies 10.
Stats: HP 1300, mana 0/150, AD 75, armor/MR 60/60, attack speed 0.6, range 1.

**base**; role APTank; stats HP 1300, mana 0/150, AD 75, AS 0.6.
Ability: Azure Shockwave.
- 1★: Gain <healing>350&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Slam the ground, sending a fissure in the direction of the most enemies. Enemies hit are briefly knocked up, take <magicDamage>100&nbsp;(AP)</magicDamage> magic damage, and are Mana Reaved for 10. Blue Buff: Each time Sentinel casts, allies gain 2 Mana Regen. Mana Reave: Increase the Mana cost of the next Ability cast.
- 2★: Gain <healing>450&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Slam the ground, sending a fissure in the direction of the most enemies. Enemies hit are briefly knocked up, take <magicDamage>150&nbsp;(AP)</magicDamage> magic damage, and are Mana Reaved for 10. Blue Buff: Each time Sentinel casts, allies gain 2 Mana Regen. Mana Reave: Increase the Mana cost of the next Ability cast.
- 3★: Gain <healing>2000&nbsp;(AP) + 10%&nbsp;(HP) max Health</healing> Shield for <healing>4</healing> seconds. Slam the ground, sending a fissure in the direction of the most enemies. Enemies hit are briefly knocked up, take <magicDamage>3500&nbsp;(AP)</magicDamage> magic damage, and are Mana Reaved for 10. Blue Buff: Each time Sentinel casts, allies gain 2 Mana Regen. Mana Reave: Increase the Mana cost of the next Ability cast.

### Sett — `DA_18_Sett`

Cost 4; role ADTank; traits Blossom, Brawler; native shop tier 4, copies 10.
Stats: HP 1200, mana 0/135, AD 80, armor/MR 60/60, attack speed 0.65, range 1.

**base**; role ADTank; stats HP 1200, mana 0/135, AD 80, AS 0.65.
Ability: Haymaker.
- 1★: Passive: Upon falling below 40% max Health the first time each combat, gain 100 mana. Active: Wind up a big punch, rapidly healing for <healing>12%&nbsp;(HP) + 225&nbsp;(AP)</healing> before dealing <physicalDamage>150%&nbsp;(AD) + 6%&nbsp;(HP) max Health</physicalDamage> physical damage in a large cone.
- 2★: Passive: Upon falling below 40% max Health the first time each combat, gain 100 mana. Active: Wind up a big punch, rapidly healing for <healing>12%&nbsp;(HP) + 275&nbsp;(AP)</healing> before dealing <physicalDamage>225%&nbsp;(AD) + 6%&nbsp;(HP) max Health</physicalDamage> physical damage in a large cone.
- 3★: Passive: Upon falling below 40% max Health the first time each combat, gain 100 mana. Active: Wind up a big punch, rapidly healing for <healing>12%&nbsp;(HP) + 2000&nbsp;(AP)</healing> before dealing <physicalDamage>5000%&nbsp;(AD) + 6%&nbsp;(HP) max Health</physicalDamage> physical damage in a large cone.

### Sivir — `DA_18_Sivir`

Cost 4; role ADCaster; traits Primal, Hunter; native shop tier 4, copies 10.
Stats: HP 850, mana 0/40, AD 50, armor/MR 40/40, attack speed 0.8, range 4.

**base**; role ADCaster; stats HP 850, mana 0/40, AD 50, AS 0.8.
Ability: Boomerang Blade.
- 1★: Throw a large crossblade that deals <physicalDamage>200%&nbsp;(AD) + 15&nbsp;(AP)</physicalDamage> physical damage to the current target and bounces 8 times between nearby enemies, dealing 20% of <physicalDamage>200%&nbsp;(AD) + 15&nbsp;(AP)</physicalDamage> physical damage each bounce. When this kills an enemy, bounce 3 additional times.
- 2★: Throw a large crossblade that deals <physicalDamage>300%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage to the current target and bounces 8 times between nearby enemies, dealing 20% of <physicalDamage>300%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage each bounce. When this kills an enemy, bounce 3 additional times.
- 3★: Throw a large crossblade that deals <physicalDamage>1050%&nbsp;(AD) + 100&nbsp;(AP)</physicalDamage> physical damage to the current target and bounces 8 times between nearby enemies, dealing 40% of <physicalDamage>1050%&nbsp;(AD) + 100&nbsp;(AP)</physicalDamage> physical damage each bounce. When this kills an enemy, bounce 6 additional times.

### Soraka — `DA_18_Soraka`

Cost 4; role APCaster; traits Executioner, Flora Fatalis; native shop tier 4, copies 10.
Stats: HP 850, mana 0/30, AD 30, armor/MR 40/40, attack speed 0.75, range 4.

**base**; role APCaster; stats HP 850, mana 0/30, AD 30, AS 0.75.
Ability: Starcall.
- 1★: Call down a star on the current target, dealing <magicDamage>225&nbsp;(AP)</magicDamage> magic damage. If a star has previously fallen on them, call down 3 additional stars that each deal <magicDamage>100&nbsp;(AP)</magicDamage> magic damage.
- 2★: Call down a star on the current target, dealing <magicDamage>335&nbsp;(AP)</magicDamage> magic damage. If a star has previously fallen on them, call down 3 additional stars that each deal <magicDamage>150&nbsp;(AP)</magicDamage> magic damage.
- 3★: Call down a star on the current target, dealing <magicDamage>1000&nbsp;(AP)</magicDamage> magic damage. If a star has previously fallen on them, call down 3 additional stars that each deal <magicDamage>1000&nbsp;(AP)</magicDamage> magic damage.

### Zyra — `DA_18_Zyra`

Cost 4; role APCaster; traits Summoner, Thornmaiden; native shop tier 4, copies 10.
Stats: HP 850, mana 0/45, AD 40, armor/MR 40/40, attack speed 0.75, range 4.

**base**; role APCaster; stats HP 850, mana 0/45, AD 40, AS 0.75.
Ability: Rampant Growth.
- 1★: Spawn 2 plants around the battlefield that attack the nearest enemy 10 times. Each attack deals <magicDamage>35&nbsp;(AP)</magicDamage> magic damage.
- 2★: Spawn 2 plants around the battlefield that attack the nearest enemy 10 times. Each attack deals <magicDamage>53&nbsp;(AP)</magicDamage> magic damage.
- 3★: Spawn 4 plants around the battlefield that attack the nearest enemy 10 times. Each attack deals <magicDamage>225&nbsp;(AP)</magicDamage> magic damage.

### Alune — `DA_18_Alune`

Cost 5; role APCaster; traits Lunar, Spellweaver, Attuned; native shop tier 5, copies 9.
Stats: HP 900, mana 0/35, AD 40, armor/MR 45/45, attack speed 0.8, range 4.

**base**; role APCaster; stats HP 900, mana 0/35, AD 40, AS 0.8.
Ability: Moonfall.
- 1★: Rain 9 moonshards split among the 3 nearest enemies, dealing <magicDamage>55&nbsp;(AP)</magicDamage> magic damage each. If the moon is full, instead crash it onto the board, dealing <magicDamage>2350&nbsp;(AP)</magicDamage> magic damage split among all enemies.
- 2★: Rain 9 moonshards split among the 3 nearest enemies, dealing <magicDamage>83&nbsp;(AP)</magicDamage> magic damage each. If the moon is full, instead crash it onto the board, dealing <magicDamage>3600&nbsp;(AP)</magicDamage> magic damage split among all enemies.
- 3★: Rain 9 moonshards split among the 3 nearest enemies, dealing <magicDamage>500&nbsp;(AP)</magicDamage> magic damage each. If the moon is full, instead crash it onto the board, dealing <magicDamage>7500&nbsp;(AP)</magicDamage> magic damage split among all enemies.

### Ashe — `DA_18_Ashe`

Cost 5; role ADCaster; traits Hunter, Blossom; native shop tier 5, copies 9.
Stats: HP 900, mana 0/80, AD 75, armor/MR 45/45, attack speed 0.8, range 5.

**base**; role ADCaster; stats HP 900, mana 0/80, AD 75, AS 0.8.
Ability: Spirit Rift.
- 1★: Fire an arrow through the most enemies in a line that deals <physicalDamage>465%&nbsp;(AD)</physicalDamage> physical damage, reduced by 80% per enemy hit (minimum 20%). If no enemies are hit refund 70% of mana spent. The arrow leaves a trail for 3 seconds that deals <physicalDamage>9%&nbsp;(AD) + 1.5% max Health</physicalDamage> physical damage per second to enemies within and 20% Slows them. Slow: Reduce Attack Speed
- 2★: Fire an arrow through the most enemies in a line that deals <physicalDamage>700%&nbsp;(AD)</physicalDamage> physical damage, reduced by 80% per enemy hit (minimum 20%). If no enemies are hit refund 70% of mana spent. The arrow leaves a trail for 3 seconds that deals <physicalDamage>14%&nbsp;(AD) + 1.5% max Health</physicalDamage> physical damage per second to enemies within and 20% Slows them. Slow: Reduce Attack Speed
- 3★: Fire an arrow through the most enemies in a line that deals <physicalDamage>1000%&nbsp;(AD)</physicalDamage> physical damage, reduced by 40% per enemy hit (minimum 20%). If no enemies are hit refund 70% of mana spent. The arrow leaves a trail for 20 seconds that deals <physicalDamage>200%&nbsp;(AD) + 10% max Health</physicalDamage> physical damage per second to enemies within and 20% Slows them. Slow: Reduce Attack Speed

### Draven — `DA_Draven18`

Cost 5; role ADCarry; traits Bounty Seeker; native shop tier 5, copies 9.
Stats: HP 900, mana 0/110, AD 48, armor/MR 45/45, attack speed 0.85, range 5.

**base**; role ADCarry; stats HP 900, mana 0/110, AD 48, AS 0.85.
Ability: Whirling Death.
- 1★: Passive: Attacks target random enemies in range and apply a bleed that deals <physicalDamage>150%&nbsp;(AD)</physicalDamage> physical damage over 12 seconds. Every attack has a 12%&nbsp;(AP) chance to deal 50% bonus physical damage and apply 2 bleeds instead. Active: Throw two giant axes towards the enemy with the most bleeds. Deal <physicalDamage>100%&nbsp;(AD)</physicalDamage> physical damage to enemies hit and consume their bleed, instantly dealing the remaining damage. The axes then return, dealing <physicalDamage>30%&nbsp;(AD)</physicalDamage> physical damage to enemies hit. If no enemies are hit refund 50% of mana spent.
- 2★: Passive: Attacks target random enemies in range and apply a bleed that deals <physicalDamage>225%&nbsp;(AD)</physicalDamage> physical damage over 12 seconds. Every attack has a 12%&nbsp;(AP) chance to deal 50% bonus physical damage and apply 2 bleeds instead. Active: Throw two giant axes towards the enemy with the most bleeds. Deal <physicalDamage>150%&nbsp;(AD)</physicalDamage> physical damage to enemies hit and consume their bleed, instantly dealing the remaining damage. The axes then return, dealing <physicalDamage>45%&nbsp;(AD)</physicalDamage> physical damage to enemies hit. If no enemies are hit refund 50% of mana spent.
- 3★: Passive: Attacks target random enemies in range and apply a bleed that deals <physicalDamage>3000%&nbsp;(AD)</physicalDamage> physical damage over 12 seconds. Every attack has a 12%&nbsp;(AP) chance to deal 900% bonus physical damage and apply 2 bleeds instead. Active: Throw two giant axes towards the enemy with the most bleeds. Deal <physicalDamage>400%&nbsp;(AD)</physicalDamage> physical damage to enemies hit and consume their bleed, instantly dealing the remaining damage. The axes then return, dealing <physicalDamage>100%&nbsp;(AD)</physicalDamage> physical damage to enemies hit. If no enemies are hit refund 50% of mana spent.

### Elder Dragon — `DA_18_ElderDragon`

Cost 5; role ADFighter; traits Riftbeast, Apex Predator; native shop tier 5, copies 9.
Stats: HP 1800, mana 0/60, AD 125, armor/MR 75/75, attack speed 0.5, range 2.

**base**; role ADFighter; stats HP 1800, mana 0/60, AD 125, AS 0.5.
Ability: Heat Without Equal.
- 1★: Passive: Attacks deal 75% damage to enemies adjacent to the target. Active: Become invulnerable and fly into the air. On return, stun all enemies for 1.25 seconds, gain 15% Omnivamp, and Ignite them for 3 seconds. Ignited enemies take <physicalDamage>2% max Health</physicalDamage> physical damage per second. Replace this ability with Flame Breath and immediately cast it. Flame Breath: Spew fire at the most enemies in a line through the target, dealing <physicalDamage>285%&nbsp;(AD) + 20&nbsp;(AP)</physicalDamage> physical damage, reduced by 20% for each enemy it passes through (minimum 20%.) Ignite those enemies for 3 seconds. Elder Dragon Buff: Damaging an enemy below <healing>12%</healing> Health executes them.
- 2★: Passive: Attacks deal 75% damage to enemies adjacent to the target. Active: Become invulnerable and fly into the air. On return, stun all enemies for 1.25 seconds, gain 15% Omnivamp, and Ignite them for 3 seconds. Ignited enemies take <physicalDamage>2% max Health</physicalDamage> physical damage per second. Replace this ability with Flame Breath and immediately cast it. Flame Breath: Spew fire at the most enemies in a line through the target, dealing <physicalDamage>435%&nbsp;(AD) + 30&nbsp;(AP)</physicalDamage> physical damage, reduced by 20% for each enemy it passes through (minimum 20%.) Ignite those enemies for 3 seconds. Elder Dragon Buff: Damaging an enemy below <healing>12%</healing> Health executes them.
- 3★: Passive: Attacks deal 100% damage to enemies adjacent to the target. Active: Become invulnerable and fly into the air. On return, stun all enemies for 99 seconds, gain 100% Omnivamp, and Ignite them for 99 seconds. Ignited enemies take <physicalDamage>20% max Health</physicalDamage> physical damage per second. Replace this ability with Flame Breath and immediately cast it. Flame Breath: Spew fire at the most enemies in a line through the target, dealing <physicalDamage>7000%&nbsp;(AD) + 200&nbsp;(AP)</physicalDamage> physical damage, reduced by 20% for each enemy it passes through (minimum 20%.) Ignite those enemies for 99 seconds. Elder Dragon Buff: Damaging an enemy below <healing>12%</healing> Health executes them.

### Gnar — `DA_18_GnarSmall`

Cost 5; role ADSpecialist; traits Sprykin, Elderwood, Brawler; native shop tier 5, copies 9.
Stats: HP 900, mana 0/70, AD 100, armor/MR 55/55, attack speed 0.9, range 2.

**base**; role ADSpecialist; stats HP 900, mana 0/70, AD 100, AS 0.9.
Ability: Rage Gene.
- 1★: Passive: Gain 5 Rage per second and 5 Rage per attack. Active: Transform into Mega Gnar and leap into the largest group of enemies within 3 hexes. Then, deal <physicalDamage>100%&nbsp;(AD)</physicalDamage> physical damage to enemies within 2 hexes, reduce their Armor and Magic Resist by 15&nbsp;(AP), and Stun them for 1 second. Mega Gnar gains <healing>400</healing> Health, and replaces his Ability with Grab n' Throw. Grab n' Throw: Throw the target at the farthest enemy, dealing <physicalDamage>380%&nbsp;(AD)</physicalDamage> physical damage to them and <physicalDamage>135%&nbsp;(AD)</physicalDamage> physical damage to enemies they pass through. If there's only 1 enemy left, throw them off the battlefield instead.
- 2★: Passive: Gain 5 Rage per second and 5 Rage per attack. Active: Transform into Mega Gnar and leap into the largest group of enemies within 3 hexes. Then, deal <physicalDamage>150%&nbsp;(AD)</physicalDamage> physical damage to enemies within 2 hexes, reduce their Armor and Magic Resist by 20&nbsp;(AP), and Stun them for 1 second. Mega Gnar gains <healing>600</healing> Health, and replaces his Ability with Grab n' Throw. Grab n' Throw: Throw the target at the farthest enemy, dealing <physicalDamage>570%&nbsp;(AD)</physicalDamage> physical damage to them and <physicalDamage>205%&nbsp;(AD)</physicalDamage> physical damage to enemies they pass through. If there's only 1 enemy left, throw them off the battlefield instead.
- 3★: Passive: Gain 50 Rage per second and 20 Rage per attack. Active: Transform into Mega Gnar and leap into the largest group of enemies within 3 hexes. Then, deal <physicalDamage>2000%&nbsp;(AD)</physicalDamage> physical damage to enemies within 10 hexes, reduce their Armor and Magic Resist by 250&nbsp;(AP), and Stun them for 15 second. Mega Gnar gains <healing>15000</healing> Health, and replaces his Ability with Grab n' Throw. Grab n' Throw: Throw the target at the farthest enemy, dealing <physicalDamage>9000%&nbsp;(AD)</physicalDamage> physical damage to them and <physicalDamage>4500%&nbsp;(AD)</physicalDamage> physical damage to enemies they pass through. If there's only 1 enemy left, throw them off the battlefield instead.

### Ivern — `DA_18_Ivern`

Cost 5; role APCaster; traits Greenfather; native shop tier 5, copies 9.
Stats: HP 1000, mana 0/80, AD 60, armor/MR 55/55, attack speed 0.8, range 3.

**base**; role APCaster; stats HP 1000, mana 0/80, AD 60, AS 0.8.
Ability: Triggerseed.
- 1★: Passive: Shields from this Ability can critically strike with Precision. Active: Grant 2 allies <healing>185&nbsp;(AP)</healing> Shield and 10% Damage Amp for 6 seconds. Then deal <magicDamage>155&nbsp;(AP)</magicDamage> magic damage to enemies adjacent to them. After casting 6 times, also grant 100% stacking Attack Speed to targets.
- 2★: Passive: Shields from this Ability can critically strike with Precision. Active: Grant 2 allies <healing>350&nbsp;(AP)</healing> Shield and 15% Damage Amp for 6 seconds. Then deal <magicDamage>235&nbsp;(AP)</magicDamage> magic damage to enemies adjacent to them. After casting 6 times, also grant 100% stacking Attack Speed to targets.
- 3★: Passive: Shields from this Ability can critically strike with Precision. Active: Grant 10 allies <healing>3000&nbsp;(AP)</healing> Shield and 100% Damage Amp for 6 seconds. Then deal <magicDamage>2000&nbsp;(AP)</magicDamage> magic damage to enemies adjacent to them. After casting 6 times, also grant 100% stacking Attack Speed to targets.

### Kennen — `DA_18_Kennen`

Cost 5; role APReaper; traits Inferno, Executioner; native shop tier 5, copies 9.
Stats: HP 1200, mana 0/40, AD 50, armor/MR 60/60, attack speed 0.85, range 2.

**base**; role APReaper; stats HP 1200, mana 0/40, AD 50, AS 0.85.
Ability: Firestorm.
- 1★: Charge up, gaining 15% Ability Power per Burning enemy. Then, gain <healing>230&nbsp;(AP)</healing> Shield for <healing>2.5</healing> seconds and rush through a nearby group of enemies, dealing <magicDamage>80&nbsp;(AP)</magicDamage> magic damage to each. After rushing, unleash a 2 Hex firestorm that deals a total of <magicDamage>475&nbsp;(AP)</magicDamage> magic damage split among all enemies hit over 2 seconds.
- 2★: Charge up, gaining 15% Ability Power per Burning enemy. Then, gain <healing>300&nbsp;(AP)</healing> Shield for <healing>2.5</healing> seconds and rush through a nearby group of enemies, dealing <magicDamage>120&nbsp;(AP)</magicDamage> magic damage to each. After rushing, unleash a 2 Hex firestorm that deals a total of <magicDamage>715&nbsp;(AP)</magicDamage> magic damage split among all enemies hit over 2 seconds.
- 3★: Charge up, gaining 15% Ability Power per Burning enemy. Then, gain <healing>3000&nbsp;(AP)</healing> Shield for <healing>2.5</healing> seconds and rush through a nearby group of enemies, dealing <magicDamage>1500&nbsp;(AP)</magicDamage> magic damage to each. After rushing, unleash a 2 Hex firestorm that deals a total of <magicDamage>5000&nbsp;(AP)</magicDamage> magic damage split among all enemies hit over 2 seconds.

### Lux — `DA_Lux18_Base`

Cost 5; role APCaster; traits Avatar; native shop tier 5, copies 9.
Stats: HP 900, mana 0/70, AD 40, armor/MR 45/45, attack speed 0.8, range 5.

**base**; role APCaster; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%).
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%).
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%).

**base.flexVariants[0]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Blackthorn Bonus: Stuns targets hit for 1 second.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Blackthorn Bonus: Stuns targets hit for 1 second.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Blackthorn Bonus: Stuns targets hit for 1 second.

**base.flexVariants[1]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Blossom Bonus: The first target hit is dealt 10% bonus damage.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Blossom Bonus: The first target hit is dealt 10% bonus damage.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Blossom Bonus: The first target hit is dealt 10% bonus damage.

**base.flexVariants[2]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Coven Bonus: Reduces the Armor and Magic Resist of targets hit by 8 for the rest of combat.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Coven Bonus: Reduces the Armor and Magic Resist of targets hit by 8 for the rest of combat.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Coven Bonus: Reduces the Armor and Magic Resist of targets hit by 8 for the rest of combat.

**base.flexVariants[3]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Elderwood Bonus: Casts grant all allies 2.5% increased max Health for the rest of combat.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Elderwood Bonus: Casts grant all allies 2.5% increased max Health for the rest of combat.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Elderwood Bonus: Casts grant all allies 2.5% increased max Health for the rest of combat.

**base.flexVariants[4]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Fae Bonus: Heals the lowest percent Health ally for 18% of ability damage dealt.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Fae Bonus: Heals the lowest percent Health ally for 18% of ability damage dealt.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Fae Bonus: Heals the lowest percent Health ally for 18% of ability damage dealt.

**base.flexVariants[5]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Inferno Bonus: Restores 10 mana per takedown.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Inferno Bonus: Restores 10 mana per takedown.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Inferno Bonus: Restores 10 mana per takedown.

**base.flexVariants[6]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Lunar Bonus: Applies 8% Vulnerable to enemies hit for 4 seconds. Vulnerable: Increases damage taken
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Lunar Bonus: Applies 8% Vulnerable to enemies hit for 4 seconds. Vulnerable: Increases damage taken
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Lunar Bonus: Applies 8% Vulnerable to enemies hit for 4 seconds. Vulnerable: Increases damage taken

**base.flexVariants[7]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Primal Bonus: Gain 60% Attack Speed for 6 seconds after cast.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Primal Bonus: Gain 60% Attack Speed for 6 seconds after cast.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Primal Bonus: Gain 60% Attack Speed for 6 seconds after cast.

**base.flexVariants[8]**; role —; stats HP 900, mana 0/70, AD 40, AS 0.8.
Ability: Final Spark.
- 1★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>375&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Solar Bonus: Deal 15% bonus damage. For each unique 3-star champion fielded, deal an additional 12% bonus damage.
- 2★: Passive: On cast, all allies that share a trait with Lux gain 3&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>565&nbsp;(AP)</magicDamage> magic damage, reduced by 25% for each enemy hit (minimum 40%). Solar Bonus: Deal 15% bonus damage. For each unique 3-star champion fielded, deal an additional 12% bonus damage.
- 3★: Passive: On cast, all allies that share a trait with Lux gain 100&nbsp;(AP) mana. Active: Fire a laser towards the most enemies in a line that deals <magicDamage>6500&nbsp;(AP)</magicDamage> magic damage, reduced by 10% for each enemy hit (minimum 40%). Solar Bonus: Deal 15% bonus damage. For each unique 3-star champion fielded, deal an additional 12% bonus damage.

### Maokai — `DA_18_Maokai`

Cost 5; role APTank; traits Juggernaut, Old Growth; native shop tier 5, copies 9.
Stats: HP 1150, mana 0/100, AD 80, armor/MR 60/60, attack speed 0.65, range 1.

**base**; role APTank; stats HP 1150, mana 0/100, AD 80, AS 0.65.
Ability: Sow the Seeds.
- 1★: Passive: After every 650 damage blocked, a sapling jumps towards a nearby enemy and deals <magicDamage>7%&nbsp;(HP) max Health</magicDamage> magic damage. On death, 3 saplings jump out. Active: Deal <magicDamage>6%&nbsp;(HP) max Health</magicDamage> magic damage to target and restore 330&nbsp;(AP) + 10% missing Health.
- 2★: Passive: After every 650 damage blocked, a sapling jumps towards a nearby enemy and deals <magicDamage>7%&nbsp;(HP) max Health</magicDamage> magic damage. On death, 5 saplings jump out. Active: Deal <magicDamage>6%&nbsp;(HP) max Health</magicDamage> magic damage to target and restore 400&nbsp;(AP) + 10% missing Health.
- 3★: Passive: After every 300 damage blocked, a sapling jumps towards a nearby enemy and deals <magicDamage>75%&nbsp;(HP) max Health</magicDamage> magic damage. On death, 10 saplings jump out. Active: Deal <magicDamage>100%&nbsp;(HP) max Health</magicDamage> magic damage to target and restore 2000&nbsp;(AP) + 100% missing Health.

### Taric — `DA_Taric18`

Cost 5; role APTank; traits Emerald Aspect, Vanguard; native shop tier 5, copies 9.
Stats: HP 1300, mana 0/65, AD 55, armor/MR 65/65, attack speed 0.75, range 1.

**base**; role APTank; stats HP 1300, mana 0/65, AD 55, AS 0.75.
Ability: Emerald Radiance.
- 1★: Passive: The first time Taric or his paired ally drops below <healing>50%</healing> Health, unleash emerald energy from both of them, granting <healing>75 + 15%&nbsp;(HP) max Health</healing> Shield to allies within 3 Hexes for 3 seconds. Active: Restore <healing>275&nbsp;(AP)</healing> Health. Taric and his paired ally deal 100&nbsp;(AP) bonus magic damage on their next 2 attacks.
- 2★: Passive: The first time Taric or his paired ally drops below <healing>50%</healing> Health, unleash emerald energy from both of them, granting <healing>150 + 15%&nbsp;(HP) max Health</healing> Shield to allies within 3 Hexes for 3 seconds. Active: Restore <healing>450&nbsp;(AP)</healing> Health. Taric and his paired ally deal 150&nbsp;(AP) bonus magic damage on their next 2 attacks.
- 3★: Passive: The first time Taric or his paired ally drops below <healing>50%</healing> Health, unleash emerald energy from both of them, granting <healing>10000 + 100%&nbsp;(HP) max Health</healing> Shield to allies within 3 Hexes for 99 seconds. Active: Restore <healing>3000&nbsp;(AP)</healing> Health. Taric and his paired ally deal 1000&nbsp;(AP) bonus magic damage on their next 2 attacks.

## Traits and tier effects

| Trait | Threshold | Published effect | Unresolved tokens |
|---|---:|---|---|
| Adaptor | 2 | (2) 25% AD OR AP |  |
| Adaptor | 3 | (3) 35% AD OR AP |  |
| Adaptor | 4 | (4) 50% AD OR AP |  |
| Apex Predator | 1 | Elder Dragon takes up 2 team slots and grants +2 to the Riftbeast trait. |  |
| Attuned | 1 | Your strongest Alune cycles to a new phase of the moon after each cast. While the moon is at or below half full, your team gains 7% Durabilty. While above, your team gains 7% Damage Amp. |  |
| Avatar | 1 | Having an Avatar on your bench or board transforms all other Avatars in your shop to the Trait of that Avatar.<br><br>An Avatar's chosen Trait is counted twice for Trait bonuses. |  |
| Blackthorn | 2 | (2) 175 HP |  |
| Blackthorn | 4 | (4) 350 HP; Bonus is 0% stronger |  |
| Blackthorn | 6 | (6) 600 HP; Bonus is 60% stronger |  |
| Blossom | 3 | (3) Wisps are upgraded, 12% ADAP |  |
| Blossom | 5 | (5) Wisps are in every shop, 30% ADAP |  |
| Blossom | 7 | (7) Gain 4 gold after buying a Wisp, 50% ADAP |  |
| Blossom | 9 | (9) You can buy 2 Wisps per round, 55% ADAP |  |
| Blossom | 11 | (11) Wisps overflow with power, 100% ADAP |  |
| Bounty Seeker | 1 | Choose a bounty. Your strongest Draven can progress on the bounty to earn its reward. Upon completing a bounty, choose another. |  |
| Brawler | 2 | (2) 25% HP |  |
| Brawler | 4 | (4) 40% HP |  |
| Brawler | 6 | (6) 65% HP |  |
| Caustic | 1 | Caustic damage 30% Shreds and Sunders enemies for 4 seconds.<br><br>Shred: Reduce Magic Resist<br>Sunder: Reduce Armor |  |
| Coven | 3 | (3) 2 Essence per kill, 22 Essence per loss |  |
| Coven | 4 | (4) 2 per kill, 28 per loss |  |
| Coven | 5 | (5) 3 per kill, 35 per loss |  |
| Coven | 7 | (7) 10 per kill, 60 per loss |  |
| Defender | 2 | (2) 25 %i:scaleArmor%%i:scaleMR% |  |
| Defender | 4 | (4) 60 %i:scaleArmor%%i:scaleMR% |  |
| Defender | 6 | (6) 115 %i:scaleArmor%%i:scaleMR% |  |
| Eclipse | 0 | After 8 seconds of combat, the Eclipse kills the lowest Health enemy, repeating every 3.5 seconds. |  |
| Elderwood | 3 | (3) A Stonebark Tree and a Lifebloom |  |
| Elderwood | 5 | (5) A second Stonebark Tree and Stonebark Trees gain 200 Health |  |
| Elderwood | 7 | (7) and the Deepwood Protector |  |
| Elderwood | 9 | (9) Plants star up to 2-star |  |
| Elderwood | 11 | (11) Plants star up to 3-star and the forest comes to life |  |
| Emerald Aspect | 1 | Drag an ally onto your strongest Taric to pair them, granting the ally powerful bonuses from Taric's Ability. |  |
| Executioner | 2 | (2) Executioners gain Precision and 15% Critical Strike Chance. |  |
| Executioner | 3 | (3) Additionally, enemies bleed for 25% bonus true damage over 3 seconds. |  |
| Executioner | 4 | (4) Bleed damage increased to 35%. |  |
| Fae | 2 | (2) 4.5% ADAP and 2.5% Heal. |  |
| Fae | 4 | (4) 7% ADAP and 4% Heal. After attracting 7 Pixies, start attracting Golden Pixies instead which grant gold. |  |
| Flora Fatalis | 1 | (1) 10 Mana |  |
| Flora Fatalis | 2 | (2) and grant a 8% max Health heal to the lowest Health ally. |  |
| Greenfather | 1 | Gain 1 seed when your strongest Ivern casts, plus 3 every combat. Ivern uses 5 seeds to grow a hex on your board that grants a bonus to its occupant. |  |
| Hunter | 2 | (2) 20% AD |  |
| Hunter | 3 | (3) 30% AD |  |
| Hunter | 4 | (4) 45% AD |  |
| Hunter | 5 | (5) 60% AD |  |
| Inferno | 2 | (2) 1% Burn, 33% Wound |  |
| Inferno | 3 | (3) After combat, 1 of your shop slots without an Inferno champion ignites, rolling a champion one tier higher |  |
| Inferno | 5 | (5) Ignite 2 shop slots, 3% Burn |  |
| Inferno | 7 | (7) Ignite 4 shop slots, 4% Burn |  |
| Invoker | 2 | (2) 1 %i:scaleManaRegen% \| 3 %i:scaleManaRegen% |  |
| Invoker | 3 | (3) 1 %i:scaleManaRegen% \| 4 %i:scaleManaRegen% |  |
| Invoker | 4 | (4) 2 %i:scaleManaRegen% \| 6 %i:scaleManaRegen% |  |
| Invoker | 5 | (5) 2 %i:scaleManaRegen% \| 8 %i:scaleManaRegen% |  |
| Juggernaut | 2 | (2) 4% or 20% |  |
| Juggernaut | 4 | (4) 4% or 30% |  |
| Juggernaut | 6 | (6) 8% or 42% |  |
| Lunar | 2 | (2) 7% %i:scaleAS%, 7% AP |  |
| Lunar | 3 | (3) 10% %i:scaleAS%, 12% AP |  |
| Lunar | 4 | (4) 14% %i:scaleAS%, 16% AP |  |
| Lunar | 5 | (5) 18% %i:scaleAS%, 20% AP |  |
| Monolith | 1 | Monoliths gain 10 Armor and Magic Resist for each enemy targeting them. |  |
| Old Growth | 1 | Whenever an enemy within 3 hexes dies, your strongest Old Growth champion gains 30 permanent max Health. |  |
| Primal | 2 | (2) Choose a blessing. |  |
| Primal | 4 | (4) Choose a second blessing. |  |
| Rapidfire | 2 | (2) +3% %i:scaleAS% per Attack |  |
| Rapidfire | 3 | (3) +5% %i:scaleAS% per Attack |  |
| Rapidfire | 4 | (4) +8% %i:scaleAS% per Attack |  |
| Rapidfire | 5 | (5) +12% %i:scaleAS% per Attack |  |
| Ravager | 2 | (2) 12% Bonus Damage |  |
| Ravager | 4 | (4) 25% Bonus Damage |  |
| Ravager | 6 | (6) 40% Bonus Damage |  |
| Riftbeast | 3 | (3) Use the Alpha Mark to grant a Riftbeast their unique Buff |  |
| Riftbeast | 5 | (5) Every 3 combats, your next shop is overrun with Riftbeasts. |  |
| Riftbeast | 7 | (7) On combat start and every 5 seconds Riftbeasts grow gaining <br>6% AD 6% AP 6% %i:scaleAS%<br>+5 %i:scaleArmor% +5 %i:scaleMR% +50 HP +1 %i:scaleManaRegen% |  |
| Riftbeast | 10 | (10) +2 maximum team size |  |
| Rival | 1 | Only applies to your strongest Rival.<br><row>(1) Only active while fielding 1 Rival.<br><br>Rivals collect takedowns, gaining 3 if they takedown another Rival.</row><br><row>(1) Only active while fielding 1 Rival.<br><br>Rivals collect takedowns, gaining 3 if they takedown another Rival.</row><br><row>(1) Rivals collect takedowns, gaining 3 if they takedown another Rival.<br><br>Takedowns evolve Kha'Zix, permanently granting him your choice of Executioner, Rapidfire, Ravager, or Spellweaver.<br><br>Rengar grants 2/2/2 gold every 8 takedowns. After 30 takedowns, your team gains 5% Attack Damage plus 0.2% AD per additional takedown.</row><br><row>(1) Rivals collect takedowns, gaining 3 if they takedown another Rival.</row><br><row>(1) Rivals can be fielded together, and their abilities grant each other bonuses.</row> |  |
| Solar | 3 | (3) Your champions gain a 5% max Health shield and deal 8% bonus magic damage. Gain additional bonuses for each unique 3-star champion:<br><br><TFTConditionalStyle attributeId="TFTTraitAttributes.Stack4" value="1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12" activeStyle="default" inactiveStyle="dim">1 : Increase shield and magic damage by 1% for each 3-star. <br><TFTConditionalStyle attributeId="TFTTraitAttributes.Stack4" value="3, 4, 5, 6, 7, 8, 9, 10, 11, 12" activeStyle="default" inactiveStyle="dim">3 : 15% %i:scaleAS% and 12 %i:scaleArmor%%i:scaleMR%<br><TFTConditionalStyle attributeId="TFTTraitAttributes.Stack4" value="5, 6, 7, 8, 9, 10, 11, 12" activeStyle="default" inactiveStyle="dim">5 : Convert 40% of the bonus magic damage to true damage.<br><TFTConditionalStyle attributeId="TFTTraitAttributes.Stack4" value="7, 8, 9, 10, 11, 12" activeStyle="default" inactiveStyle="dim">8 : Every 4 seconds of combat, a 3-star champion ascends to 4-star. |  |
| Spellweaver | 2 | (2) 10% AP, +1% AP per cast |  |
| Spellweaver | 4 | (4) 30% AP, +1% AP per cast |  |
| Spellweaver | 6 | (6) 55% AP, +2% AP per cast |  |
| Sprykin | 3 | (3) The Rider gains<br>15% HP and 15% %i:scaleAS% |  |
| Sprykin | 5 | (5) 40% HP 35% %i:scaleAS%, and 0% of the BFF's Ability applies to your Sprykin champions. |  |
| Sprykin | 7 | (7) 55% HP 55% %i:scaleAS%, and 100% of the BFF's Ability applies to your Sprykin champions. |  |
| Summoner | 2 | (2) Empower Summons |  |
| Summoner | 3 | (3) Improve each effect by 50% |  |
| Thornmaiden | 1 | Your team gains 5% Durability, increased to 10% if 6 or more Zyra plants are alive. |  |
| Vanguard | 2 | (2) 18% max Health |  |
| Vanguard | 4 | (4) 30% max Health |  |
| Vanguard | 6 | (6) 40% max Health. Gain 5% Durability while Shielded. |  |

## Published items and augment effects

All 571 published items are listed below. The 257 TFTraits entries tagged as augment are distinct from 592 CommunityDragon setData augment candidates.

| Kind | Name (`apiName`) | Tags / traits | Published effect | Unresolved |
|---|---|---|---|---|
| item | Aegis of Dawn (`DA_Artifact_AegisOfDawn`) | artifact | <br>If Aegis of Dusk is also equipped, trigger this item's effect every 1.25 seconds instead.<br><br>Healing increases based on Stage. |  |
| item | Aegis of Dusk (`DA_Artifact_AegisOfDusk`) | artifact | Every 2.5 seconds, steal 3 Magic Resist from enemies within 1-hex and deal 18% of the holder's Magic Resist as magic damage.<br><br>If Aegis of Dawn is also equipped, trigger this item's effect every 1.25 seconds instead.<br><br>Damage increases based on Stage. |  |
| item | Artifactinate (`DA_Artifactinate18`) | charm.category.item, charm.round.early, charm.round.earlymid, charm.tier.2 | Lose 3 components, including ones built into items. Gain an Artifact anvil. |  |
| item | Blighting Jewel (`DA_Artifact_BlightingJewel`) | artifact | Dealing magic damage reduces the target’s Magic Resist by 3. If their Magic Resist is 0, grant the holder 4 Mana instead.<br><br>Ability damage can only trigger on each enemy once every 0.5 seconds. |  |
| item | Cappa Juice (`DA_Artifact_CappaJuice`) | artifact, stacking | The holder dons a Hat on each takedown. The holder gains 1% Attack Damage and Ability Power per Hat. On death lose 20% of all Hats. |  |
| item | Dawncore (`DA_Artifact_Dawncore`) | artifact | Reduce the holder's max Mana by 10. Subsequent spellcasts reduce max Mana by 5%, to a minimum of 15. |  |
| item | Death's Defiance (`DA_Artifact_DeathsDefiance`) | artifact | 50% of the damage the holder receives is instead dealt over 4 seconds as non-lethal damage.<br><br>Unique - only 1 per champion |  |
| item | Eternal Pact (`DA_Artifact_EternalPact`) | artifact | Combat start: Form a pact with the highest Health allied champion, If they die, gain 10 Mana regen and 40% Ability Power. <br><br>When the ally uses their ability, gain 10 Mana. Every 6 seconds, shield your ally for 200% of the holder's Ability Power. |  |
| item | Fishbones (`DA_Artifact_Fishbones`) | artifact | Gain +2 attack range, and causes each of their attacks to target a random enemy. |  |
| item | Flickerblades (`DA_Artifact_NavoriFlickerblade`) | artifact, stacking | Attacks grant 4% stacking Attack Speed. Every 3 attacks also grant 2% Attack Damage and 2% Ability Power. |  |
| item | Forbidden Idol (`DA_Artifact_ForbiddenIdol`) | artifact | Shields have 40% of their value converted to max Health instead. |  |
| item | Gambler's Blade (`DA_Artifact_GamblersBlade`) | artifact, goldgenerating | Grant 1% bonus Attack Speed per gold in your bank (up to 30 gold).<br><br>Each attack has a 6% chance to drop 1 gold.<br><br>Unique - only 1 per champion |  |
| item | Gold Collector (`DA_Artifact_GoldCollector`) | artifact, goldgenerating | Attacks and Abilities execute enemies below 12% of their maximum Health. Executions on champions have a 33% chance to drop 1 gold.<br><br>Unique - only 1 per champion |  |
| item | Hellfire Hatchet (`DA_Artifact_HellfireHatchet`) | artifact | Attacks deal 3% of the holder's max Health as bonus physical damage. For every 1% missing Health, gain 1.5% Attack Speed. |  |
| item | Horizon Focus (`DA_Artifact_HorizonFocus`) | artifact | Stunning an enemy causes lightning to strike them, dealing 30% of their max Health as magic damage. |  |
| item | Hullcrusher (`DA_Artifact_Hullcrusher`) | artifact | Combat Start: If there are no adjacent allies, gain 400 Health, 10% Attack Damage, and 10% Ability Power. |  |
| item | Infinity Force (`DA_Artifact_InfinityForce`) | artifact | Tons of EVERYTHING! |  |
| item | Lich Bane (`DA_Artifact_LichBane`) | artifact | <br>Damage increases based on Stage. |  |
| item | Lightshield Crest (`DA_Artifact_LightshieldCrest`) | artifact | Every 3 seconds, Shields the lowest percent Health ally for 70% of the holder’s combined Armor and Magic Resist for 5 seconds.<br><br>On death grants this shield to all allies. |  |
| item | Luden's Tempest (`DA_Artifact_LudensTempest`) | artifact | 100% of overkill damage plus 130 is dealt as magic damage to the two enemies nearest the target. |  |
| item | Manazane (`DA_Artifact_Manazane`) | artifact | After casting the first time in combat, gain 110 Mana over 5 seconds. |  |
| item | Mittens (`DA_Artifact_Mittens`) | artifact | Shrinks the holder, granting them increased movement speed and immunity to Slow, Burn, and Wound.<br><br>Slow: Reduces Attack Speed.<br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Mogul's Mail (`DA_Artifact_MogulsMail`) | artifact, goldgenerating, stacking | Grants 1 Armor, 1 Magic Resist, and 5 Health when taking damage, stacking up to 35 times.<br><br>At full stacks, grant 1 gold and continue gaining 1 gold every 11 seconds.<br><br>Unique - only 1 per champion |  |
| item | Rapid Firecannon (`DA_Artifact_RapidFireCannon`) | artifact | Gain +1 Attack Range, increased by 1 whenever the holder kills an enemy. |  |
| item | Seeker's Armguard (`DA_Artifact_SeekersArmguard`) | artifact, stacking | Takedowns increase the holder’s Armor, Magic Resist, and Ability Power by 20. |  |
| item | Silvermere Dawn (`DA_Artifact_SilvermereDawn`) | artifact | Grants immunity to Stuns and the holder's attacks Stun the target for 0.8 seconds.<br><br>The holder’s Attack Speed is locked at 0.5. |  |
| item | Statikk Shiv (`DA_Artifact_StatikkShiv`) | artifact | Every 3rd attack deals 15 + 35% of the holder's Ability Power as additional magic damage to 6 enemies. |  |
| item | Talisman of Ascension (`DA_Item_Artifact_TalismanOfAscension`) | artifact | After 22 seconds gain 100% max Health, 12 Mana Regen, and 120% Damage Amp for the rest of combat. |  |
| item | The Indomitable (`DA_Artifact_TheIndomitable`) | artifact | The holder's Move Speed is drastically reduced.<br><br>Gain 15% max Health, become unstoppable, and pull the current target into melee range. |  |
| item | Titanic Hydra (`DA_Artifact_TitanicHydra`) | artifact | Attacks deal 2% of the holder's max Health plus 4% of their Attack Damage as bonus physical damage to the target and adjacent enemies. |  |
| item | Void Gauntlet (`DA_Artifact_VoidGauntlet`) | artifact | Combat Start: Store 30% max Health and 2.5% more every second. On death, unleash the stored Health as magic damage split between enemies within 4 hexes.<br><br>Unique - only 1 per champion |  |
| item | Wit's End (`DA_Artifact_WitsEnd`) | artifact | Heals the holder for 25% of all magic damage dealt.<br><br>Damage increases based on Stage. |  |
| item | Zhonya's Paradox (`DA_Artifact_ZhonyasParadox`) | artifact | Once per combat at 40% Health, become invulnerable and untargetable for 3 seconds.<br><br>Unique - only 1 per champion |  |
| augment | Advanced Loan (`DA_AdvancedLoan`) | augment.category.economic, augment.roundvariant.early, augment.tier.gold, augment.tier.prismatic, augment.variant.advancedloan | Gain 20 Gold. Your next augment is one tier lower. |  |
| augment | Advanced Loan+ (`DA_AdvancedLoanPlus`) | augment.category.economic, augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.gold, augment.tier.prismatic, augment.variant.advancedloan | Gain 33 Gold. Your next augment is one tier lower. |  |
| augment | Arcane Viktor-y (`DA_ArcaneViktory`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.arcaneviktory | After 8 seconds of combat, stun the enemy team for 1.5 seconds. Repeat this after 18 seconds of combat.<br><br>TFT Macao Open, 2024 |  |
| augment | Ascension (`DA_Ascension`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.ascension | After 12 seconds of combat, your units gain 35% Damage Amp. |  |
| augment | Augmented Power (`DA_AugmentedPower`) | augment.roundvariant.mid, augment.tier.gold, augment.tier.silver, augment.variant.augmentedpower | Your next augment is one tier higher. |  |
| augment | Backline Blueprint (`DA_BacklineBlueprint`) | augment.roundvariant.early, augment.tier.gold, augment.variant.backlineblueprint | Gain a 3-cost non-Tank champion and an Emblem that matches their class. |  |
| augment | Backup Bows (`DA_BackupBows`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.silver, augment.variant.backupbows, augment.variant.carveapath, augment.variant.continuousconjuration, augment.variant.criticalsuccess, augment.variant.extrabuckles, augment.variant.flowingtears | Gain a Recurve Bow. After your champions attack 1000 times, get 2 more. |  |
| augment | Band of Thieves (`DA_BandOfThieves`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.bandofthieves, radiant, thiefsgloves | Gain 1 Thief's Gloves. |  |
| augment | Band of Thieves II (`DA_BandOfThievesII`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.bandofthieves, radiant, thiefsgloves | Gain 2 Thief's Gloves. After 5 player combats, gain another. |  |
| augment | Band of Thieves II+ (`DA_BandOfThievesIIPlus`) | augment.category.grantsitems, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.bandofthieves, radiant, thiefsgloves | Gain 2 Thief's Gloves. After 5 player combats, gain another. |  |
| augment | Band of Thieves II++ (`DA_BandOfThievesIIPlusPlus`) | augment.category.grantsitems, augment.roundvariant.late, augment.tier.prismatic, augment.variant.bandofthieves, radiant, thiefsgloves | Gain 2 Thief's Gloves. After 3 player combats, gain another. |  |
| augment | Baron's Lair (`DA_BaronsLair`) | augment.rarity.common, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.baronslair | Gain a random Tank item. After 8 seconds of combat, your team gains 4% bonus Attack Damage and Ability Power every second for the rest of combat.<br><br>TFT Paris Open, 2025 |  |
| augment | Beast Within (`DA_18_PrimalAugment_Nidalee`) | augment.category.trait, augment.roundvariant.mid, augment.tier.gold | Primal grants an additional Blessing. Gain a Vi now and a Nidalee after 3 rounds. |  |
| augment | Beast Within (`DA_18_PrimalAugment_Sivir`) | augment.category.trait, augment.roundvariant.mid, augment.tier.gold | Primal grants an additional Blessing. Gain a Vi now and a Sivir after 3 rounds. |  |
| augment | Beast Within+ (`DA_18_PrimalAugmentPlus_Nidalee`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.tier.gold | Primal grants an additional Blessing. Gain a Vi and a Nidalee. |  |
| augment | Beast Within+ (`DA_18_PrimalAugmentPlus_Sivir`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.tier.gold | Primal grants an additional Blessing. Gain a Vi and a Sivir. |  |
| augment | Belt Overflow (`DA_BeltOverflow`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Gain 4 Giant's Belts. Your Giant's Belts grant +85 bonus Health. |  |
| augment | Big Grab Bag (`DA_18_BigGrabBag`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Gain 3 random components, 2 gold, and 1 Reforger. |  |
| augment | Birthday Present (`DA_BirthdayPresent`) | augment.category.economic, augment.roundvariant.early, augment.tier.prismatic | Gain a 2-star champion and 1 gold each time you level up. The champion's cost tier is your level minus 4 (max: 5-cost). |  |
| augment | Birthday Reunion (`DA_BirthdayReunion`) | augment.rarity.common, augment.roundvariant.early, augment.tier.gold, augment.variant.birthdayreunion | Gain a random 2-star 2-cost champion. At Level 6, gain a random item component. At Level 9, gain a random 2-star 5-cost champion.<br><br>Inkborn Fables Tactician's Crown, 2024 |  |
| augment | Blossom's Call (`DA_18_BlossomTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.tier.gold | When you buy a Wisp, gain a random Blossom champion based on the Wisp's cost. Gain a Yunara, a Yorick, and a Karma. |  |
| augment | Bodyguard Training (`DA_BodyguardTraining`) | augment.roundvariant.early, augment.tier.gold, augment.variant.bodyguardtraining | Allies gain 15 Armor and Magic Resist, increased by 2 per player level.<br><br>Gizmos & Gadgets Championship, 2022 |  |
| augment | Bonus Gifts (`DA_BonusGift`) | augment.category.economic, augment.mode.excludedoubleup, augment.roundvariant.early, augment.tier.gold, augment.variant.bonusgift, augment.variant.constructacompanion, augment.variant.forgeafriend, augment.variant.missedconnections | Whenever you open a loot orb, you have a 25% chance to gain a gray loot orb. Gain 1 gray loot orbs. |  |
| augment | Bonus Gifts+ (`DA_BonusGiftPlus`) | augment.category.economic, augment.mode.excludedoubleup, augment.roundvariant.mid, augment.tier.gold, augment.variant.bonusgift, augment.variant.constructacompanion, augment.variant.forgeafriend, augment.variant.missedconnections | Whenever you open a loot orb, you have a 25% chance to gain a gray loot orb. Gain 2 gray loot orbs. |  |
| augment | Booster Pack (`DA_BoosterPack`) | augment.category.economic, augment.roundvariant.early, augment.tier.gold, augment.variant.boosterpack | Gain 12 gold of random champions. (At least one 3-cost guaranteed!) |  |
| augment | Booster Pack+ (`DA_BoosterPackPlus`) | augment.category.economic, augment.roundvariant.mid, augment.tier.gold, augment.variant.boosterpack, augment.variant.plotarmor | Gain 18 gold of random champions. (At least one 4-cost guaranteed!) |  |
| augment | Booster Pack++ (`DA_BoosterPackPlusPlus`) | augment.category.economic, augment.roundvariant.late, augment.tier.gold, augment.variant.boosterpack, augment.variant.plotarmor | Gain 26 gold of random champions. (At least one 5-cost guaranteed!) |  |
| augment | Boxing Lessons (`DA_BoxingLessons`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.boxinglessons | Your team gains 30 Health for each champion that starts combat in the front row. |  |
| augment | Branching Out (`DA_18_BranchingOut`) | augment.category.grantsemblem, augment.roundvariant.early, augment.tier.silver, augment.variant.branchingout | Gain a random Emblem. |  |
| augment | Branching Out+ (`DA_18_BranchingOutPlus`) | augment.category.grantsemblem, augment.roundvariant.mid, augment.tier.silver, augment.variant.branchingout | Reforgers allow you to remake any item. |  |
| augment | Bronze For Life I (`DA_BronzeForLifeI`) | augment.complexity.complex, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.bronzeforlife, augment.variant.standunited, augment.variant.traitladder | Your team gains 2.5% Damage Amp for each Bronze-tier trait. |  |
| augment | Bronze For Life II (`DA_BronzeForLifeII`) | augment.complexity.complex, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.bronzeforlife, augment.variant.standunited, augment.variant.traitladder | Your team gains 2.5% Damage Amp and 3 Armor and Magic Resist for each Bronze-tier trait. |  |
| augment | Build a Bud (`DA_BuildABud`) | augment.roundvariant.early, augment.tier.prismatic, augment.variant.buildabud, augment.variant.weighttheworth | Gain a random 3-star 1-cost champion. Gain 6 gold. |  |
| augment | Buried Treasures III (`DA_BuriedTreasuresIII`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.buriedtreasures, augment.variant.componentquest | Gain a random item component now and at the start of the next 6 rounds. |  |
| augment | Calculated Loss (`DA_CalculatedLoss`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold, augment.variant.calculatedloss | After losing your combat, gain 2 gold and a free Shop reroll. |  |
| augment | Call To Chaos (`DA_CallToChaos`) | augment.rarity.common, augment.roundvariant.late, augment.tier.prismatic, augment.variant.calltochaos | Gain a powerful and random reward. |  |
| augment | Called Shot (`DA_CalledShot`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver | Set your win streak to +4. Gain 4 gold. |  |
| augment | Capital Gains I (`DA_CapitalGainsI`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver | Store gold equal to the interest you earn. On 3-3, gain gold equal to 100% of the stored gold. Gain 1 gold now. |  |
| augment | Capital Gains II (`DA_CapitalGainsII`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold | Store gold equal to the interest you earn. On 3-3, gain gold equal to 125% of the stored gold. Gain 3 gold now. |  |
| augment | Caretaker's Ally (`DA_18_CaretakersAlly`) | augment.roundvariant.early, augment.tier.silver | Gain a random 2-cost champion now. Gain the same one again every time you level up.<br><br>Champion: |  |
| augment | Caretaker's Favor (`DA_CaretakersFavor`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold | Gain a component anvil when you reach level 5, 6, 7, and 8.<br><br>Component anvils offer 4 choices. |  |
| augment | Carve a Path (`DA_CarveAPath`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.silver, augment.variant.backupbows, augment.variant.carveapath, augment.variant.continuousconjuration, augment.variant.criticalsuccess, augment.variant.extrabuckles, augment.variant.flowingtears | Gain a B.F. Sword. After your champions deal 65000 physical damage, gain 2 more. |  |
| augment | Celestial Blessing I (`DA_CelestialBlessingI`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.celestialblessing | Your team gains 12% Omnivamp. Excess healing is converted to a shield up to 200 Health. |  |
| augment | Celestial Blessing II (`DA_CelestialBlessingII`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.celestialblessing | Your team gains 18% Omnivamp. Excess healing is converted to a shield up to 400 Health. |  |
| augment | Celestial Blessing III (`DA_CelestialBlessingIII`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.celestialblessing | Your team gains 25% Omnivamp. Excess healing is converted to a shield up to 1000 Health. |  |
| augment | Challenger's Grace (`DA_ChallengersGrace`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.challengersgrace | At the start of combat, allies gain 25% Attack Speed for 3 seconds. On takedown, allies dash to their next target and gain this bonus again. |  |
| augment | Champ Delivery (`DA_ChampDelivery`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver | Gain 3 2-cost champions. After 6 rounds, gain 3 more. |  |
| augment | Champ Delivery+ (`DA_ChampDeliveryPlus`) | augment.category.economic, augment.roundvariant.mid, augment.tier.silver | Gain 3 3-cost champions. After 6 rounds, gain 3 more. |  |
| augment | Champ Delivery++ (`DA_ChampDeliveryPlusPlus`) | augment.category.economic, augment.roundvariant.late, augment.tier.silver | Gain 3 4-cost champions. After 6 rounds, gain 3 more. |  |
| augment | Chosen of the Sun (`DA_18_SolarTraitAugment`) | augment.category.trait, augment.roundvariant.early, augment.tier.silver | Gain a Leona, a Kayle, and a Sejuani. Leona gains 70 permanent max Health each round, increased by 10 for each unique 3-star champion fielded. |  |
| augment | Clear Mind (`DA_ClearMind`) | augment.category.economic, augment.mode.excludedoubleup, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold, augment.variant.clearmind, augment.variant.clutteredmind, augment.variant.pandorasbench | If there are no champions on your bench at the end of player combat, gain 3 XP. |  |
| augment | Clockwork Accelerator (`DA_ClockworkAccelerator`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Your team gains 10% Attack Speed every 3 seconds in combat. |  |
| augment | Cluttered Mind (`DA_ClutteredMind`) | augment.category.economic, augment.mode.excludedoubleup, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold, augment.variant.clearmind, augment.variant.clutteredmind, augment.variant.pandorasbench | Gain 4 1-cost champions now. If your bench is full at the end of player combat, gain 3 XP. |  |
| augment | Cognitive Overload (`DA_CognitiveOverload`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.mid, augment.tier.gold, augment.variant.cognitiveoverload | Gain 7 gold, 1 2-star 1-cost champion, 1 2-cost champion, 2 3-cost champions, 1 XP, and 1 Shop reroll. |  |
| augment | Cognitive Tax (`DA_CognitiveTax`) | augment.category.economic, augment.rarity.common, augment.roundvariant.early, augment.tier.silver, augment.variant.cognitivetax | Gain 8 gold and 1 XP. |  |
| augment | Cognitive Tax+ (`DA_CognitiveTaxPlus`) | augment.category.economic, augment.rarity.common, augment.roundvariant.mid, augment.tier.silver, augment.variant.cognitivetax | Gain 12 gold and 3 XP. |  |
| augment | Comeback Story (`DA_ComebackStory`) | augment.mode.excludetockers, augment.roundvariant.early, augment.tier.prismatic, augment.variant.comebackstory | Your team gains 4 Health and 0.3% Attack Speed per missing player Health. |  |
| augment | Commerce Core (`DA_CommerceCore`) | augment.category.economic, augment.roundvariant.late, augment.tier.prismatic, augment.variant.commercecore, augment.variant.tradesector | Gain 16 free Shop rerolls now and 3 every round for the rest of the game. |  |
| augment | Component Buffet (`DA_ComponentBuffet`) | augment.category.grantsitems, augment.roundvariant.none, augment.tier.silver, component.spatorpan | Whenever you would get a component, gain a component anvil instead. Gain a random component.The anvil offers 4 choices. |  |
| augment | Component Quest (`DA_ComponentQuest`) | augment.mode.excludetockers, augment.roundvariant.early, augment.tier.prismatic, augment.variant.buriedtreasures, augment.variant.componentquest | Gain a random component and 1 gold. The next 7 times you win a player combat, gain a different random component. Afterwards, gain 1 gold. |  |
| augment | Construct a Companion (`DA_ConstructACompanion`) | augment.roundvariant.mid, augment.tier.gold, augment.variant.constructacompanion | The next 1-cost champion you buy is 3-star. Gain 2 gold. |  |
| augment | Consuming Flora (`DA_18_FloraFatalisAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold | Gain a Flora Fatalis emblem. The champion holding the emblem gains 50% increased benefits from Flora Fatalis. Gain 3 gold. |  |
| augment | Cooking Pot (`DA_CookingPot`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.cookingpot, augment.variant.thetraittree, augment.variant.traittracker, augment.variant.wanderingtrainer | At the start of each turn, all allies holding a Frying Pan or Spatula item grant the nearest champion 60 permanent Health. Gain a Frying Pan. |  |
| augment | Coronation (`DA_Coronation`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.coronation, augment.variant.tacticianskitchen, augment.variant.traitladder | Gain a Tactician's Crown. Tactician's Crown, Cape, and Shield grant the holder 20% Attack Speed, 25% Attack Damage, and 30% Ability Power. |  |
| augment | Corrosion (`DA_Corrosion`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.corrosion | Enemies in the first two rows lose 4 Armor and Magic Resist every 2 seconds. |  |
| augment | Coven Acolyte (`DA_18_CovenTraitAugment`) | augment.category.trait, augment.mode.excludedoubleup, augment.roundvariant.early, augment.tier.gold, augment.variant.covenacolyte | When you choose to continue gathering Coven essence, heal 2 Tactician health. Gain a Camille, an Elise, and a Caitlyn. |  |
| augment | Crafted Crafting (`DA_CraftedCrafting`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver, augment.variant.craftedcrafting, augment.variant.salvagebin | Whenever you craft a completed item, gain 2 rerolls. |  |
| augment | Cry Me a River (`DA_CryMeARiver`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.crymeariver, augment.variant.makeshiftarmor | Gain a Tear of the Goddess. Your team gains 1 Mana Regen. After 12 seconds in combat, increase this to 4. |  |
| augment | Cursed Crown (`DA_CursedCrown`) | augment.category.grantsitems, augment.complexity.complex, augment.mode.excludedoubleup, augment.mode.excludetockers, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.cursedcrown, augment.variant.traitladder, disabled | Gain +2 max team size, but you take double player damage when you lose a player combat. |  |
| augment | Cybernetic Implants (`DA_CyberneticImplants_Gold`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.cyberneticimplants, augment.variant.cyberneticimplantsalltiers, augment.variant.goodforsomething | Your champions holding an item gain 100 Health and 15% Attack Damage. Gain a B.F. Sword. |  |
| augment | Cybernetic Uplink (`DA_CyberneticUplink_Gold`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.cyberneticuplink, augment.variant.cyberneticuplinkalltiers | Your champions holding an item gain 100 Health and 2 Mana Regen. Gain a Tear of the Goddess. |  |
| augment | Dark Ritual (`DA_18_CovenTraitAugment_LootToAP`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.darkritual | Converting Coven Essence to rewards grants Coven champions Ability Power instead of loot. Gain a Camille, an Elise, and a Caitlyn. |  |
| augment | Deadlier Blades (`DA_DeadlierBlades`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.heartofsteel, augment.variant.retribution, augment.variant.salvagebin, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain a Deathblade. Deathblades permanently gain 1% Attack Damage whenever their holders score a takedown. |  |
| augment | Deadlier Caps (`DA_DeadlierCaps`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.retribution, augment.variant.salvagebin, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain a Rabadon's Deathcap. Rabadon's Deathcaps grant 1 Mana Regen and permanently gain 1% Ability Power whenever their holders score a takedown. |  |
| augment | Dummify (`DA_Dummify`) | augment.complexity.complex, augment.mode.excludechonccstreasure, augment.roundvariant.mid, augment.tier.silver, augment.variant.dummify, augment.variant.noscoutnopivot | Lose all champions on your board and bench. Gain a Training Dummy with 60% of their combined health. The dummy gains 1150 Health per stage. Gain a random non-tank 2-star 2 cost champion. |  |
| augment | Duo Queue (`DA_18_DuoQueue`) | augment.category.grantsitems, augment.roundvariant.late, augment.tier.gold | Gain 2 random 5-cost champions and 2 copies of a random component. |  |
| augment | Early Learnings (`DA_EarlyLearnings`) | augment.category.reroll, augment.roundvariant.early, augment.tier.gold, augment.variant.earlylearnings | TFT Vegas Open, 2023 |  |
| augment | Electrocharge I (`DA_ElectrochargeI`) | augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.electrocharge | Every 4 attacks an ally takes, they deal 30-30 (based on current Stage) magic damage to nearby enemies (1 second cooldown). |  |
| augment | Electrocharge II (`DA_ElectrochargeII`) | augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.electrocharge | Every 4 attacks an ally takes, they deal 50-50 (based on current Stage) magic damage to nearby enemies (1 second cooldown). |  |
| augment | Embiggen (`DA_18_FaeTraitAugment`) | augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Fae pixies are now larger and grant 50% more Attack Damage and Ability Power. Fae champions gain 10% Attack Damage and Ability Power immediately. Gain a Xayah and a Rakan. |  |
| augment | Epic Rolldown (`DA_EpicRolldown`) | augment.category.economic, augment.roundvariant.mid, augment.tier.gold, augment.variant.epicrolldown | When you reach Level 8, gain 20 Shop rerolls.<br><br>Runeterra Reforged Championship, 2023 |  |
| augment | Epoch (`DA_Epoch`) | augment.category.economic, augment.mode.excludetockers, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold, augment.variant.epoch | Now, and at the start of every stage, gain 4 XP and 2 free rerolls. |  |
| augment | Epoch+ (`DA_EpochPlus`) | augment.category.economic, augment.mode.excludetockers, augment.property.grantsxp, augment.roundvariant.mid, augment.tier.gold, augment.variant.epoch | Now, and at the start of every stage, gain 8 XP and 2 free rerolls. |  |
| augment | Exclusive Customization (`DA_ExclusiveCustomization`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.exclusivecustomization | Use a Lucky Item Chest on a champion to choose from an armory of recommended items! |  |
| augment | Expected Unexpectedness (`DA_ExpectedUnexpectedness`) | augment.mode.excludetockers, augment.roundvariant.early, augment.tier.prismatic, augment.variant.magicroll | Now and at the start of the next 2 stages, roll 3 dice. Gain various rewards based on their total. |  |
| augment | Expedition (`DA_Expedition`) | augment.complexity.complex, augment.mode.excludedoubleup, augment.roundvariant.early, augment.tier.silver, augment.variant.backupdancers, augment.variant.expedition, augment.variant.pandorasbench | At the start of every round, lose the champion in the rightmost bench slot. After losing 33 gold of champions in this way, gain a powerful reward. Gain a 3-cost champion now. |  |
| augment | Explosive Growth (`DA_ExplosiveGrowth`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.mid, augment.tier.gold, augment.variant.explosivegrowth | Now and at the start of the next 3 rounds, gain 7 XP. |  |
| augment | Explosive Growth+ (`DA_ExplosiveGrowthPlus`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.late, augment.tier.gold, augment.variant.explosivegrowth | Now and at the start of the next 3 rounds, gain 9 XP. |  |
| augment | Extra Buckles (`DA_ExtraBuckles`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.silver, augment.variant.backupbows, augment.variant.carveapath, augment.variant.continuousconjuration, augment.variant.criticalsuccess, augment.variant.extrabuckles, augment.variant.flowingtears | Gain a Giant's Belt. After your champions take 75000 damage, get 2 more. |  |
| augment | Feeling Lucky (`DA_FeelingLucky`) | augment.category.economic, augment.roundvariant.mid, augment.tier.silver, augment.variant.feelinglucky | Gain 12 gold, then flip a coin. If heads, gain 4 more gold. |  |
| augment | Find Your Center (`DA_FindYourCenter`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver | Your champion that starts combat in the center of the front row gains 15% Damage Amp and 25% max Health. |  |
| augment | Flame On (`DA_18_InfernoTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.none, augment.tier.silver | Your 1 and 2-cost Inferno champions gain 0.2 Attack Damage and Ability Power. The one who did the most damage last combat gains double. Gain a Varus and an Akali. |  |
| augment | Flexible (`DA_Flexible`) | augment.category.grantsemblem, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.prismatic, augment.variant.flexible, augment.variant.pandorasitems, augment.variant.salvagebin, augment.variant.thetraittree, augment.variant.traittracker | Gain 1 random Emblem. At the start of every Stage, gain a random Emblem. Your team gains 30 Health for each Emblem they are holding. |  |
| augment | Flowing Tears (`DA_FlowingTears`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.silver, augment.variant.backupbows, augment.variant.carveapath, augment.variant.continuousconjuration, augment.variant.criticalsuccess, augment.variant.extrabuckles, augment.variant.flowingtears | Gain a Tear of the Goddess. After your champions spend 6500 Mana, gain 2 more. |  |
| augment | Focused Fire (`DA_FocusedFire`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver | Your team gains 10% Attack Damage. Every 5 seconds, they gain 5% more. |  |
| augment | Forge a Friend (`DA_ForgeAFriend`) | augment.roundvariant.late, augment.tier.silver, augment.variant.forgeafriend | The next 1-cost champion you buy is 3-star. Gain 5 gold. |  |
| augment | Forged In Strength (`DA_ForgedInStrength`) | augment.category.grantsitems, augment.property.grantsartifactanvil, augment.roundvariant.early, augment.tier.prismatic, augment.variant.forgedinstrength | Gain 1 random Artifact. When you drop below 35 Health, gain 1 more random Artifact, 1 random completed item, and 2 random components.<br><br>Remix Rumble Championship, 2023 |  |
| augment | FOURcing (`DA_18_FOURcing`) | augment.roundvariant.mid, augment.tier.gold | Gain a random 4-cost champion. For each item equipped to that champion, your team gains 100 health. |  |
| augment | Frontline Foundation (`DA_FrontlineFoundation`) | augment.roundvariant.early, augment.tier.gold, augment.variant.frontlinefoundation | Gain a 2-star 1-cost Tank champion and an Emblem that matches their class. |  |
| augment | Future Focused (`DA_FutureFocused`) | augment.category.economic, augment.mode.excludedoubleup, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver | Your Tactician loses 20 Health, but after 5 player combats, gain 3 4-cost champions and 8 gold. |  |
| augment | Gain 21 Gold (`DA_GainGold`) | augment.category.economic, augment.roundvariant.mid, augment.tier.gold, augment.variant.gaingold, augment.variant.raininggold | Gain 21 gold. |  |
| augment | Giant and Mighty (`DA_GiantAndMighty`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Your team becomes large, gaining 200 Health and 10% max Health. |  |
| augment | Gilded Steel (`DA_GildedSteel`) | augment.rarity.common, augment.roundvariant.late, augment.tier.gold, augment.variant.gildedsteel | Gain two 5-cost champions. If you field at least one 5-cost champion, your 1 to 4-cost champions gain 8% Durability.<br><br>K.O. Coliseum Tactician's Crown, 2025 |  |
| augment | Glass Cannon I (`DA_GlassCannon_Silver`) | augment.complexity.complex, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.glasscannon | Allies that start combat in the back row begin combat at 80% Health but gain 16% Damage Amp. |  |
| augment | Glass Cannon II (`DA_GlassCannon_Gold`) | augment.complexity.complex, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.glasscannon | Allies that start combat in the back row begin combat at 80% Health but gain 25% Damage Amp. |  |
| augment | Going Long (`DA_GoingLong`) | augment.category.economic, augment.complexity.complex, augment.roundvariant.early, augment.tier.prismatic, augment.variant.goinglong, augment.variant.invested+, augment.variant.invested++ | You no longer gain interest. Gain 10 gold now. Gain 4 XP after every player combat.<br><br>Interest is extra gold you gain per 10g saved. |  |
| augment | Gold Destiny (`DA_GoldDestiny`) | augment.category.randomaugment, augment.roundvariant.early, augment.tier.gold, augment.variant.destiny | Gain a random Gold Augment and 3 gold. |  |
| augment | Gold Destiny+ (`DA_GoldDestinyPlus`) | augment.category.randomaugment, augment.roundvariant.mid, augment.tier.gold, augment.variant.destiny | Gain a random Gold Augment and 5 gold. |  |
| augment | Golden Gamble (`DA_GoldenGamble`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.goldengamble | Gain 2 gold and flip a coin. If heads, gain a Radiant Lucky Item Chest. If tails, gain 2 Completed Item anvils. |  |
| augment | Golden Gamble+ (`DA_GoldenGamblePlus`) | augment.category.grantsitems, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.goldengamble | Gain 3 gold and flip a coin. If heads, gain a Radiant Lucky Item Chest. If tails, gain 2 Completed Item anvils. |  |
| augment | Golden Gamble++ (`DA_GoldenGamblePlusPlus`) | augment.category.grantsitems, augment.roundvariant.late, augment.tier.prismatic, augment.variant.goldengamble | Gain 6 gold and flip a coin. If heads, gain a Radiant Lucky Item Chest. If tails, gain 2 Completed Item anvils. |  |
| augment | Good For Something I (`DA_18_GoodForSomethingI`) | augment.roundvariant.early, augment.tier.silver, augment.variant.cyberneticimplantsalltiers, augment.variant.cyberneticuplinkalltiers, augment.variant.goodforsomething | Champions that aren't holding items have a 40% chance to drop 1 gold on death. |  |
| augment | Group Hug I (`DA_GroupHugI`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.bestfriends, augment.variant.exiles, augment.variant.grouphug | Combat start: Champions grant other adjacent champions 6 Armor and Magic Resist. This effect stacks. |  |
| augment | Group Hug II (`DA_GroupHugII`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.bestfriends, augment.variant.exiles, augment.variant.grouphug | Combat start: Champions grant other adjacent champions 9 Armor and Magic Resist. This effect stacks. |  |
| augment | Hard Bargain (`DA_HardBargain`) | augment.category.economic, augment.mode.excludedoubleup, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold, augment.variant.ninelives | You cannot choose your Carousel rewards. Gain an additional 6 player health and 8 gold each carousel round.<br>When you do not pick a Carousel Reward, you are given an unpicked champion and the item it carries. |  |
| augment | Hard Commit (`DA_HardCommit`) | augment.category.grantsitems, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.prismatic | Gain a random emblem. Now and at the start of each stage, gain a 1-star champion of that trait with a cost equal to the Stage (max 5) and 3 gold. |  |
| augment | Healing Orbs I (`DA_HealingOrbsI`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver | When an enemy dies, a nearby ally is healed for 250 Health. |  |
| augment | Healing Orbs II (`DA_HealingOrbsII`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | When an enemy dies, a nearby ally is healed for 575 Health. |  |
| augment | Heart of Steel (`DA_HeartOfSteel`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.heartofsteel, augment.variant.retribution, augment.variant.salvagebin, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain a Steadfast Heart. Every 10 seconds of combat its holder survives, Steadfast Heart gains additional 18 permanent max Health. |  |
| augment | Hedge Fund (`DA_HedgeFund`) | augment.category.economic, augment.mode.excludechonccstreasure, augment.roundvariant.early, augment.tier.prismatic, augment.variant.hedgefund, augment.variant.invested+, augment.variant.invested++ | Gain 22 gold. Your max interest is increased to 10. |  |
| augment | Heroic Grab Bag (`DA_HeroicGrabBag`) | augment.category.reroll, augment.roundvariant.early, augment.tier.gold, augment.variant.heroicgrabbag | Gain 2 Lesser Champion Duplicators. Gain 4 gold. |  |
| augment | Heroic Grab Bag+ (`DA_HeroicGrabBagPlus`) | augment.roundvariant.mid, augment.tier.gold, augment.variant.heroicgrabbag | Gain 2 Lesser Champion Duplicators. Gain 8 gold. |  |
| augment | Heroic Grab Bag++ (`DA_HeroicGrabBagPlusPlus`) | augment.category.reroll, augment.roundvariant.late, augment.tier.gold, augment.variant.heroicgrabbag | Gain 2 Lesser Champion Duplicators. Gain 14 gold. |  |
| augment | Hold the Line (`DA_HoldTheLine`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.holdtheline, augment.variant.twinguardians | Champions in your back 2 rows gain 10% Ability Power and 9% Attack Damage for each champion that starts combat in your front row. |  |
| augment | Hustler (`DA_Hustler`) | augment.category.economic, augment.complexity.complex, augment.roundvariant.early, augment.tier.gold, augment.variant.hedgefund, augment.variant.hustler, augment.variant.invested+, augment.variant.invested++ | You no longer gain interest but gain 3 gold at the start of every player combat round. Gain 3 gold now.<br><br>Interest is extra gold you gain per 10g saved. |  |
| augment | Infinity Protection (`DA_InfinityProtection`) | augment.category.grantsitems, augment.mode.excludetockers, augment.roundvariant.none, augment.tier.gold | Gain 3 gold now. On Stage 3-7, gain an Infinity Force. Infinity Force gives allies in the same row a 12% Health shield.<br><br>Monsters Attack Championship, 2023 |  |
| augment | Invested+ (`DA_InvestedPlus`) | augment.category.economic, augment.mode.excludechonccstreasure, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.hedgefund, augment.variant.invested+, augment.variant.invested++ | Gain 26 gold. At the start of each round, gain 1 Shop reroll for every 10 gold above 50 (max 80 gold). |  |
| augment | Invested++ (`DA_InvestedPlusPlus`) | augment.category.economic, augment.mode.excludechonccstreasure, augment.roundvariant.late, augment.tier.prismatic, augment.variant.hedgefund, augment.variant.invested+, augment.variant.invested++ | Gain 45 gold. At the start of each round, gain 1 Shop reroll for every 10 gold above 50 (max 80 gold). |  |
| augment | Investment Strategy I (`DA_InvestmentStrategyI`) | augment.category.reroll, augment.roundvariant.early, augment.tier.gold, augment.variant.investmentstrategy | Your champions gain 9 permanent max health per interest you earn. Gain 6 gold now. |  |
| augment | Investment Strategy II (`DA_InvestmentStrategy`) | augment.category.reroll, augment.roundvariant.early, augment.tier.prismatic, augment.variant.investmentstrategy | Your champions gain 12 permanent max health per interest you earn. Your max interest is increased by 2. Gain 10 gold now. |  |
| augment | Iron Assets (`DA_IronAssets`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.silver | Gain a component anvil and 3 gold. |  |
| augment | It's Me, Baby (`DA_ItsMeBaby`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Gain a championship hex in the bottom right corner. The champion in it gains 15% Damage Amp and 15% Attack Speed, and drops 1 gold every 5 takedowns.<br><br>Lore & Legends Tactician's Crown, 2026 |  |
| augment | Item Extraction (`DA_BlackthornTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold | The first 3 times you sacrifice a champion in the Blackthorn hex, gain a copy of a random component they're holding. Gain an Azir, Veigar, and a Rek'Sai. |  |
| augment | Item Grab Bag I (`DA_ItemGrabBag`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver | Gain 1 random completed item. |  |
| augment | Jeweled Lotus I (`DA_JeweledLotus_I`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.jeweledlotus | Your team gains 10% Critical Strike Chance and Precision.<br><br>Precision: Ability damage can critically strike. Additional Precision grants 10% Critical Strike Damage. |  |
| augment | Jeweled Lotus II (`DA_JeweledLotus_II`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.jeweledlotus | Your team gains 25% Critical Strike Chance, 10% Critical Strike Damage, and Precision.<br><br>Precision: Ability damage can critically strike. Additional Precision grants 10% Critical Strike Damage. |  |
| augment | Kick Start (`DA_KickStart`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver, augment.variant.kickstart | Gain a random 2-star 2-cost champion and 1 gold. |  |
| augment | Kingslayer (`DA_Kingslayer`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.silver, augment.variant.kingslayer, augment.variant.ninelives | After winning player combat, gain 1 gold. If they had more health than you, gain 6 Gold instead. Gain 1 gold. |  |
| augment | Know Your Enemy (`DA_KnowYourEnemy`) | augment.mode.excludetockers, augment.roundvariant.none, augment.tier.gold, augment.variant.knowyourenemy | You can see who you will fight next. Your team gains 8% Damage Amp, increased to 15% if you and your opponent have any of the same traits active. |  |
| augment | Late Game Scaling (`DA_LateGameScaling`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold, augment.variant.lategamescaling | Gain 2 XP at the start of player combat rounds. Your 5-cost champions gain 12% Health and 12% Attack Speed.<br><br>Cyber City Tactician's Crown, 2025 |  |
| augment | Late Game Specialist (`DA_LateGameSpecialist`) | augment.category.economic, augment.roundvariant.mid, augment.tier.silver, augment.variant.lategamespecialist, augment.variant.levelup | When you reach Level 9, gain 27 gold. |  |
| augment | Latent Forge (`DA_LatentForge`) | augment.property.grantsartifactanvil, augment.roundvariant.early, augment.tier.silver | The anvil offers 4 choices. Artifacts are more powerful items with a unique effect. |  |
| augment | Legion of Threes (`DA_LegionOfThrees`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.legionofthrees, emblem | Gain a random Emblem. Your 3-cost champions and all allies equipped with an Emblem gain 150 Health and 12% Attack Speed.<br><br>Reckoning Championship, 2021 |  |
| augment | Level Up! (`DA_LevelUp`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.early, augment.tier.prismatic, augment.variant.lategamespecialist, augment.variant.levelup | When you buy XP, gain an additional 2. Gain 10 immediately. |  |
| augment | Living Forge (`DA_LivingForge`) | augment.category.grantsitems, augment.property.grantsartifactanvil, augment.roundvariant.early, augment.tier.prismatic, augment.variant.livingforge | <br>Artifacts are more powerful items with a unique effect. |  |
| augment | Loaded Dice (`DA_LoadedDice`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver, augment.variant.loadeddice | Your dice and coins are luckier.<br><br>Roll a die and gain gold equal to the number rolled. Then flip a coin and gain 1 gold if you flip heads. |  |
| augment | Lucky Gloves (`DA_LuckyGloves`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.luckygloves, augment.variant.makeshiftarmor, augment.variant.qualityoverquantity | Thief's Gloves will always give your champions ideal items. Gain 2 Sparring Gloves and 4 gold. |  |
| augment | Lucky Gloves+ (`DA_LuckyGlovesPlus`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.luckygloves, augment.variant.makeshiftarmor, augment.variant.qualityoverquantity | Thief's Gloves will always give your champions ideal items. Gain 2 Sparring Gloves now, then another after 4 player combats. |  |
| augment | Luxury Subscription (`DA_LuxurySubscription`) | augment.roundvariant.mid, augment.tier.prismatic, augment.variant.luxurysubscription | Gain a package containing a 5-cost champion, a 2-star 1-cost champion, and 5 gold.<br><br>At the start of the next 2 stages, gain the package again. |  |
| augment | Magic Roll (`DA_MagicRoll`) | augment.roundvariant.mid, augment.tier.gold, augment.variant.magicroll | Roll 3 dice. Gain rewards based on their total. |  |
| augment | Makeshift Armor I (`DA_MakeshiftArmorI`) | augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.silver, augment.variant.cyberneticbulk, augment.variant.cyberneticimplants, augment.variant.cyberneticleech, augment.variant.cyberneticshell, augment.variant.cyberneticuplink, augment.variant.luckygloves, augment.variant.makeshiftarmor | Champions without items equipped gain 30 Armor and Magic Resist. |  |
| augment | Makeshift Armor II (`DA_MakeshiftArmorII`) | augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.gold, augment.variant.cyberneticbulk, augment.variant.cyberneticimplants, augment.variant.cyberneticleech, augment.variant.cyberneticshell, augment.variant.cyberneticuplink, augment.variant.luckygloves, augment.variant.makeshiftarmor | Champions without items equipped gain 50 Armor and Magic Resist. |  |
| augment | Malicious Monetization (`DA_MaliciousMonetization`) | augment.category.economic, augment.roundvariant.late, augment.tier.gold | Gain 4 gold. For the next 2 rounds, enemy champions drop 2 gold when killed. |  |
| augment | Master of All Origins (`DA_18_LuxAugmentII`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.tier.prismatic | Open an armory and choose one of 3 traits. Gain a Lux with that trait and a Spear of Shojin.<br><br>Traits on your board are more likely to appear in the armory. Lux provides +2 to her chosen trait |  |
| augment | Max Build (`DA_MaxBuild`) | augment.mode.excludechonccstreasure, augment.roundvariant.late, augment.tier.gold, augment.variant.maxbuild, augment.variant.onebufftwobuff | Gain 10 free Shop rerolls. When you reach level 9, gain 3 free Shop rerolls and a Champion Duplicator.<br><br>Galaxies Championship, 2020 |  |
| augment | Missed Connections (`DA_MissedConnections`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.missedconnections | Gain a copy of each 1-cost champion. |  |
| augment | Money Hungry (`DA_MoneyHungry_NotBroken`) | augment.category.economic, augment.roundvariant.early, augment.tier.gold, augment.variant.moneyhungry, augment.variant.tinytitans, augment.variant.titanictitan | Gain 7 gold now, then 7 gold at the start of every stage. Picking up gold makes your Tactician larger. |  |
| augment | Money Hungry+ (`DA_MoneyHungryPlus`) | augment.category.economic, augment.rarity.common, augment.roundvariant.mid, augment.tier.gold, augment.variant.moneyhungry, augment.variant.tinytitans, augment.variant.titanictitan | Gain 13 gold now, then 7 gold at the start of every stage. Picking up gold makes your Tactician larger. |  |
| augment | Money Monsoon (`DA_MoneyMonsoon`) | augment.category.economic, augment.roundvariant.late, augment.tier.prismatic | Gain 7 gold now and every round for the rest of the game. |  |
| augment | Nature's Shelter (`DA_18_ElderwoodTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Champions that start combat adjacent to an Elderwood plant gain 15% Attack Speed and heal 2% of their maximum Health every 2 seconds. Gain an Alistar, an Ornn, and a Xayah. |  |
| augment | Nesting Anvils (`DA_NestingAnvils`) | augment.property.grantsartifactanvil, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.nestinganvils | Gain an Artifact Anvil. After you open it, gain a Component Anvil. After you open that, gain 4 gold. |  |
| augment | Nesting Anvils+ (`DA_NestingAnvilsPlus`) | augment.property.grantsartifactanvil, augment.roundvariant.late, augment.tier.prismatic, augment.variant.nestinganvils | Gain an Artifact Anvil. After you open it, gain a Component Anvil. After you open that, gain 8 gold. |  |
| augment | Nesting Dolls (`DA_NestingDolls`) | augment.category.reroll, augment.roundvariant.early, augment.tier.prismatic, augment.variant.nestingdolls, disabled | After a champion dies in combat, spawn a copy of them one star level lower with 70% health. Gain 3 free rerolls. |  |
| augment | Nesting Dolls (`DA_NestingDollsPlus`) | augment.category.reroll, augment.filtering.essentialfiltersonly, augment.roundvariant.none, augment.tier.prismatic, augment.variant.nestingdolls, disabled | After a champion dies in combat, spawn a copy of them one star level lower with 60% health. Gain 3 free rerolls. |  |
| augment | Nesting Dolls (`DA_NestingDollsPlusPlus`) | augment.category.reroll, augment.filtering.essentialfiltersonly, augment.roundvariant.none, augment.tier.prismatic, augment.variant.nestingdolls, disabled | After a champion dies in combat, spawn a copy of them one star level lower with 60% health. Gain 3 free rerolls. |  |
| augment | NO SCOUT NO PIVOT (`DA_NoScoutNoPivot`) | augment.category.reroll, augment.complexity.complex, augment.mode.excludedoubleup, augment.roundvariant.early, augment.tier.gold, augment.variant.dummify, augment.variant.noscoutnopivot, augment.variant.recombobulator | Champions that fight in player combat cannot be benched or sold. Your team gains 1% Health, and 1% Attack Damage and Ability Power after player combat. |  |
| augment | Omega Riftbeast (`DA_18_RiftbeastTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | You can now choose a second Alpha Riftbeast. Alpha Riftbeasts gain 10% max Health and 10% Attack Speed. Gain a Scuttlecrab, a Cinderling, and a Pebbles. |  |
| augment | One Buff Two Buff (`DA_OneBuffTwoBuff`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.maxbuild, augment.variant.onebufftwobuff | Gain a Red Buff, a Blue Buff, and a Champion Duplicator. |  |
| augment | One, Two, Five! (`DA_18_OneTwoFive`) | augment.category.economic, augment.roundvariant.late, augment.tier.silver | Gain 1 random component, 2 gold, and 1 random 5-cost champion. |  |
| augment | Ones Two Three (`DA_18_OnesTwosThree`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver | Gain 2 1-cost champions, 1 2-cost champion, and 1 3-cost champion. |  |
| augment | Pandora's Bench (`DA_PandorasBench`) | augment.mode.excludechonccstreasure, augment.mode.excludedoubleup, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.silver, augment.variant.clearmind, augment.variant.clutteredmind, augment.variant.pandorasbench | At the start of every round, champions on the 3 rightmost bench slots transform into random champions of the same cost. Gain 4 gold. |  |
| augment | Pandora's Items I (`DA_PandorasItemsI`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.flexible, augment.variant.pandorasitems, augment.variant.slammin, component.spatorpan | Round start: items on your bench are randomized. <br><br>Gain 1 random component. |  |
| augment | Pandora's Items II (`DA_PandorasItemsII`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.flexible, augment.variant.pandorasitems, augment.variant.slammin, component.spatorpan | Round start: items on your bench are randomized. <br><br>Gain 2 random components and 4 gold. |  |
| augment | Pandora's Items III (`DA_PandorasItemsIII`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.flexible, augment.variant.pandorasitems, augment.variant.slammin, component.spatorpan | Round start: items on your bench are randomized. <br><br>Gain 1 Radiant item. |  |
| augment | Partial Ascension (`DA_PartialAscension`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.ascension | After 12 seconds of combat, your units gain 20% Damage Amp. |  |
| augment | Patience is a Virtue (`DA_PatienceIsAVirtue`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver, augment.variant.firesale, augment.variant.patienceisavirtue | Gain 4 rerolls now. Each round, gain 1 free reroll if you did not buy a champion last round. |  |
| augment | Patient Study (`DA_PatientStudy`) | augment.category.economic, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold | After player combat, gain 2 XP if you won or 3 XP if you lost. |  |
| augment | Pilfer (`DA_Pilfer`) | augment.category.economic, augment.mode.excludechonccstreasure, augment.rarity.common, augment.roundvariant.mid, augment.tier.gold, augment.variant.pilfer | Each round, gain a 1-star copy of the first champion you killed last combat. The first time you gain 21 gold worth of champions in this way, gain a Thief's Gloves. |  |
| augment | Plot Armor (`DA_PlotArmor`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.plotarmor | Your team gains 8 Armor and Magic Resist. After falling below 50% Health, increase this to 40 for the rest of combat. |  |
| augment | Portable Forge (`DA_PortableForge`) | augment.category.grantsitems, augment.property.grantsartifactanvil, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Choose 1 of 4 Artifacts. Artifacts are more powerful items with a unique effect. |  |
| augment | Prismatic Destiny (`DA_PrismaticDestiny`) | augment.category.randomaugment, augment.roundvariant.early, augment.tier.prismatic, augment.variant.destiny | Gain a random Prismatic Augment and 4 gold. |  |
| augment | Prismatic Destiny+ (`DA_PrismaticDestinyPlus`) | augment.category.randomaugment, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.destiny | Gain a random Prismatic Augment and 7 gold. |  |
| augment | Prismatic Ticket (`DA_PrismaticTicket`) | augment.category.economic, augment.category.reroll, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.prismaticticket | Each time your shop is rerolled you have a 45% chance to gain a free reroll. |  |
| augment | Promised Protection (`DA_PromisedProtection`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.makeshiftarmor, augment.variant.promisedprotection | Gain a Protector's Vow. Protector's Vow grants its holder 20% additional Mana from all sources and 200 max Health. |  |
| augment | Quick Streaks (`DA_QuickStreaks`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver | You gain twice as much progress towards win and loss streaks. Gain 2 gold. |  |
| augment | Radiant Rascal (`DA_RadiantRascal`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.radiantrascal | Gain a Radiant Thief's Gloves item. This equips 2 random Radiant items every round. |  |
| augment | Radiant Relics (`DA_RadiantRelic`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Choose 1 of 5 Radiant Items. Gain a Magnetic Remover. |  |
| augment | Recombobulator (`DA_Recombobulator`) | augment.complexity.complex, augment.roundvariant.mid, augment.tier.silver, augment.variant.pocketrecombobulator, augment.variant.recombobulator | Champions on your board permanently transform into random champions 1 cost tier higher (max 5). Gain 2 Magnetic Removers and 3 free rerolls. |  |
| augment | Replication (`DA_Replication`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold | Choose 1 of 3 components. For the next 2 rounds, gain a copy of that component. |  |
| augment | Residual Magic (`DA_18_ResidualMagic`) | augment.roundvariant.early, augment.tier.silver, augment.variant.residualmagic | Your team gains 60 Health. Each time you purchase a Wisp, increase this by 10. |  |
| augment | Residual Magic + (`DA_18_ResidualMagicPlus`) | augment.roundvariant.mid, augment.tier.silver, augment.variant.residualmagic | Your team gains 75 Health. Each time you purchase a Wisp, increase this by 10. |  |
| augment | Residual Magic ++ (`DA_18_ResidualMagicPlusPlus`) | augment.roundvariant.late, augment.tier.silver, augment.variant.residualmagic | Your team gains 90 Health. Each time you purchase a Wisp, increase this by 10. |  |
| augment | Retribution (`DA_Retribution`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.heartofsteel, augment.variant.retribution, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain 2 Hands of Justice. Allies equipped with Hand of Justice gain Precision and 25% Critical Strike Chance.<br><br>Precision: Ability damage can critically strike. Additional Precision grants 10% Critical Strike Damage. |  |
| augment | Rolling For Days (`DA_RollingForDays`) | augment.category.economic, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.rollingfordays | Gain 10 free Shop rerolls. |  |
| augment | Salvage Bin (`DA_SalvageBin`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.craftedcrafting, augment.variant.flexible, augment.variant.salvagebin, augment.variant.traittracker | Gain 1 random completed item now, and 1 component after 8 player combats. Selling champions breaks completed items into components (excluding Tactician's items and Emblems). |  |
| augment | Salvage Bin+ (`DA_SalvageBinPlus`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.craftedcrafting, augment.variant.flexible, augment.variant.salvagebin, augment.variant.traittracker | Gain 1 random completed item now, and 1 component after 4 player combats. Selling champions breaks completed items into components (excluding Tactician's items and Emblems). |  |
| augment | Seraphim's Staff (`DA_SeraphimsStaff`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.retribution, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain an Archangel's Staff. Archangel's Staff grants 2 additional Mana Regen if its holder has 90% or more Ability Power. |  |
| augment | Shimmerscale Essence (`DA_ShimmerscaleEssence`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic | Gain a Gambler's Blade. After 6 player combats, gain a Mogul's Mail. |  |
| augment | Shopping Spree (`DA_ShoppingSpree`) | augment.category.economic, augment.roundvariant.early, augment.tier.prismatic, augment.variant.shoppingspree, augment.variant.tradesector | When you level up, gain a number of Shop refreshes equal to your level +1. Gain 6 gold. |  |
| augment | Silver Destiny (`DA_SilverDestiny`) | augment.category.randomaugment, augment.roundvariant.early, augment.tier.silver, augment.variant.destiny | Gain a random Silver Augment and 2 gold. |  |
| augment | Silver Destiny+ (`DA_SilverDestinyPlus`) | augment.category.randomaugment, augment.roundvariant.mid, augment.tier.silver, augment.variant.destiny | Gain a random Silver Augment and 4 gold. |  |
| augment | Silver Destiny++ (`DA_SilverDestinyPlusPlus`) | augment.category.randomaugment, augment.roundvariant.late, augment.tier.silver, augment.variant.destiny | Gain a random Silver Augment and 7 gold. |  |
| augment | Silver Spoon (`DA_SilverSpoon`) | augment.category.economic, augment.roundvariant.early, augment.tier.silver | Gain 10 XP. |  |
| augment | Slammin' (`DA_Slammin`) | augment.category.grantsitems, augment.mode.excludedoubleup, augment.property.grantsxp, augment.roundvariant.early, augment.tier.gold, augment.variant.aurafarming, augment.variant.pandorasitems, augment.variant.slammin, consumable, reforger, reusable | Gain 3 gold. After each player combat, if there are no items on your bench (other than consumables), gain 2 XP. |  |
| augment | Slammin'+ (`DA_SlamminPlus`) | augment.category.grantsitems, augment.mode.excludedoubleup, augment.property.grantsxp, augment.roundvariant.mid, augment.tier.gold, augment.variant.aurafarming, augment.variant.pandorasitems, augment.variant.slammin, consumable, reforger, reusable | Gain 4 gold and 10 XP now. After each player combat, if there are no items on your bench (other than consumables), gain 2 XP. |  |
| augment | Slice of Life (`DA_SliceOfLife`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver, augment.variant.sliceoflife | Twice per stage, gain a random champion. Its cost increases by Stage. This effect ends after receiving 1 5-cost champion. |  |
| augment | Slightly Magic Roll (`DA_SlightlyMagicRoll`) | augment.roundvariant.early, augment.tier.silver, augment.variant.magicroll | Roll a die. Gain rewards based on the number rolled. |  |
| augment | Small Furry Friend (`DA_18_SprykinAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | While Sprykin is active, gain a second BFF summon that is 45% as powerful. Gain a Teemo, a Veigar, and a Kobuko. |  |
| augment | Small Grab Bag (`DA_SmallGrabBag`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.smallgrabbag, component.spatorpan | Gain 2 random item components. |  |
| augment | Solo Leveling (`DA_SoloLeveling`) | augment.complexity.complex, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold, augment.variant.sololeveling | For the next 5 combats, your team size is 1, but the champion you field has massively increased stats. Gain 1 XP for every kill they get. Afterwards, gain 2 item components. |  |
| augment | Solo Plate (`DA_SoloPlate`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.retribution, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption, augment.variant.twinguardians | Gain a Gargoyle Stoneplate. Allies holding Gargoyle Stoneplate gain 17% max Health if they start combat alone in their row. |  |
| augment | Soul Awakening (`DA_SoulAwakening`) | augment.rarity.common, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.soulawakening | Combat start: Your team gains 1.5% Attack Damage and Ability Power per second for 10 seconds. At max stacks, deal 12% bonus true damage. |  |
| augment | Speedy Double Kill (`DA_SpeedyDoubleKill`) | augment.category.grantsitems, augment.mode.excludedoubleup, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold, augment.variant.speedydoublekill | Gain a Guinsoo's Rageblade. When 2 players are eliminated, gain 40 gold.<br><br>Fates Championship, 2021 |  |
| augment | Spirit of Redemption (`DA_SpiritOfRedemption`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.gold, augment.variant.deadlierblades, augment.variant.deadliercaps, augment.variant.heartofsteel, augment.variant.retribution, augment.variant.seraphimsstaff, augment.variant.soloplate, augment.variant.spiritofredemption | Gain a Spirit Visage. Every 5 seconds, Spirit Visage heals allies within 1 hex for 7.5% of their missing Health. |  |
| augment | Spreading Roots (`DA_SpreadingRoots`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.cookingpot, augment.variant.spreadingroots, augment.variant.traitladder, augment.variant.wanderingtrainer | Gain a random Emblems. After 3 combats, gain another. |  |
| augment | Spreading Roots+ (`DA_SpreadingRootsPlus`) | augment.category.grantsitems, augment.roundvariant.mid, augment.tier.gold, augment.variant.cookingpot, augment.variant.spreadingroots, augment.variant.traitladder, augment.variant.wanderingtrainer, emblem | Gain 2 random Emblems and 2 gold. |  |
| augment | Staffsmith (`DA_Staffsmith`) | augment.category.grantsitems, augment.roundvariant.late, augment.tier.gold, craftable, emblem | Gain 2 random completed items that build from Needlessly Large Rod. |  |
| augment | Stand United (`DA_StandUnited`) | augment.complexity.complex, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.bronzeforlife, augment.variant.standunited | Your units gain 1.5% Attack Damage and 1.5% Ability Power for each non-unique Trait active across your team. |  |
| augment | Starring Up (`DA_StarringUp`) | augment.category.reroll, augment.complexity.complex, augment.property.grantsxp, augment.roundvariant.early, augment.tier.prismatic, disabled | After 3-starring 5 champions, set your level to 9. Gain 2 rerolls now and at the start of every round. |  |
| augment | Subscription Service (`DA_SubscriptionService`) | augment.roundvariant.early, augment.tier.prismatic, disabled | Now and at the start of each stage, open a shop of 4 unique 4-cost champions and gain 6 gold. |  |
| augment | Sun and Moon (`DA_18_LunarTraitAugment`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.gold, augment.variant.lunartraitaugment | Your Lunar champions gain 100 Health and 8% Damage Amp for each unique Solar champion fielded. Gain a Leona, a Kayle, and a Diana. |  |
| augment | Sun and Moon+ (`DA_18_LunarTraitAugmentPlus`) | augment.category.trait, augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.tier.gold, augment.variant.lunartraitaugment | Your Lunar champions gain 100 Health and 8% Damage Amp for each unique Solar champion fielded. Gain a Leona, a Kayle, and an Aphelios. |  |
| augment | Sweet Treats (`DA_SweetTreats`) | augment.category.grantsitems, augment.property.grantsartifactanvil, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.sweettreats | <br>Magic N' Mayhem Tactician's Crown, 2024 |  |
| augment | Sword Overflow (`DA_SwordOverflow`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Gain 4 BF Swords. Your BF Swords grant +4% Attack Speed. |  |
| augment | Swordsmith (`DA_Swordsmith`) | augment.category.grantsitems, augment.roundvariant.late, augment.tier.gold | Gain 2 random completed items that build from B.F. Sword. |  |
| augment | Tactician's Kitchen (`DA_TacticiansKitchen`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.coronation, augment.variant.tacticianskitchen | Gain a random Emblem. After 3 rounds, gain a Tactician's Cape. |  |
| augment | Team Building (`DA_TeamBuilding`) | augment.category.reroll, augment.roundvariant.early, augment.roundvariant.mid, augment.tier.silver, augment.variant.teambuilding | Gain a Lesser Champion Duplicator. Gain another after 5 player combats.<br><br>This item allows you to copy a 3-cost or less champion. |  |
| augment | The Golden Dragon (`DA_TheGoldenDragon`) | augment.category.grantsitems, augment.complexity.complex, augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.gold, augment.variant.shimmerscaleessence, augment.variant.thegoldendragon | Gain a Mogul's Mail. Champions holding Mogul's Mail take up +1 team slot but gain 600 Health and 15% Durability.<br><br>Mogul's Mail gives gold as well as combat power.<br>Dragonlands Championship, 2022 |  |
| augment | The Golden Egg (`DA_GoldenEgg`) | augment.category.economic, augment.category.nolowhealth, augment.filtering.essentialfiltersonly, augment.mode.excludetockers, augment.roundvariant.late, augment.tier.prismatic, augment.variant.goldenegg | Gain a golden egg that hatches in 11 turns for a huge amount of loot. Winning player combat speeds up the hatch timer by an extra turn. |  |
| augment | The Tower (`DA_TheTower`) | augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.thetower | Gain a giant Training Dummy. Every 4 seconds, it zaps the 3 nearest enemies dealing 5% max Health true damage. |  |
| augment | The Trait Tree (`DA_TheTraitTree`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.cookingpot, augment.variant.thetraittree, augment.variant.traitladder, augment.variant.urf, augment.variant.wanderingtrainer, emblem | Gain 3 random Emblems and 2 gold. |  |
| augment | The Trait Tree+ (`DA_TheTraitTreePlus`) | augment.category.grantsitems, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.cookingpot, augment.variant.thetraittree, augment.variant.traitladder, augment.variant.urf, augment.variant.wanderingtrainer, emblem, reforger | Gain 3 random Emblems, a Reforger, and 4 gold. |  |
| augment | Time Skip (`DA_TimeSkip`) | augment.category.economic, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold | Disable your Shop for the next 3 rounds. Then gain 32 XP. |  |
| augment | Tons of Stats! (`DA_TonsOfStatsI`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold | Your team gains 44 Health, 4% Attack Damage, 4% Ability Power, 4 Armor, 4 Magic Resist, 4% Attack Speed, and 4 Mana. |  |
| augment | TONS of Stats! (`DA_TonsOfStatsII`) | augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Your team gains 88 Health, 8% Attack Damage, 8% Ability Power, 8 Armor, 8 Magic Resist, 8% Attack Speed, and 8 Mana. |  |
| augment | Trade Sector (`DA_TradeSector`) | augment.category.economic, augment.roundvariant.early, augment.tier.gold, augment.variant.commercecore, augment.variant.tradesector | Gain a Shop reroll every round. Gain 2 gold. |  |
| augment | Trade Sector+ (`DA_TradeSectorPlus`) | augment.category.economic, augment.roundvariant.mid, augment.tier.gold, augment.variant.commercecore, augment.variant.tradesector | Gain a Shop reroll every round. Gain 8 gold. |  |
| augment | Trait Ladder (`DA_TraitLadder`) | augment.complexity.complex, augment.roundvariant.early, augment.tier.prismatic, augment.variant.bronzeforlife, augment.variant.coronation, augment.variant.cursedcrown, augment.variant.spreadingroots, augment.variant.thetraittree, augment.variant.traitladder, augment.variant.verticality, augment.variant.worldrunes, emblem | Gain a random emblem. After fielding 2 non-unique traits in a player combat, gain a reward. Then increase the number of traits needed and the size of the reward. |  |
| augment | Twin Guardians (`DA_Lineup`) | augment.rarity.common, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.lineup, disabled | Your team gains 2 Armor and Magic Resist for each ally that starts combat in the front 2 rows. |  |
| augment | Twin Guardians (`DA_TwinGuardians`) | augment.rarity.common, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.holdtheline, augment.variant.soloplate, augment.variant.twinguardians | If you have exactly 2 allies in your first row, grant them 100 Health, 35 Armor, and 35 Magic Resist. |  |
| augment | U.R.F (`DA_URF`) | augment.category.grantsitems, augment.roundvariant.early, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.thetraittree, augment.variant.urf | Gain a Spatula. Champions holding Spatula or Frying Pan items gain 2000% Attack Speed and 3 Mana Regen. |  |
| augment | Upward Mobility (`DA_UpwardMobility`) | augment.category.economic, augment.mode.excludedoubleup, augment.rarity.common, augment.roundvariant.early, augment.tier.prismatic, augment.variant.upwardmobility | Buying XP costs 1 less. Gain 2 Health and 2 Shop rerolls whenever you level up. |  |
| augment | Urf's Grab Bag (`DA_UrfsGrabBag`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Gain 1 Spatula, 3 random components, and 5 gold. |  |
| augment | Verticality I (`DA_VerticalityI`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.silver, augment.variant.traitladder, augment.variant.verticality | Champions gain 1.5% Attack Damage, 1.5% Ability Power, 1.5 Armor, and 1.5 Magic Resist for each ally that shares a trait with them. |  |
| augment | Verticality II (`DA_VerticalityII`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.gold, augment.variant.traitladder, augment.variant.verticality | Champions gain 2.5% Attack Damage, 2.5% Ability Power, 2 Armor, and 2 Magic Resist for each ally that shares a trait with them. |  |
| augment | Verticality III (`DA_VerticalityIII`) | augment.filtering.essentialfiltersonly, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic, augment.variant.traitladder, augment.variant.verticality | Champions gain 4% Attack Damage, 4% Ability Power, 3.5 Armor, and 3.5 Magic Resist for each ally that shares a trait with them. |  |
| augment | Wand Overflow (`DA_WandOverflow`) | augment.category.grantsitems, augment.roundvariant.late, augment.roundvariant.mid, augment.tier.prismatic | Gain 4 Needlessly Large Rods. Your Needlessly Large Rods grant +5% Attack Speed. |  |
| augment | Warpath (`DA_Warpath`) | augment.mode.excludedoubleup, augment.mode.excludetockers, augment.roundvariant.early, augment.tier.gold, augment.variant.warpath | Gain a 2-star 2-cost champion. After dealing 80 player damage, gain a chest of high cost champions and items. |  |
| augment | We Stick Together (`DA_WeStickTogether`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.prismatic, augment.variant.westicktogether | Gain a random Emblem and a completed item anvil. Allies that share a trait with that Emblem gain 30% Attack Speed. <br><br>Into The Arcane Tactician's Crown, 2025 |  |
| augment | Weight the Worth (`DA_18_WeightTheWorth`) | augment.category.reroll, augment.complexity.complex, augment.filtering.essentialfiltersonly, augment.roundvariant.mid, augment.tier.gold, augment.variant.buildabud, augment.variant.weighttheworth | The first time you 3-star a champion, gain a copy of them each round for the rest of the game. 3-starring the same champion again grants additional copies. Gain a Lesser Champion Duplicator. |  |
| augment | Wisp Rebate (`DA_18_WispRebate`) | augment.roundvariant.none, augment.tier.silver, augment.variant.wisprebate, disabled | Each time you purchase a Wisp, gain 2 gold. Gain 4 gold now. |  |
| augment | Wisp Rebate (`DA_18_WispRebatePlus`) | augment.roundvariant.mid, augment.tier.silver, augment.variant.wisprebate | Each time you purchase a Wisp, gain 2 gold. Gain 4 gold now. |  |
| augment | Wisp Rebate+ (`DA_18_WispRebatePlusPlus`) | augment.roundvariant.late, augment.tier.silver, augment.variant.wisprebate | Each time you purchase a Wisp, gain 2 gold. Gain 8 gold now. |  |
| augment | Worth the Wait (`DA_WorththeWait`) | augment.roundvariant.early, augment.tier.gold, augment.variant.weighttheworth, augment.variant.worththewait, augment.variant.worththewaitll | Gain a random 1-cost champion. Gain another copy of them at the start of each round for the rest of the game. |  |
| augment | Worth the Wait II (`DA_WorththeWaitII`) | augment.roundvariant.early, augment.tier.prismatic, augment.variant.weighttheworth, augment.variant.worththewait | Gain 2 copies of a random 2-cost champion. Gain another copy of them at the start of each round for the rest of the game. |  |
| augment | Woven Magic (`DA_WovenMagic`) | augment.category.grantsitems, augment.roundvariant.early, augment.tier.gold, augment.variant.wovenmagic | Gain a random item component. Every 2200 Mana spent by your champions, grants an additional component. |  |
| augment | Young and Wild and Free (`DA_YoungAndWildAndFree`) | augment.mode.excludetockers, augment.roundvariant.early, augment.tier.silver | You can always move freely on Carousel rounds. Gain 5 gold. |  |
| item | Adaptive Helm (`DA_AdaptiveHelm`) | magic, tank, craftable, provides.resource.mana | Gain an additional 15% Mana from all sources. The wearer gains an additional bonus based on their Role:<br><br>Tanks and Fighters: Gain 30 Armor and Magic Resistance.<br><br>Other Roles: Gain 10% Attack Damage and Ability Power. |  |
| item | Archangel's Staff (`DA_ArchangelsStaff`) | magic, craftable, stacking, provides.resource.mana | Combat start: Gain 20% Ability Power every 5 seconds in combat. |  |
| item | Bloodthirster (`DA_Bloodthirster`) | attack, craftable | Once per combat at 50% Health, gain a 30% max Health Shield that lasts up to 5 seconds. |  |
| item | Blue Buff (`DA_BlueBuff`) | magic, craftable, provides.resource.mana | Gain 10% additional Attack Damage and Ability Power from all sources. |  |
| item | Bramble Vest (`DA_BrambleVest`) | tank, craftable | Gain 6% max Health.<br><br>Take 5% reduced damage from attacks. When struck by any attack, deal 100 magic damage to all adjacent enemies.<br><br>Cooldown: 2 seconds |  |
| item | Crownguard (`DA_Crownguard`) | tank, craftable | Combat start: Gain a 25% max Health Shield for 8 seconds.<br>When the shield expires, gain 20% Ability Power. |  |
| item | Deathblade (`DA_Deathblade`) | attack, craftable | Perfect peace and calm for the holder - and all who face it. |  |
| item | Dragon's Claw (`DA_DragonsClaw`) | tank, craftable | Gain 6% max Health. Every 2 seconds, heal 2.5% max Health. |  |
| item | Edge of Night (`DA_EdgeOfNight`) | attack, craftable | At 40% Health, briefly become untargetable, shed negative effects, and heal 15% missing health. |  |
| item | Evenshroud (`DA_Evenshroud`) | tank, craftable | 30% Sunder enemies within 2 hexes. Gain 15 Armor and Magic Resist for the first 15 seconds of combat.<br><br>Sunder: Reduce Armor |  |
| item | Gargoyle Stoneplate (`DA_GargoyleStoneplate`) | tank, craftable | Gain 10 Armor and 10 Magic Resist for each enemy targeting the holder. |  |
| item | Giant Slayer (`DA_GiantSlayer`) | attack, magic, craftable | Gain 15% additional Damage Amp against Tanks. |  |
| item | Guinsoo's Rageblade (`DA_GuinsoosRageblade`) | attack, craftable, stacking | Gain 7% stacking Attack Speed every second. |  |
| item | Hand of Justice (`DA_HandOfJustice`) | attack, magic, craftable, provides.resource.mana | Gain 2 effects:<br>• 18% Attack Damage and 18% Ability Power.<br>• 15% Omnivamp.<br><br>While above 50% health, double the Attack Damage and Ability Power. While below 50% Health, double the Omnivamp. |  |
| item | Hextech Gunblade (`DA_HextechGunblade`) | magic, craftable | Heal the lowest percent Health ally for 20% of damage dealt. |  |
| item | Infinity Edge (`DA_InfinityEdge`) | attack, craftable | Gain Precision. <br><br>Precision: Ability damage can critically strike. Extra Precision grants 10% Critical Strike Damage. |  |
| item | Ionic Spark (`DA_IonicSpark`) | tank, craftable | 30% Shred enemies within 2 hexes. When enemies cast an Ability, deal magic damage equal to 150% of the Mana spent.<br><br>Shred: Reduce Magic Resist |  |
| item | Jeweled Gauntlet (`DA_JeweledGauntlet`) | magic, craftable | Gain Precision. <br><br>Precision: Ability damage can critically strike. Extra Precision grants 10% Critical Strike Damage. |  |
| item | Kraken's Fury (`DA_KrakensFury`) | attack, craftable, stacking | Attacks grant 3.5% stacking Attack Damage, up to 15 attacks. After 15 attacks, gain 15% Attack Speed. |  |
| item | Last Whisper (`DA_LastWhisper`) | attack, craftable | Attacks and Ability damage 30% Sunders the target for 3 seconds. This effect does not stack.<br><br>Sunder: Reduce Armor |  |
| item | Morellonomicon (`DA_Morellonomicon`) | magic, craftable | Attacks and Abilities deal 1% Burn and 33% Wound to enemies for 10 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Nashor's Tooth (`DA_NashorsTooth`) | magic, craftable | Attacks grant 2 bonus Mana, increased to 4 if they critically strike. |  |
| item | Protector's Vow (`DA_ProtectorsVow`) | tank, craftable, provides.resource.mana | Combat Start: Gain 20 Mana.<br><br>At 40% Health, gain 15 Mana and a Shield equal to 20% max Health. |  |
| item | Quicksilver (`DA_Quicksilver`) | attack, craftable | Combat Start: Unstoppable for 18 seconds. <br><br>Gain 3% stacking Attack Speed every second. |  |
| item | Rabadon's Deathcap (`DA_RabadonsDeathcap`) | magic, craftable | This humble hat can help you make, or unmake, the world itself. |  |
| item | Red Buff (`DA_RedBuff`) | attack, craftable | Attacks and Abilities 1% Burn and 33% Wound enemies for 5 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Spear of Shojin (`DA_SpearOfShojin`) | attack, magic, craftable, provides.resource.mana | Attacks grant 5 bonus Mana. |  |
| item | Spirit Visage (`DA_SpiritVisage`) | tank, craftable, spiritvisage, provides.resource.mana | Regenerate 2% of missing Health each second. |  |
| item | Steadfast Heart (`DA_SteadfastHeart`) | tank, craftable, steadfastheart | Gain 5% Durability. While above 50% Health, instead gain 15% Durability. |  |
| item | Sterak's Gage (`DA_SteraksGage`) | attack, craftable | At 60% Health, gain a Shield equal to 40% of the wearer's maximum Health that rapidly decays over 4 seconds. |  |
| item | Striker's Flail (`DA_StrikersFlail`) | attack, magic, craftable | Critical Strikes grant 5% Damage Amp for 5 seconds, stacking up to 4 times. |  |
| item | Sunfire Cape (`DA_SunfireCape`) | tank, craftable | Gain 8% max Health.<br><br>Every 2 seconds, deal 1% Burn and 33% Wound to an enemy within 2 hexes for 10 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Tactician's Cape (`DA_TacticiansCape`) | craftable, tacticians | Your team gains +1 maximum team size.<br><br>10% chance to drop 1 gold after 10 seconds of combat.<br><br>...and a bit of Luck. |  |
| item | Tactician's Crown (`DA_TacticiansCrown`) | craftable, tacticians | Your team gains +1 maximum team size.<br><br>10% chance to drop 1 gold when you win combat.<br><br>...the Heart of a hero... |  |
| item | Tactician's Shield (`DA_TacticiansShield`) | craftable, tacticians | Your team gains +1 maximum team size.<br><br>10% chance to drop 1 gold when the holder dies.<br><br>Imbued with a Philosopher's wisdom... |  |
| item | Thief's Gloves (`DA_ThiefsGloves`) | craftable, thiefsgloves | Each round: Equip 2 random items<br><br>[Consumes 3 item slots.] |  |
| item | Titan's Resolve (`DA_TitansResolve`) | attack, craftable, stacking | Gain 2% Attack Damage and Ability Power when attacking or taking damage, stacking up to 25 times.<br><br>At full stacks, gain 10% Damage Amp and become unstoppable. |  |
| item | Void Staff (`DA_VoidStaff`) | magic, craftable, provides.resource.mana | Attacks and Ability damage 30% Shred the target for 5 seconds. This effect does not stack.<br><br>Shred: Reduce Magic Resist |  |
| item | Warmog's Armor (`DA_WarmogsArmor`) | tank, craftable | Gain 18% max Health. |  |
| item | B.F. Sword (`DA_Component_BFSword`) | component | AD +10% Attack Damage |  |
| item | Chain Vest (`DA_Component_ChainVest`) | component | %i:scaleArmor% +20 Armor |  |
| item | Frying Pan (`DA_Component_FryingPan`) | component, component.spatorpan | ...why else would it be here? |  |
| item | Giant's Belt (`DA_Component_GiantsBelt`) | component | HP +150 Health |  |
| item | Needlessly Large Rod (`DA_Component_NeedlesslyLargeRod`) | component | AP +10% Ability Power |  |
| item | Negatron Cloak (`DA_Component_NegatronCloak`) | component | %i:scaleMR% +20 Magic Resist |  |
| item | Recurve Bow (`DA_Component_RecurveBow`) | component | %i:scaleAS% +10% Attack Speed |  |
| item | Sparring Gloves (`DA_Component_SparringGloves`) | component | %i:scaleCrit% +20% Critical Strike Chance |  |
| item | Spatula (`DA_Component_Spatula`) | component, component.spatorpan | It must do something... |  |
| item | Tear of the Goddess (`DA_Component_TearOfTheGoddess`) | component, provides.resource.mana | %i:scaleManaRegen% +1 Mana Regeneration |  |
| item | Ability Power Booster (`DA_AbilityBooster18`) | consumable.statboost | Permanently grant 8% Ability Power. <br><br>[Consumable - This item disappears when used.] |  |
| item | Armor and Magic Resist Booster (`DA_ArmorMRBooster18`) | consumable.statboost | Permanently grant 10 Armor and 10 Magic Resist. <br><br>[Consumable - This item disappears when used.] |  |
| item | Attack Damage Booster (`DA_AttackBooster18`) | consumable.statboost | Permanently grant 8% Attack Damage. <br><br>[Consumable - This item disappears when used.] |  |
| item | Attack Speed Booster (`DA_SpeedBooster18`) | consumable.statboost | Permanently grant 8% Attack Speed. <br><br>[Consumable - This item disappears when used.] |  |
| item | Champion Duplicator (`DA_Consumable_ChampionDuplicator`) | consumable, duplicator | Use on a champion to create a 1-star copy on your bench.<br><br>Consumable - This item disappears when used. |  |
| item | Golden Item Remover (`DA_Consumable_GoldenItemRemover`) | cantbecombined, cantreforge, remover, reusable | Use on a champion to unequip all items as many times as you want. Converts all future Magnetic Removers to Reforgers. <br><br>Repeatable: This item can be infinitely reusable. |  |
| item | Health Booster (`DA_HealthBooster18`) | consumable.statboost | Permanently grant 100 max Health. <br><br>[Consumable - This item disappears when used.] |  |
| item | Item Remover (`DA_Consumable_ItemRemover`) | consumable, remover | Use on a champion to unequip all items. <br><br>Cannot be used on champions in combat.<br>Consumable: This item disappears when used. |  |
| item | Lesser Champion Duplicator (`DA_Consumable_LesserChampionDuplicator`) | consumable, duplicator | Use on a 3-cost champion or less to create a 1-star copy on your bench.<br><br>Consumable: This item disappears when used. |  |
| item | Lucky Item Chest (`DA_LuckyItemChest`) | consumable | Use on a champion to open an armory of items especially suited for them.<br><br>These items are based on the champion's recommended items. |  |
| item | Mana Regen Booster (`DA_ManaRegenBooster18`) | consumable.statboost | Permanently grant 1 Mana Regen. <br><br>[Consumable - This item disappears when used.] |  |
| item | Masterwork Upgrade (`DA_MasterworkUpgrade`) | cantremove, consumable, craftable, emblem, temporary | Use on a champion to choose a Radiant version of that champion's craftable completed items. Upgrade the item you choose to its Radiant equivalent and unequip it. |  |
| item | Radiant Lucky Item Chest (`DA_RadiantLuckyItemChest`) | consumable, radiant | Use on a champion to open an armory of items especially suited for them.<br><br>These items are based on the champion's recommended items. |  |
| item | Reforger (`DA_Reforger`) | cantreforge, cantremove, consumable, reforger, temporary | Unequip all items and randomly transform them into new ones of a similar type and quality.<br><br>[Consumable - This item disappears when used.] |  |
| item | Tiny Champion Duplicator (`DA_Consumable_TinyChampionDuplicator`) | consumable, duplicator | Use on a 1-cost champion to create a 1-star copy on your bench.<br><br>Consumable: This item disappears when used. |  |
| item | Blackthorn Emblem (`DA_18_EmblemBlackthorn`) | craftable, emblem, Blackthorn | The holder gains the Blackthorn trait. |  |
| item | Blossom Emblem (`DA_18_EmblemBlossom`) | craftable, emblem, Blossom | The holder gains the Blossom trait. |  |
| item | Brawler Emblem (`DA_18_EmblemBrawler`) | craftable, emblem, westicktogetherbanned, Brawler | The holder gains the Brawler trait. <br><br>Attacks deal 2.5% of the holder's max Health as magic damage. |  |
| item | Coven Emblem (`DA_18_EmblemCoven`) | emblem.elusive, Coven | The holder gains the Coven trait. |  |
| item | Defender Emblem (`DA_18_EmblemDefender`) | emblem.elusive, westicktogetherbanned, Defender | The holder gains the Defender trait. <br><br>Combat Start: Gain 6% Attack Speed for every ally that starts in the front row. |  |
| item | Elderwood Emblem (`DA_18_EmblemElderwood`) | craftable, emblem, Elderwood | The holder gains the Elderwood trait. |  |
| item | Executioner Emblem (`DA_18_EmblemExecutioner`) | craftable, emblem, Executioner | The holder gains the Executioner trait. <br><br>Damage executes enemies below 8% of their max Health. |  |
| item | Fae Emblem (`DA_18_EmblemFae`) | craftable, emblem, Fae | The holder gains the Fae trait. |  |
| item | Flora Fatalis Emblem (`DA_18_EmblemFloraFatalis`) | emblem.elusive, Flora Fatalis | The holder gains the Flora Fatalis trait. |  |
| item | Hunter Emblem (`DA_18_EmblemHunter`) | craftable, emblem, Hunter | The holder gains the Hunter trait. <br><br>Takedowns grant 15% Attack Damage. |  |
| item | Inferno Emblem (`DA_18_EmblemInferno`) | craftable, emblem, Inferno | The holder gains the Inferno trait. |  |
| item | Invoker Emblem (`DA_18_EmblemInvoker`) | craftable, emblem, Invoker | The holder gains the Invoker trait. <br><br>On cast, gain Ability Power equal to 8% of Mana spent. |  |
| item | Juggernaut Emblem (`DA_18_EmblemJuggernaut`) | emblem.elusive, westicktogetherbanned, Juggernaut | The holder gains the Juggernaut trait. <br><br>Gain 10 mana whenever a Juggernaut dies. |  |
| item | Lunar Emblem (`DA_18_EmblemLunar`) | craftable, emblem, Lunar | The holder gains the Lunar trait. |  |
| item | Phantom Emblem (`DA_PhantomEmblem18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Gain a temporary emblem of your most active trait. |  |
| item | Primal Emblem (`DA_18_EmblemPrimal`) | craftable, emblem, westicktogetherbanned, Primal | The holder gains the Primal trait. |  |
| item | Rapidfire Emblem (`DA_18_EmblemRapidfire`) | craftable, emblem, Rapidfire | The holder gains the Rapidfire trait. <br><br>Attacks deal 1% of the target's max Health as true damage. |  |
| item | Ravager Emblem (`DA_18_EmblemSlayer`) | craftable, emblem, Ravager | The holder gains the Ravager trait. <br><br>Gain 3% Damage Amp per 300 Health restored. |  |
| item | Spellweaver Emblem (`DA_18_EmblemSpellweaver`) | craftable, emblem, Spellweaver | The holder gains the Spellweaver trait. <br><br>Gain 2 Mana whenever an ally casts their Ability. |  |
| item | Sprykin Emblem (`DA_18_EmblemSprykin`) | craftable, emblem, Sprykin | The holder gains the Sprykin trait.<br><br>If the holder is riding the BFF, gain an additional <br>20% %i:scaleAS% 15 %i:scaleArmor% 15 %i:scaleMR% |  |
| item | Vanguard Emblem (`DA_18_EmblemVanguard`) | craftable, emblem, Vanguard | The holder gains the Vanguard trait. <br><br>If the holder survives 22 seconds in player combat, gain 1 player health. |  |
| item | Abandon Ship (`DA_AbandonShip18`) | charm.category.risky, charm.round.earlymid, charm.tier.3 | Sell your board and bench, gain 6 gold and 8 rerolls. |  |
| item | Aftershock (`DA_18_AfterShock`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | After 8 seconds, stun all enemies for 1.5 seconds. |  |
| item | All Fives (`DA_18_AllFives`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.verylate, charm.tier.3 | Reroll your shop with all 5-cost champions. |  |
| item | All Fours (`DA_18_AllFours`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.late, charm.tier.1 | Reroll your shop with all 4-cost champions. |  |
| item | All Ones (`DA_18_AllOnes`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.early, charm.tier.1 | Reroll your shop with all 1-cost champions. |  |
| item | All Threes (`DA_18_AllThrees`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.mid, charm.round.midlate, charm.tier.1 | Reroll your shop with all 3-cost champions. |  |
| item | All Twos (`DA_18_AllTwos`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.early, charm.round.earlymid, charm.tier.1 | Reroll your shop with all 2-cost champions. |  |
| item | Animate Shop (`DA_AnimateShop18`) | charm.category.shop, charm.round.late, charm.round.midlate, charm.tier.2 | For 18 seconds, your shop rerolls for free every 2 seconds. |  |
| item | Backrow Star (`DA_18_BackrowStar`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | A random back row champion gains 100% Attack Speed for 7 seconds. |  |
| item | Bark Armor (`DA_18_BarkArmor`) | charm.category.combat, charm.round.early, charm.tier.1 | Your champions gain 150 shield for 10 seconds. |  |
| item | Barrier (`DA_Barrier18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Allies gain 1250 Shield, decaying over 6 seconds. |  |
| item | Barter (`DA_Barter18`) | charm.category.goldxp, charm.round.late, charm.round.mid, charm.round.midlate, charm.tier.1 | The next champion sold this round sells for 200% gold. |  |
| item | Beggar's Wisp (`DA_BeggarsWisp18`) | charm.category.goldxp, charm.round.early, charm.round.earlymid, charm.round.late, charm.round.mid, charm.round.midlate, charm.round.verylate, charm.tier.1 | The wilds couldn't find a wisp for you this roll. Gain 3 gold. |  |
| item | Big Boom (`DA_BigBoom18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.tier.1 | The first ally to die explodes, dealing 25% Max Health magic damage. |  |
| item | Blast Potion (`DA_BlastPotion18`) | temporary, potion.normal | After 8 seconds of combat, knock up enemies within 3 hexes for 1.75 seconds.<br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Blaze (`DA_Blaze18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Fire spreads across the board, dealing true damage to enemies. |  |
| item | Blood and Iron (`DA_BloodAndIron18`) | charm.category.item, charm.round.earlymid, charm.round.mid, charm.tier.2.rabbit | After 20 champion deaths, gain a component anvil. |  |
| item | Blood Money (`DA_18_BloodMoney`) | charm.category.goldxp, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1 | Gain 1 gold for every champion you kill. |  |
| item | Blood Ritual (`DA_18_BloodRitual`) | charm.category.misc, charm.lockout.oncepergame, charm.round.midlate, charm.tier.3 | Lose 10 Player Health. Gain a Champion Duplicator. |  |
| item | Booster Shot (`DA_BoosterShot18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Up to 2 1-star champions temporarily star up during combat. |  |
| item | Border Village (`DA_BorderVillage18`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.earlymid, charm.round.mid, charm.tier.3 | Reroll your shop with all 2-star 2-cost champions. |  |
| item | Borrowed Gear (`DA_BorrowedGear18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1 | At the start of combat, a champion gains a temporary recommended item. |  |
| item | Bronze Spoon (`DA_18_BronzeSpoon_Upgrade`) | charm.category.goldxp, charm.round.early, charm.round.earlymid, charm.round.mid, charm.tier.2 | Gain 4 XP. |  |
| item | Bulwark (`DA_Bulwark18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Your Tanks gain a 20% Max Health shield upon falling below 50% Health. |  |
| item | Bunch-o'-Belts (`DA_BunchOBelts18`) | charm.category.combat, charm.round.mid, charm.round.midlate, charm.tier.1 | Your allies gain 7 temporary, non-removable Giant's Belts. |  |
| item | Clone Companion (`DA_CloneCompanion18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Clone your highest damage champion. The clone deals 20% damage. |  |
| item | Coin Flip (`DA_CoinFlip18`) | charm.category.goldxp, charm.round.early, charm.tier.1 | Flip a coin, gain 1 gold if it's heads. |  |
| item | Combust (`DA_Combust18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Your champions explode on death, dealing 12% Max Health magic damage. |  |
| item | Component Bounty (`DA_ComponentBounty`) | charm.category.risky, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1.rabbit, charm.tier.2.rabbit | If you win the next player combat, gain a random component. |  |
| item | Counterspell (`DA_18_Counterspell`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Increase all enemies' Max Mana by 15 until their next cast. |  |
| item | Curio Cart (`DA_CurioCart18`) | charm.category.item, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.2 | Open an item store. Items cost 0 to 15 gold. |  |
| item | Cutpurse (`DA_Cutpurse18`) | charm.category.risky, charm.round.mid, charm.round.midlate, charm.tier.2 | Every 5 seconds, your champions have a 20% chance to drop 1 Gold. |  |
| item | Die Roll (`DA_DieRoll18`) | charm.category.goldxp, charm.round.earlymid, charm.round.mid, charm.tier.1 | Roll a six-sided die. Gain gold equal to the result. |  |
| item | Diversified (`DA_Diversified18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Your team gains 30 Health for each active non-unique trait. |  |
| item | Doodad Bag (`DA_DoodadBag18`) | charm.category.misc, charm.round.earlymid, charm.round.mid, charm.tier.1 | Gain 2 consumables that give permanent Armor and Magic Resist or Health. |  |
| item | Doodad Jar (`DA_DoodadJar18`) | charm.category.misc, charm.round.early, charm.tier.1 | Gain 1 consumable that gives permanent Armor and Magic Resist or Health. |  |
| item | Doodad Sack (`DA_DoodadSack18`) | charm.category.misc, charm.round.late, charm.round.verylate, charm.tier.2 | Gain 3 consumables that give permanent Armor and Magic Resist or Health. |  |
| item | Downpour (`DA_Downpour18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Your team gains 2 Mana Regen. |  |
| item | Drizzle (`DA_18_Drizzle`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | After 8 seconds of combat, your team gains 10 Mana. |  |
| item | Early Fix (`DA_18_EarlyFix`) | charm.category.misc, charm.round.early, charm.tier.1 | Gain 1 Item Reforger. |  |
| item | Essence Theft (`DA_EssenceTheft18`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.round.mid, charm.tier.1 | Gain 50% bonus Coven Essence this combat. |  |
| item | Experienced (`DA_18_Experienced_Upgrade`) | charm.category.goldxp, charm.round.early, charm.tier.1 | Gain 2 XP. |  |
| item | Fellowship (`DA_18_Fellowship`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Champions gain 4% Max Health Shield and 4% Damage Amp per adjacent ally. |  |
| item | Fertilize (`DA_18_Fertilize`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.tier.1 | Gain 1 XP for each enemy that dies. |  |
| item | Flash Fire (`DA_FlashFire18`) | charm.category.shop, charm.round.late, charm.round.mid, charm.round.midlate, charm.tier.1 | Reroll your shop. Inferno lights 2 shop slots on fire, upgrading them. |  |
| item | Flip Frenzy (`DA_FlipFrenzy18`) | charm.category.risky, charm.round.earlymid, charm.round.mid, charm.tier.2 | Flip a coin, gain 1 gold if it's heads. Continue until you flip tails. |  |
| item | Flow (`DA_Flow18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.1 | Your champions are unstoppable and gain 15% Attack Speed for 10 seconds. |  |
| item | Forest Mage (`DA_18_ForestMage`) | charm.category.misc, charm.norollshopafterpurchase, charm.round.late, charm.round.mid, charm.round.midlate, charm.round.verylate, charm.tier.1 | Fill your shop with Wisps. You can only buy one. |  |
| item | Forest Twins (`DA_ForestTwins18`) | charm.category.champion, charm.round.early, charm.tier.2 | Gain 2 copies of a 2-cost champion you don't have. |  |
| item | Found Friend (`DA_FoundFriend18`) | charm.category.combat, charm.round.early, charm.tier.1 | Gain a temporary Training Dummy with a Giant's Belt. |  |
| item | Freeroller (`DA_18_Freeroller`) | charm.category.shop, charm.round.early, charm.round.earlymid, charm.round.mid, charm.tier.1 | Gain 2 rerolls. |  |
| item | Giant Growth (`DA_18_GiantGrowth`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Your highest Health unit grows, gaining 800 Health. |  |
| item | Giant's Aura (`DA_GiantsAura18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2, charm.tier.3 | Your highest Health ally deals 2% max Health damage per second in an area. |  |
| item | Golden Goose (`DA_GoldenGoose18`) | charm.category.goldxp, charm.round.late, charm.round.midlate, charm.tier.2 | Gain 1 gold for every 1700 damage your highest damage champion deals. |  |
| item | Golden Road (`DA_GoldenRoad18`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.tier.2.rabbit | After 3 player combats, gain 2 Gold per fight won. |  |
| item | Good Loss (`DA_GoodLoss18`) | charm.category.risky, charm.round.earlymid, charm.round.mid, charm.tier.2.rabbit | For the next 3 player combats, gain 4 XP if you lose. |  |
| item | Greater Chaos (`DA_GreaterChaos18`) | charm.category.misc, charm.norollshopafterpurchase, charm.round.late, charm.round.verylate, charm.tier.3 | Cast 2 random Wisps. |  |
| item | Grove Armor (`DA_18_GroveArmor`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | Your highest Health champion gains 15 Armor and 15 Magic Resist. |  |
| item | Grow Up (`DA_GrowUp18_Upgrade`) | charm.category.goldxp, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.2 | Gain 12 XP. |  |
| item | Hand of Baron (`DA_HandOfBaron18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Your team gains Baron Buff, increasing their stats. |  |
| item | Healing Pool (`DA_18_HealingPool`) | charm.category.misc, charm.playerhealing, charm.round.early, charm.round.earlymid, charm.tier.2 | Heal 5 Player Health. |  |
| item | Health Potion (`DA_HealthPotion18`) | temporary, potion.normal | When the holder drops below 50% health, heal for 750 Health over 3 seconds.<br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Heated Rivalry (`DA_18_HeatedRivalry`) | charm.category.champion, charm.round.early, charm.tier.1 | Gain a Rengar or a Kha'Zix. They gain 3 takedowns. |  |
| item | Hero of Prophecy (`DA_HeroOfProphecy18`) | charm.category.champion, charm.doesnotcounttowardslimit, charm.lockout.oncepergame, charm.round.verylate, charm.tier.3 | Gain a 5-cost champion. Gain them again each round FOREVER. |  |
| item | Hero's Entrance (`DA_HerosEntrance18`) | charm.category.combat, charm.round.verylate, charm.tier.3 | After 8 seconds, the leftmost benched champion joins combat and gains 2 recommended items. |  |
| item | Heroic Sacrifice (`DA_18_HeroicSacrifice`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.3 | Your 3 strongest Champions gain HEROIC POWER, but other allies are sacrificed. |  |
| item | Hireling (`DA_Hireling18`) | charm.category.combat, charm.round.verylate, charm.tier.3 | A temporary 1-star 5-cost with 1 recommended items joins your team. |  |
| item | Homing Fireflies (`DA_HomingFireflies18`) | charm.category.combat, charm.round.late, charm.round.mid, charm.round.midlate, charm.round.verylate, charm.tier.2 | Your Casters spawn a firefly per 20 Mana spent. Each deals 110 magic damage. |  |
| item | Hugify (`DA_Hugify18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.tier.1 | Your highest Health unit grows, gaining 350 Health. |  |
| item | Hummingbird (`DA_18_Hummingbird`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.tier.1 | Your highest Attack Speed unit shrinks, gaining 20% Attack Speed. |  |
| item | Idle Craftsman (`DA_IdleCraftsman18`) | charm.category.item, charm.round.earlymid, charm.round.mid, charm.tier.2 | A component on your bench turns into a completed item it builds. |  |
| item | Improved Reach (`DA_ImprovedReach18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Your Fighters gain 1 range. |  |
| item | Infliction (`DA_18_Infliction`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Slow, Burn, Shred, and Sunder enemies for 8 seconds. |  |
| item | Iron Core (`DA_IronCore18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Your front center champion gains 6% Max Health per front-row unit. |  |
| item | Ironwood (`DA_Ironwood18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Enemies attacking your highest health champion deal 14% less damage. |  |
| item | Killer's Regret (`DA_KillersRegret18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Your first 3 champions to die stun their killer for 1.5 seconds. |  |
| item | Killing Frenzy (`DA_18_KillingFrenzy`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Fighters execute targets under 12% Health. They gain 30% Attack Speed on kill. |  |
| item | Knick-Knack Bag (`DA_KnickKnackBag18`) | charm.category.misc, charm.round.earlymid, charm.round.mid, charm.tier.1 | Gain 2 consumables that give permanent Attack Damage or Attack Speed. |  |
| item | Knick-Knack Jar (`DA_KnickKnackJar18`) | charm.category.misc, charm.round.early, charm.tier.1 | Gain 1 consumable that gives permanent Attack Damage or Attack Speed. |  |
| item | Knick-Knack Sack (`DA_KnickKnackSack18`) | charm.category.misc, charm.round.late, charm.round.verylate, charm.tier.2 | Gain 3 consumables that give permanent Attack Damage or Attack Speed. |  |
| item | Late Bloomer (`DA_LateBloomer18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.3 | A temporary 3-star 1-cost joins your team. |  |
| item | Lesser Chaos (`DA_LesserChaos18_Upgrade`) | charm.category.misc, charm.round.early, charm.round.earlymid, charm.tier.1 | Cast a random Wisp <Set18CharmUpgrade>worth 1<Set18CharmUpgrade> or more gold. |  |
| item | Life Debt (`DA_18_LifeDebt`) | charm.category.goldxp, charm.round.late, charm.round.verylate, charm.tier.2 | Gain 1 gold for every 12 missing Player Health. |  |
| item | Lightning Storm (`DA_18_LightningStorm`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Every 1 second deal 5% Max Health true damage to an enemy. |  |
| item | Lightning Strike (`DA_18_LightningStrike`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | Deal 10% Max Health true damage to all enemies. |  |
| item | Living Soil (`DA_LivingSoil18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Every 4 seconds, roots stun an enemy for 1 second. |  |
| item | Lost Travelers (`DA_18_LostTravelers_Upgrade`) | charm.category.champion, charm.round.early, charm.tier.1 | Gain <Set18CharmUpgrade>4 gold worth of random champions. |  |
| item | Lucky 7 (`DA_Lucky718`) | charm.category.shop, charm.round.verylate, charm.tier.2 | Gain 7 shop rerolls. |  |
| item | Major Gambit (`DA_18_MajorGambit`) | charm.category.risky, charm.round.late, charm.round.midlate, charm.tier.2.rabbit | If you win the next player combat, gain 8 Gold. |  |
| item | Major Polymorph (`DA_18_MajorPolymorph`) | charm.category.risky, charm.round.late, charm.round.midlate, charm.tier.2 | A random 4-cost you own permanently transforms into a 5-cost. |  |
| item | Mana Potion (`DA_ManaPotion18`) | temporary, potion.normal | The holder gains 10 Mana. On cast, restore 70 Mana over 5 seconds.<br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Mana-Rich Soil (`DA_ManaRichSoil18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Your Casters have 18% reduced Max Mana. |  |
| item | Marksmen's Gale (`DA_MarksmensGale18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Your Marksmen's attacks grant 3% stacking Attack Speed. |  |
| item | Marksmen's Marks (`DA_MarksmensMarks18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Your Marksmen have a 30% chance to double attack. |  |
| item | Mercenary Force (`DA_18_MercenaryForce`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Gain 3% Damage Amp for every 10 gold you have. |  |
| item | Middle Path (`DA_MiddlePath18`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.mid, charm.round.midlate, charm.tier.2 | Reroll your shop with all 2-star 3-cost champions. |  |
| item | Minor Blood Ritual (`DA_18_MinorBloodRitual`) | charm.category.misc, charm.round.early, charm.round.earlymid, charm.tier.2 | Lose 3 Player Health. Gain a Lesser Champion Duplicator. |  |
| item | Minor Gambit (`DA_18_MinorGambit`) | charm.category.risky, charm.round.early, charm.tier.1.rabbit | If you win the next player combat, gain 2 Gold. |  |
| item | Minor Polymorph (`DA_18_MinorPolymorph`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.tier.1 | A random 1-cost you own permanently transforms into a 2-cost. |  |
| item | Moonlight Ritual (`DA_MoonlightRitual18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.2 | Your lowest star 1-cost or 2-cost champion stars up in combat. |  |
| item | Moonrise (`DA_18_Moonrise`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | After 8 seconds, increase Lunar's effects by 100%. |  |
| item | Nature's Ally (`DA_NaturesAlly18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Every 3 ally deaths, summon a random Riftbeast. |  |
| item | Nature's Wrath (`DA_NaturesWrath18`) | charm.category.combat, charm.round.verylate, charm.tier.3 | Kill EVERYONE without an item after 10 seconds. |  |
| item | Payday (`DA_18_Payday`) | charm.category.risky, charm.round.mid, charm.round.midlate, charm.tier.2.rabbit | For each ally champion that survives combat, gain 2 Gold. |  |
| item | Peddler (`DA_Peddler18`) | charm.category.item, charm.round.late, charm.round.midlate, charm.tier.2 | Open a random item store. Random items cost 0 to 14 gold. |  |
| item | Petrified Dummy (`DA_PetrifiedDummy18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1 | Your first champion to die turns into a 900 Health dummy with their defenses. |  |
| item | Petrify Shields (`DA_PetrifyShields18`) | charm.category.combat, charm.round.midlate, charm.round.verylate, charm.tier.1 | 10% Slow enemies and reduce their shields by 20% for 10 seconds. |  |
| item | Phantom Armor (`DA_PhantomArmor18_Prismatic`) | charm.category.combat, charm.tier.3 | Gain <Set18CharmUpgrade>6 temporary <Set18CharmUpgrade>Radiant Warmog's Armors <Set18CharmUpgrade>and 5 Removers. |  |
| item | Phantom Gloves (`DA_PhantomGloves18_Upgrade`) | charm.category.combat, charm.round.earlymid, charm.round.late, charm.round.mid, charm.round.midlate, charm.tier.2 | Gain a temporary <Set18CharmUpgrade>Mittens. |  |
| item | Phantom Splash (`DA_PhantomSplash18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Combat start: Up to 2 inactive traits activate at the lowest level. |  |
| item | Phantom Vest (`DA_PhantomVest18_Upgrade`) | charm.category.combat, charm.round.earlymid, charm.round.late, charm.round.mid, charm.round.midlate, charm.tier.2 | Gain a temporary <Set18CharmUpgrade>Aegis of Dawn. |  |
| item | Plated Shields (`DA_PlatedShields18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Shields are 15% stronger. Allies gain 150 shield for 10 seconds. |  |
| item | Pocket Change (`DA_18_PocketChange`) | charm.category.goldxp, charm.round.earlymid, charm.round.mid, charm.tier.1 | Your one-star champions drop 1 gold on death. |  |
| item | Polymorph (`DA_18_Polymorph`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.round.mid, charm.tier.1 | A random 2-cost you own permanently transforms into a 3-cost. |  |
| item | Potioncraft (`DA_Potioncraft18`) | charm.category.misc, charm.round.late, charm.round.verylate, charm.tier.2 | Gain three temporary equippable Potions. |  |
| item | Preppers (`DA_18_Preppers`) | charm.category.combat, charm.round.earlymid, charm.round.late, charm.round.mid, charm.round.midlate, charm.tier.2 | Your stacking items start next combat partially stacked. |  |
| item | Prolific Power (`DA_18_ProlificPower`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.1 | Your champions gain 4% Attack Damage and Ability Power. |  |
| item | Propagate (`DA_18_Propagate`) | charm.category.champion, charm.round.early, charm.round.earlymid, charm.round.mid, charm.tier.2.rabbit | Gain a copy of the first allied champion to die. |  |
| item | Quicken (`DA_Quicken18`) | charm.category.combat, charm.round.mid, charm.round.midlate, charm.tier.1 | On cast, your champions gain 30% Attack Speed for 4 seconds. |  |
| item | Rain (`DA_Rain18`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1 | Your team gains 1 Mana Regen. |  |
| item | Refreshing Light (`DA_RefreshingLight18`) | charm.category.shop, charm.round.mid, charm.round.midlate, charm.tier.2 | Gain a free reroll per star level of each unique Solar champion. |  |
| item | Regeneration (`DA_Regeneration18`) | charm.category.combat, charm.round.mid, charm.round.midlate, charm.tier.2 | Your team heals 1% max Health per second. |  |
| item | Resistant (`DA_18_Resistant`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.1 | Tanks reduce instances of incoming damage by 10. |  |
| item | Returning Friend (`DA_FoundBigFriend18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | Gain a temporary Training Dummy with two Giant's Belts. |  |
| item | Revenge (`DA_Revenge18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Whenever an ally dies, your champions gain 4% stacking Damage Amp. |  |
| item | Ride the Wave (`DA_RideTheWave18`) | charm.category.shop, charm.round.late, charm.round.midlate, charm.tier.3 | The next 2 rerolls this round will have 2+ champions fielded last combat. |  |
| item | Rolling Bones (`DA_RollingBones18`) | charm.category.shop, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.2 | You have a 50% chance to get a free reroll with each kill. |  |
| item | Roly-Polys (`DA_RolyPolys18`) | charm.category.shop, charm.round.earlymid, charm.round.mid, charm.tier.2 | For each ally champion alive after 18 seconds, gain a reroll. |  |
| item | Room for a Shroom (`DA_RoomForAShroom`) | charm.category.goldxp, charm.round.late, charm.round.midlate, charm.tier.1 | Gain 2 random mushrooms. |  |
| item | Salvager (`DA_Salvager18`) | charm.category.misc, charm.round.late, charm.round.midlate, charm.tier.1 | Any units you bench have items removed and broken apart. |  |
| item | Scrappy (`DA_Scrappy18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Combat start: 2 champions without items gain a temporary recommended item. |  |
| item | Search Party (`DA_SearchParty18`) | charm.category.shop, charm.round.mid, charm.round.midlate, charm.tier.1 | Each of your shops has a 4-cost in it this round until you buy one. |  |
| item | Sinister Deal (`DA_18_SinisterDeal`) | charm.category.misc, charm.round.early, charm.round.earlymid, charm.tier.2 | Lose 4 Player Health. Gain 2 Gold. |  |
| item | Slow Study (`DA_SlowStudy18`) | charm.category.goldxp, charm.round.mid, charm.round.midlate, charm.tier.2 | For each ally champion alive after 15 seconds, gain 2 XP. |  |
| item | Solitude's Cloak (`DA_SolitudesCloak18`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.2 | Champions with no adjacent allies gain 10% Max Health and 10% Damage Amp. |  |
| item | Stand Alone (`DA_StandAlone18`) | charm.category.combat, charm.round.late, charm.round.mid, charm.round.midlate, charm.round.verylate, charm.tier.2 | Champions alone in their row gain 15% Health and 15% Damage Amp. |  |
| item | Starfall (`DA_18_Starfall`) | charm.category.shop, charm.round.earlymid, charm.round.mid, charm.tier.1, charm.tier.2 | The first 6 times you reroll your shop this round, the lowest cost champion becomes 2-star. |  |
| item | Starting Town (`DA_StartingTown18`) | charm.category.shop, charm.norollshopafterpurchase, charm.round.early, charm.round.earlymid, charm.tier.3 | Reroll your shop with all 2-star 1-cost champions. |  |
| item | Stealthy (`DA_Stealthy18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.1 | Your 3 strongest Fighters or Assassins are untargetable for 8 seconds. |  |
| item | Sunfire Sorcery (`DA_18_SunfireSorcery`) | charm.category.combat, charm.round.mid, charm.round.midlate, charm.tier.1 | Burn and Wound enemies for 10 seconds. |  |
| item | Supercritical (`DA_18_Supercritical`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.2 | Allies with Precision gain 25% Critical Strike Damage. |  |
| item | Take One With Ya (`DA_TakeOneWithYa18`) | charm.category.risky, charm.round.early, charm.tier.1.rabbit | If you lose and kill at least one enemy, gain 4 XP. |  |
| item | Tattered Armor (`DA_18_TatteredArmor`) | charm.category.combat, charm.round.mid, charm.round.midlate, charm.tier.1 | 30% Shred and Sunder enemies for 10 seconds. |  |
| item | Terraforming (`DA_Terraforming18`) | charm.category.misc, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.1 | Gain 7 seeds at start of combat. |  |
| item | Thingamajig Bag (`DA_ThingamajigBag18`) | charm.category.misc, charm.round.earlymid, charm.round.mid, charm.tier.1 | Gain 2 consumables that give permanent Ability Power or Mana Regen. |  |
| item | Thingamajig Jar (`DA_ThingamajigJar18`) | charm.category.misc, charm.round.early, charm.tier.1 | Gain 1 consumable that gives permanent Ability Power or Mana Regen. |  |
| item | Thingamajig Sack (`DA_ThingamajigSack18`) | charm.category.misc, charm.round.late, charm.round.verylate, charm.tier.2 | Gain 3 consumables that give permanent Ability Power or Mana Regen. |  |
| item | Training Yard (`DA_TrainingYard18`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Gain 2 Training Dummies each with a random tank item. |  |
| item | Treetop Archers (`DA_TreetopArchers`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Archers fire from the trees, dealing 500 physical damage every 3 seconds. |  |
| item | Tremors (`DA_18_Tremors`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | Every 8 seconds, Stun enemies for 1 second. |  |
| item | Trophy Hunter (`DA_TrophyHunter18`) | charm.category.risky, charm.round.early, charm.round.earlymid, charm.round.mid, charm.round.midlate, charm.tier.1 | Next player combat, your Rivals' takedowns count twice. |  |
| item | Truce (`DA_Truce18`) | charm.category.goldxp, charm.round.early, charm.tier.1 | Gain 1 gold. Your opponent gains 1 gold. |  |
| item | Ultra Ascension (`DA_18_UltraAscension`) | charm.category.combat, charm.round.earlymid, charm.round.mid, charm.tier.1 | After 25 seconds, allies gain 300% Damage Amp. |  |
| item | Verdant Vitality (`DA_18_VerdantVitality`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.round.verylate, charm.tier.1 | Your champions gain 50 Health. |  |
| item | Wrapped In Thorns (`DA_WrappedInThorns18`) | charm.category.combat, charm.round.late, charm.round.mid, charm.round.midlate, charm.round.verylate, charm.tier.1 | Your Tanks reflect 12% of damage taken to adjacent enemies every 4 seconds. |  |
| item | Yordle Spirit (`DA_18_YordleSpirit`) | charm.category.combat, charm.round.late, charm.round.midlate, charm.tier.2 | Allies have a 99% chance to dodge attacks for 4 seconds. |  |
| item | Radiant Adaptive Helm (`DA_AdaptiveHelm_Radiant`) | magic, tank, radiant, provides.resource.mana | Gain an additional 30% Mana from all sources. The wearer gains an additional bonus based on their Role:<br><br>Tanks and Fighters: Gain 80 Armor and Magic Resistance.<br><br>Other Roles: Gain 40% Attack Damage and Ability Power. |  |
| item | Radiant Archangel's Staff (`DA_ArchangelsStaffRadiant`) | magic, radiant, stacking, provides.resource.mana | Combat start: Gain 40<colorRadiant>% Ability Power every 5 seconds in combat. |  |
| item | Radiant Blast Potion (`DA_BlastPotion18_Radiant`) | temporary, potion.radiant | After 8 seconds of combat, knock up enemies within 4 hexes for 2 seconds.<br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Radiant Bloodthirster (`DA_BloodthirsterRadiant`) | attack, radiant | Once per combat at 50% Health, gain a 60% max Health Shield that lasts up to 5 seconds. |  |
| item | Radiant Blue Buff (`DA_BlueBuffRadiant`) | magic, radiant, provides.resource.mana | Gain 20% additional Attack Damage and Ability Power from all sources. |  |
| item | Radiant Bramble Vest (`DA_BrambleVestRadiant`) | tank, radiant | Gain 12% max Health.<br><br>Take 10% reduced damage from attacks. When struck by any attack, deal 200 magic damage to all adjacent enemies.<br><br>Cooldown: 2 seconds |  |
| item | Radiant Crownguard (`DA_CrownguardRadiant`) | tank, radiant | Combat start: Gain a 50<colorRadiant>% max Health Shield for 8 seconds.<br>When the shield expires, gain 50<colorRadiant>% Ability Power. |  |
| item | Radiant Deathblade (`DA_DeathbladeRadiant`) | attack, radiant | It glows in the presence of enemies. Or friends. Or anything alive, really. |  |
| item | Radiant Dragon's Claw (`DA_DragonsClawRadiant`) | tank, radiant | Gain 28% max Health.<br><br>Every 2 seconds, heal 5% max Health. |  |
| item | Radiant Edge of Night (`DA_EdgeOfNightRadiant`) | attack, radiant | At 40% Health, briefly become untargetable, shed negative effects, and <colorRadiant>heal all missing health. |  |
| item | Radiant Evenshroud (`DA_EvenshroudRadiant`) | tank, radiant | 30% Sunder enemies within 3 hexes. Gain 50 <colorRadiant>Armor and Magic Resist for the first 20 <colorRadiant>seconds of combat.<br><br>Sunder: Reduce Armor |  |
| item | Radiant Gargoyle Stoneplate (`DA_GargoyleStoneplate_Radiant`) | tank, radiant | Gain 20 Armor and 20 Magic Resist for each enemy targeting the holder. |  |
| item | Radiant Giant Slayer (`DA_GiantSlayer_Radiant`) | attack, magic, radiant | Gain 30% additional Damage Amp against Tanks. |  |
| item | Radiant Guinsoo's Rageblade (`DA_GuinsoosRagebladeRadiant`) | attack, radiant, stacking | Gain 16<colorRadiant>% stacking Attack Speed every second. |  |
| item | Radiant Hand of Justice (`DA_HandOfJusticeRadiant`) | attack, magic, radiant, provides.resource.mana | Gain 2 effects:<br>• 35% Attack Damage and 35% Ability Power.<br>• 30% Omnivamp.<br><br>While above 50% health, double the Attack Damage and Ability Power. While below 50% Health, double the Omnivamp. |  |
| item | Radiant Health Potion (`DA_HealthPotion18_Radiant`) | temporary, potion.radiant | When the holder drops below 50% health, heal for 850 Health and heal allies for 150 Health over 3 seconds. <br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Radiant Hextech Gunblade (`DA_HextechGunbladeRadiant`) | magic, radiant | Heal the lowest percent Health ally for 40% of damage dealt. |  |
| item | Radiant Infinity Edge (`DA_InfinityEdgeRadiant`) | attack, radiant | Gain Precision. <br><br>Precision: Ability damage can critically strike. Extra Precision grants 10% Critical Strike Damage. |  |
| item | Radiant Ionic Spark (`DA_IonicSparkRadiant`) | tank, radiant | 30% Shred enemies within 2 hexes. When enemies cast an Ability, deal magic damage equal to 300% of the Mana spent.<br><br>Shred: Reduce Magic Resist |  |
| item | Radiant Jeweled Gauntlet (`DA_JeweledGauntletRadiant`) | magic, radiant | Gain Precision. <br><br>Precision: Ability damage can critically strike. Extra Precision grants 10% Critical Strike Damage. |  |
| item | Radiant Kraken's Fury (`DA_KrakensFury_Radiant`) | attack, radiant, stacking | Attacks grant 7<colorRadiant>% stacking Attack Damage, up to 15 attacks. After 15 attacks, gain 30% Attack Speed. |  |
| item | Radiant Last Whisper (`DA_LastWhisperRadiant`) | attack, radiant | Attacks and Ability damage 30% Sunders the target for the <colorRadiant>rest of combat. This effect does not stack.<br><br>Sunder: Reduce Armor |  |
| item | Radiant Mana Potion (`DA_ManaPotion18_Radiant`) | temporary, potion.radiant | The holder gains 10 Mana. On cast, restore 80 Mana to the holder and 10 Mana to allies over 5 seconds.<br><br>[Single Use - This item is destroyed after activating in combat.] |  |
| item | Radiant Morellonomicon (`DA_MorellonomiconRadiant`) | magic, radiant | Attacks and Abilities deal 2<colorRadiant>% Burn and 33% Wound to enemies for 10 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Radiant Nashor's Tooth (`DA_NashorsToothRadiant`) | magic, radiant | Attacks grant 4 bonus Mana, increased to 6 if they critically strike. |  |
| item | Radiant Protector's Vow (`DA_ProtectorsVowRadiant`) | tank, radiant, provides.resource.mana | Combat Start: Gain 40 Mana.<br><br>At 40% Health, gain 30 <colorRadiant>Mana and a Shield equal to 50% <colorRadiant>max Health |  |
| item | Radiant Quicksilver (`DA_QuicksilverRadiant`) | attack, radiant | Combat Start: Unstoppable for 45 seconds. <br><br>Gain 6% stacking Attack Speed every second. |  |
| item | Radiant Rabadon's Deathcap (`DA_RabadonsDeathcap_Radiant`) | magic, radiant | It's witnessed - and unleashed - miracles and calamities both. |  |
| item | Radiant Red Buff (`DA_RedBuffRadiant`) | attack, radiant | Attacks and Abilities 2<colorRadiant>% Burn and 33% Wound enemies for 5 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Radiant Spear of Shojin (`DA_SpearOfShojinRadiant`) | attack, magic, radiant, provides.resource.mana | Attacks grant 10 <colorRadiant>bonus Mana. |  |
| item | Radiant Spirit Visage (`DA_SpiritVisage_Radiant`) | tank, radiant, spiritvisage, provides.resource.mana | Regenerate 4<colorRadiant>% of missing Health each second. |  |
| item | Radiant Steadfast Heart (`DA_SteadfastHeartRadiant`) | tank, radiant, steadfastheart | Gain 10% Durability. While above 50% Health, instead gain 30% Durability. |  |
| item | Radiant Sterak's Gage (`DA_SteraksGageRadiant`) | attack, radiant | At 60% Health, gain a Shield equal to 80% of the wearer's maximum Health that rapidly decays over 6 seconds. |  |
| item | Radiant Striker's Flail (`DA_StrikersFlailRadiant`) | attack, magic, radiant | Critical Strikes grant 10% Damage Amp for 5 seconds, stacking up to 4 times. |  |
| item | Radiant Sunfire Cape (`DA_SunfireCape_Radiant`) | tank, radiant | Gain 16% max Health.<br><br>Every 2 seconds, deal 2<colorRadiant>% Burn and 33% Wound to an enemy within 2 hexes for 10 seconds.<br><br>Burn: Deals a percent of the target’s max Health as true damage every second.<br>Wound: Reduces healing received. |  |
| item | Radiant Thief's Gloves (`DA_ThiefsGlovesRadiant`) | radiant, thiefsgloves | Each round: Equip 2 random <colorRadiant>Radiant items<br><br>[Consumes 3 item slots.] |  |
| item | Radiant Titan's Resolve (`DA_TitansResolve_Radiant`) | attack, radiant, stacking | Gain 4% Attack Damage and 4% Ability Power when attacking or taking damage, stacking up to 25 times.<br><br>At full stacks, gain 20% Damage Amp and unstoppable. |  |
| item | Radiant Void Staff (`DA_VoidStaffRadiant`) | magic, radiant, provides.resource.mana | Attacks and Ability damage 30% Shred the target for the <colorRadiant>rest of combat. This effect does not stack.<br><br>Shred: Reduce Magic Resist |  |
| item | Radiant Warmog's Armor (`DA_WarmogsArmorRadiant`) | tank, radiant | Gain 36% max Health. |  |
| item | Radiantize (`DA_18_Radiantize`) | charm.category.combat, charm.round.late, charm.round.verylate, charm.tier.3 | After 8 seconds, 1 random equipped item temporarily becomes Radiant. |  |

## Wisps and consumables

All 152 published Wisp-card rows are included. Exact icon associations are shown where source icon paths match; unresolved rows remain explicit.

| Wisp | Price | Effect | Blossom effect | Item association |
|---|---:|---|---|---|
| Abandon Ship | 0 | Sell your board and bench, gain 6 gold and 8 rerolls. | Sell your board and bench, gain 10 gold and 10 rerolls. | DA_AbandonShip18 |
| Bark Armor | 0 | Your champions gain 150 shield for 10 seconds. | Your champions gain 225 shield for 10 seconds. | DA_18_BarkArmor |
| Beggar's Wisp | 0 | The wilds couldn't find a wisp for you this roll. Gain 3 gold. | The wilds couldn't find a wisp for you this roll. Gain 5 gold. | DA_BeggarsWisp18 |
| Coin Flip | 0 | Flip a coin, gain 1 gold if it's heads. | Flip 2 coins, gain 1 gold if it's heads. | DA_CoinFlip18 |
| Curio Cart | 0 | Open an item store. Items cost 0 to 15 gold. | Open an item store. Items cost 0 to 15 gold. Gain 1 Gold. | DA_CurioCart18 |
| Drizzle | 0 | After 8 seconds of combat, your team gains 10 Mana. | After 8 seconds of combat, your team gains 15 Mana. | DA_18_Drizzle |
| Early Fix | 0 | Gain 1 Item Reforger. | Gain 2 Item Reforgers. | DA_18_EarlyFix |
| Found Friend | 0 | Gain a temporary Training Dummy with a Giant's Belt. | Gain a Training Dummy with a Sunfire Cape. | DA_FoundFriend18 |
| Grove Armor | 0 | Your highest Health champion gains 15 Armor and 15 Magic Resist. | Your highest Health champion gains 25 Armor and 25 Magic Resist. | DA_18_GroveArmor |
| Life Debt | 0 | Gain 1 gold for every 12 missing Player Health. | Gain 1 gold for every 12 missing Player Health. Then heal 3 Health. | DA_18_LifeDebt |
| Major Polymorph | 0 | A random 4-cost you own permanently transforms into a 5-cost. | The highest star level 4-cost you own permanently transforms into a 5-cost. | DA_18_MajorPolymorph |
| Minor Polymorph | 0 | A random 1-cost you own permanently transforms into a 2-cost. | The highest star level 1-cost you own permanently transforms into a 2-cost. | DA_18_MinorPolymorph |
| Peddler | 0 | Open a random item store. Random items cost 0 to 14 gold. | Open a random item store. Random items cost 0 to 14 gold. Gain 2 Gold. | DA_Peddler18 |
| Polymorph | 0 | A random 2-cost you own permanently transforms into a 3-cost. | The highest star level 2-cost you own permanently transforms into a 3-cost. | DA_18_Polymorph |
| Prolific Power | 0 | Your champions gain 4% Attack Damage and Ability Power. | Your champions gain 6% Attack Damage and Ability Power. | DA_18_ProlificPower |
| Returning Friend | 0 | Gain a temporary Training Dummy with two Giant's Belts. | Gain a Training Dummy with Three Giant's Belts. | DA_FoundBigFriend18 |
| Room for a Shroom | 0 | Gain 2 random mushrooms. | Gain 3 random mushrooms. | DA_RoomForAShroom |
| Salvager | 0 | Any units you bench have items removed and broken apart. | Any units you bench have items removed and broken apart. Gain 2 Gold. | DA_Salvager18 |
| Sinister Deal | 0 | Lose 4 Player Health. Gain 2 Gold. | Lose 2 Player Health. Gain 2 Gold. | DA_18_SinisterDeal |
| Stealthy | 0 | Your 3 strongest Fighters or Assassins are untargetable for 8 seconds. | 3 random champions on the back row are untargetable for 12 seconds. | DA_Stealthy18 |
| Truce | 0 | Gain 1 gold. Your opponent gains 1 gold. | Gain 2 gold. Your opponent gains 1 gold. | DA_Truce18 |
| Verdant Vitality | 0 | Your champions gain 50 Health. | Your champions gain 75 Health. | DA_18_VerdantVitality |
| Backrow Star | 1 | A random back row champion gains 100% Attack Speed for 7 seconds. | A random back row champion gains 130% Attack Speed for 8 seconds. | DA_18_BackrowStar |
| Big Boom | 1 | The first ally to die explodes, dealing 25% Max Health magic damage. | The first 2 allies to die explode, dealing 25% Max Health magic damage. | DA_BigBoom18 |
| Blast Potion | 1 | Gain a temporary equippable Blast Potion. | Gain a temporary equippable Radiant Blast Potion. | unresolved: /assets/set18/items/da_blastpotion18_charm.png |
| Borrowed Gear | 1 | At the start of combat, a champion gains a temporary recommended item. | At the start of combat, a champion gains a temporary recommended item and 250 Health. | DA_BorrowedGear18 |
| Bunch-o'-Belts | 1 | Your allies gain 7 temporary, non-removable Giant's Belts. | Your allies gain 10 temporary, non-removable Giant's Belts. | DA_BunchOBelts18 |
| Essence Theft | 1 | Gain 50% bonus Coven Essence this combat. | Gain 90% bonus Coven Essence this combat. | DA_EssenceTheft18 |
| Fertilize | 1 | Gain 1 XP for each enemy that dies. | Gain 1 XP for each enemy that dies. Gain 2 XP. | DA_18_Fertilize |
| Flash Fire | 1 | Reroll your shop. Inferno lights 2 shop slots on fire, upgrading them. | Reroll your shop. Inferno lights 3 shop slots on fire, upgrading them. | DA_FlashFire18 |
| Flip Frenzy | 1 | Flip a coin, gain 1 gold if it's heads. Continue until you flip tails. | Flip a coin, gain 1 gold if it's heads. Continue until you flip tails. | DA_FlipFrenzy18 |
| Forest Mage | 1 | Fill your shop with Wisps. You can only buy one. | Fill your shop with upgraded Wisps. You can only buy one. | DA_18_ForestMage |
| Golden Goose | 1 | Gain 1 gold for every 1700 damage your highest damage champion deals. | Gain 1 gold for every 1000 damage your highest damage champion deals. | DA_GoldenGoose18 |
| Health Potion | 1 | Gain a tempoary equippable Health Potion. | Gain a temporary equippable Radiant Health Potion. | unresolved: /assets/set18/items/da_healthpotion18_charm.png |
| Hugify | 1 | Your highest Health unit grows, gaining 350 Health. | Your highest Health unit grows, gaining 500 Health. | DA_Hugify18 |
| Hummingbird | 1 | Your highest Attack Speed unit shrinks, gaining 20% Attack Speed. | Your highest Attack Speed unit shrinks, gaining 35% Attack Speed. | DA_18_Hummingbird |
| Improved Reach | 1 | Your Fighters gain 1 range. | Your Fighters gain 2 range. | DA_ImprovedReach18 |
| Iron Core | 1 | Your front center champion gains 6% Max Health per front-row unit. | Your front center champion gains 8% Max Health per front-row unit. | DA_IronCore18 |
| Killer's Regret | 1 | Your first 3 champions to die stun their killer for 1.5 seconds. | Your first 4 champions to die stun their killer for 1.75 second. | DA_KillersRegret18 |
| Lightning Strike | 1 | Deal 10% Max Health true damage to all enemies. | Deal 18% Max Health true damage to all enemies. | DA_18_LightningStrike |
| Mana Potion | 1 | Gain a temporary equippable Mana Potion. | Gain a temporary equippable Radiant Mana Potion. | unresolved: /assets/set18/items/da_manapotion18_charm.png |
| Minor Gambit | 1 | If you win the next player combat, gain 2 Gold. | If you win the next player combat, gain 3 Gold. | DA_18_MinorGambit |
| Nature's Wrath | 1 | Kill EVERYONE without an item after 10 seconds. | Kill EVERYONE without an item after 8 seconds. | DA_NaturesWrath18 |
| Petrify Shields | 1 | 10% Slow enemies and reduce their shields by 20% for 10 seconds. | 10% Slow enemies and reduce their shields by 30% for 10 seconds. | DA_PetrifyShields18 |
| Pocket Change | 1 | Your one-star champions drop 1 gold on death. | Your one-star champions drop 1 gold on death. Gain 1 gold. | DA_18_PocketChange |
| Rain | 1 | Your team gains 1 Mana Regen. | Your team gains 2 Mana Regen. | DA_Rain18 |
| Starfall | 1 | The first 6 times you reroll your shop this round, the lowest cost champion becomes 2-star. | The first 8 times you reroll your shop this round, the lowest cost champion becomes 2-star. | DA_18_Starfall |
| Take One With Ya | 1 | If you lose and kill at least one enemy, gain 4 XP. | If you lose and kill at least one enemy, gain 6 XP. | DA_TakeOneWithYa18 |
| Tattered Armor | 1 | 30% Shred and Sunder enemies for 10 seconds. | 30% Shred and Sunder enemies for 15 seconds. | DA_18_TatteredArmor |
| Ultra Ascension | 1 | After 25 seconds, allies gain 300% Damage Amp. | After 23 seconds, allies gain 300% Damage Amp. | DA_18_UltraAscension |
| Aftershock | 2 | After 8 seconds, stun all enemies for 1.5 seconds. | After 8 and 18 seconds, stun all enemies for 1.5 seconds. | DA_18_AfterShock |
| Artifactinate | 2 | Lose 3 components, including ones built into items. Gain an Artifact anvil. | Lose 3 components, including ones built into items. Gain an Artifact anvil and 1 Reforger. | DA_Artifactinate18 |
| Barter | 2 | The next champion sold this round sells for 200% gold. | The next champion sold this round sells for 250% gold. | DA_Barter18 |
| Blood Money | 2 | Gain 1 gold for every champion you kill. | Gain 1 gold for every champion you kill. Gain 1 gold. | DA_18_BloodMoney |
| Counterspell | 2 | Increase all enemies' Max Mana by 15 until their next cast. | Increase all enemies' Max Mana by 22 until their next cast. | DA_18_Counterspell |
| Cutpurse | 2 | Every 5 seconds, your champions have a 20% chance to drop 1 Gold. | Every 4 seconds, your champions have a 20% chance to drop 1 Gold. | DA_Cutpurse18 |
| Die Roll | 2 | Roll a six-sided die. Gain gold equal to the result. | Roll two six-sided dice. Gain gold equal to the result. | DA_DieRoll18 |
| Downpour | 2 | Your team gains 2 Mana Regen. | Your team gains 3 Mana Regen. | DA_Downpour18 |
| Freeroller | 2 | Gain 2 rerolls. | Gain 3 rerolls. | DA_18_Freeroller |
| Golden Road | 2 | After 3 player combats, gain 2 Gold per fight won. | After 3 player combats, gain 2 Gold per fight won plus 1 Gold. | DA_GoldenRoad18 |
| Healing Pool | 2 | Heal 5 Player Health. | Heal 7 Player Health. | DA_18_HealingPool |
| Hero's Entrance | 2 | After 8 seconds, the leftmost benched champion joins combat and gains 2 recommended items. | After 5 seconds, the leftmost benched champion joins combat and gains 2 recommended items. | DA_HerosEntrance18 |
| Homing Fireflies | 2 | Your Casters spawn a firefly per 20 Mana spent. Each deals 110 magic damage. | Your Casters spawn a firefly per 15 Mana spent. Each deals 110 magic damage. | DA_HomingFireflies18 |
| Ironwood | 2 | Enemies attacking your highest health champion deal 14% less damage. | Enemies attacking your highest health champion deal 20% less damage. | DA_Ironwood18 |
| Killing Frenzy | 2 | Fighters execute targets under 12% Health. They gain 30% Attack Speed on kill. | Fighters execute targets under 15% Health. They gain 60% Attack Speed on kill. | DA_18_KillingFrenzy |
| Mana-Rich Soil | 2 | Your Casters have 18% reduced Max Mana. | Your Casters have 25% reduced Max Mana. | DA_ManaRichSoil18 |
| Marksmen's Gale | 2 | Your Marksmen's attacks grant 3% stacking Attack Speed. | Your Marksmen's attacks grant 5% stacking Attack Speed. | DA_MarksmensGale18 |
| Moonlight Ritual | 2 | Your lowest star 1-cost or 2-cost champion stars up in combat. | Your two lowest star 1-cost or 2-cost champions star up in combat. | DA_MoonlightRitual18 |
| Nature's Ally | 2 | Every 3 ally deaths, summon a random Riftbeast. | Every 3 ally deaths, summon a random Riftbeast that's sometimes 2-star. | DA_NaturesAlly18 |
| Petrified Dummy | 2 | Your first champion to die turns into a 900 Health dummy with their defenses. | Your first champion to die turns into a 1350 Health dummy with their defenses. | DA_PetrifiedDummy18 |
| Phantom Armor | 2 | Gain 6 temporary Radiant Warmog's Armors and 5 Removers. | Gain a temporary The Indomitable. | DA_PhantomArmor18_Prismatic |
| Phantom Emblem | 2 | Gain a temporary emblem of your most active trait. | Gain a temporary emblem of your most active trait. | unresolved: /assets/set18/items/da_phantomemblem18.png |
| Phantom Splash | 2 | Combat start: Up to 2 inactive traits activate at the lowest level. | Combat Start: Up to 4 inactive traits activate at the lowest level. | DA_PhantomSplash18 |
| Plated Shields | 2 | Shields are 15% stronger. Allies gain 150 shield for 10 seconds. | Shields are 20% stronger. Allies gain 300 shield for 10 seconds. | DA_PlatedShields18 |
| Potioncraft | 2 | Gain three temporary equippable Potions. | Gain three temporary equippable Radiant Potions. | DA_Potioncraft18 |
| Propagate | 2 | Gain a copy of the first allied champion to die. | Gain a copy of the first allied champion to die. | DA_18_Propagate |
| Quicken | 2 | On cast, your champions gain 30% Attack Speed for 4 seconds. | On cast, your champions gain 40% Attack Speed for 5 seconds. | DA_Quicken18 |
| Regeneration | 2 | Your team heals 1% max Health per second. | Your team heals 2% max Health per second. | DA_Regeneration18 |
| Resistant | 2 | Tanks reduce instances of incoming damage by 10. | Tanks reduce instances of incoming damage by 18. | DA_18_Resistant |
| Revenge | 2 | Whenever an ally dies, your champions gain 4% stacking Damage Amp. | Whenever an ally dies, your champions gain 6% stacking Damage Amp. | DA_Revenge18 |
| Slow Study | 2 | For each ally champion alive after 15 seconds, gain 2 XP. | For each ally champion alive after 12 seconds, gain 2 XP. | DA_SlowStudy18 |
| Solitude's Cloak | 2 | Champions with no adjacent allies gain 10% Max Health and 10% Damage Amp. | Champions with no adjacent allies gain 15% Max Health and 15% Damage Amp. | DA_SolitudesCloak18 |
| Stand Alone | 2 | Champions alone in their row gain 15% Health and 15% Damage Amp. | Champions alone in their row gain 20% Health and 20% Damage Amp. | DA_StandAlone18 |
| Sunfire Sorcery | 2 | Burn and Wound enemies for 10 seconds. | Burn and Wound enemies for 15 seconds. | DA_18_SunfireSorcery |
| Supercritical | 2 | Allies with Precision gain 25% Critical Strike Damage. | Allies with Precision gain 40% Critical Strike Damage. | DA_18_Supercritical |
| Terraforming | 2 | Gain 7 seeds at start of combat. | Gain 10 seeds at start of combat. | DA_Terraforming18 |
| Trophy Hunter | 2 | Next player combat, your Rivals' takedowns count twice. | Next player combat, your Rivals' takedowns count twice. | DA_TrophyHunter18 |
| Wrapped In Thorns | 2 | Your Tanks reflect 12% of damage taken to adjacent enemies every 4 seconds. | Your Tanks reflect 18% of damage taken to adjacent enemies every 4 seconds. | DA_WrappedInThorns18 |
| Yordle Spirit | 2 | Allies have a 99% chance to dodge attacks for 4 seconds. | Allies have a 99% chance to dodge attacks for 5 seconds. | DA_18_YordleSpirit |
| Barrier | 3 | Allies gain 1250 Shield, decaying over 6 seconds. | Allies gain 1250 Shield, decaying over 9 seconds. | DA_Barrier18 |
| Blaze | 3 | Fire spreads across the board, dealing true damage to enemies. | Fire spreads across the board, dealing more true damage to enemies. | DA_Blaze18 |
| Blood and Iron | 3 | After 20 champion deaths, gain a component anvil. | After 16 champion deaths, gain a component anvil. | DA_BloodAndIron18 |
| Bulwark | 3 | Your Tanks gain a 20% Max Health shield upon falling below 50% Health. | Your Tanks gain a 30% Max Health shield upon falling below 50% Health. | DA_Bulwark18 |
| Combust | 3 | Your champions explode on death, dealing 12% Max Health magic damage. | Your champions explode on death, dealing 18% Max Health magic damage. | DA_Combust18 |
| Diversified | 3 | Your team gains 30 Health for each active non-unique trait. | Your team gains 45 Health for each active non-unique trait. | DA_Diversified18 |
| Fellowship | 3 | Champions gain 4% Max Health Shield and 4% Damage Amp per adjacent ally. | Champions gain 6% Max Health Shield and 6% Damage Amp per adjacent ally. | DA_18_Fellowship |
| Giant's Aura | 3 | Your highest Health ally deals 2% max Health damage per second in an area. | Your highest Health ally deals 3% max Health damage per second in an area. | DA_GiantsAura18 |
| Heated Rivalry | 3 | Gain a Rengar or a Kha'Zix. They gain 3 takedowns. | Gain a Rengar or a Kha'Zix. They gain 5 takedowns. | DA_18_HeatedRivalry |
| Lightning Storm | 3 | Every 1 second deal 5% Max Health true damage to an enemy. | Every 1 seconds deal 7% Max Health true damage to an enemy. | DA_18_LightningStorm |
| Major Gambit | 3 | If you win the next player combat, gain 8 Gold. | If you win next combat, gain 10 Gold. | DA_18_MajorGambit |
| Marksmen's Marks | 3 | Your Marksmen have a 30% chance to double attack. | Your Marksmen have a 45% chance to double attack. | DA_MarksmensMarks18 |
| Mercenary Force | 3 | Gain 3% Damage Amp for every 10 gold you have. | Gain 4% Damage Amp for every 10 gold you have. | DA_18_MercenaryForce |
| Minor Blood Ritual | 3 | Lose 3 Player Health. Gain a Lesser Champion Duplicator. | Lose 1 Player Health. Gain a Lesser Champion Duplicator. | DA_18_MinorBloodRitual |
| Payday | 3 | For each ally champion that survives combat, gain 2 Gold. | For each ally champion that survives combat, gain 3 Gold. | DA_18_Payday |
| Radiantize | 3 | After 8 seconds, 1 random equipped item temporarily becomes Radiant. | After 5 seconds, 1 random equipped item temporarily becomes Radiant. | DA_18_Radiantize |
| Ride the Wave | 3 | The next 2 rerolls this round will have 2+ champions fielded last combat. | The next 3 rerolls this round will have 2+ champions fielded last combat. | DA_RideTheWave18 |
| Rolling Bones | 3 | You have a 50% chance to get a free reroll with each kill. | 60% chance to get a reroll with each kill, and 1 more if you win. | DA_RollingBones18 |
| Roly-Polys | 3 | For each ally champion alive after 18 seconds, gain a reroll. | For each ally champion alive after 16 seconds, gain a reroll. | DA_RolyPolys18 |
| Scrappy | 3 | Combat start: 2 champions without items gain a temporary recommended item. | Combat Start: 3 champions without items gain a temporary recommended item. | DA_Scrappy18 |
| Search Party | 3 | Each of your shops has a 4-cost in it this round until you buy one. | Each of your shops has a 4-cost in it this round until you buy one. | DA_SearchParty18 |
| Training Yard | 3 | Gain 2 Training Dummies each with a random tank item. | Gain 3 Training Dummies each with a random tank item. | DA_TrainingYard18 |
| Treetop Archers | 3 | Archers fire from the trees, dealing 500 physical damage every 3 seconds. | Archers fire from the trees, dealing 900 physical damage every 3 seconds. | DA_TreetopArchers |
| Tremors | 3 | Every 8 seconds, Stun enemies for 1 second. | Every 8 seconds, Stun enemies for 1.5 seconds. | DA_18_Tremors |
| Component Bounty | 4 | If you win the next player combat, gain a random component. | If you win the next player combat, gain a random component. | DA_ComponentBounty |
| Forest Twins | 4 | Gain 2 copies of a 2-cost champion you don't have. | Gain 3 copies of a 2-cost champion you don't have. | DA_ForestTwins18 |
| Giant Growth | 4 | Your highest Health unit grows, gaining 800 Health. | Your 2 highest Health units grow, gaining 800 Health. | DA_18_GiantGrowth |
| Good Loss | 4 | For the next 3 player combats, gain 4 XP if you lose. | For the next 3 player combats, gain 6 XP if you lose. | DA_GoodLoss18 |
| Greater Chaos | 4 | Cast 2 random Wisps. | Cast 2 random Wisps worth 2 or more gold. | DA_GreaterChaos18 |
| Idle Craftsman | 4 | A component on your bench turns into a completed item it builds. | A component on your bench turns into a completed item it builds. | DA_IdleCraftsman18 |
| Infliction | 4 | Slow, Burn, Shred, and Sunder enemies for 8 seconds. | Slow, Burn, Shred, and Sunder enemies for 12 seconds. | DA_18_Infliction |
| Clone Companion | 5 | Clone your highest damage champion. The clone deals 20% damage. | Clone your highest damage champion. The clone deals 30% damage. | DA_CloneCompanion18 |
| Heroic Sacrifice | 5 | Your 3 strongest Champions gain HEROIC POWER, but other allies are sacrificed. | Your 3 strongest Champions gain HEROIC POWER, but other allies are sacrificed. | DA_18_HeroicSacrifice |
| Blood Ritual | 6 | Lose 10 Player Health. Gain a Champion Duplicator. | Lose 8 Player Health. Gain a Champion Duplicator. | DA_18_BloodRitual |
| Booster Shot | 6 | Up to 2 1-star champions temporarily star up during combat. | Up to 3 1-star champions temporarily star up during combat. | DA_BoosterShot18 |
| Hand of Baron | 6 | Your team gains Baron Buff, increasing their stats. | Your team gains Baron Buff, greatly increasing their stats. | DA_HandOfBaron18 |
| Animate Shop | 8 | For 18 seconds, your shop rerolls for free every 2 seconds. | For 24 seconds, your shop rerolls for free every 2 seconds. | DA_AnimateShop18 |
| Hero of Prophecy | 35 | Gain a 5-cost champion. Gain them again each round FOREVER. | Gain a 5-cost champion. Gain them again each round FOREVER. | DA_HeroOfProphecy18 |
| All Fives | — | Reroll your shop with all 5-cost champions. | Reroll your shop with all 5-cost champions. Gain 5 gold. | DA_18_AllFives |
| All Fours | — | Reroll your shop with all 4-cost champions. | Reroll your shop with all 4-cost champions. Gain 2 gold. | DA_18_AllFours |
| All Ones | — | Reroll your shop with all 1-cost champions. | Reroll your shop with all 1-cost champions. Gain 1 Gold. | DA_18_AllOnes |
| All Threes | — | Reroll your shop with all 3-cost champions. | Reroll your shop with all 3-cost champions. Gain 2 gold. | DA_18_AllThrees |
| All Twos | — | Reroll your shop with all 2-cost champions. | Reroll your shop with all 2-cost champions. Gain 1 gold. | DA_18_AllTwos |
| Border Village | — | Reroll your shop with all 2-star 2-cost champions. | Reroll your shop with all 2-star 2-cost champions. | DA_BorderVillage18 |
| Doodad Bag | — | Gain 2 consumables that give permanent Armor and Magic Resist or Health. | Gain 3 consumables that give permanent Armor and Magic Resist or Health. | DA_DoodadBag18 |
| Doodad Jar | — | Gain 1 consumable that gives permanent Armor and Magic Resist or Health. | Gain 2 consumables that give permanent Armor and Magic Resist or Health. | DA_DoodadJar18 |
| Doodad Sack | — | Gain 3 consumables that give permanent Armor and Magic Resist or Health. | Gain 4 consumables that give permanent Armor and Magic Resist or Health. | DA_DoodadSack18 |
| Flow | — | Your champions are unstoppable and gain 15% Attack Speed for 10 seconds. | Your champions are unstoppable and gain 15% Attack Speed for 15 seconds. | DA_Flow18 |
| Hireling | — | A temporary 1-star 5-cost with 1 recommended items joins your team. | A temporary 1-star 5-cost with 2 recommended items joins your team. | DA_Hireling18 |
| Knick-Knack Bag | — | Gain 2 consumables that give permanent Attack Damage or Attack Speed. | Gain 3 consumables that give permanent Attack Damage or Attack Speed. | DA_KnickKnackBag18 |
| Knick-Knack Jar | — | Gain 1 consumable that gives permanent Attack Damage or Attack Speed. | Gain 2 consumables that give permanent Attack Damage or Attack Speed. | DA_KnickKnackJar18 |
| Knick-Knack Sack | — | Gain 3 consumables that give permanent Attack Damage or Attack Speed. | Gain 4 consumables that give permanent Attack Damage or Attack Speed. | DA_KnickKnackSack18 |
| Late Bloomer | — | A temporary 3-star 1-cost joins your team. | A temporary 3-star 1-cost with 1recommend item joins your team. | DA_LateBloomer18 |
| Living Soil | — | Every 4 seconds, roots stun an enemy for 1 second. | Every 4 seconds, roots stun 2 enemies for 1 second. | DA_LivingSoil18 |
| Lucky 7 | — | Gain 7 shop rerolls. | Gain 10 shop rerolls. | DA_Lucky718 |
| Middle Path | — | Reroll your shop with all 2-star 3-cost champions. | Reroll your shop with all 2-star 3-cost champions. | DA_MiddlePath18 |
| Moonrise | — | After 8 seconds, increase Lunar's effects by 100%. | After 8 seconds, increase Lunar's effects by 175%. | DA_18_Moonrise |
| Preppers | — | Your stacking items start next combat partially stacked. | Your stacking items start next combat extra stacked. | DA_18_Preppers |
| Refreshing Light | — | Gain a free reroll per star level of each unique Solar champion. | Gain a free reroll per star level of each unique Solar champion. | DA_RefreshingLight18 |
| Starting Town | — | Reroll your shop with all 2-star 1-cost champions. | Reroll your shop with all 2-star 1-cost champions. | DA_StartingTown18 |
| Thingamajig Bag | — | Gain 2 consumables that give permanent Ability Power or Mana Regen. | Gain 3 consumables that give permanent Ability Power or Mana Regen. | DA_ThingamajigBag18 |
| Thingamajig Jar | — | Gain 1 consumable that gives permanent Ability Power or Mana Regen. | Gain 2 consumables that give permanent Ability Power or Mana Regen. | DA_ThingamajigJar18 |
| Thingamajig Sack | — | Gain 3 consumables that give permanent Ability Power or Mana Regen. | Gain 4 consumables that give permanent Ability Power or Mana Regen. | DA_ThingamajigSack18 |

## Economy reference

Native shop tier pool: T1: 14 shop identities, 420 copies; T2: 13 shop identities, 325 copies; T3: 14 shop identities, 252 copies; T4: 14 shop identities, 140 copies; T5: 10 shop identities, 90 copies. The JSON retains every TierBagEntries object and its ShopData/Character association.
Shop odds, champion pool size, XP to level and stage/round timing are transcribed from the versioned published tables below; they do not establish live server configuration.

Native Map22 shop odds (exact Set18 DropRateTables.Shop association):

| Level row | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 0 | 0 | 0 |
| 2 | 1 | 0 | 0 | 0 | 0 |
| 3 | 0.75 | 0.25 | 0 | 0 | 0 |
| 4 | 0.550000011920929 | 0.30000001192092896 | 0.15000000596046448 | 0 | 0 |
| 5 | 0.44999998807907104 | 0.33000001311302185 | 0.20000000298023224 | 0.019999999552965164 | 0 |
| 6 | 0.30000001192092896 | 0.4000000059604645 | 0.25 | 0.05000000074505806 | 0 |
| 7 | 0.1899999976158142 | 0.30000001192092896 | 0.4000000059604645 | 0.10000000149011612 | 0.009999999776482582 |
| 8 | 0.15000000596046448 | 0.20000000298023224 | 0.3199999928474426 | 0.30000001192092896 | 0.029999999329447746 |
| 9 | 0.10000000149011612 | 0.17000000178813934 | 0.25 | 0.33000001311302185 | 0.15000000596046448 |
| 10 | 0.05000000074505806 | 0.10000000149011612 | 0.20000000298023224 | 0.4000000059604645 | 0.25 |
| 11 | 0.009999999776482582 | 0.019999999552965164 | 0.11999999731779099 | 0.5 | 0.3499999940395355 |

### rollOdds

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-roll-odds-18.4.html.

#### rollOdds table 1

| Level | 1-cost | 2-cost | 3-cost | 4-cost | 5-cost |
| --- | --- | --- | --- | --- | --- |
| 1 | 100% | 0% | 0% | 0% | 0% |
| 2 | 100% | 0% | 0% | 0% | 0% |
| 3 | 75% | 25% | 0% | 0% | 0% |
| 4 | 55% | 30% | 15% | 0% | 0% |
| 5 | 45% | 33% | 20% | 2% | 0% |
| 6 | 30% | 40% | 25% | 5% | 0% |
| 7 | 16% | 30% | 43% | 10% | 1% |
| 8 | 15% | 20% | 32% | 30% | 3% |
| 9 | 10% | 17% | 25% | 33% | 15% |
| 10 | 5% | 10% | 20% | 40% | 25% |
| 11 | 1% | 2% | 12% | 50% | 35% |

### poolSizes

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-pool-sizes-18.4.html.

#### poolSizes table 1

| Cost | Copies per champion | Champions of this cost | Copies in the pool |
| --- | --- | --- | --- |
| 1-cost | 30 | 14 | 420 |
| 2-cost | 25 | 13 | 325 |
| 3-cost | 18 | 14 | 252 |
| 4-cost | 10 | 14 | 140 |
| 5-cost | 9 | 10 | 90 |

#### Copies per star level

| 1-star | 1 |
| --- | --- |
| 2-star | 3 |
| 3-star | 9 |

### xpToLevel

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-xp-to-level-18.4.html.

#### xpToLevel table 1

| Level | XP to reach it | XP from level 1 | Gold to buy it |
| --- | --- | --- | --- |
| 2 | 2 | 2 | 4 |
| 3 | 2 | 4 | 4 |
| 4 | 6 | 10 | 8 |
| 5 | 10 | 20 | 12 |
| 6 | 20 | 40 | 20 |
| 7 | 36 | 76 | 36 |
| 8 | 60 | 136 | 60 |
| 9 | 68 | 204 | 68 |
| 10 | 68 | 272 | 68 |

### rounds

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-rounds-18.4.html.

#### Stage 1

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 1-2 | PvE fight | - | - |
| 1-3 | PvE fight | Yes | - |
| 1-4 | PvE fight | Yes | - |

#### Stage 2

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 2-1 | Player fight | Yes | Augment choice |
| 2-2 | Player fight | Yes | - |
| 2-3 | Player fight | Yes | - |
| 2-4 | Carousel | - | - |
| 2-5 | Player fight | Yes | - |
| 2-6 | Player fight | Yes | - |
| 2-7 | PvE fight | Yes | - |

#### Stage 3

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 3-1 | Player fight | Yes | - |
| 3-2 | Player fight | Yes | Augment choice |
| 3-3 | Player fight | Yes | - |
| 3-4 | Carousel | - | - |
| 3-5 | Player fight | Yes | - |
| 3-6 | Player fight | Yes | - |
| 3-7 | PvE fight | Yes | - |

#### Stage 4

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 4-1 | Player fight | Yes | - |
| 4-2 | Player fight | Yes | Augment choice |
| 4-3 | Player fight | Yes | - |
| 4-4 | Carousel | - | - |
| 4-5 | Player fight | Yes | - |
| 4-6 | Player fight | Yes | - |
| 4-7 | PvE fight | Yes | - |

#### Stage 5

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 5-1 | Player fight | Yes | - |
| 5-2 | Player fight | Yes | - |
| 5-3 | Player fight | Yes | - |
| 5-4 | Carousel | - | - |
| 5-5 | Player fight | Yes | - |
| 5-6 | Player fight | Yes | - |
| 5-7 | PvE fight | Yes | - |

#### Stage 6

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 6-1 | Player fight | Yes | - |
| 6-2 | Player fight | Yes | - |
| 6-3 | Player fight | Yes | - |
| 6-4 | Carousel | - | - |
| 6-5 | Player fight | Yes | - |
| 6-6 | Player fight | Yes | - |
| 6-7 | PvE fight | Yes | - |

#### Stage 7

| Round | What happens | Shop refreshes | Augment |
| --- | --- | --- | --- |
| 7-1 | Player fight | Yes | - |
| 7-2 | Player fight | Yes | - |
| 7-3 | Player fight | Yes | - |
| 7-4 | Carousel | - | - |
| 7-5 | Player fight | Yes | - |
| 7-6 | Player fight | Yes | - |
| 7-7 | PvE fight | Yes | - |

### topmetaSet18CrossCheck

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/topmeta-economy-set18-18.4.html.

#### Income & Gold

| Round | Base gold |
| --- | --- |
| 1-2 · 1-3 | +2 |
| 1-4 | +3 |
| 2-1 | +4 |
| 2-2 onward | +5 |

#### Interest

| Gold held | Interest |
| --- | --- |
| 0–9 | +0 |
| 10–19 | +1 |
| 20–29 | +2 |
| 30–39 | +3 |
| 40–49 | +4 |
| 50+ | +5 |

#### Win / Loss Streaks

| Streak length | Bonus gold |
| --- | --- |
| 2 · 3 · 4 | +1 |
| 5 | +2 |
| 6+ | +3 |

#### Unit Sell Value

| Cost |  |  |  |
| --- | --- | --- | --- |
| 1 | 1 | 3 | 9 |
| 2 | 2 | 5 | 17 |
| 3 | 3 | 8 | 26 |
| 4 | 4 | 11 | 35 |
| 5 | 5 | 14 | 44 |

### topmetaLeveling

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/topmeta-leveling-set18-18.4b.html.

#### Experience & Leveling

| Level up | XP needed | Cumulative | Gold to buy |
| --- | --- | --- | --- |
| → 3 | 2 | 2 | 2g |
| → 4 | 6 | 8 | 6g |
| → 5 | 10 | 18 | 10g |
| → 6 | 20 | 38 | 20g |
| → 7 | 36 | 74 | 36g |
| → 8 | 56 | 130 | 56g |
| → 9 | 68 | 198 | 68g |
| → 10 | 68 | 266 | 68g |

#### Unit Pool & Star-ups

| Cost | Copies / unit | # of units | Total pool | Max 3★ |
| --- | --- | --- | --- | --- |
| 1 | 30 | 14 | 420 | 3 players |
| 2 | 25 | 13 | 325 | 2 players |
| 3 | 18 | 14 | 252 | 2 players |
| 4 | 10 | 14 | 140 | 1 players |
| 5 | 9 | 10 | 90 | 1 players |

### noxuSystem

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/noxutft-system-tables-set18-oct8.html.

#### Shop odds by level

| Level | 1-cost | 2-cost | 3-cost | 4-cost | 5-cost |
| --- | --- | --- | --- | --- | --- |
| 1 | 100% | — | — | — | — |
| 2 | 100% | — | — | — | — |
| 3 | 75% | 25% | — | — | — |
| 4 | 55% | 30% | 15% | — | — |
| 5 | 45% | 33% | 20% | 2% | — |
| 6 | 30% | 40% | 25% | 5% | — |
| 7 | 16% | 30% | 43% | 10% | 1% |
| 8 | 15% | 20% | 32% | 30% | 3% |
| 9 | 10% | 17% | 25% | 33% | 15% |
| 10 | 5% | 10% | 20% | 40% | 25% |
| 11 | 1% | 2% | 12% | 50% | 35% |

#### XP and leveling

| Reach level | XP from previous | Rounds if you never buy | Gold if you buy it all | Cumulative XP |
| --- | --- | --- | --- | --- |
| 2 | free | — | — | 0 |
| 3 | 2 | 1 | 4 | 2 |
| 4 | 6 | 3 | 8 | 8 |
| 5 | 10 | 5 | 12 | 18 |
| 6 | 20 | 10 | 20 | 38 |
| 7 | 36 | 18 | 36 | 74 |
| 8 | 60 | 30 | 60 | 134 |
| 9 | 68 | 34 | 68 | 202 |
| 10 | 68 | 34 | 68 | 270 |

#### Champion pool

| Cost | Copies of each | Distinct champions | Total in pool | Cost of a 3★ |
| --- | --- | --- | --- | --- |
| 1 | 30 | 14 | 420 | 9g |
| 2 | 25 | 13 | 325 | 18g |
| 3 | 18 | 14 | 252 | 27g |
| 4 | 10 | 14 | 140 | 36g |
| 5 | 9 | 10 | 90 | 45g |

#### Base income

| Round | Gold |
| --- | --- |
| 1-2 | +2 |
| 1-3 | +2 |
| 1-4 | +3 |
| 2-1 | +4 |
| 2-2 onward | +5 |
| Winning the round | +1 |

#### Interest

| Gold held | Bonus |
| --- | --- |
| 0–9 | +0 |
| 10–19 | +1 |
| 20–29 | +2 |
| 30–39 | +3 |
| 40–49 | +4 |
| 50+ | +5 |

#### Streaks

| Streak | Bonus |
| --- | --- |
| 2 | +1 |
| 3 | +1 |
| 4 | +1 |
| 5 | +2 |
| 6 or more | +3 |

### tftNinjaEconomy

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tft-ninja-economy-set18-sept25.html.

### currentPublishedReference

Source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-roll-odds-18.4.html.

#### Current published XP to reach level

| Target level | XP to reach |
| --- | --- |
| 2 | 2 |
| 3 | 2 |
| 4 | 6 |
| 5 | 10 |
| 6 | 20 |
| 7 | 36 |
| 8 | 56 |
| 9 | 68 |
| 10 | 68 |

#### Level 7 shop odds: published reference and native Map22 conflict

| Source | 1-cost | 2-cost | 3-cost | 4-cost | 5-cost |
| --- | --- | --- | --- | --- | --- |
| TFTraits current published | 16% | 30% | 43% | 10% | 1% |
| CDragon native Map22 | 19% | 30% | 40% | 10% | 1% |


## Official 18.4B overlay

Overlay statements are separate from the unchanged CDragon/TFTraits base. `baseValue` records the observed published value (or a documented conflict); `to` records the official change. Unknown or ambiguous mappings remain flagged.

| Group | Identity | Field | Base | Official result / status |
|---|---|---|---|---|
| Champion | `DA_18_Camille` | ability.AbilityDamage | [150,225,375] | [150,225,400] |
| Champion | `DA_18_Varus` | startingMana/mana | [30,120] | [20,110]; published source stats.initialMana is 0; official pair conflicts with source representation |
| Champion | `DA_18_Alistar` | AllyHeal | [200,260,320] | [230,300,400]; unverified; raw AllyHeal is [80,105,130], official wording says Heal |
| Champion | `DA_18_Alistar` | Damage | [100,150,225] | [180,270,420] |
| Champion | `DA_Gromp18_AP` | SecondaryDamageAP | [160,240,375] | [180,270,435] |
| Champion | `DA_Gromp18_AP` | stats.damage | 45 | 50 |
| Champion | `DA_Gromp18_AP` | stats.attackSpeed | 0.7 | 0.75 |
| Champion | `DA_Murkwolf18` | EmpoweredDamageAD | [60,90,135] | [65,100,160] |
| Champion | `DA_18_Warwick` | BiteDamage | [215,325,500] | [230,345,535] |
| Champion | `DA_18_Warwick` | description.healPercent | 20 | 25 |
| Champion | `DA_CrimsonRaptor18` | stats.damage | 55 | 60 |
| Champion | `DA_Nidalee18_AP` | ADform.armorPenetrationBehavior | "bugged behavior" | "fixed behavior"; tooltip values unchanged |
| Augment | `DA_ChallengersGrace` | BuffDuration | 3 | 4 |
| Augment | `DA_EarlyLearnings` | InitialStacks | 5 | 3 |
| Augment | `DA_ElectrochargeI` | stageDamage | [30,50,70,90] | [25,40,60,80] |
| Augment | `DA_FutureFocused` | RewardGold | 8 | 5 |
| Augment | `DA_GiantAndMighty` | FlatHealth | 200 | 225 |
| Augment | `DA_GroupHugI` | Armor_Silver/MR_Silver | 6 | 7 |
| Augment | `DA_GroupHugII` | Armor_Gold/MR_Gold | 9 | 10 |
| Augment | `DA_HeroicGrabBag` | Gold | 4 | 6 |
| Augment | `DA_HoldTheLine` | AttackDamagePcntPerFrontLiner | 0.09 | 0.11 |
| Augment | `DA_HoldTheLine` | AbilityPowerPcntPerFrontLiner | 0.1 | 0.11 |
| Augment | `DA_SpiritOfRedemption` | PercentMissingHealth | 0.075 | 0.09 |
| Wisp | `DA_AbandonShip18` | StopsAppearingAfterThisManySeconds | 10 | 2;  |
| Wisp | `DA_ArmorMRBooster18` | Armor/MR/MagicResist | 10 | 8;  |
| Wisp | `DA_SpeedBooster18` | AS/AttackSpeed/AttackSpeedMinusOne | [8,1.08,0.08] | [6,1.06,0.06];  |
| Wisp | `DA_Combust18` | maxHealthExplosionDamage | 0.12 | 0.15; upgrade/prismatic values not specified; retain raw values |
| Wisp | `DA_18_HealingPool` | AmountOfMissingHealthToSee | 10 | 10; official eligibility threshold agrees with source |
| Wisp | `DA_ManaRichSoil18` | ManaReduction upgrade/base/inverted-base | [0.75,0.82] | [0.8,0.85,0.15]; official 20% / 15%; keep source variable meaning |
| Wisp | `DA_SearchParty18` | Cost/Cost_Upgrade | [3,2] | [1,0]; source representation conflicts with official 3/1 old pair |
| Wisp | `DA_ThreeMe18` | Cost | 9 | 10; Map22 charm list exact identity; absent from published 571 item list |
| Wisp | `DA_ThingamajigJar18/Bag18/Sack18` | ManaRegenBooster appearance probability | null | null; reduced; exact probability unknown |
| Availability/behavior | `DA_HeartOfSteel` | status | — | temporarily disabled; base retains 18 HP |
| Availability/behavior | `DA_18_CovenTraitAugment + DA_18_CovenTraitAugment_LootToAP` | status | — | combined lobby cap 1 |
| Availability/behavior | `DA_18_SolarTraitAugment` | status | — | lobby cap 1 |
| Availability/behavior | `DA_WeightTheWorth` | status | — | no longer creates GoldenEgg copy |
| Availability/behavior | `abilities` | status | — | some abilities no longer disappear before dealing damage; unknown |
| Availability/behavior | `DA_MinMax` | status | — | adds Golden Magnetic Remover |
| Availability/behavior | `traits` | status | — | no trait value changes reported; augment appearance rates and lobby limits changed |

## Source gaps and interpretation

- `DA_EarlyLearnings`: source description refers only to TFT Vegas Open 2023; official baseline semantic is 5% to 3% AD/AP via InitialStacks and Buff .01.
- `DA_ElectrochargeI`: published effects expose DamageI=30 and DamageII=50 only; all-stage values come from published tables and are kept separately.
- `DA_18_CovenTraitAugment/DA_18_CovenTraitAugment_LootToAP/DA_18_SolarTraitAugment`: candidate source does not establish current active pool.
- Economy — Level 7 to 8 XP: 56; source values {"cdragon":60,"tftraits":60,"noxu":56,"topmeta":56}. Riot primary patch history states 18.2 changed 60 to 56; Sept 14 changed the 8→9 and 9→10 values back to 68 while retaining 7→8 at 56.
- Economy — XP level 8 to 9 / 9 to 10: 68,68; source values {"cdragon":[68,68],"tftraits":[68,68],"noxu":[68,68],"topmeta":[68,68]}. Riot primary patch history identifies 64 then 68; source values remain available in their original tables.
- Economy — base income, interest, win/loss streak, sell values: current public sources align; live native engine consumer/configuration is not verified; source values {}.
- Economy — level 7 shop odds: retain each source independently; no live engine claim; source values {"cdragon":[19,30,40,10,1],"tftraits":[16,30,43,10,1],"noxu":[16,30,43,10,1]}.
- Published data has 4 Wisp rows without an exact item icon association; these remain listed with source image paths.
- Unresolved published item tokens: 0; unresolved skill tokens: 0. No missing value is inferred from an unrelated field.
- Semantic effect mapping: `DA_WeStickTogether @AttackSpeedMinusOne*100@` resolves as 30% using exact source `Attackspeed - 1` and is checked against source `AS=30`; the raw effect object is unchanged.
- Client augment/item candidates and third-party published lists are not evidence of the current online legal pool; live active/disabled status remains unknown except explicit official patch notes.

Sources: [CommunityDragon 16.20 client data](https://raw.communitydragon.org/16.20/cdragon/tft/{locale}.json); [TFTraits source manifest](E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/tftraits-source-manifest-18.4.json); [Riot patch 18.4 announcement](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/); Riot 18.2 XP correction source: E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/riot-patch-18.2-including-sept14-xp.html.

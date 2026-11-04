import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainPath = path.join(root, 'public/js/assault/main.js');
const main = fs.readFileSync(mainPath, 'utf8');
const field = fs.readFileSync(path.join(root, 'public/js/assault/field.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/js/assault/ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/assault.html'), 'utf8');

test('Assault entry relative import targets exist', () => {
  const specs = [...main.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)]
    .map((match) => match[2]).filter((specifier) => specifier.startsWith('.'));
  assert.ok(specs.length > 0);
  const publicRoot = path.resolve(root, 'public');
  const reusedPublic = process.env.SP_REUSED_PUBLIC_DIR;
  for (const specifier of specs) {
    const target = path.resolve(path.dirname(mainPath), specifier);
    const relativeToPublic = path.relative(publicRoot, target);
    const candidates = [target];
    if (reusedPublic && relativeToPublic && !relativeToPublic.startsWith('..') && !path.isAbsolute(relativeToPublic)) {
      candidates.push(path.resolve(reusedPublic, relativeToPublic));
    }
    assert.ok(candidates.some((candidate) => fs.existsSync(candidate)), `${specifier}: ${candidates.join(' | ')}`);
  }
});

test('Assault entry delegates to the native UI composition', () => {
  assert.match(main, /import\s*\{\s*AssaultUI\s*,\s*seedNativeUi\s*\}\s*from\s*['"]\.\/ui\.js['"]/);
  assert.match(main, /<\$\{AssaultUI\}/);
  assert.match(ui, /<\$\{NativeAssaultField\}/);
  assert.match(ui, /<\$\{ShopBar\}/);
  assert.match(ui, /<\$\{TopBar\}/);
});

test('Assault page loads alliance native styles and excludes the retired custom stylesheet', () => {
  assert.match(html, /\.\/css\/screens\/game\.css/);
  assert.match(html, /\.\/css\/screens\/game-shop\.css/);
  assert.match(html, /\.\/css\/assault-native\.css/);
  assert.doesNotMatch(html, /\.\/css\/assault\.css/);
  // the bronze-frame skin is page-scoped and loads after the native placement rules it restyles
  assert.ok(html.indexOf('./css/assault-bazaar.css') > html.indexOf('./css/assault-native.css'));
  assert.doesNotMatch(html, /ix-ws/);
});

test('Assault phase screens reuse native title, shop, battle HUD, detail and settlement components', () => {
  assert.match(ui, /<\$\{TitleScreen\}/);
  assert.match(ui, /<\$\{ShopBar\}/);
  assert.match(ui, /<\$\{TopBar\}/);
  assert.match(ui, /<\$\{DetailPanel\}/);
  assert.match(ui, /<\$\{ResultView\}/);
  assert.match(ui, /<\$\{ChoiceOverlay\}/);
});

test('Assault detail card keeps only the attack/skill range switch; the native stat box draws the range', () => {
  assert.match(ui, /const attackRange = attackRangeOf\(catalog, piece\);/);
  assert.match(ui, /class="assault-actions assault-range" data-range-cells=/);
  assert.doesNotMatch(ui, /<\$\{RangeGrid\}/);
  assert.doesNotMatch(ui, /朝右为正前方/);
  assert.match(ui, /\$\{rangeBlock\}\$\{cardBlock\}/);
  assert.match(html, /css\/assault-native\.css/);
});

test('Assault enemy preview uses the authored encounter pen and native enemy detail callback', () => {
  assert.match(field, /state\?\.currentNode\?\.encounterId/);
  assert.match(field, /catalog\?\.design\?\.encounters\?\.encounters/);
  assert.match(field, /current\.setPen\?\./);
  assert.match(field, /pen && !inBattle \? 'pen' : kind/);
  assert.match(field, /enemyDetailRef\.current\?\.\(enemyKey\)/);
  assert.match(field, /event\.preview \|\| event\.unit\?\.preview/);
});

test('the bronze-frame skin stays inside the Assault page and only recolours frames', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/assault-bazaar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('{').slice(0, -1).map((chunk) => chunk.split(/[};]/).pop().trim()).filter((head) => head && !head.startsWith('@'));
  assert.ok(selectors.length > 20);
  for (const group of selectors) for (const selector of group.split(',').map((part) => part.trim()))
    assert.match(selector, /^html\.assault-page(?![\w-])/, selector);
  // only colours change: no external resources, no layout / typography / visibility / text-colour declarations,
  // and the native fills / text / tier / price tokens stay untouched
  assert.doesNotMatch(css, /url\(|@media|(?:^|[;{\s])(?:content|display|position|inset|top|left|right|bottom|width|height|margin|padding|font[\w-]*|transform|filter|opacity|color)\s*:/m);
  assert.doesNotMatch(css, /--(?:bg|mint|gold|amber|orange|red|ice|text|tier|lv)-[\w-]*\s*:|--btn-(?:bg|fg)[\w-]*\s*:|--cap\s*:/);
  assert.match(css, /--bk-c\s*:/);
});

test('Assault battle speed is the native single-player speed bar: chips 1× 2× 4×, top right, kept across the visit only', () => {
  const components = fs.readFileSync(path.join(root, 'public/js/ui/components.js'), 'utf8');
  const independent = fs.readFileSync(path.join(root, 'public/js/independent/game.js'), 'utf8');
  assert.match(components, /export const BATTLE_SPEEDS = \[2, 4, 8\];/);
  assert.match(components, /export function BattleSpeedBar\(/);
  assert.match(components, /\$\{s \/ 2\}×/);
  // one component for both modes: the single-player screen and Assault render the same bar
  assert.match(independent, /<\$\{BattleSpeedBar\} speed=\$\{speed\} onSpeed=\$\{setSpeed\}>/);
  assert.doesNotMatch(independent, /ix-chip', speed === s/);
  assert.match(ui, /<\$\{BattleSpeedBar\} speed=\$\{\(session\?\.speed \|\| 1\) \* 2\} onSpeed=\$\{speed => onSpeed\(speed \/ 2\)\} \/>/);
  assert.doesNotMatch(ui, /assault-speed|\[1,2,4,8\]/);
  assert.match(html, /\.\/css\/independent\.css/);
  // default 1× (the real-second clock); the choice survives into later battles of the visit and is never stored
  assert.match(main, /const speedRef = useRef\(1\);/);
  assert.match(main, /speed: speedRef\.current, paused: false/);
  assert.doesNotMatch(main, /localStorage\.setItem\([^)]*speed/i);
});

test('Assault collection column keeps clear of the cost box during the battle and shows the rest behind "+N"', () => {
  assert.match(ui, /function CollectionEffects\(\{ skills, renderIcon, battle, onEffect, onMore \}\)/);
  assert.match(ui, /querySelector\('\.dpbox'\)/);
  assert.match(ui, /<\$\{CollectionEffects\} skills=\$\{collectionSkills\}/);
});

test('Assault phase line is a native ticker status line that replaces the previous phase and never shows empty', () => {
  assert.match(ui, /replaces:'assault-phase'/);
  assert.match(ui, /if\(!text\)return;/);
  const ticker = fs.readFileSync(path.join(root, 'public/js/ui/ticker.js'), 'utf8');
  assert.match(ticker, /line\.replaces != null && line\.replaces === old\.replaces/);
});

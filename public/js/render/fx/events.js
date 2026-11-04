// Event entry points installed on FxSystem by system.js.

import { dmgStyleKey } from '../style.js';
import { fxCue, fxRegistry } from '../fxRegistry.js';

export class FxEvents {
  identify(view) { return this.ctx.identify?.(view) || null; }

  play(channel, cue) {
    const previousCue = this._activeFxCue;
    this._activeFxCue = channel === 'fx' ? cue : previousCue;
    try {
      // an official effect drew this event (render/vfx): the procedural recipe and the fork's own sim-fx drawings are
      // skipped — the damage / heal numbers below still show
      if (!cue?.official) {
        if (channel === 'fx' && (cue?.kind === 'chen3Wave' || cue?.kind === 'coldWind')) this._drawSimFx(cue.kind, cue.x, cue.y, cue.extra);
        else (this.ctx.registry || fxRegistry).play(this, channel, cue);
      }
    } finally {
      this._activeFxCue = previousCue;
    }
    if (channel === 'fx' && cue?.kind === 'dodge' && cue.extra?.num === 'm' &&
        this.ctx.settings?.damageNumbers !== false && this.ctx.settings?.officialDamageNumbers) {
      const view = this.ctx.view?.(cue.extra.id);
      if (view) this.officialNumber(view, 0, 'miss');
    }
    if (channel === 'dmg' && this.ctx.settings?.damageNumbers !== false && cue?.view) {
      if (this.ctx.settings?.officialDamageNumbers) {
        if (cue.mark === 'r') this.officialNumber(cue.view, Number(cue.amount) || 0, 'crit');
      } else this.number(cue.view, Number(cue.amount) || 0, dmgStyleKey(cue.type), { src: cue.attacker || cue.src });
    } else if (channel === 'heal' && this.ctx.settings?.damageNumbers !== false && !this.ctx.settings?.officialDamageNumbers && cue?.view) {
      this.number(cue.view, Number(cue.amount) || 0, 'heal');
    }
  }

  attack(src, tgt, kind, options = {}) { this.play('atk', fxCue.atk(src, tgt, kind, options)); }
  damage(view, amount, type, src = null, options = {}) {
    const opt = typeof options === 'string' ? { mark: options } : options;
    this.play('dmg', fxCue.dmg(view, amount, type, src, { attacker: opt.attacker || src, melee: !!src, ...opt }));
  }
  heal(view, amount) { this.play('heal', fxCue.heal(view, amount)); }
  skill(view, on, options) { this.play('skill', fxCue.skill(view, on, options)); }
  death(view) { this.play('die', fxCue.die(view)); }
  deploy(view) { this.play('deploy', fxCue.deploy(view)); }
  simFx(kind, x, y, extra) { this.play('fx', fxCue.fx(kind, x, y, extra)); }
}

// Explicit FIFO causal effects for the assault battle rules.
import { EVENT_FAMILIES, eventFamily } from '../../../../shared/assault/adaptation.js';

const targetOf = (payload) => payload?.targetUid ?? payload?.target?.uid ?? payload?.target?.id ?? null;

function copyCause(cause) {
  return {
    rootId: cause.rootId,
    path: [...cause.path],
    visited: cause.visited.map((entry) => ({ ...entry })),
  };
}

export function createAssaultRuntime(battle) {
  if (!battle || battle.contentMode !== 'assault') throw new Error('assault runtime requires content: assault');
  let eventSeq = 0;
  let observerSeq = 0;
  const observers = new Map();
  const queue = [];
  const afterFlushQueue = [];
  const diagnostics = { suppressed: [], processed: 0, families: Object.fromEntries(Object.keys(EVENT_FAMILIES).map(key => [key, 0])) };
  let flushing = false;
  let currentCause = null;
  let publishDepth = 0;
  const withCause = (cause, fn) => {
    const previous = currentCause;
    currentCause = cause ?? previous;
    try { return fn(); } finally { currentCause = previous; }
  };

  const runtime = {
    battle,
    diagnostics,
    get currentCause() { return currentCause ? copyCause(currentCause) : null; },
    withCause,

    publish(type, payload, { sourceUid, cause, observerKey } = {}) {
      if (typeof type !== 'string' || !type) throw new Error('assault event requires a type');
      if (++publishDepth > 128) {
        publishDepth--;
        throw new Error(`assault event recursion exceeded 128 publications at ${type}; cause=${JSON.stringify(currentCause)}`);
      }
      try {
        const parent = cause ?? currentCause;
        const targetUid = targetOf(payload);
        const eventCause = parent
          ? { ...copyCause(parent), path: [...parent.path, type] }
          : { rootId: ++eventSeq, path: [type], visited: [] };
        if (observerKey != null) {
          const pair = { key: String(observerKey), targetUid: targetUid == null ? null : String(targetUid) };
          if (!eventCause.visited.some((v) => v.key === pair.key && v.targetUid === pair.targetUid)) eventCause.visited.push(pair);
        }
        const family = eventFamily(type, payload);
        if (family) diagnostics.families[family]++;
        const event = { type, family, payload, sourceUid: sourceUid ?? payload?.sourceUid ?? payload?.source?.uid ?? payload?.source?.id ?? null, cause: eventCause };
        const list = [...(observers.get(type) ?? []), ...(family ? observers.get(`family:${family}`) ?? [] : [])];
        if (list) {
          const previous = currentCause;
          currentCause = eventCause;
          try {
            for (const observer of [...list]) {
              if (!observer.active) continue;
              const observerTarget = targetUid == null ? null : String(targetUid);
              if (eventCause.visited.some((v) => v.key === observer.key && v.targetUid === observerTarget)) {
                diagnostics.suppressed.push({ key: observer.key, targetUid: observerTarget, rootId: eventCause.rootId, path: [...eventCause.path] });
                continue;
              }
              observer.fn(event, runtime);
            }
          } finally {
            currentCause = previous;
          }
        }
        return event;
      } finally {
        publishDepth--;
      }
    },

    observe(type, observerKey, fn, { owner = null, priority = 0 } = {}) {
      if (typeof type !== 'string' || !type || typeof observerKey !== 'string' || !observerKey || typeof fn !== 'function') {
        throw new Error('assault observer requires type, observerKey, and function');
      }
      const item = { key: observerKey, fn, owner, priority: Number(priority) || 0, seq: ++observerSeq, active: true };
      const list = observers.get(type) ?? [];
      list.push(item);
      list.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      observers.set(type, list);
      return () => {
        item.active = false;
        const live = list.filter((entry) => entry.active);
        if (live.length) observers.set(type, live);
        else observers.delete(type);
      };
    },

    observeFamily(family, observerKey, fn, options) {
      if (!Object.hasOwn(EVENT_FAMILIES, family)) throw new TypeError(`unknown assault event family ${family}`);
      return runtime.observe(`family:${family}`, observerKey, fn, options);
    },

    offOwner(owner) {
      for (const [type, list] of observers) {
        for (const observer of list) if (observer.owner === owner) observer.active = false;
        const live = list.filter((observer) => observer.active);
        if (live.length) observers.set(type, live);
        else observers.delete(type);
      }
    },

    enqueue(effectFn, { key = null, targetUid = null, cause, sourceUid = null } = {}) {
      if (typeof effectFn !== 'function') throw new Error('assault queue effect must be a function');
      if (queue.length >= 10000) {
        throw new Error(`assault effect queue exceeded 10000 entries; cause=${JSON.stringify(currentCause)}`);
      }
      const parent = cause ?? currentCause ?? { rootId: ++eventSeq, path: ['enqueue'], visited: [] };
      const nextCause = copyCause(parent);
      if (key != null) {
        const pair = { key: String(key), targetUid: targetUid == null ? null : String(targetUid) };
        if (nextCause.visited.some((v) => v.key === pair.key && v.targetUid === pair.targetUid)) {
          diagnostics.suppressed.push({ ...pair, rootId: nextCause.rootId, path: [...nextCause.path] });
          return false;
        }
        nextCause.visited.push(pair);
      }
      queue.push({ effectFn, key, targetUid, sourceUid, cause: nextCause });
      return true;
    },

    afterFlush(callback, { cause = currentCause } = {}) {
      if (typeof callback !== 'function') throw new Error('assault afterFlush callback must be a function');
      afterFlushQueue.push({ callback, cause: cause ? copyCause(cause) : null });
      if (!flushing) runtime.flush();
    },

    flush() {
      if (flushing) return 0;
      flushing = true;
      let count = 0;
      try {
        while (queue.length || afterFlushQueue.length) {
          if (!queue.length) {
            let next = 0;
            for (let i = 1; i < afterFlushQueue.length; i++) {
              const depth = afterFlushQueue[i].cause?.path.length ?? 0;
              const best = afterFlushQueue[next].cause?.path.length ?? 0;
              if (depth > best) next = i;
            }
            afterFlushQueue.splice(next, 1)[0].callback(runtime);
            continue;
          }
          if (++count > 100000) {
            throw new Error(`assault effect queue exceeded 100000 executions; next=${JSON.stringify(queue[0]?.cause)}`);
          }
          const task = queue.shift();
          const previous = currentCause;
          currentCause = task.cause;
          try {
            task.effectFn(runtime, task);
          } catch (error) {
            error.message = `assault effect ${task.key ?? '<anonymous>'} failed at ${task.cause.path.join(' > ')}: ${error.message}`;
            throw error;
          } finally {
            currentCause = previous;
          }
        }
      } finally {
        diagnostics.processed += count;
        flushing = false;
      }
      return count;
    },

    cast(unit, opts = {}) {
      if (!unit || !unit.skill || typeof unit.skill._castAssault !== 'function') {
        throw new Error(`assault cast has no fixed skill handler for ${unit?.defId ?? unit?.id ?? 'unknown unit'}`);
      }
      return withCause(opts.cause ?? currentCause, () => unit.skill._castAssault({
        extra: opts.extra === true,
        suppressRedeploy: opts.suppressRedeploy === true,
        force: opts.force === true,
        cause: opts.cause ?? currentCause,
      }));
    },
  };

  battle.assaultRuntime = runtime;
  return runtime;
}

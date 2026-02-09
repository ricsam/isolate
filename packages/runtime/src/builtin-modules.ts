/**
 * Built-in module registry for node: modules.
 * Provides crypto, events, stream, and stream/promises as importable ESM modules
 * that work inside the V8 isolate without requiring a user-provided moduleLoader.
 */

/**
 * Normalize a module specifier to a built-in name.
 * Strips `node:` prefix if present and checks against the registry.
 * @returns The normalized name (key into BUILTIN_MODULES) or null if not a built-in.
 */
export function normalizeBuiltinSpecifier(specifier: string): string | null {
  let name = specifier;
  if (name.startsWith("node:")) {
    name = name.slice(5);
  }
  if (name in BUILTIN_MODULES) {
    return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Module source code strings
// ---------------------------------------------------------------------------

const CRYPTO_MODULE = `
export default globalThis.crypto;
export const randomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
export const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
export const subtle = globalThis.crypto.subtle;
`;

const EVENTS_MODULE = `
class EventEmitter {
  constructor() {
    this._events = Object.create(null);
    this._maxListeners = 10;
  }

  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  off(event, listener) {
    return this.removeListener(event, listener);
  }

  removeListener(event, listener) {
    const listeners = this._events[event];
    if (!listeners) return this;
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
    if (listeners.length === 0) delete this._events[event];
    return this;
  }

  removeAllListeners(event) {
    if (event === undefined) {
      this._events = Object.create(null);
    } else {
      delete this._events[event];
    }
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events[event];
    if (!listeners || listeners.length === 0) return false;
    const copy = listeners.slice();
    for (const fn of copy) {
      fn.apply(this, args);
    }
    return true;
  }

  once(event, listener) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };
    wrapped.listener = listener;
    return this.on(event, wrapped);
  }

  prependListener(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].unshift(listener);
    return this;
  }

  prependOnceListener(event, listener) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };
    wrapped.listener = listener;
    return this.prependListener(event, wrapped);
  }

  listeners(event) {
    const listeners = this._events[event];
    if (!listeners) return [];
    return listeners.map(fn => fn.listener || fn);
  }

  rawListeners(event) {
    return (this._events[event] || []).slice();
  }

  listenerCount(event) {
    const listeners = this._events[event];
    return listeners ? listeners.length : 0;
  }

  setMaxListeners(n) {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners() {
    return this._maxListeners;
  }

  eventNames() {
    return Object.keys(this._events);
  }
}

EventEmitter.EventEmitter = EventEmitter;

export default EventEmitter;
export { EventEmitter };
`;

const STREAM_MODULE = `
import { EventEmitter } from 'node:events';

class Stream extends EventEmitter {
  constructor(opts) {
    super();
  }

  pipe(dest, opts) {
    const source = this;
    const onData = (chunk) => {
      const canWrite = dest.write(chunk);
      if (canWrite === false && source.pause) source.pause();
    };
    source.on('data', onData);

    const onDrain = () => { if (source.resume) source.resume(); };
    dest.on('drain', onDrain);

    const onEnd = () => {
      if (!opts || opts.end !== false) dest.end();
    };
    source.on('end', onEnd);

    const onError = (err) => {
      cleanup();
      if (this.listenerCount('error') === 0) throw err;
    };
    source.on('error', onError);
    dest.on('error', onError);

    const onClose = () => { cleanup(); };
    source.on('close', onClose);
    dest.on('close', onClose);

    function cleanup() {
      source.removeListener('data', onData);
      dest.removeListener('drain', onDrain);
      source.removeListener('end', onEnd);
      source.removeListener('error', onError);
      dest.removeListener('error', onError);
      source.removeListener('close', onClose);
      dest.removeListener('close', onClose);
    }

    dest.emit('pipe', source);
    return dest;
  }
}

class Readable extends Stream {
  constructor(opts) {
    super(opts);
    this._readableState = {
      buffer: [],
      flowing: null,
      ended: false,
      endEmitted: false,
      destroyed: false,
      objectMode: !!(opts && opts.objectMode),
      highWaterMark: (opts && opts.highWaterMark != null) ? opts.highWaterMark : 16384,
      reading: false,
      pipes: [],
      encoding: null,
    };
    if (opts && typeof opts.read === 'function') this._read = opts.read;
    if (opts && typeof opts.destroy === 'function') this._destroy = opts.destroy;
  }

  _read(n) {}

  push(chunk) {
    const state = this._readableState;
    if (state.destroyed) return false;
    if (chunk === null) {
      state.ended = true;
      if (state.flowing) {
        this._emitEnd();
      } else if (state.buffer.length === 0) {
        this.emit('readable');
      }
      return false;
    }
    state.buffer.push(chunk);
    if (state.flowing) {
      this._flowBuffer();
    } else {
      this.emit('readable');
    }
    return state.buffer.length < state.highWaterMark;
  }

  _flowBuffer() {
    const state = this._readableState;
    while (state.flowing && state.buffer.length > 0) {
      const chunk = state.buffer.shift();
      this.emit('data', chunk);
      // data listener might have called pause()
    }
    if (state.ended && state.buffer.length === 0) {
      this._emitEnd();
    }
  }

  _emitEnd() {
    const state = this._readableState;
    if (state.endEmitted) return;
    state.endEmitted = true;
    this.emit('end');
    this.emit('close');
  }

  _startReading() {
    const state = this._readableState;
    if (!state.reading && !state.ended && !state.destroyed) {
      state.reading = true;
      this._read(state.highWaterMark);
      state.reading = false;
    }
  }

  read(n) {
    const state = this._readableState;
    if (state.buffer.length === 0 && !state.ended) {
      this._startReading();
    }
    if (state.buffer.length === 0) {
      return state.ended ? null : null;
    }
    return state.buffer.shift();
  }

  setEncoding(enc) {
    this._readableState.encoding = enc;
    return this;
  }

  on(event, listener) {
    const result = super.on(event, listener);
    if (event === 'data') {
      // Adding a data listener switches to flowing mode (deferred like Node.js)
      if (this._readableState.flowing !== false) {
        const self = this;
        Promise.resolve().then(() => self.resume());
      }
    }
    return result;
  }

  pause() {
    this._readableState.flowing = false;
    return this;
  }

  resume() {
    const state = this._readableState;
    if (!state.flowing) {
      state.flowing = true;
      this._flow();
    }
    return this;
  }

  _flow() {
    const state = this._readableState;
    // Drain buffer first
    this._flowBuffer();
    // If not ended and not destroyed, ask for more data
    if (!state.ended && !state.destroyed) {
      this._startReading();
    }
  }

  pipe(dest, opts) {
    const state = this._readableState;
    state.pipes.push(dest);
    const result = Stream.prototype.pipe.call(this, dest, opts);
    this.resume();
    return result;
  }

  unpipe(dest) {
    const state = this._readableState;
    if (dest) {
      const idx = state.pipes.indexOf(dest);
      if (idx !== -1) state.pipes.splice(idx, 1);
    } else {
      state.pipes.length = 0;
    }
    return this;
  }

  destroy(err) {
    const state = this._readableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (this._destroy) {
      this._destroy(err, (e) => {
        if (e) this.emit('error', e);
        this.emit('close');
      });
    } else {
      if (err) this.emit('error', err);
      this.emit('close');
    }
    return this;
  }

  [Symbol.asyncIterator]() {
    const stream = this;
    const buffer = [];
    let resolve = null;
    let done = false;
    let error = null;

    stream.on('data', (chunk) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    });
    stream.on('end', () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined, done: true });
      }
    });
    stream.on('error', (err) => {
      error = err;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(Promise.reject(err));
      }
    });

    stream.resume();

    return {
      next() {
        if (error) return Promise.reject(error);
        if (buffer.length > 0) {
          return Promise.resolve({ value: buffer.shift(), done: false });
        }
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => { resolve = r; });
      },
      return() {
        stream.destroy();
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() { return this; }
    };
  }
}

// Static from() helper
Readable.from = function(iterable, opts) {
  const readable = new Readable(Object.assign({}, opts, {
    read() {}
  }));
  (async () => {
    try {
      for await (const chunk of iterable) {
        readable.push(chunk);
      }
      readable.push(null);
    } catch (err) {
      readable.destroy(err);
    }
  })();
  return readable;
};

class Writable extends Stream {
  constructor(opts) {
    super(opts);
    this._writableState = {
      ended: false,
      finished: false,
      destroyed: false,
      objectMode: !!(opts && opts.objectMode),
      highWaterMark: (opts && opts.highWaterMark != null) ? opts.highWaterMark : 16384,
      writing: false,
      buffered: [],
      corked: 0,
      needDrain: false,
    };
    if (opts && typeof opts.write === 'function') this._write = opts.write;
    if (opts && typeof opts.final === 'function') this._final = opts.final;
    if (opts && typeof opts.destroy === 'function') this._destroy = opts.destroy;
  }

  _write(chunk, encoding, cb) {
    cb();
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = 'utf8'; }
    if (!cb) cb = () => {};
    const state = this._writableState;
    if (state.ended) {
      const err = new Error('write after end');
      if (cb) cb(err);
      this.emit('error', err);
      return false;
    }
    state.writing = true;
    this._write(chunk, encoding || 'utf8', (err) => {
      state.writing = false;
      if (err) {
        if (cb) cb(err);
        this.emit('error', err);
        return;
      }
      if (cb) cb();
      if (state.needDrain) {
        state.needDrain = false;
        this.emit('drain');
      }
      if (state.buffered.length > 0) {
        const next = state.buffered.shift();
        this._write(next.chunk, next.encoding, next.cb);
      }
    });
    return true;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    const state = this._writableState;
    if (state.ended) return this;

    const finish = () => {
      state.ended = true;
      const doFinish = () => {
        state.finished = true;
        this.emit('finish');
        this.emit('close');
        if (cb) cb();
      };
      if (this._final) {
        this._final((err) => {
          if (err) {
            this.emit('error', err);
            if (cb) cb(err);
            return;
          }
          doFinish();
        });
      } else {
        doFinish();
      }
    };

    if (chunk != null) {
      this.write(chunk, encoding, () => finish());
    } else {
      finish();
    }
    return this;
  }

  destroy(err) {
    const state = this._writableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (this._destroy) {
      this._destroy(err, (e) => {
        if (e) this.emit('error', e);
        this.emit('close');
      });
    } else {
      if (err) this.emit('error', err);
      this.emit('close');
    }
    return this;
  }

  cork() { this._writableState.corked++; }
  uncork() { if (this._writableState.corked > 0) this._writableState.corked--; }
}

class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    // Mixin writable state
    this._writableState = {
      ended: false,
      finished: false,
      destroyed: false,
      objectMode: !!(opts && opts.objectMode),
      highWaterMark: (opts && opts.highWaterMark != null) ? opts.highWaterMark : 16384,
      writing: false,
      buffered: [],
      corked: 0,
      needDrain: false,
    };
    if (opts && typeof opts.write === 'function') this._write = opts.write;
    if (opts && typeof opts.final === 'function') this._final = opts.final;
  }
}
// Mix in Writable methods
Duplex.prototype._write = Writable.prototype._write;
Duplex.prototype.write = Writable.prototype.write;
Duplex.prototype.end = Writable.prototype.end;
Duplex.prototype.cork = Writable.prototype.cork;
Duplex.prototype.uncork = Writable.prototype.uncork;

class Transform extends Duplex {
  constructor(opts) {
    super(opts);
    if (opts && typeof opts.transform === 'function') this._transform = opts.transform;
    if (opts && typeof opts.flush === 'function') this._flush = opts.flush;

    // Override _write to route through _transform
    this._write = (chunk, encoding, cb) => {
      this._transform(chunk, encoding, (err, data) => {
        if (err) { cb(err); return; }
        if (data != null) this.push(data);
        cb();
      });
    };

    // Override _final to flush
    this._final = (cb) => {
      if (this._flush) {
        this._flush((err, data) => {
          if (err) { cb(err); return; }
          if (data != null) this.push(data);
          this.push(null);
          cb();
        });
      } else {
        this.push(null);
        cb();
      }
    };
  }

  _transform(chunk, encoding, cb) {
    cb(null, chunk);
  }
}

class PassThrough extends Transform {
  constructor(opts) {
    super(Object.assign({}, opts, {
      transform(chunk, encoding, cb) { cb(null, chunk); }
    }));
  }
}

function pipeline(...args) {
  let cb;
  if (typeof args[args.length - 1] === 'function') {
    cb = args.pop();
  }
  const streams = args.flat();
  if (streams.length < 2) {
    const err = new Error('pipeline requires at least 2 streams');
    if (cb) { cb(err); return streams[0]; }
    throw err;
  }

  let error;
  let finished = false;
  const destroyAll = (err) => {
    if (error) return;
    error = err;
    for (const s of streams) {
      if (typeof s.destroy === 'function') s.destroy(err);
    }
  };

  const last = streams[streams.length - 1];

  // Register listeners BEFORE piping to avoid missing synchronous completions
  for (const s of streams) {
    s.on('error', destroyAll);
  }
  last.on('finish', () => { if (cb && !error && !finished) { finished = true; cb(); } });
  last.on('close', () => { if (cb && error && !finished) { finished = true; cb(error); } });

  for (let i = 0; i < streams.length - 1; i++) {
    streams[i].pipe(streams[i + 1]);
  }

  return last;
}

function finished(stream, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }

  const onFinish = () => { cleanup(); if (cb) cb(); };
  const onEnd = () => { cleanup(); if (cb) cb(); };
  const onError = (err) => { cleanup(); if (cb) cb(err); };
  const onClose = () => {
    cleanup();
    if (cb) cb();
  };

  stream.on('finish', onFinish);
  stream.on('end', onEnd);
  stream.on('error', onError);
  stream.on('close', onClose);

  function cleanup() {
    stream.removeListener('finish', onFinish);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
  }

  return cleanup;
}

export default { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
export { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
`;

const STREAM_PROMISES_MODULE = `
import { pipeline as _pipeline, finished as _finished } from 'node:stream';

export function pipeline(...streams) {
  return new Promise((resolve, reject) => {
    _pipeline(...streams, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function finished(stream, opts) {
  return new Promise((resolve, reject) => {
    _finished(stream, opts || {}, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export default { pipeline, finished };
`;

const PROCESS_MODULE = `
export default globalThis.process;
export const env = globalThis.process.env;
export const cwd = globalThis.process.cwd;
`;

/**
 * Registry mapping normalized module names to ESM source code.
 */
export const BUILTIN_MODULES: Record<string, string> = {
  crypto: CRYPTO_MODULE,
  events: EVENTS_MODULE,
  stream: STREAM_MODULE,
  "stream/promises": STREAM_PROMISES_MODULE,
  process: PROCESS_MODULE,
};

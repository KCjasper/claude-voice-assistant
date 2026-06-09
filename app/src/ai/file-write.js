'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_HASH_MAX_BYTES = 5 * 1024 * 1024;

function resultError(code, error, details = {}) {
  return { ok: false, code, error, ...details };
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function fileMetadata(filePath, fsImpl = fs, hashMaxBytes = DEFAULT_HASH_MAX_BYTES) {
  const stat = fsImpl.statSync(filePath);
  return {
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: stat.size <= hashMaxBytes
      ? crypto.createHash('sha256').update(fsImpl.readFileSync(filePath)).digest('hex')
      : null,
  };
}

function nearestExistingAncestor(candidate, fsImpl = fs) {
  let current = candidate;
  while (!fsImpl.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function resolveWritableTarget(rootPath, requestedPath, fsImpl = fs) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw Object.assign(new Error('A non-empty file path is required.'), {
      code: 'WRITE_INVALID_PATH',
    });
  }
  if (path.isAbsolute(requestedPath)) {
    throw Object.assign(new Error('write_file accepts workspace-relative paths only.'), {
      code: 'WRITE_INVALID_PATH',
    });
  }
  if (process.platform === 'win32' && requestedPath.includes(':')) {
    throw Object.assign(new Error('Windows alternate data stream paths are not allowed.'), {
      code: 'WRITE_INVALID_PATH',
    });
  }

  const root = path.resolve(rootPath);
  const rootReal = fsImpl.realpathSync(root);
  const lexicalTarget = path.resolve(root, requestedPath);
  if (!isInsideRoot(root, lexicalTarget) || lexicalTarget === root) {
    throw Object.assign(new Error('The target path is outside the workspace.'), {
      code: 'WRITE_PATH_OUTSIDE_WORKSPACE',
    });
  }

  const lexicalParent = path.dirname(lexicalTarget);
  const ancestor = nearestExistingAncestor(lexicalParent, fsImpl);
  const ancestorReal = fsImpl.realpathSync(ancestor);
  if (!isInsideRoot(rootReal, ancestorReal)) {
    throw Object.assign(new Error('The target parent resolves outside the workspace.'), {
      code: 'WRITE_PATH_OUTSIDE_WORKSPACE',
    });
  }

  fsImpl.mkdirSync(lexicalParent, { recursive: true });
  const parentReal = fsImpl.realpathSync(lexicalParent);
  if (!isInsideRoot(rootReal, parentReal)) {
    throw Object.assign(new Error('The target parent resolves outside the workspace.'), {
      code: 'WRITE_PATH_OUTSIDE_WORKSPACE',
    });
  }

  return path.join(parentReal, path.basename(lexicalTarget));
}

function atomicReplace(target, content, {
  fsImpl = fs,
  renameImpl = fs.renameSync,
  mode = 0o666,
} = {}) {
  const tempPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  let handle;

  try {
    handle = fsImpl.openSync(tempPath, 'wx', mode);
    fsImpl.writeFileSync(handle, content, 'utf8');
    fsImpl.fsyncSync(handle);
    fsImpl.closeSync(handle);
    handle = undefined;
    renameImpl(tempPath, target);
  } catch (error) {
    if (handle !== undefined) {
      try { fsImpl.closeSync(handle); } catch {}
    }
    try { fsImpl.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function writeFile(rootPath, args = {}, opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  if (typeof args.content !== 'string') {
    return resultError('WRITE_INVALID_CONTENT', 'File content must be a string.');
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const bytes = Buffer.byteLength(args.content, 'utf8');
  if (bytes > maxBytes) {
    return resultError(
      'WRITE_TOO_LARGE',
      `File content exceeds the ${maxBytes} byte limit.`,
      { bytes, maxBytes }
    );
  }

  let target;
  try {
    target = resolveWritableTarget(rootPath, args.path, fsImpl);
  } catch (error) {
    return resultError(error.code || 'WRITE_INVALID_PATH', error.message);
  }

  let existing = null;
  let mode = 0o666;
  try {
    if (fsImpl.existsSync(target)) {
      const lstat = fsImpl.lstatSync(target);
      if (lstat.isSymbolicLink()) {
        return resultError('WRITE_SYMLINK_BLOCKED', 'Writing through a symbolic link is not allowed.', {
          path: args.path,
        });
      }
      if (!lstat.isFile()) {
        return resultError('WRITE_TARGET_NOT_FILE', 'The target exists and is not a regular file.', {
          path: args.path,
        });
      }

      existing = fileMetadata(target, fsImpl);
      mode = lstat.mode & 0o777;
      if (args.overwrite !== true) {
        return resultError(
          'WRITE_CONFLICT',
          'The target already exists. Retry with overwrite=true only after confirming replacement.',
          {
            path: args.path,
            requiresOverwrite: true,
            existing,
          }
        );
      }
    }
  } catch (error) {
    return resultError('WRITE_INSPECTION_FAILED', 'The target could not be inspected safely.', {
      path: args.path,
      cause: error.message,
    });
  }

  try {
    atomicReplace(target, args.content, {
      fsImpl,
      renameImpl: opts.renameImpl || fsImpl.renameSync.bind(fsImpl),
      mode,
    });
  } catch (error) {
    return resultError('WRITE_FAILED', 'The file could not be written atomically.', {
      path: args.path,
      cause: error.message,
    });
  }

  let modifiedAt = null;
  try { modifiedAt = fsImpl.statSync(target).mtime.toISOString(); } catch {}
  const written = {
    size: bytes,
    modifiedAt,
    sha256: crypto.createHash('sha256').update(args.content, 'utf8').digest('hex'),
  };
  return {
    ok: true,
    code: existing ? 'WRITE_OVERWRITTEN' : 'WRITE_CREATED',
    path: args.path,
    bytes,
    overwritten: Boolean(existing),
    previous: existing,
    written,
  };
}

module.exports = {
  DEFAULT_HASH_MAX_BYTES,
  DEFAULT_MAX_BYTES,
  atomicReplace,
  resolveWritableTarget,
  writeFile,
};

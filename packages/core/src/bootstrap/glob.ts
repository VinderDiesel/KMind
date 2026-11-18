/**
 * Minimal gitignore-style glob matcher for bootstrap rules (no extra deps).
 * Supports `*`, `**`, and `?`. Case-sensitive on path segments.
 */
export function matchPathGlob(glob: string, filePath: string): boolean {
  const pattern = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  const target = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const re = globToRegExp(pattern);
  return re.test(target);
}

function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += '$';
  return new RegExp(out);
}

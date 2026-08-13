export interface PccDiff {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: any;
  oldValue?: any;
}

export function detectDrift(expected: any, actual: any, path = ''): PccDiff[] {
  const diffs: PccDiff[] = [];

  if (expected === actual) return diffs;

  // Handle nulls / undefineds
  if (expected === null || expected === undefined || actual === null || actual === undefined) {
    diffs.push({
      op: 'replace',
      path,
      value: actual,
      oldValue: expected
    });
    return diffs;
  }

  // Handle primitives
  if (typeof expected !== 'object' || typeof actual !== 'object') {
    diffs.push({
      op: 'replace',
      path: path || '/',
      value: actual,
      oldValue: expected
    });
    return diffs;
  }

  // Handle Arrays
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push({
        op: 'replace',
        path: path || '/',
        value: actual,
        oldValue: expected
      });
      return diffs;
    }
    for (let i = 0; i < expected.length; i++) {
      diffs.push(...detectDrift(expected[i], actual[i], `${path}/${i}`));
    }
    return diffs;
  }

  // If one is array and other is object
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    diffs.push({
      op: 'replace',
      path: path || '/',
      value: actual,
      oldValue: expected
    });
    return diffs;
  }

  // Handle Objects
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);

  // Missing keys (expected but not in actual)
  for (const key of expectedKeys) {
    const currentPath = path ? `${path}/${key}` : `/${key}`;
    if (!(key in actual)) {
      diffs.push({
        op: 'remove',
        path: currentPath,
        oldValue: expected[key]
      });
    } else {
      diffs.push(...detectDrift(expected[key], actual[key], currentPath));
    }
  }

  // Extra keys (actual but not expected)
  for (const key of actualKeys) {
    if (!(key in expected)) {
      const currentPath = path ? `${path}/${key}` : `/${key}`;
      diffs.push({
        op: 'add',
        path: currentPath,
        value: actual[key]
      });
    }
  }

  return diffs;
}

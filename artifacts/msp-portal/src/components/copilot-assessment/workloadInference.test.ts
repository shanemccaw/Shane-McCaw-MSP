/**
 * workloadInference.test.ts — #270 (Copilot Assessment epic #183).
 *
 * What this pins down is the thing #270 exists to fix: before it, EVERY
 * customer's draftingLoad/researchLoad/communicationLoad/repetitiveLoad were
 * hardcoded to 0.5, so every customer got the identical ROI score and the
 * identical "Workload loads" line in the use-case generation prompt. So the
 * assertions here are about real VARIATION between real answer sets, plus the
 * catalog-coverage guarantee that stops a future use case scoring as nothing.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  inferWorkloadMix,
  USE_CASE_WORKLOAD,
  WORKLOAD_DIMENSIONS,
  allCatalogUseCaseIds,
  type WorkloadMix,
} from './workloadInference.ts';
import { ADAPTIVE_USE_CASES } from './quizCatalog.ts';

/** The four loads, strongest first — what actually differentiates two customers. */
function ranked(mix: WorkloadMix): string[] {
  return (
    [
      ['drafting', mix.draftingLoad],
      ['research', mix.researchLoad],
      ['communication', mix.communicationLoad],
      ['repetitive', mix.repetitiveLoad],
    ] as [string, number][]
  )
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function values(mix: WorkloadMix): number[] {
  return [mix.draftingLoad, mix.researchLoad, mix.communicationLoad, mix.repetitiveLoad];
}

describe('the use-case categorisation covers the real catalog (#270)', () => {
  it('every use case the quiz can offer has a workload category', () => {
    const missing = allCatalogUseCaseIds().filter((id) => !USE_CASE_WORKLOAD[id]);
    assert.deepEqual(missing, [], `use cases with no workload category: ${missing.join(', ')}`);
  });

  it('has no category entries for use cases that no longer exist', () => {
    const real = new Set(allCatalogUseCaseIds());
    const orphans = Object.keys(USE_CASE_WORKLOAD).filter((id) => !real.has(id));
    assert.deepEqual(orphans, [], `categorised ids missing from the catalog: ${orphans.join(', ')}`);
  });

  it('every entry names a real dimension, primary first', () => {
    for (const [id, dims] of Object.entries(USE_CASE_WORKLOAD)) {
      assert.ok(dims.length >= 1 && dims.length <= 2, `${id}: expected 1-2 dimensions, got ${dims.length}`);
      dims.forEach((d) => assert.ok(WORKLOAD_DIMENSIONS.includes(d), `${id}: unknown dimension ${d}`));
      if (dims.length === 2) assert.notEqual(dims[0], dims[1], `${id}: secondary duplicates the primary`);
    }
  });

  it('spreads across all four dimensions rather than collapsing onto one', () => {
    // A categorisation that put ~everything in "drafting" would technically pass
    // the coverage test above while making the inference useless.
    const primaries = Object.values(USE_CASE_WORKLOAD).map((d) => d[0]);
    WORKLOAD_DIMENSIONS.forEach((dim) => {
      const share = primaries.filter((p) => p === dim).length / primaries.length;
      assert.ok(share > 0.1, `only ${(share * 100).toFixed(0)}% of use cases are primarily ${dim}`);
      assert.ok(share < 0.6, `${(share * 100).toFixed(0)}% of use cases are primarily ${dim} — too concentrated`);
    });
  });
});

// ── Two REAL answer sets, both buildable in the live quiz ─────────────────────
// Space industry: a research scientist who picked synthesis/analysis work, vs a
// program manager who picked status reporting and public briefings. Every id
// below is a real ADAPTIVE_USE_CASES['space'] / ADAPTIVE_PERSONAS['space'] id.

const RESEARCH_HEAVY = {
  industry: 'space',
  personaIds: ['scientist', 'data_scientist'],
  useCaseIds: ['lit_synthesis_space', 'telemetry_pattern', 'mission_log_synth'],
  role: 'Research Scientist',
  department: 'Science & Research',
  workflowStyle: 'unstructured' as const,
};

const OPERATIONS_HEAVY = {
  industry: 'space',
  personaIds: ['prog_mgr', 'comms_spec'],
  useCaseIds: ['agency_status_reports', 'traceability_matrix', 'mission_briefings'],
  role: 'Program Administrator',
  department: 'Program & Administration',
  workflowStyle: 'structured' as const,
};

describe('real answers produce real, varied workload weights (#270)', () => {
  it('a research-led answer set is research-dominant', () => {
    const mix = inferWorkloadMix(RESEARCH_HEAVY);
    assert.equal(ranked(mix)[0], 'research', `expected research to lead, got ${JSON.stringify(mix)}`);
  });

  it('an operations-led answer set is repetitive-dominant, not research-dominant', () => {
    const mix = inferWorkloadMix(OPERATIONS_HEAVY);
    assert.equal(ranked(mix)[0], 'repetitive', `expected repetitive to lead, got ${JSON.stringify(mix)}`);
    assert.notEqual(ranked(mix)[0], 'research');
  });

  it('the two answer sets genuinely differ — the whole point of #270', () => {
    const a = inferWorkloadMix(RESEARCH_HEAVY);
    const b = inferWorkloadMix(OPERATIONS_HEAVY);
    assert.notDeepEqual(values(a), values(b));

    // And they differ by a margin that survives the ROI weighting, rather than
    // technically-different-in-the-third-decimal.
    const biggestGap = Math.max(...values(a).map((v, i) => Math.abs(v - values(b)[i])));
    assert.ok(biggestGap > 0.15, `largest per-dimension gap was only ${biggestGap.toFixed(2)}`);
  });

  it('no longer returns the flat 0.5 that made every customer identical', () => {
    [RESEARCH_HEAVY, OPERATIONS_HEAVY].forEach((input) => {
      const vals = values(inferWorkloadMix(input));
      assert.notDeepEqual(vals, [0.5, 0.5, 0.5, 0.5]);
      assert.ok(new Set(vals).size > 1, `all four loads came back equal: ${vals.join(', ')}`);
    });
  });

  it('stays inside 0-1, and never bottoms out at a hard zero', () => {
    [RESEARCH_HEAVY, OPERATIONS_HEAVY].forEach((input) => {
      values(inferWorkloadMix(input)).forEach((v) => {
        assert.ok(v > 0, `a zero load would tell the use-case generator to refuse a whole category`);
        assert.ok(v <= 1, `load out of range: ${v}`);
      });
    });
  });
});

describe('missing answers degrade honestly rather than collapsing to neutral (#270)', () => {
  it('workflow style alone still separates two customers', () => {
    // The minimum a completed quiz can carry into this: no personas, no use
    // cases resolved, unreadable role text. Workflow structure is a required
    // single-select, so there is always at least one real signal.
    const bare = { industry: 'space', personaIds: [], useCaseIds: [], role: '', department: '' };
    const structured = inferWorkloadMix({ ...bare, workflowStyle: 'structured' });
    const unstructured = inferWorkloadMix({ ...bare, workflowStyle: 'unstructured' });

    assert.notDeepEqual(values(structured), values(unstructured));
    assert.ok(structured.repetitiveLoad > unstructured.repetitiveLoad);
    assert.ok(unstructured.researchLoad > structured.researchLoad);
  });

  it('an unrecognised use-case id contributes nothing instead of throwing', () => {
    const withGarbage = inferWorkloadMix({ ...RESEARCH_HEAVY, useCaseIds: ['not_a_real_use_case'] });
    values(withGarbage).forEach((v) => assert.ok(Number.isFinite(v)));
  });

  it('dropping the persona answer changes the result rather than being ignored', () => {
    const withPersonas = inferWorkloadMix(OPERATIONS_HEAVY);
    const without = inferWorkloadMix({ ...OPERATIONS_HEAVY, personaIds: [] });
    assert.notDeepEqual(values(withPersonas), values(without));
  });
});

describe('the categorisation resolves against every industry catalog (#270)', () => {
  it('no industry scores on a single dimension alone', () => {
    // Guards the failure mode where an industry's whole catalog lands in one
    // dimension, which would leave the use-case signal unable to tell two
    // customers in that industry apart at all.
    //
    // Primary AND secondary count, because both contribute points. Some
    // industries genuinely are primary-dominated — the six 'technology' use
    // cases are all primarily drafting, because engineering documentation work
    // honestly is — and that is left alone rather than re-labelled to satisfy
    // a test.
    for (const [industry, tiles] of Object.entries(ADAPTIVE_USE_CASES)) {
      const dims = new Set(tiles.flatMap((t) => USE_CASE_WORKLOAD[t.id] ?? []));
      assert.ok(dims.size >= 2, `${industry}: every use case scores only ${[...dims][0]}`);
    }
  });
});

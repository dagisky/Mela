const proofAuditTool = {
  name: 'proof_audit',
  description: 'Run a deterministic proof-audit checklist over a proposed mathematical argument.',
  inputSchema: {
    type: 'object',
    properties: {
      problem: {
        type: 'string',
        description: 'Problem statement or theorem being proved.',
      },
      proof: {
        type: 'string',
        description: 'Proposed proof or mathematical argument.',
      },
      claimed_status: {
        type: 'string',
        description: 'Claimed status, such as proof, counterexample, reduction, or partial progress.',
      },
    },
    required: ['problem', 'proof'],
    additionalProperties: false,
  },
  timeoutMs: 5000,
  maxResultSizeBytes: 12000,
  concurrencySafe: true,
  display: {
    name: 'Proof Audit',
    activity() {
      return 'Auditing proof';
    },
    result(output: { verdict?: string }) {
      return `Proof audit verdict: ${output.verdict ?? 'unknown'}`;
    },
  },
  validateInput(input: unknown) {
    if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
    if (typeof input.problem !== 'string' || input.problem.trim().length === 0) {
      return { ok: false, message: 'problem is required.' };
    }
    if (typeof input.proof !== 'string' || input.proof.trim().length === 0) {
      return { ok: false, message: 'proof is required.' };
    }
    return {
      ok: true,
      value: {
        problem: input.problem.trim(),
        proof: input.proof.trim(),
        claimedStatus: typeof input.claimed_status === 'string' ? input.claimed_status.trim() : 'unspecified',
      },
    };
  },
  async checkPermissions() {
    return { decision: 'allow' as const };
  },
  async execute(input: { problem: string; proof: string; claimedStatus: string }) {
    const warnings = audit(input.problem, input.proof);
    return {
      ok: true as const,
      output: {
        claimedStatus: input.claimedStatus,
        verdict: warnings.some((warning) => warning.severity === 'critical') ? 'reject' : warnings.length > 0 ? 'review' : 'passes_basic_checklist',
        warnings,
        checklist: [
          'Definitions stated or clearly referenced',
          'Quantifiers and hypotheses tracked',
          'Nontrivial lemmas justified',
          'Boundary cases considered',
          'Citations verified if used',
          'Conclusion matches the problem',
        ],
      },
    };
  },
  mapResultToModel: mapResultToModel,
};

function audit(problem: string, proof: string) {
  const combined = `${problem}\n${proof}`.toLowerCase();
  const warnings: Array<{ severity: 'info' | 'warning' | 'critical'; message: string }> = [];

  if (proof.length < 500) {
    warnings.push({ severity: 'warning', message: 'The argument is short for a research-level proof; check for compressed or missing steps.' });
  }
  if (/\bclearly\b|\bobvious\b|\btrivial\b|\beasy to see\b/.test(combined)) {
    warnings.push({ severity: 'warning', message: 'The proof uses words that often hide nontrivial steps.' });
  }
  if (/\bstandard\b|\bwell-known\b|\bclassical\b/.test(combined) && !/\b(source|citation|reference|theorem|lemma)\b/.test(combined)) {
    warnings.push({ severity: 'warning', message: 'A standard result appears to be invoked without an identifiable source or theorem statement.' });
  }
  if (/\bfor all\b|\bevery\b|\balways\b/.test(problem.toLowerCase()) && !/\barbitrary\b|\blet\b|\bfix\b/.test(proof.toLowerCase())) {
    warnings.push({ severity: 'warning', message: 'The problem has universal quantification; verify the proof fixes an arbitrary object with all hypotheses.' });
  }
  if (/\bexcept\b|\bnonzero\b|\bpositive\b|\bcompact\b|\bsmooth\b|\bfinite\b/.test(problem.toLowerCase()) && !/\bcase\b|\bassume\b|\bhypothes/.test(proof.toLowerCase())) {
    warnings.push({ severity: 'warning', message: 'The problem contains restrictive hypotheses; verify each one is used or explained.' });
  }
  if (/\btherefore\b|\bhence\b|\bthus\b/.test(proof.toLowerCase()) === false) {
    warnings.push({ severity: 'warning', message: 'The proof has no explicit conclusion marker; check that the final statement proves the requested claim.' });
  }
  if (/\bconjecture\b|\bseems\b|\bprobably\b|\bplausible\b|\bheuristic\b/.test(proof.toLowerCase())) {
    warnings.push({ severity: 'critical', message: 'The proof contains speculative language and should not be marked verified.' });
  }
  if (/\bcite\b|\breference\b|\barxiv\b|\btheorem [0-9]/.test(proof.toLowerCase()) && !/\bverified\b|\bchecked\b|\bsource\b/.test(proof.toLowerCase())) {
    warnings.push({ severity: 'warning', message: 'Citation-like support appears; verify the cited source actually contains the claimed result.' });
  }

  return warnings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapResultToModel(result: { ok: boolean; output?: unknown; errorCode?: string; message?: string }, toolCallId: string) {
  if (!result.ok) {
    return {
      toolCallId,
      content: JSON.stringify({ ok: false, errorCode: result.errorCode, message: result.message }),
      isError: true,
      errorCode: result.errorCode,
    };
  }
  return { toolCallId, content: JSON.stringify({ ok: true, output: result.output }) };
}

export default proofAuditTool;

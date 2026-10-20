/**
 * When to ask, and when to get out of the way.
 *
 * The app is the agency's software, not their regulator. Nothing here decides
 * whether the agency may produce their own paperwork: that is their decision, and
 * their business. What the app does is put the facts in front of them once, and
 * record that they chose to carry on.
 *
 *   relaxed  — nothing blocks. If something looks wrong, ask before generating.
 *   strict   — refuse to generate while an error stands. For anyone who wants the
 *              guardrail switched on.
 *
 * The default is relaxed, which is also the honest default: we know their process
 * better than we know their circumstances.
 */

import type { ComplianceReport, Finding } from './compliance.ts';

export type ReviewMode = 'relaxed' | 'strict';

export const REVIEW_MODES: readonly ReviewMode[] = ['relaxed', 'strict'];

export type ReviewGate = {
  mode: ReviewMode;
  /** May the documents be produced at all? Always true in relaxed mode. */
  canGenerate: boolean;
  /** Should the agent ask before carrying on? */
  needsConfirmation: boolean;
  /** What to put in front of them — the findings worth mentioning. */
  outstanding: Finding[];
  /** One sentence the assistant can use as-is. */
  message: string;
};

export function reviewGate(report: ComplianceReport, mode: ReviewMode): ReviewGate {
  const outstanding = report.findings.filter((finding) => finding.severity === 'error');
  const count = outstanding.length;

  if (count === 0) {
    return {
      mode,
      canGenerate: true,
      needsConfirmation: false,
      outstanding: [],
      message: 'Nothing to flag.',
    };
  }

  const listed = `${count} thing${count === 1 ? '' : 's'}`;

  if (mode === 'strict') {
    return {
      mode,
      canGenerate: false,
      needsConfirmation: true,
      outstanding,
      message: `Strict mode is on, so generation is held until ${listed} ${count === 1 ? 'is' : 'are'} resolved.`,
    };
  }

  return {
    mode,
    canGenerate: true,
    needsConfirmation: true,
    outstanding,
    message: `${listed} still worth fixing. They do not stop anything — say what they are and ask whether to carry on.`,
  };
}

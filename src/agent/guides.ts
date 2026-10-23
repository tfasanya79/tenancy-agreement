/**
 * What to offer the person in front of this pack, and what counts as done.
 *
 * The Assistant tab used to open with a greeting and four fixed chips, identical for an
 * empty pack and for one that is a download away from finished. A static menu is a
 * toolbar in a chat's clothes; what is useful is the *next thing*, ranked by what is
 * actually true of this pack.
 *
 * Two rules hold the design together:
 *
 *   - **Ranking is computed from the pack, not from the model.** Everything below reads
 *     facts the app already has, so the screen is free to draw and the order is testable.
 *   - **Done is verified, never claimed.** Each step has a predicate over the pack. A
 *     guide cannot tick a step because a sentence said so, which is what keeps a legal
 *     document flow away from a model's memory of the conversation.
 *
 * The model is used inside the steps that need language — reading a pasted email, writing
 * the tenant's message — and nowhere else.
 */

/** Everything the ranking and the steps are allowed to look at. Read from the pack. */
export type GuideFacts = {
  /** A named tenant exists: something has been entered or extracted. */
  hasTenant: boolean;
  /** Field keys still needed before the agreement can be produced. */
  missing: string[];
  /** Error-severity compliance findings. */
  errors: number;
  /** Warnings worth a look, but not blocking. */
  warnings: number;
  /** Documents produced for this pack. */
  documents: number;
  /** How many the registry suggests for a move-in. */
  suggested: number;
  /** A covering message has been drafted and saved. */
  hasCoverMessage: boolean;
  /** Uploads of the agency's own documents, and how many have a mapping. */
  uploads: number;
  mappedUploads: number;
  /** A landlord only reads, so the guides that write are not theirs. */
  isLandlord: boolean;
};

export type GuideStep = {
  id: string;
  title: string;
  /** One line: what happens when they press it. */
  what: string;
  /** True when this step needs a model call. */
  usesModel: boolean;
  /** Where an agent would do it themselves, if they would rather. */
  where?: string;
  done: (facts: GuideFacts) => boolean;
};

export type Guide = {
  id: string;
  title: string;
  /** Why this is being offered now, in the app's own voice. */
  why: (facts: GuideFacts) => string;
  /** Lower runs first when several apply. */
  rank: number;
  when: (facts: GuideFacts) => boolean;
  steps: GuideStep[];
  /** Guides that hand over to another when their own steps are done. */
  then?: string;
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const GUIDES: Guide[] = [
  {
    id: 'start-from-email',
    title: 'Start from the landlord’s email',
    rank: 5,
    when: (facts) => !facts.hasTenant,
    why: () => 'Paste what the landlord or the tenant sent you, and I will pull out the dates, the rent and the names.',
    steps: [
      {
        id: 'paste',
        title: 'Paste the email or the WhatsApp thread',
        what: 'I read it and record what I find — dates, rent, deposit, names, addresses.',
        usesModel: true,
        where: 'the box below',
        done: (facts) => facts.hasTenant,
      },
      {
        id: 'review',
        title: 'Check what I pulled out',
        what: 'Anything I could not find is listed as missing, with the field it belongs in.',
        usesModel: false,
        where: 'the Details tab',
        done: (facts) => facts.hasTenant && facts.missing.length === 0,
      },
    ],
    then: 'ready-to-send',
  },
  {
    id: 'ready-to-send',
    title: 'Get this pack ready to send',
    rank: 20,
    when: (facts) => facts.hasTenant,
    why: (facts) => {
      if (facts.missing.length > 0) {
        return `${plural(facts.missing.length, 'detail is', 'details are')} still needed before the agreement can be produced.`;
      }
      if (facts.errors > 0) return `${plural(facts.errors, 'item needs', 'items need')} a look before anything is generated.`;
      if (facts.documents === 0) return `${plural(facts.suggested, 'document is', 'documents are')} ready to produce in one step.`;
      return 'Everything is produced. Send it to the tenant next.';
    },
    steps: [
      {
        id: 'essentials',
        title: 'Fill in what is needed',
        what: 'The essentials the agreement cannot be written without.',
        usesModel: false,
        where: 'the Details tab',
        done: (facts) => facts.missing.length === 0,
      },
      {
        id: 'checks',
        title: 'Run the checks',
        what: 'See what is worth fixing before anything is generated. Nothing here stops you.',
        usesModel: false,
        where: 'the Checks tab',
        done: (facts) => facts.errors === 0,
      },
      {
        id: 'generate',
        title: 'Produce the documents',
        what: 'The move-in set, filled in and written to Word.',
        usesModel: false,
        where: 'the Documents tab',
        done: (facts) => facts.documents > 0,
      },
      {
        id: 'download',
        title: 'Download the pack',
        what: 'One zip: every document, plus the summary sheet.',
        usesModel: false,
        where: 'Download all (ZIP)',
        done: () => false,
      },
      {
        id: 'message',
        title: 'Write the message to the tenant',
        what: 'The covering email and a short WhatsApp message, ready to send.',
        usesModel: true,
        where: 'the Assistant, then Documents → Message to the tenant',
        done: (facts) => facts.hasCoverMessage,
      },
    ],
  },
  {
    id: 'fix-checks',
    title: 'Fix what the checks flagged',
    rank: 10,
    when: (facts) => facts.hasTenant && facts.errors > 0 && facts.missing.length === 0,
    why: (facts) => `${plural(facts.errors, 'item needs', 'items need')} a look before the pack goes out.`,
    steps: [
      {
        id: 'checks',
        title: 'See what is flagged',
        what: 'Each finding says what it is and where it came from.',
        usesModel: false,
        where: 'the Checks tab',
        done: (facts) => facts.errors === 0,
      },
    ],
  },
  {
    id: 'use-our-document',
    title: 'Use our own document',
    rank: 30,
    when: (facts) => facts.uploads === 0 || facts.mappedUploads < facts.uploads,
    why: () =>
      'Upload your own agreement or report once, and every pack fills it in from then on — your layout, your wording.',
    steps: [
      {
        id: 'upload',
        title: 'Upload your Word document',
        what: 'One .docx. It stays in your data folder.',
        usesModel: false,
        where: 'Back office → Our documents',
        done: (facts) => facts.uploads > 0,
      },
      {
        id: 'map',
        title: 'Check the mapping',
        what: 'Each value I found is shown next to the detail that fills it.',
        usesModel: false,
        where: 'Back office → Our documents',
        done: (facts) => facts.mappedUploads > 0,
      },
      {
        id: 'fill',
        title: 'Fill it for this tenant',
        what: 'Your document, produced with this tenancy’s details in place.',
        usesModel: false,
        where: 'Documents → Your own documents',
        done: () => false,
      },
    ],
  },
  {
    id: 'tenant-message',
    title: 'Write the message to the tenant',
    rank: 12,
    when: (facts) => facts.hasTenant && facts.documents > 0 && !facts.hasCoverMessage,
    why: () => 'The pack is produced. The tenant needs a short email and a WhatsApp message to go with it.',
    steps: [
      {
        id: 'message',
        title: 'Draft it',
        what: 'A subject line, the email, and a short WhatsApp message. Saved with the pack.',
        usesModel: true,
        where: 'Documents → Message to the tenant',
        done: (facts) => facts.hasCoverMessage,
      },
    ],
  },
];

/** The read-only set: a landlord writes nothing, so most of the above is not theirs. */
export const LANDLORD_GUIDES: Guide[] = [
  {
    id: 'read-the-pack',
    title: 'Read what you have been sent',
    rank: 10,
    when: () => true,
    why: (facts) =>
      facts.documents === 0
        ? 'No documents have been produced for this tenancy yet.'
        : `${plural(facts.documents, 'document', 'documents')} for this tenancy, ready to download.`,
    steps: [
      {
        id: 'download',
        title: 'Download the documents',
        what: 'One zip with everything, or open any document on its own.',
        usesModel: false,
        where: 'Documents, or Download all (ZIP)',
        done: () => false,
      },
      {
        id: 'outstanding',
        title: 'See what is still outstanding',
        what: 'Anything the agency still has to do on this tenancy.',
        usesModel: false,
        where: 'the Checks tab',
        done: (facts) => facts.errors === 0,
      },
    ],
  },
];

export type OfferedStep = {
  id: string;
  title: string;
  what: string;
  usesModel: boolean;
  where: string | null;
  done: boolean;
};

export type OfferedGuide = {
  id: string;
  title: string;
  why: string;
  steps: OfferedStep[];
  /** Index of the first step not done; `steps.length` when the guide is complete. */
  at: number;
  complete: boolean;
};

function offer(guide: Guide, facts: GuideFacts): OfferedGuide {
  const steps = guide.steps.map((step) => ({
    id: step.id,
    title: step.title,
    what: step.what,
    usesModel: step.usesModel,
    where: step.where ?? null,
    done: step.done(facts),
  }));
  const at = steps.findIndex((step) => !step.done);
  return {
    id: guide.id,
    title: guide.title,
    why: guide.why(facts),
    steps,
    at: at === -1 ? steps.length : at,
    complete: at === -1,
  };
}

/**
 * What to put in front of this person, best first.
 *
 * Guides whose conditions hold are offered in rank order; a guide already under way (some
 * steps done, not all) is pulled to the front, because "what would you like to work on?"
 * is the wrong question for somebody who is halfway through something.
 */
export function rankGuides(facts: GuideFacts): { options: OfferedGuide[]; resume: { guideId: string; step: number } | null } {
  const source = facts.isLandlord ? LANDLORD_GUIDES : GUIDES;
  const offered = source.filter((guide) => guide.when(facts)).map((guide) => offer(guide, facts));

  // Ranked by need, not by "something is half done". Almost every pack has *some* guide
  // part-finished, so promoting those would put the same card on top for ever and hide
  // what actually needs attention. A guide chosen in this session is remembered by the
  // interface instead.
  const ordered = [...offered].sort((left, right) => {
    const leftRank = source.find((guide) => guide.id === left.id)?.rank ?? 99;
    const rightRank = source.find((guide) => guide.id === right.id)?.rank ?? 99;
    return leftRank - rightRank;
  });

  const first = ordered[0];
  return {
    options: ordered,
    resume: first !== undefined && !first.complete && first.at > 0 ? { guideId: first.id, step: first.at } : null,
  };
}

/** The guide by id, for a client that resumes one it remembered. */
export function guideById(id: string): Guide | null {
  return [...GUIDES, ...LANDLORD_GUIDES].find((guide) => guide.id === id) ?? null;
}

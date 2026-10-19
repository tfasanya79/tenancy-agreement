/**
 * A small, curated knowledge base of the rules a letting agent must satisfy in
 * England & Wales.
 *
 * The AI agent can look these up instead of recalling law from its training
 * data — which is exactly the kind of thing language models get confidently
 * wrong. Each entry names its source so a human can check it.
 *
 * Last reviewed: October 2026, against the Renters' Rights Act 2025
 * implementation roadmap on GOV.UK.
 */

export type Rule = {
  id: string;
  topic: string;
  title: string;
  summary: string;
  detail: readonly string[];
  source: { label: string; url: string };
};

const GOV_UK_RRA =
  'https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector';

export const RULES: readonly Rule[] = [
  {
    id: 'tenancy-type',
    topic: 'tenancy type',
    title: 'All new private tenancies in England are assured periodic tenancies',
    summary:
      'From 1 May 2026 fixed-term assured shorthold tenancies no longer exist for new lettings in England. New and existing tenancies became assured periodic tenancies.',
    detail: [
      'There is no fixed end date: the tenancy rolls on until the tenant ends it or a court orders possession.',
      'Avoid drafting a fixed term or an "end date" for a new tenancy — it is no longer the correct model.',
      'Existing fixed-term tenancies converted, so old AST paperwork should not be reused for new lettings.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'section-21',
    topic: 'possession',
    title: 'Section 21 "no fault" notices are abolished in England',
    summary:
      'Landlords can no longer serve a section 21 notice. Possession must be sought on a section 8 ground, through the court.',
    detail: [
      'Do not use or send a section 21 notice for a tenancy in England.',
      'Section 8 grounds were reformed and expanded at the same time; notice periods vary by ground.',
      'A court order is still required before a tenant can be evicted.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'tenant-notice',
    topic: 'ending the tenancy',
    title: 'A tenant can end an assured periodic tenancy with two months’ notice',
    summary:
      'Tenants may end the tenancy by giving two months’ written notice. They can leave sooner only if the landlord agrees (a surrender).',
    detail: [
      'Put the two-month notice right in the agreement so it is unambiguous.',
      'A landlord cannot charge a fee or penalty for the tenant exercising this right.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'written-statement',
    topic: 'written statement of terms',
    title: 'The tenant must be given a written statement of terms',
    summary:
      'A written statement of the key terms of the tenancy must be provided to the tenant, and promptly — treat 28 days from the start of the tenancy as your deadline.',
    detail: [
      'It must include the parties, the rent, the rent period, the deposit and how it is protected, and the notice periods.',
      'The landlord’s name and an address in England or Wales for serving notices must appear on the agreement.',
      'Keep evidence of the date it was given.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'rent-increase',
    topic: 'rent increase',
    title: 'Rent may be increased once a year, with two months’ notice',
    summary:
      'Rent increases must follow the section 13 procedure: no more than once in any 12-month period, with at least two months’ written notice on the prescribed form.',
    detail: [
      'You cannot increase rent more than once a year, even by agreement outside the procedure.',
      'The notice must state the new rent and the date it takes effect (at least two months ahead).',
      'The tenant can challenge a proposed increase at the tribunal.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'deposit-protection',
    topic: 'deposit',
    title: 'Deposits must be protected within 30 days, with prescribed information',
    summary:
      'A tenancy deposit must be protected in a government-approved scheme within 30 days of receipt, and the tenant must be given the prescribed information for that scheme.',
    detail: [
      'Keep the certificate and the date the prescribed information was served.',
      'Failing to protect or to serve the prescribed information can expose the landlord to a penalty of up to three times the deposit and can block a possession claim.',
      'The prescribed information must be re-served if the tenancy is renewed or the deposit is re-protected.',
    ],
    source: { label: 'GOV.UK — Tenancy deposit protection guidance', url: 'https://www.gov.uk/tenancy-deposit-protection' },
  },
  {
    id: 'deposit-cap',
    topic: 'deposit',
    title: 'Deposits are capped at five weeks’ rent',
    summary:
      'Under the Tenant Fees Act 2019 a deposit is capped at five weeks’ rent where the annual rent is under £50,000, and six weeks’ rent where it is £50,000 or more.',
    detail: [
      'Weekly rent = monthly rent × 12 ÷ 52.',
      'Holding deposits are capped separately at one week’s rent and must be refunded or put towards the tenancy.',
      'A deposit above the cap is a prohibited payment, and the excess is repayable.',
    ],
    source: { label: 'GOV.UK — Tenant Fees Act 2019 guidance', url: 'https://www.gov.uk/government/collections/tenant-fees-act' },
  },
  {
    id: 'rent-in-advance',
    topic: 'rent in advance',
    title: 'No more than one month’s rent may be taken in advance',
    summary:
      'Taking more than one month’s rent in advance is no longer allowed. Rental bidding is also banned: you cannot ask for, encourage or accept more than the advertised rent.',
    detail: [
      'This applies to lettings agents as well as landlords.',
      'Both practices were banned as part of the first phase of the Renters’ Rights Act reforms.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'discrimination',
    topic: 'fair letting',
    title: 'You cannot discriminate against tenants with children or on benefits',
    summary:
      'It is illegal for a landlord or agent to do anything that makes it less likely that someone with children or in receipt of benefits will rent a property.',
    detail: [
      'This includes withholding availability, refusing a viewing, or refusing to grant a tenancy.',
      'The practical effect is that "no DSS" and "no children" policies are not acceptable.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'pets',
    topic: 'pets',
    title: 'Tenants have a right to request a pet',
    summary:
      'A landlord must consider a written request to keep a pet within 28 days and must give a valid reason in writing if refusing.',
    detail: [
      'Record requests and responses in writing.',
      'Where a pet is allowed, the agreement should say what is permitted and who is responsible for damage.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'gas-safety',
    topic: 'gas safety',
    title: 'Gas safety check before move-in and every 12 months',
    summary:
      'Every gas appliance and flue must be checked by a Gas Safe registered engineer before the tenant moves in, then at least every 12 months. The tenant must get a copy of the certificate.',
    detail: [
      'The record must be given to the tenant before they move in and within 28 days of each later check.',
      'Keep the certificate — it is needed for a possession claim.',
    ],
    source: { label: 'HSE — Gas safety in rented accommodation', url: 'https://www.hse.gov.uk/gas/domestic/landlords.htm' },
  },
  {
    id: 'eicr',
    topic: 'electrical safety',
    title: 'Electrical installation condition report every five years',
    summary:
      'The electrical installation must be inspected and tested at least every five years by a qualified person, and the report given to the tenant before move-in.',
    detail: [
      'The report must show the installation is satisfactory, or you must do the remedial work within 28 days.',
      'Also check any portable appliances you supply.',
    ],
    source: { label: 'GOV.UK — Electrical safety standards in the private rented sector', url: 'https://www.gov.uk/government/publications/electrical-safety-standards-in-the-private-rented-sector-guidance-for-landlords-tenants-and-local-authorities' },
  },
  {
    id: 'epc',
    topic: 'energy performance',
    title: 'A valid EPC of band E or better is required',
    summary:
      'You need a valid Energy Performance Certificate, and you cannot let a property rated F or G without a registered exemption. Band C is proposed for 2030.',
    detail: [
      'Give the tenant a copy of the EPC before they move in.',
      'The government has consulted on raising the minimum to band C by 2030.',
    ],
    source: { label: 'GOV.UK — Energy Performance Certificates for landlords', url: 'https://www.gov.uk/guidance/energy-performance-certificates-what-landlords-need-to-know' },
  },
  {
    id: 'alarms',
    topic: 'alarms',
    title: 'Smoke alarms on every storey, carbon monoxide where needed',
    summary:
      'Smoke alarms must be fitted on every storey of the property used as living accommodation, and carbon monoxide alarms where there is a solid fuel appliance or a relevant gas appliance.',
    detail: [
      'They must be tested on the day the tenancy starts.',
      'Record in the inventory that they were tested and working.',
    ],
    source: { label: 'GOV.UK — Smoke and carbon monoxide alarm requirements', url: 'https://www.gov.uk/government/publications/smoke-and-carbon-monoxide-alarms-guidance-for-landlords' },
  },
  {
    id: 'right-to-rent',
    topic: 'right to rent',
    title: 'Right to rent checks are required before the tenancy starts',
    summary:
      'You must check that every adult tenant has the right to rent in England, and keep evidence of the check.',
    detail: [
      'Use the Home Office right to rent service to check a share code, or inspect original documents in person.',
      'Keep copies for the duration of the tenancy and two years afterwards.',
    ],
    source: { label: 'GOV.UK — Right to rent checks', url: 'https://www.gov.uk/check-tenant-right-to-rent-documents' },
  },
  {
    id: 'how-to-rent',
    topic: 'how to rent',
    title: 'Give the tenant the How to Rent guide',
    summary:
      'The current How to Rent guide must be given to the tenant at the start of the tenancy. It is needed later if the landlord wants to serve notice.',
    detail: [
      'Give the latest version, and record the date you gave it.',
      'For a new tenancy starting after 1 May 2026, give the current version in force on that date.',
    ],
    source: { label: 'GOV.UK — How to rent: the checklist for renting in England', url: 'https://www.gov.uk/government/publications/how-to-rent' },
  },
  {
    id: 'prs-database',
    topic: 'landlord registration',
    title: 'The PRS Database and Landlord Ombudsman are coming',
    summary:
      'From late 2026 landlords must register with the government PRS Database. Membership of the PRS Landlord Ombudsman is expected to become mandatory later.',
    detail: [
      'Registration will require landlord contact details, property details and safety certificates.',
      'Watch for the fee and the registration route being confirmed.',
    ],
    source: { label: 'GOV.UK — Renters’ Rights Act implementation roadmap', url: GOV_UK_RRA },
  },
  {
    id: 'client-money',
    topic: 'agency compliance',
    title: 'Agencies must display client money protection and redress scheme membership',
    summary:
      'If you hold client money — deposits or rent — you must belong to a government-approved client money protection scheme and a redress scheme, and say so on your paperwork.',
    detail: [
      'Your scheme names should appear on agreements, invoices and your website.',
      'Check your professional body’s rules for the exact wording.',
    ],
    source: { label: 'GOV.UK — Client money protection schemes for property agents', url: 'https://www.gov.uk/government/publications/client-money-protection-schemes-for-property-agents' },
  },
];

/** Free-text search across the knowledge base, used by the agent's lookup tool. */
export function searchRules(query: string): Rule[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...RULES];
  const words = needle.split(/\s+/).filter((word) => word.length > 2);

  return RULES.map((rule) => {
    const haystack = `${rule.topic} ${rule.title} ${rule.summary} ${rule.detail.join(' ')}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (rule.topic.toLowerCase().includes(word)) score += 3;
      if (rule.title.toLowerCase().includes(word)) score += 2;
      if (haystack.includes(word)) score += 1;
    }
    return { rule, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.rule);
}

export const RULES_REVIEWED_ON = '2026-10-19';

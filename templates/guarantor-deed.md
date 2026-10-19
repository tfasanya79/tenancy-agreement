---
id: guarantor-deed
title: Deed of Guarantee
category: guarantee
jurisdiction: england-wales
version: "1.0"
updated: "2026-10-01"
description: Deed by which a guarantor guarantees the tenant's obligations under an assured periodic tenancy, executed as a deed with a witness.
required: [guarantor.full_name, guarantor.address, landlord.full_name, property.address_line1, tenants, tenancy.rent_amount]
---
# Deed of Guarantee

> This document is a deed. It must be signed by the Guarantor in the presence of an adult witness, and the witness must also sign. It is not validly executed unless both signatures appear in section 6.

## 1. The Parties

**1.1 The Landlord** is {{landlord.full_name}} of {{landlord.address}}, telephone {{landlord.phone}}, email {{landlord.email}}.

**1.2 The Tenant** is {{#each tenants}}{{this.full_name}}{{/each}}, of the Property described in clause 1.4.

**1.3 The Guarantor** is {{guarantor.full_name}} of {{guarantor.address}}, telephone {{guarantor.phone}}, email {{guarantor.email}}, who is the Tenant's {{guarantor.relationship}}.

**1.4 The Property** is {{property.address_line1}}, {{property.address_line2}}, {{property.city}}, {{property.postcode}}, let to the Tenant by an assured periodic tenancy beginning {{tenancy.start_date|date}} at a rent of {{tenancy.rent_amount|money}} {{tenancy.rent_frequency}}.

## 2. The Guarantee

**2.1** In consideration of the Landlord granting the tenancy to the Tenant, the Guarantor guarantees to the Landlord that the Tenant will pay the rent and perform every obligation of the Tenant under the tenancy agreement.

**2.2** If the Tenant fails to pay any sum due, or fails to perform any obligation, the Guarantor will pay that sum or make good that failure to the Landlord on written demand, as if the Guarantor were the principal debtor.

**2.3** The Guarantor's liability under this deed covers the rent, any other sums properly payable under the tenancy, the reasonable costs of enforcing this guarantee, and the reasonable cost of remedying any damage to the Property beyond fair wear and tear for which the Tenant is responsible.

**2.4** The Guarantor's liability is limited to the rent for the whole of the tenancy together with any arrears, losses and reasonable enforcement costs arising during the tenancy or within three months of it ending.

**2.5** This guarantee is a continuing guarantee. It continues for the whole of the tenancy, including any period after the tenancy becomes periodic, and it is not released by any variation of the tenancy agreed between the Landlord and the Tenant, by any period of delay or forbearance by the Landlord, or by the release of any other guarantor.

**2.6** The Guarantor's liability is joint and several with the Tenant. The Landlord may enforce this guarantee against the Guarantor without first taking proceedings against the Tenant or any other person.

## 3. What the Guarantor Is Entitled To

**3.1** The Guarantor is entitled to a copy of the tenancy agreement, the inventory and check-in report and any notice of arrears relating to this guarantee.

**3.2** The Guarantor may ask the Landlord for information about the Tenant's account at any reasonable time, and the Landlord will provide it within 14 days of a written request.

**3.3** If the Guarantor pays a sum under this guarantee, the Guarantor may recover that sum from the Tenant, but may not take any step that would prejudice the Landlord's position.

## 4. Notices

**4.1** Any demand under this deed must be in writing and delivered by hand, sent by first class post to the address in clause 1.3, or sent by email to the address in clause 1.3.

**4.2** A notice sent by first class post is treated as received on the second working day after posting.

**4.3** The Guarantor must tell the Landlord in writing within 14 days of any change of the Guarantor's address, telephone number or email address.

## 5. Data Protection and Governing Law

**5.1** The Landlord and the Agent may hold and use the Guarantor's personal data to administer this guarantee and to recover sums due, and may share it with the deposit scheme, professional advisers and a court where necessary, in accordance with the UK GDPR.

**5.2** This deed is governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.

**5.3** The Guarantor confirms that they have had the opportunity to take independent legal advice before signing, understand that this is a deed and that they may become liable for the Tenant's obligations, and sign it voluntarily.

## 6. Execution as a Deed

Signed as a deed by the Guarantor, {{guarantor.full_name}}, in the presence of the witness below.

| Signatory | Name | Signature | Date |
| --- | --- | --- | --- |
| Guarantor | {{guarantor.full_name}} | | |
| Witness | | | |

**Witness details.** The witness must be at least 18 years old, must not be a party to this deed, and must be present when the Guarantor signs.

| Witness detail | Entry |
| --- | --- |
| Full name | |
| Address | |
| Occupation | |

Signed by or on behalf of the Landlord:

**Landlord** — {{landlord.full_name}}

Signature: ______________________________________  Date: ____________________

{{#if agent.company_name}}
**Agent for the Landlord** — {{agent.name}} for {{agent.company_name}}

Signature: ______________________________________  Date: ____________________
{{/if}}

The Tenant acknowledges receipt of a copy of this deed and consents to the Landlord giving the Guarantor information about the Tenant's account as set out in clause 3.

{{#each tenants}}
**Tenant** — {{this.full_name}}

Signature: ______________________________________  Date: ____________________

{{/each}}

> *This document was assembled by TenancyDesk from a template. It is not legal advice. Always check the current law before signing.*

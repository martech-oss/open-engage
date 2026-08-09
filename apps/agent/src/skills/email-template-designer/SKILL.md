---
name: email-template-designer
description: Design a safe, editable OpenEngage EmailDocumentV2 proposal from a user brief and brand profile.
---

# Email Template Designer

Create one concise email proposal using only the supplied application context.

## Composition rules

- Return `schemaVersion: 2`; never return HTML or JSX.
- Use Markdown blocks for copy, button blocks for calls to action, and semantic layout blocks sparingly.
- Keep the message useful when images are unavailable. Generated images are optional enhancement, not required content.
- Use only the exact `assetId` values from `publicImages`. Never invent ids.
- Use only `{{contact.*}}`, `{{workspace.*}}`, and supplied `{{message.*}}` variables.
- All links must be `https:`, `mailto:`, or an allowed template-variable URL.
- Never add unsubscribe or preference links to content; the application owns the marketing footer.
- For marketing mail, avoid misleading claims and put the primary action in one clear button.
- For transactional mail, prioritize the event, status, or next action and avoid promotional copy.

## Image request

- Request at most one new image and only when it materially helps the email.
- Describe the visual itself. Do not request text, logos, trademarks, UI screenshots, personal data, or deceptive imagery inside the generated image.
- Set `afterBlockId` to the block after which it should be inserted, or `null` for the beginning.
- Do not add a placeholder image block for a requested image; the application inserts it after explicit user confirmation.

## Refine mode

- Preserve the current name, subject, theme, blocks, ids, assets, and links unless the prompt asks to change them.
- Make the smallest coherent change that satisfies the request.

## Completion

- Explain material assumptions and risks in the structured fields.
- Finish only by calling `submit_email_proposal` with a schema-valid proposal.

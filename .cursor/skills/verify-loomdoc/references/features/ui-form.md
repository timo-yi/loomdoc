# UI form

The page is one form. The user pastes a video link, picks a document style, optionally adds guidance and audience, chooses output options, and presses **Generate document**. The page checks the form before it asks the server to start a run.

## Sub-features

- `form-styles` lists eight styles. **How-to guide** is selected by default.
- `form-empty` asks for a link when the video field is empty.
- `form-bad-link` rejects text that is not a Loom or YouTube URL.
- `form-custom` requires guidance when **Custom** is selected, and the guidance label says it is required.
- `form-formats` requires at least one of Markdown, Word, or PDF.
- `form-output` opens PDF layout, model, and effort from **Output options**.
- `form-audience` opens audience, role, industry, and use case from **Audience and context**.

## How to get to it (user POV)

- Open the private link from `loomdoc ui`. The form is the whole page.
- Choose a style card.
- Open **Audience and context** or **Output options**. Both start collapsed.

## Driving it with control-loomdoc

Preconditions:

- [UI session](ui-session.md) is ready with `--placeholder-key`.
- `control-loomdoc doctor` reports `activeRunId` null.

- **Empty link.** Run `control-loomdoc browser click --role button --name "Generate document"`, then `control-loomdoc browser wait --text "Paste a Loom or YouTube link."`. The alert role is `#form-error`.
- **Custom without guidance.** Run `control-loomdoc browser click --role radio --name "Custom"`, then `control-loomdoc browser fill --selector "#url" --value "https://www.loom.com/share/abcdef0123456789abcdef0123456789"`, then click `#submit`. The alert text is `The Custom style needs guidance describing the document you want.` The guidance label reads `(required for Custom)`.
- **Bad link.** Fill `#url` with `not a link`, check a format, and click `#submit`. The alert text is `That doesn't look like a link. Paste the full Loom or YouTube URL.`
- **No format.** Open output options with `control-loomdoc browser click --role DisclosureTriangle --name "Output options"`. Click `input[name=formats][value=markdown]`, the `docx` checkbox, and the `pdf` checkbox until all three are unchecked. Click `#submit`. The alert text is `Pick at least one output format.`
- **PDF layout.** With output options open, run `control-loomdoc browser fill --selector 'select[name=pdfLayout]' --value paged`. The returned value is `paged`.
- **Audience.** Run `control-loomdoc browser click --role DisclosureTriangle --name "Audience and context"`. The snapshot gains textboxes named `Audience`, `Their role`, `Industry`, and `Use case`.
- **Proof.** Run `control-loomdoc browser screenshot --selector "#form-error" --path <file>` after an alert. The PNG shows the loomdoc heading and the alert text. `browser network` has no `POST /api/runs` for these cases, because the page rejected them locally.
- **Cleanup.** Run `control-loomdoc stop`.

## Gotchas

- Preset accessible names include the card's summary. Pass a prefix such as `Custom` or `How-to guide`. The command fails if two names share that prefix.
- **How-to guide** is the default. **How-to** is not the accessible name.
- Format checkboxes toggle. Read `checked` with `browser eval` before assuming a click turned one on.
- `browser network` also lists `fetch` calls the helper makes, including `GET /api/config` from `doctor`.
- A failed check does not save preferences. A submit that passes the page's checks does.

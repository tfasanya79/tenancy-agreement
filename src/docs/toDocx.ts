/**
 * Render parsed Markdown to a Word document (.docx).
 *
 * Word is the practical interchange format for letting agents: it is what
 * e-signature tools accept, what landlords want to redline, and what prints
 * predictably. PDF is offered by the "print" view instead, so we need no
 * headless browser or office suite to be installed.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableCellOptions,
} from 'docx';

import type { Block, Inline } from './markdown.ts';

export type DocxMeta = {
  title: string;
  /** Small line printed under the title, e.g. "Reference: TD-2026-0007". */
  subtitle?: string;
  /** Running footer text, e.g. the agency name. */
  footerText?: string;
};

const BODY_FONT = 'Georgia';
const BODY_SIZE = 21; // half-points → 10.5pt
const INK = '1A1A1A';
const MUTED = '5A5A5A';
const RULE = 'C8C8C8';

function runsFromInline(inlines: Inline[], options: { size?: number; color?: string; allBold?: boolean; allItalic?: boolean } = {}): TextRun[] {
  const size = options.size ?? BODY_SIZE;
  const color = options.color ?? INK;
  return inlines.map(
    (run) =>
      new TextRun({
        text: run.text,
        bold: options.allBold === true || run.bold === true,
        italics: options.allItalic === true || run.italic === true,
        font: BODY_FONT,
        size,
        color,
      }),
  );
}

function headingParagraph(level: 1 | 2 | 3, inlines: Inline[]): Paragraph {
  if (level === 1) {
    return new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: runsFromInline(inlines, { size: 40, color: INK, allBold: true }),
    });
  }
  if (level === 2) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 140 },
      children: runsFromInline(inlines, { size: 26, color: INK, allBold: true }),
    });
  }
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: runsFromInline(inlines, { size: 22, color: INK, allBold: true }),
  });
}

function tableBlock(headers: string[], rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (header) =>
        new TableCell({
          shading: { fill: 'F4F1EC' },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          children: [new Paragraph({ children: runsFromInline([{ text: header }], { size: 19, allBold: true }) })],
        } satisfies ITableCellOptions),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: headers.map(
          (_header, index) =>
            new TableCell({
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 90, bottom: 90, left: 120, right: 120 },
              children: [
                new Paragraph({ children: runsFromInline([{ text: row[index] ?? '' }], { size: 19 }) }),
              ],
            } satisfies ITableCellOptions),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headerRow, ...bodyRows],
  });
}

function blockToParagraphs(block: Block): Array<Paragraph | Table> {
  switch (block.type) {
    case 'heading':
      return [headingParagraph(block.level, block.inlines)];

    case 'paragraph':
      return [
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160, line: 300 },
          children: runsFromInline(block.inlines),
        }),
      ];

    case 'quote':
      return [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 120, after: 160, line: 280 },
          indent: { left: 240 },
          shading: { fill: 'F7F4EF' },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'B9A88F', space: 8 } },
          children: runsFromInline(block.inlines, { size: 19, allItalic: true, color: MUTED }),
        }),
      ];

    case 'bullets':
      return block.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80, line: 280 },
            children: runsFromInline(item),
          }),
      );

    case 'numbered':
      return block.items.map(
        (item) =>
          new Paragraph({
            spacing: { after: 80, line: 280 },
            indent: { left: 360, hanging: 360 },
            children: runsFromInline(item),
          }),
      );

    case 'table':
      return [tableBlock(block.headers, block.rows)];

    case 'rule':
      return [
        new Paragraph({
          spacing: { before: 120, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
          children: [new TextRun({ text: '', size: 2 })],
        }),
      ];

    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

export async function renderDocx(blocks: Block[], meta: DocxMeta): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  if (meta.subtitle !== undefined && meta.subtitle !== '') {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320 },
        children: runsFromInline([{ text: meta.subtitle }], { size: 18, color: MUTED }),
      }),
    );
  } else {
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: '', size: 2 })] }));
  }

  for (const block of blocks) children.push(...blockToParagraphs(block));

  // A closing line so every document states plainly what produced it.
  children.push(
    new Paragraph({
      spacing: { before: 480 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
      children: runsFromInline(
        [{ text: 'Prepared with TenancyDesk. Check every detail, and the current law, before signing.' }],
        { size: 16, color: MUTED, allItalic: true },
      ),
    }),
  );

  const document = new Document({
    creator: 'TenancyDesk',
    title: meta.title,
    description: 'Tenancy document generated by TenancyDesk',
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: BODY_SIZE, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2 cm
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
                children: runsFromInline([{ text: meta.title }], { size: 15, color: MUTED }),
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: meta.footerText ?? '',
                    font: BODY_FONT,
                    size: 15,
                    color: MUTED,
                  }),
                  new TextRun({ text: '   ·   Page ', font: BODY_FONT, size: 15, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], font: BODY_FONT, size: 15, color: MUTED }),
                  new TextRun({ text: ' of ', font: BODY_FONT, size: 15, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: BODY_FONT, size: 15, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

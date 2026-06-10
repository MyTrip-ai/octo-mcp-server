/**
 * Terminal UI primitives — zero dependencies (ANSI + node:readline).
 * Color auto-disables when not a TTY or when NO_COLOR is set (keeps test output clean).
 */

import * as readline from "node:readline/promises";

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = wrap("1");
export const dim = wrap("2");
export const terracotta = wrap("38;5;167");
export const teal = wrap("38;5;36");
export const ochre = wrap("38;5;179");
export const clay = wrap("38;5;130");
export const faint = wrap("38;5;102");

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
// Approximate display width: emoji / wide symbols occupy two columns.
const charWidth = (cp: number) => (cp >= 0x1f000 || cp === 0x231a || cp === 0x231b || cp === 0x23f0 || cp === 0x23f3) ? 2 : 1;
const vlen = (s: string) => { let w = 0; for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0)!); return w; };

export interface IO {
  ask(q: string): Promise<string>;
  out(s?: string): void;
  close(): void;
}

export function readlineIO(): IO {
  const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q) => iface.question(q),
    out: (s = "") => void process.stdout.write(s + "\n"),
    close: () => iface.close(),
  };
}

/** In-memory IO for non-interactive tests: feeds scripted answers, captures output. */
export function bufferIO(answers: string[]): { io: IO; text: () => string } {
  const buf: string[] = [];
  let i = 0;
  return {
    io: {
      ask: async (q) => {
        buf.push(q);
        if (i >= answers.length) throw new Error(`bufferIO: ran out of scripted answers at prompt: ${stripAnsi(q)}`);
        const a = answers[i++];
        buf.push("› " + a);
        return a;
      },
      out: (s = "") => void buf.push(s),
      close: () => {},
    },
    text: () => buf.join("\n"),
  };
}

/** A rounded box with an optional title; color applies to the border. */
export function box(content: string[], color: (s: string) => string = (x) => x, title = ""): string {
  const w = Math.min(74, Math.max(vlen(title) + 2, ...content.map(vlen)));
  const pad = (l: string) => l + " ".repeat(Math.max(0, w - vlen(l)));
  const head = title ? `─ ${title} `.padEnd(w + 2, "─") : "─".repeat(w + 2);
  const lines = [color("╭" + head + "╮")];
  for (const l of content) lines.push(color("│ ") + pad(l) + color(" │"));
  lines.push(color("╰" + "─".repeat(w + 2) + "╯"));
  return lines.join("\n");
}

/** Wrap a long string to a width, preserving words. */
export function wrapText(s: string, width = 68): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { out.push(line.trim()); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export const glass = (toolName: string) => dim(`   🔌 ${toolName}`);

export function splash(): string {
  return [
    "",
    bold(terracotta("  M E R I D I A N")),
    faint("  an unofficial OCTO experience"),
    "",
    "  " + "Watch an AI book real tours across every connected supplier —",
    "  " + "through one open standard.",
    faint("  Unofficial demo · not affiliated with OCTO."),
    "",
  ].join("\n");
}

export function callout(text: string): string {
  return box(["💡 " + wrapText(text, 66)[0], ...wrapText(text, 66).slice(1).map((l) => "   " + l)], ochre, "WHY THIS MATTERS");
}

export function recap(): string {
  return box(
    [
      bold("1. A new distribution channel."),
      "   When travelers ask their AI to book experiences, OCTO can be",
      "   the rails between agent and supplier.",
      "",
      bold("2. Build once, reach every supplier."),
      "   One MCP server fronts all OCTO suppliers — the standardization",
      "   that powers today's resellers powers AI agents tomorrow.",
      "",
      bold("3. OCTO can lead this."),
      "   A canonical \"agent-ready\" profile would let suppliers advertise",
      "   AI-readiness — and put OCTO ahead of the curve.",
    ],
    teal,
    "WHAT THIS MEANS FOR OCTO",
  );
}

export function bookingBox(b: any, done: boolean): string {
  const lines = [
    bold(done ? "✓ Confirmed" : "⏳ On hold") + "  ·  " + (b.ref || ""),
    faint(b.when || ""),
    bold(b.total || ""),
  ];
  if (done) {
    if (b.supplierRef) lines.push(faint("Supplier ref " + b.supplierRef));
    if (b.voucherUrl) {
      const url = b.voucherUrl.length > 48 ? b.voucherUrl.slice(0, 47) + "…" : b.voucherUrl;
      lines.push(faint(`Voucher (${b.voucherFormat}) ✓  ${url}`));
    }
  } else if (b.expiresMin) {
    lines.push(faint(`Held — expires in ${b.expiresMin} min. Nothing is charged yet.`));
  }
  return box(lines, done ? teal : ochre);
}

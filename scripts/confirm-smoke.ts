/**
 * Confirm-booking body test: suppliers like Ventrata require a contact on EVERY ticket
 * (unit requiredContactFields), not only the lead contact. Checks the adapter sends the
 * lead contact on each existing unit item, with first/last name split out.
 * No network — fetch is stubbed.
 *
 * Run: npm run confirm-smoke
 */

import { HttpOctoAdapter } from "../src/octo/httpAdapter.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

const sent: Array<{ method: string; url: string; body: any }> = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  sent.push({ method, url, body });
  const booking = {
    uuid: "b1",
    status: url.endsWith("/confirm") ? "CONFIRMED" : "ON_HOLD",
    productId: "p1",
    optionId: "DEFAULT",
    unitItems: [
      { uuid: "t1", unitId: "adult" },
      { uuid: "t2", unitId: "child" },
    ],
  };
  return new Response(JSON.stringify(booking), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main(): Promise<void> {
  const a = new HttpOctoAdapter({ supplierId: "ventrata", baseUrl: "https://x.test", apiKey: "k" });
  const res = await a.confirmBooking("b1", {
    contact: { fullName: "Jane Doe Smith", emailAddress: "jane@example.com", phoneNumber: "+15555550100", country: "GB" },
  });

  const confirm = sent.find((s) => s.method === "POST" && s.url.endsWith("/bookings/b1/confirm"));
  check("confirm request sent", !!confirm);
  const body = confirm?.body ?? {};
  check("lead contact sent", body.contact?.emailAddress === "jane@example.com");
  check("lead contact has first/last name split", body.contact?.firstName === "Jane" && body.contact?.lastName === "Doe Smith", JSON.stringify(body.contact));
  check("lead contact keeps fullName", body.contact?.fullName === "Jane Doe Smith");

  const items = body.unitItems ?? [];
  check("every existing ticket is sent", items.length === 2, `${items.length} unit items`);
  check("tickets keep their uuid + unitId (no new tickets)", items[0]?.uuid === "t1" && items[0]?.unitId === "adult" && items[1]?.uuid === "t2" && items[1]?.unitId === "child", JSON.stringify(items.map((i: any) => [i.uuid, i.unitId])));
  check("each ticket carries the contact", items.every((i: any) => i.contact?.emailAddress === "jane@example.com" && i.contact?.firstName === "Jane"));
  check("booking comes back CONFIRMED", res.status === "CONFIRMED", res.status);

  // single-word name: no invented last name
  sent.length = 0;
  await a.confirmBooking("b1", { contact: { fullName: "Cher", emailAddress: "c@example.com" } });
  const c2 = sent.find((s) => s.url.endsWith("/confirm"))?.body;
  check("single-word name → firstName only, no invented lastName", c2?.contact?.firstName === "Cher" && c2?.contact?.lastName === undefined, JSON.stringify(c2?.contact));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

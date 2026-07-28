import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seedData } from "../src/data/seed";
import { exportExcel, exportWord, importExcel } from "../src/lib/officeExchange";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAC0lEQVR42u3PAQ0AAAgDINc/9K3hHFQgEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgZQAEAAZCe6QAAAABJRU5ErkJggg==";
const output = resolve("output", "office-qa");
const data = structuredClone(seedData);
data.settings.passwordTemplate = "Studio!2026{网站名称}";
data.settings.encryptImages = true;
data.services[0].icon = { id: "qa-steam-icon", name: "steam-icon.png", dataUrl: png };
data.accounts[0].images = [
  { id: "qa-code-image", name: "steam-security-code.png", dataUrl: png, sourceUrl: "https://help.steampowered.com/" },
  { id: "qa-backup-image", name: "backup-code.png", dataUrl: png },
];

await mkdir(output, { recursive: true });
const xlsx = await exportExcel(data);
const docx = await exportWord(data);
await writeFile(resolve(output, "account-notebook-sample.xlsx"), xlsx);
await writeFile(resolve(output, "account-notebook-sample.docx"), docx);

const roundTrip = await importExcel(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength), "account-notebook-sample.xlsx");
if (roundTrip.data.services[0].icon?.dataUrl !== png || roundTrip.data.accounts[0].images.some((image) => image.dataUrl !== png)) {
  throw new Error("Office QA image round trip failed");
}
console.log(JSON.stringify({ output, xlsxBytes: xlsx.byteLength, docxBytes: docx.byteLength, counts: roundTrip.counts }, null, 2));

#!/usr/bin/env node
/**
 * 从 examples/icon.jpg 生成网站 favicon / PWA 图标，输出到 public/：
 *   favicon.ico            （16/32/48 多尺寸，内嵌 PNG）
 *   favicon-32.png
 *   apple-touch-icon.png   （180x180）
 *   icon-192.png / icon-512.png（PWA manifest）
 *
 * 用法：node scripts/generate-favicon.mjs
 */
import sharp from "sharp";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "examples", "icon.jpg");
const publicDir = resolve(repoRoot, "public");

function log(message) {
  process.stdout.write(`${message}\n`);
}

/** 把多张 PNG Buffer 打包成一个 ICO（PNG 压缩条目，Windows Vista+ / 现代浏览器均支持）。 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;
  const datas = [];

  images.forEach(({ size, data }, index) => {
    const entry = directory.subarray(index * 16, index * 16 + 16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    datas.push(data);
  });

  return Buffer.concat([header, directory, ...datas]);
}

async function png(size) {
  // cover：源图已是正方形，这里保证严格方形输出。
  return sharp(source)
    .rotate()
    .resize(size, size, { fit: "cover", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const icoSizes = [16, 32, 48];
  const icoImages = [];
  for (const size of icoSizes) {
    const data = await png(size);
    icoImages.push({ size, data });
    if (size === 32) {
      writeFileSync(resolve(publicDir, "favicon-32.png"), data);
      log(`wrote favicon-32.png (${data.length} bytes)`);
    }
  }

  const ico = packIco(icoImages);
  writeFileSync(resolve(publicDir, "favicon.ico"), ico);
  log(`wrote favicon.ico (${ico.length} bytes, sizes ${icoSizes.join("/")})`);

  for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
    const data = await png(size);
    writeFileSync(resolve(publicDir, name), data);
    log(`wrote ${name} (${data.length} bytes)`);
  }

  // 自检：ICO 头可读。
  const check = readFileSync(resolve(publicDir, "favicon.ico"));
  if (check.readUInt16LE(2) !== 1 || check.readUInt16LE(4) !== icoSizes.length) {
    throw new Error("favicon.ico header verification failed");
  }
  log("done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

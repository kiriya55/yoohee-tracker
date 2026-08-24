#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const INDEX_KEY = "miniprogram-resource-index.json";
const DEFAULT_MIN_ITEMS = 251;

function parseArgs(argv) {
  const args = {
    index: "public/images/resource-index.json",
    imageRoot: "public/images",
    artifactPath: "output/miniprogram-resource-artifact/miniprogram-resource-index.json",
    minItems: DEFAULT_MIN_ITEMS,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--index") args.index = argv[++i];
    else if (arg === "--image-root") args.imageRoot = argv[++i];
    else if (arg === "--artifact-path") args.artifactPath = argv[++i];
    else if (arg === "--min-items") args.minItems = Math.max(1, Number(argv[++i]) || DEFAULT_MIN_ITEMS);
    else if (arg === "--public-base-url") args.publicBaseUrl = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-miniprogram-resources.mjs [options]

Options:
  --index <file>             Generated resource index. Default: public/images/resource-index.json
  --image-root <dir>         Root containing /images paths. Default: public/images
  --artifact-path <file>     Artifact copy path. Default: output/miniprogram-resource-artifact/miniprogram-resource-index.json
  --min-items <n>            Minimum catalog item count. Default: ${DEFAULT_MIN_ITEMS}
  --public-base-url <url>    Public R2 base URL used for post-upload verification
  --dry-run                  Validate and write the artifact without uploading
`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function imageKeyForItem(item) {
  const localIcon = String(item?.localIcon ?? "");
  if (!localIcon.startsWith("/images/")) {
    throw new Error(`Resource ${item?.id ?? "unknown"} has no /images localIcon`);
  }

  const key = localIcon.slice("/images/".length).replaceAll("\\", "/");
  if (!key || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Resource ${item?.id ?? "unknown"} has an unsafe localIcon: ${localIcon}`);
  }
  return key;
}

function contentTypeFor(key) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function resolveInside(root, key) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, ...key.split("/"));
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resource path escapes image root: ${key}`);
  }
  return absolutePath;
}

export async function validateCatalog(index, imageRoot, { minItems = DEFAULT_MIN_ITEMS } = {}) {
  if (!isObject(index) || index.format !== "gf2-resource-index" || !isObject(index.items)) {
    throw new Error("Invalid resource index: expected gf2-resource-index with an items object");
  }

  const items = Object.values(index.items);
  if (items.length < minItems) {
    throw new Error(`Resource index has ${items.length} items; expected at least ${minItems}`);
  }

  const assets = [];
  const seenKeys = new Set();
  for (const item of items) {
    const key = imageKeyForItem(item);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const sourcePath = resolveInside(imageRoot, key);
    let stat;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      throw new Error(`Missing local resource image: ${sourcePath}`);
    }
    if (!stat.isFile()) throw new Error(`Local resource image is not a file: ${sourcePath}`);
    assets.push({ key, sourcePath, contentType: contentTypeFor(key) });
  }

  return {
    itemCount: items.length,
    imageCount: assets.length,
    assets: assets.sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export async function buildUploadPlan(index, imageRoot, artifactPath, options = {}) {
  const validation = await validateCatalog(index, imageRoot, options);
  const serializedIndex = `${JSON.stringify(index, null, 2)}\n`;
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, serializedIndex, "utf8");

  return {
    ...validation,
    objects: [
      ...validation.assets.map((asset) => ({
        ...asset,
        cacheControl: "public, max-age=31536000, immutable",
      })),
      {
        key: INDEX_KEY,
        sourcePath: artifactPath,
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store, max-age=0, must-revalidate",
      },
    ],
  };
}

export async function uploadPlan(plan, { client, bucket }) {
  if (!client || !bucket) throw new Error("R2 client and bucket are required");

  for (const object of plan.objects) {
    const body = await fs.readFile(object.sourcePath);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: object.key,
      Body: body,
      ContentType: object.contentType,
      CacheControl: object.cacheControl,
    }));
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: object.key,
    }));
  }

  return {
    uploaded: plan.objects.length,
    itemCount: plan.itemCount,
    imageCount: plan.imageCount,
  };
}

async function verifyPublicIndex(publicBaseUrl, expectedIndex) {
  if (!publicBaseUrl) return;
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  const response = await fetch(new URL(INDEX_KEY, base), {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Public R2 index verification failed: HTTP ${response.status}`);
  const actual = await response.json();
  const actualCount = isObject(actual.items) ? Object.keys(actual.items).length : 0;
  if (actual.format !== expectedIndex.format || actualCount !== Object.keys(expectedIndex.items).length) {
    throw new Error(`Public R2 index verification failed: expected ${Object.keys(expectedIndex.items).length} items, got ${actualCount}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = JSON.parse(await fs.readFile(args.index, "utf8"));
  const plan = await buildUploadPlan(index, args.imageRoot, args.artifactPath, { minItems: args.minItems });
  console.log(`Validated ${plan.itemCount} catalog items and ${plan.imageCount} image objects`);
  console.log(`Wrote Action artifact index to ${args.artifactPath}`);

  if (args.dryRun) return;

  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  const result = await uploadPlan(plan, { client, bucket: R2_BUCKET_NAME });
  await verifyPublicIndex(args.publicBaseUrl, index);
  console.log(`Uploaded and HEAD-verified ${result.imageCount} images, then ${INDEX_KEY}`);
  if (args.publicBaseUrl) console.log(`Public R2 index verified at ${args.publicBaseUrl}/${INDEX_KEY}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

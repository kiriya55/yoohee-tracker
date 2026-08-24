import sharp from "sharp";

export async function convertDollToPng(input, options = {}) {
  let image = sharp(input).ensureAlpha();
  if (options.crop) {
    const metadata = await image.metadata();
    const sourceWidth = Number(metadata.width);
    const sourceHeight = Number(metadata.height);
    const referenceWidth = Number(options.crop.referenceWidth) || sourceWidth;
    const referenceHeight = Number(options.crop.referenceHeight) || sourceHeight;
    const scaleX = sourceWidth / referenceWidth;
    const scaleY = sourceHeight / referenceHeight;
    image = image.extract({
      left: Math.round((Number(options.crop.left) || 0) * scaleX),
      top: Math.round((Number(options.crop.top) || 0) * scaleY),
      width: Math.round(Number(options.crop.width) * scaleX),
      height: Math.round(Number(options.crop.height) * scaleY),
    });
  }
  return image
    .resize(128, 128, { fit: "fill" })
    .png()
    .toBuffer();
}

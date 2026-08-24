import sharp from "sharp";

export async function convertDollToPng(input, options = {}) {
  let image = sharp(input).ensureAlpha();
  if (options.crop) {
    image = image.extract({
      left: Number(options.crop.left) || 0,
      top: Number(options.crop.top) || 0,
      width: Number(options.crop.width),
      height: Number(options.crop.height),
    });
  }
  return image
    .resize(128, 128, { fit: "fill" })
    .png()
    .toBuffer();
}

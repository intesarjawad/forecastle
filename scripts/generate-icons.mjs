import sharp from "sharp";

const directory = new URL("../site/public/", import.meta.url);
for (const [size, filename] of [
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"],
]) {
  await sharp(new URL("favicon.svg", directory).pathname)
    .resize(size, size)
    .png()
    .toFile(new URL(filename, directory).pathname);
  console.log(`${filename}: ${size}x${size}`);
}

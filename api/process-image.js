const sharp = require("sharp");
const { v4: uuid } = require("uuid");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageUrl, operations } = req.body;

  if (!imageUrl || !operations || !Array.isArray(operations)) {
    return res.status(400).json({ error: "Missing imageUrl or operations" });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(buffer);

    let processed = sharp(imageBuffer);
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    if (operations.includes("normalize")) processed = processed.normalize();
    if (operations.includes("convert")) processed = processed.toFormat("png");
    if (operations.includes("crop")) {
      processed = processed.extract({
        left: Math.floor(width * 0.1),
        top: Math.floor(height * 0.1),
        width: Math.floor(width * 0.8),
        height: Math.floor(height * 0.8)
      });
    }
    if (operations.includes("trim")) processed = processed.trim();

    const pngBuffer = await processed.png().toBuffer();
    const fileName = `garments/${uuid()}.png`;

    const { data, error: uploadError } = await supabase.storage
      .from("garment-images")
      .upload(fileName, pngBuffer, { contentType: "image/png", upsert: false });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: signedData } = await supabase.storage
      .from("garment-images")
      .createSignedUrl(fileName, 7 * 24 * 60 * 60);

    res.json({
      success: true,
      processedImageUrl: signedData.signedUrl,
      storagePath: data.path,
      fileName
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Image processing failed" });
  }
};

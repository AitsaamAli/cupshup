"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_DIMENSION = 800; // px, longest side — plenty for a menu tile or POS thumbnail
const JPEG_QUALITY = 0.82;

/**
 * Resizes an image file entirely in the browser (Canvas), so uploads stay
 * small and consistent without needing a server-side image library. Runs
 * before the file ever leaves the device.
 */
async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

/**
 * Resizes then uploads a menu item photo to the `menu-images` Storage
 * bucket (see 0007_menu_storage.sql — write access is owner/manager
 * only, enforced by Storage RLS, not just by who can see this button).
 * Returns the public URL; the caller still has to save that URL onto the
 * item via `upsert_menu_item()`.
 */
export async function uploadMenuItemImage(itemId: string, file: File): Promise<string> {
  const resized = await resizeImage(file);
  const supabase = createClient();
  const path = `${itemId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from("menu-images")
    .upload(path, resized, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
  return data.publicUrl;
}

import { useCallback, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import type { ApiClient } from "../../lib/api";
import { useApiClient } from "../../lib/api";
import { haptics } from "../../lib/haptics";

type FilePart = {
  uri: string;
  name: string;
  type: string;
};

function buildFilePart(asset: ImagePicker.ImagePickerAsset): FilePart {
  const fileName = asset.fileName ?? `upload-${Date.now()}.jpg`;
  const guessedType =
    asset.mimeType ??
    (fileName.endsWith(".png")
      ? "image/png"
      : fileName.endsWith(".webp")
      ? "image/webp"
      : fileName.endsWith(".gif")
      ? "image/gif"
      : "image/jpeg");
  return { uri: asset.uri, name: fileName, type: guessedType };
}

/**
 * Pick an image from the media library and upload it.
 *
 * Contract:
 * - Returns `null` for the non-error exit paths: permission denied, or the
 *   user cancelling the picker / no asset selected. Callers should treat
 *   `null` as "nothing to do" (no error UI).
 * - Throws on genuine upload failures (api reject, or a non-OK presigned
 *   PUT). Callers MUST catch and surface these (haptic + user-facing error),
 *   the same way `useImageUpload.pickAndUpload` does.
 *
 * This is the single source of truth for the upload/MIME mechanics shared by
 * the thumbnail path (`useImageUpload`) and per-step images (StepListEditor).
 */
export async function pickAndUploadImage(
  apiClient: ApiClient,
): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.85,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  const filePart = buildFilePart(asset);
  const form = new FormData();
  // RN's FormData accepts a blob descriptor; the typing isn't compatible with DOM lib.
  form.append("file", filePart as unknown as Blob);
  const res = await apiClient.recipes.uploadImage(form);
  if (res.upload_url) {
    const putRes = await fetch(res.upload_url, {
      method: "PUT",
      headers: { "Content-Type": filePart.type },
      // RN's fetch accepts the same blob descriptor as the body.
      body: filePart as unknown as BodyInit,
    });
    if (!putRes.ok) throw new Error("Failed to upload image to storage");
  }
  return res.file_url;
}

export function useImageUpload(initialUrl?: string | null) {
  const apiClient = useApiClient();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(initialUrl ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = useCallback(async () => {
    setError(null);
    // Distinguish permission-denied (preserve the original explicit message)
    // from the picker-cancel path before delegating to the shared uploader.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to attach an image.");
      return;
    }

    setIsUploading(true);
    try {
      const fileUrl = await pickAndUploadImage(apiClient);
      // null = user cancelled / no asset: leave state untouched, no error.
      if (fileUrl === null) return;
      setThumbnailUrl(fileUrl);
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setIsUploading(false);
    }
  }, [apiClient]);

  const clear = useCallback(() => {
    setThumbnailUrl(null);
    setError(null);
  }, []);

  return {
    thumbnailUrl,
    setThumbnailUrl,
    pickAndUpload,
    clear,
    isUploading,
    error,
  };
}

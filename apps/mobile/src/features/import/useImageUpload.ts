import { useCallback, useState } from "react";
import * as ImagePicker from "expo-image-picker";
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

export function useImageUpload(initialUrl?: string | null) {
  const apiClient = useApiClient();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(initialUrl ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = useCallback(async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setIsUploading(true);
    try {
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
      setThumbnailUrl(res.file_url);
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

import { apiFetch } from "./api";

export async function uploadRecipeImage(file: File, errLabel: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch("/recipes/upload-image", { method: "POST", body: form });
  if (!res.ok) {
    let detail = errLabel;
    try {
      const text = await res.text();
      if (text.trim()) {
        try {
          const data = JSON.parse(text);
          detail = (data?.detail || text) as string;
        } catch {
          detail = text;
        }
      }
    } catch {
      // keep errLabel
    }
    throw new Error(detail);
  }
  const { upload_url, file_url } = (await res.json()) as { upload_url: string; file_url: string };
  if (upload_url) {
    await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
  }
  return file_url;
}
